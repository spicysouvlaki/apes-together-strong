/**
 * Mix review without ears (dev-only, audio-demo.html). Renders typical gameplay offline through
 * the real engine — real turn-start batches from autoplay logs (turnlog.ts) through the
 * planner, interface sounds in between, over the age's music bed with a culture mix — and
 * measures what a listener would judge:
 *   - integrated loudness (BS.1770) of the whole mix per age, and its spread across ages
 *   - effects over music: each Sfx's loudest 400 ms vs the bed's short-term (3 s) level
 *   - clipping: peak and samples near full scale
 *   - fatigue: share of energy in 2–5 kHz (where phone speakers are loudest) per 3 s window
 *   - small speakers: share of each Sfx's energy above 300 Hz (phones roll off below that)
 */
import type { SimEvent } from '@contracts/sim-api';
import { bandShare, blockLoudness, dbfs, integratedLoudness, mixDown, peak, spectrum } from './analysis';
import { engineTarget, type SoakTarget } from './soak';
import { SFX_INFO } from './catalog';
import { buildGraph } from './graph';
import { busGains, DEFAULT_AUDIO_SETTINGS } from './levels';
import { mulberry32 } from './random';
import { RECIPES, SFX_LIST } from './recipes';
import { spawnSfx } from './sfxvoice';
import { TURN_LOG } from './turnlog';
import type { AmbienceScene, Sfx } from './types';

export const MIX_SR = 48000;

/** Typical culture mixes per age (normalised weights, as the UI sends them). */
export const MIX_SCENES: Record<'ancient' | 'classical' | 'exploration' | 'modern', AmbienceScene> = {
  ancient: { age: 'ancient', cultures: { egyptian: 1, greek: 0.4 } },
  classical: { age: 'classical', cultures: { greek: 1, arab: 0.55, chinese: 0.3 } },
  exploration: { age: 'exploration', cultures: { norse: 1, spanish: 0.7, inuit: 0.25 } },
  modern: { age: 'modern', cultures: { spanish: 1, mongol: 0.5, greek: 0.3 } },
};

/** One turn of interface sounds between turn starts (seconds after the turn start). */
const TURN_UI: readonly (readonly [number, Sfx])[] = [
  [1.6, 'select'], [2.3, 'move'], [3.2, 'tap'], [3.8, 'open'], [5.0, 'close'], [5.6, 'select'], [6.2, 'move'], [7.4, 'endTurn'],
];
export const TURN_SECONDS = 8;

type Make = (ctx: BaseAudioContext) => SoakTarget;

/** Render `seconds` of the engine on an offline context, running `script` at 0.1 s steps. */
export const renderSession = async (seconds: number, script: (t: number, target: SoakTarget) => void, make: Make = (ctx) => engineTarget(ctx).target, sr = MIX_SR): Promise<Float32Array[]> => {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const target = make(ctx);
  target.setSettings({ ...DEFAULT_AUDIO_SETTINGS });
  const step = 0.1;
  const steps = Math.round(seconds / step);
  script(0, target);
  target.tick();
  for (let k = 1; k < steps; k++) {
    void ctx.suspend(k * step).then(() => {
      script(Math.round(k * step * 10) / 10, target);
      target.tick();
      void ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  return [buf.getChannelData(0), buf.getChannelData(1)];
};

/** Turn-start batches of one age from the log, the busy ones first (a lively minute). */
const batchesFor = (age: string): SimEvent[][] => {
  const own = TURN_LOG.filter((b) => b.age === age);
  const pool = own.length >= 4 ? own : TURN_LOG;
  return [...pool].sort((a, b) => b.events.length - a.events.length || a.turn - b.turn).map((b) => b.events);
};

export interface MixOptions {
  seconds?: number;
  music?: boolean;
  sfx?: boolean;
}

/** A minute of gameplay in one age: turn starts every 8 s with UI sounds in between. */
export const renderGameplay = (age: keyof typeof MIX_SCENES, o: MixOptions = {}, make?: Make): Promise<Float32Array[]> => {
  const seconds = o.seconds ?? 60;
  const batches = batchesFor(age);
  const scene = MIX_SCENES[age];
  return renderSession(seconds, (t, target) => {
    if (t === 0 && o.music !== false) target.setAmbience(scene);
    if (o.sfx === false || t < 4) return;
    const turn = Math.floor((t - 4) / TURN_SECONDS);
    const within = Math.round(((t - 4) - turn * TURN_SECONDS) * 10) / 10;
    if (within === 0) target.playEvents(batches[turn % batches.length] ?? [], 'p1');
    for (const [at, sfx] of TURN_UI) if (Math.abs(within - at) < 0.05) target.play(sfx);
  }, make);
};

/** One Sfx alone through the graph at the default SFX volume (what the player hears). */
export const renderSfxAlone = async (sfx: Sfx, seed = 3, reverb = true, limiter = true): Promise<Float32Array[]> => {
  const recipe = RECIPES[sfx];
  const sr = MIX_SR;
  const ctx = new OfflineAudioContext(2, Math.ceil((recipe.dur + 1.2) * sr), sr);
  const g = buildGraph(ctx, { rand: mulberry32(seed), reverb, limiter });
  const level = busGains(DEFAULT_AUDIO_SETTINGS).sfx;
  g.sfxDry.gain.value = level;
  g.sfxWet.gain.value = level;
  spawnSfx(g, sfx, recipe.build(mulberry32(seed)), 0.01, 1, false);
  const buf = await ctx.startRendering();
  return [buf.getChannelData(0), buf.getChannelData(1)];
};

const median = (xs: number[]): number => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? -Infinity;
};

export interface SfxMix {
  sfx: Sfx;
  tier: string;
  /** Loudest 400 ms (LUFS) at default SFX volume. */
  momentaryMax: number;
  /** momentaryMax minus the classical bed's short-term median. */
  overBed: number;
  /** Share of energy above 300 Hz (dry). */
  above300: number;
  /** Peak before the master limiter at default volume (dBFS). */
  peakDb: number;
}

export interface MixReport {
  ages: { age: string; integrated: number; bed: number; bedShortTerm: number; peakDb: number; nearFull: number; harsh2to5k: number; bed2to5k: number }[];
  ageSpread: number;
  sfx: SfxMix[];
  failures: string[];
}

/** 2–5 kHz energy share, worst 3 s window. */
const worstBandWindow = (mono: Float32Array, sr: number, lo: number, hi: number): number => {
  const w = 3 * sr;
  let worst = 0;
  for (let s = 0; s + w <= mono.length; s += w / 2) {
    const sp = spectrum(mono.subarray(s, s + w), sr);
    worst = Math.max(worst, bandShare(sp.mags, sr, lo, hi));
  }
  return worst;
};

/** Thresholds the review checks (documented in the demo page guide). */
export const MIX_TARGETS = {
  integrated: [-30, -16] as const,
  ageSpread: 3,
  overBed: 8,
  /**
   * Interface clicks (SFX_INFO group 'Interface') are short transients that cut through by
   * their attack, and play on every tap; 8 dB over the bed would make them tiring.
   */
  overBedInterface: 4,
  above300: 0.4,
  peakDb: -1,
  /** A single effect alone never reaches the -1 dBFS ceiling (pre-limiter, default volume). */
  sfxPeakDb: -1.5,
  harsh2to5k: 0.35,
};

export type AgeMix = MixReport['ages'][number];

/** Gameplay mix and bed alone for one age. */
export const reviewAge = async (age: keyof typeof MIX_SCENES, make?: Make): Promise<AgeMix> => {
  const sr = MIX_SR;
  const full = await renderGameplay(age, {}, make);
  const bed = await renderGameplay(age, { sfx: false }, make);
  const from = 5 * sr; // after the bed's fade-in
  const fullS = full.map((c) => c.subarray(from));
  const bedS = bed.map((c) => c.subarray(from));
  let near = 0;
  for (const c of full) for (let i = 0; i < c.length; i++) if (Math.abs(c[i] ?? 0) > 0.88) near++;
  return {
    age,
    integrated: integratedLoudness(fullS, sr),
    bed: integratedLoudness(bedS, sr),
    bedShortTerm: median(blockLoudness(bedS, sr, 3, 1)),
    peakDb: dbfs(peak(full)),
    nearFull: near,
    harsh2to5k: worstBandWindow(mixDown(fullS), sr, 2000, 5000),
    bed2to5k: worstBandWindow(mixDown(bedS), sr, 2000, 5000),
  };
};

/**
 * One Sfx at default volume against a bed short-term level. Loudness is the loudest window of
 * the sound's own length (100–400 ms): BS.1770's 400 ms momentary window would under-read a
 * 120 ms click by 5 dB. The pre-limiter peak shows whether a sound leans on the limiter.
 */
export const reviewSfx = async (s: Sfx, bedRef: number): Promise<SfxMix> => {
  const wet = await renderSfxAlone(s);
  const dry = await renderSfxAlone(s, 3, false);
  const raw = await renderSfxAlone(s, 3, true, false);
  const win = Math.min(0.4, Math.max(0.1, RECIPES[s].dur));
  const momentaryMax = Math.max(...blockLoudness(wet, MIX_SR, win, 0.02));
  const sp = spectrum(mixDown(dry), MIX_SR);
  return { sfx: s, tier: RECIPES[s].tier, momentaryMax, overBed: momentaryMax - bedRef, above300: bandShare(sp.mags, MIX_SR, 300), peakDb: dbfs(peak(raw)) };
};

export const judgeMix = (ages: AgeMix[], sfx: SfxMix[]): MixReport => {
  const ints = ages.map((a) => a.integrated);
  const ageSpread = Math.max(...ints) - Math.min(...ints);
  const failures: string[] = [];
  const T = MIX_TARGETS;
  for (const a of ages) {
    if (a.integrated < T.integrated[0] || a.integrated > T.integrated[1]) failures.push(`${a.age}: integrated ${a.integrated.toFixed(1)} LUFS outside ${T.integrated.join('…')}`);
    if (a.peakDb > T.peakDb) failures.push(`${a.age}: peak ${a.peakDb.toFixed(1)} dBFS`);
    if (a.harsh2to5k > T.harsh2to5k) failures.push(`${a.age}: ${(a.harsh2to5k * 100).toFixed(0)}% of energy in 2–5 kHz`);
  }
  if (ageSpread > T.ageSpread) failures.push(`ages differ by ${ageSpread.toFixed(1)} dB`);
  for (const s of sfx) {
    const need = SFX_INFO[s.sfx].group === 'Interface' ? T.overBedInterface : T.overBed;
    if (s.overBed < need) failures.push(`${s.sfx}: only ${s.overBed.toFixed(1)} dB over the bed`);
    if (s.peakDb > T.sfxPeakDb) failures.push(`${s.sfx}: pre-limiter peak ${s.peakDb.toFixed(1)} dBFS`);
    if (s.above300 < T.above300) failures.push(`${s.sfx}: ${(s.above300 * 100).toFixed(0)}% above 300 Hz`);
  }
  return { ages, ageSpread, sfx, failures };
};

/** The whole review: every age, then every Sfx against the loudest bed. */
export const runMixReview = async (make?: Make, onProgress?: (msg: string) => void): Promise<MixReport> => {
  const ages: AgeMix[] = [];
  for (const age of Object.keys(MIX_SCENES) as (keyof typeof MIX_SCENES)[]) {
    onProgress?.(`rendering ${age}…`);
    ages.push(await reviewAge(age, make));
  }
  const bedRef = Math.max(...ages.map((a) => a.bedShortTerm));
  const sfx: SfxMix[] = [];
  for (const s of SFX_LIST) {
    onProgress?.(`measuring ${s}…`);
    sfx.push(await reviewSfx(s, bedRef));
  }
  return judgeMix(ages, sfx);
};
