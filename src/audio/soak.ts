/**
 * Browser soak test (dev-only, audio-demo.html): a long session compressed into one
 * OfflineAudioContext render. The real engine is attached to the offline context and driven
 * at 0.1 s steps exactly like the live scheduler, while a script fires hundreds of random
 * sounds, event batches and scene changes (including bursts), then goes quiet. Every node is
 * counted (accounting.ts), so a leak shows up as a live count that does not return to the
 * idle baseline. Rendering is faster than real time and needs no audio device.
 */
import type { SimEvent } from '@contracts/sim-api';
import { NodeLedger, instrumentContext } from './accounting';
import { WebAudioEngine } from './engine';
import { MAX_SFX_VOICES } from './levels';
import { mulberry32 } from './random';
import { SFX_LIST } from './recipes';
import { PLUCK_CACHE_BYTES } from './synth';
import type { AmbienceScene, AudioSettings, Sfx } from './types';

/** What the soak drives (the real engine; an adapter can wrap an older build for comparison). */
export interface SoakTarget {
  play(sfx: Sfx): void;
  playEvents(events: readonly SimEvent[], viewer: string): void;
  setAmbience(scene: AmbienceScene): void;
  setSettings(s: AudioSettings): void;
  tick(): void;
  /** Extra counters merged into each sample (drones, voices…). */
  extra?(): Record<string, number>;
}

export interface SoakSample {
  t: number;
  liveNodes: number;
  liveSources: number;
  [k: string]: number;
}

export interface SoakOptions {
  sfxCount?: number;
  sceneChanges?: number;
  /** Simulated seconds of activity, then `tail` seconds with ambience off. */
  seconds?: number;
  tail?: number;
  sampleRate?: number;
  seed?: number;
}

export interface SoakReport {
  baseline: number;
  samples: SoakSample[];
  /** Live nodes `settle` s after the last sound and with ambience off. */
  final: SoakSample;
  peakSources: number;
  peakSfxVoices: number;
  peakDrones: number;
  peakBuses: number;
  pluckBytes: number;
  bufferBytes: number;
  played: number;
  scenes: number;
  renderMs: number;
  checks: { name: string; ok: boolean; value: number | string; limit: string }[];
}

/**
 * Worst case for scheduled sources (oscillators + buffer sources) under the soak's spam: 8 rich
 * SFX voices (up to ~35 sources each, including queued ones) over the densest ambience. Normal
 * play peaks far lower; Safari on an iPhone 13 handles several hundred cheap sources.
 */
export const SOAK_SOURCE_CAP = 256;

const AGES = ['ancient', 'classical', 'exploration', 'modern'] as const;
const CULTURES = ['egyptian', 'greek', 'chinese', 'arab', 'norse', 'inuit', 'mongol', 'spanish'];

const randomScene = (r: () => number): AmbienceScene => {
  const cultures: Record<string, number> = {};
  const n = Math.floor(r() * 4);
  for (let i = 0; i < n; i++) cultures[CULTURES[Math.floor(r() * CULTURES.length)] ?? 'greek'] = Math.round(r() * 100) / 100;
  return { age: AGES[Math.floor(r() * AGES.length)] ?? 'ancient', cultures, crisis: r() < 0.25 };
};

const BUSY: SimEvent[] = [
  { type: 'turnStarted', turn: 30 },
  { type: 'productionCompleted', settlement: 's0', item: 'warrior', player: 'p1' },
  { type: 'researchCompleted', player: 'p1', tree: 'tech', id: 'bronze' },
  { type: 'cultureHint', player: 'p1', culture: 'greek', text: '' },
  { type: 'offerCreated', offer: 'o1', player: 'p1' },
  { type: 'combat', attacker: 'u1', attackerOwner: 'p1', defenderOwner: 'p2', defender: 'u2', at: { q: 0, r: 0 }, damageToAttacker: 3, damageToDefender: 30, attackerDied: false, defenderDied: true },
];

export const engineTarget = (ctx: BaseAudioContext): { target: SoakTarget; engine: WebAudioEngine } => {
  const e = new WebAudioEngine();
  e.attach(ctx);
  const target: SoakTarget = {
    play: (s) => e.play(s),
    playEvents: (ev, v) => e.playEvents(ev, v),
    setAmbience: (s) => e.setAmbience(s),
    setSettings: (s) => e.setSettings(s),
    tick: () => e.tick(),
    extra: () => {
      const s = e.stats();
      return { sfxVoices: s.sfxVoices, sfxSounding: s.sfxSounding, ambienceVoices: s.ambienceVoices, drones: s.drones, buses: s.ambienceBuses, pluckBytes: s.pluckBytes, bufferBytes: s.bufferBytes, schedulerTicks: s.scheduler.ticks };
    },
  };
  return { target, engine: e };
};

/**
 * Run the soak. `make` builds the target on the (already instrumented) context; by default the
 * real engine. Returns the timeline and pass/fail checks.
 */
export const runSoak = async (o: SoakOptions = {}, make: (ctx: BaseAudioContext) => SoakTarget = (ctx) => engineTarget(ctx).target): Promise<SoakReport> => {
  const sr = o.sampleRate ?? 16000;
  const seconds = o.seconds ?? 120;
  const tail = o.tail ?? 8;
  const total = seconds + tail;
  const sfxCount = o.sfxCount ?? 500;
  const sceneChanges = o.sceneChanges ?? 30;
  const r = mulberry32(o.seed ?? 11);
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  const ledger = new NodeLedger();
  instrumentContext(ctx, ledger);
  const target = make(ctx);
  target.setSettings({ sfxVolume: 80, musicVolume: 50, muted: false });
  const baseline = ledger.liveNodes;

  // The script: actions keyed by step (0.1 s).
  const step = 0.1;
  const steps = Math.round(total / step);
  const actions = new Map<number, (() => void)[]>();
  const at = (t: number, fn: () => void): void => {
    const k = Math.max(1, Math.round(t / step));
    const list = actions.get(k) ?? [];
    list.push(fn);
    actions.set(k, list);
  };
  let played = 0;
  let scenes = 0;
  // Random sounds over the session, a third of them in tight bursts (spam).
  for (let i = 0; i < sfxCount; i++) {
    const burst = i % 3 === 0;
    const t = burst ? 5 + Math.floor(r() * (seconds - 10) / 4) * 4 + r() * 0.3 : 1 + r() * (seconds - 6);
    const sfx = SFX_LIST[Math.floor(r() * SFX_LIST.length)] ?? 'tap';
    at(t, () => {
      target.play(sfx);
      played += 1;
    });
  }
  // Busy turn starts every 10 s.
  for (let t = 3; t < seconds - 5; t += 10) at(t, () => target.playEvents(BUSY, 'p1'));
  // Scene changes: one rapid burst (5 in 2 s), the rest spread out; a mute blip in the middle.
  const sceneTimes: number[] = [2, 40, 40.4, 40.9, 41.5, 42];
  while (sceneTimes.length < sceneChanges) sceneTimes.push(4 + r() * (seconds - 10));
  for (const t of sceneTimes) {
    const sc = randomScene(r);
    at(t, () => {
      target.setAmbience(sc);
      scenes += 1;
    });
  }
  at(seconds * 0.6, () => target.setSettings({ sfxVolume: 80, musicVolume: 50, muted: true }));
  at(seconds * 0.6 + 3, () => target.setSettings({ sfxVolume: 80, musicVolume: 50, muted: false }));
  // Then silence: ambience off, no more sounds.
  at(seconds, () => target.setAmbience({ age: null }));

  const samples: SoakSample[] = [];
  const sample = (t: number): void => {
    samples.push({ t, liveNodes: ledger.liveNodes, liveSources: ledger.liveSources, ...(target.extra?.() ?? {}) });
  };
  for (let k = 1; k < steps; k++) {
    void ctx.suspend(k * step).then(() => {
      for (const fn of actions.get(k) ?? []) fn();
      target.tick();
      if (k % 5 === 0) sample(k * step);
      void ctx.resume();
    });
  }
  const t0 = performance.now();
  await ctx.startRendering();
  const renderMs = performance.now() - t0;
  // 'ended' events of the last sources are delivered after rendering; let them land.
  await new Promise((res) => setTimeout(res, 50));
  sample(total);

  const final = samples[samples.length - 1] ?? { t: total, liveNodes: -1, liveSources: -1 };
  const max = (k: string): number => Math.max(0, ...samples.map((s) => s[k] ?? 0));
  const peakSources = ledger.snapshot().peakSources;
  const report: SoakReport = {
    baseline,
    samples,
    final,
    peakSources,
    peakSfxVoices: max('sfxSounding'),
    peakDrones: max('drones'),
    peakBuses: max('buses'),
    pluckBytes: max('pluckBytes'),
    bufferBytes: max('bufferBytes'),
    played,
    scenes,
    renderMs,
    checks: [],
  };
  const c = (name: string, ok: boolean, value: number | string, limit: string): void => {
    report.checks.push({ name, ok, value, limit });
  };
  c('live nodes back to idle baseline', final.liveNodes === baseline, final.liveNodes, `= ${baseline}`);
  c('no sources left running', final.liveSources === 0, final.liveSources, '= 0');
  c('SFX voices sounding never above the cap', report.peakSfxVoices <= MAX_SFX_VOICES, report.peakSfxVoices, `<= ${MAX_SFX_VOICES}`);
  c('drones never stack', report.peakDrones <= 3, report.peakDrones, '<= 3 (current, fading, one being cut)');
  c('ambience buses bounded', report.peakBuses <= 7 + 4, report.peakBuses, '<= 11');
  c('pluck cache bounded', report.pluckBytes <= PLUCK_CACHE_BYTES, report.pluckBytes, `<= ${PLUCK_CACHE_BYTES}`);
  c('simultaneous sources bounded', peakSources <= SOAK_SOURCE_CAP, peakSources, `<= ${SOAK_SOURCE_CAP} (sfx spam + ambience)`);
  return report;
};
