/**
 * Browser self-check: renders every Sfx and ambience scene with an OfflineAudioContext through
 * the real graph and measures it (we cannot listen, so we check): non-silent, peak <= -1 dBFS,
 * headroom before the limiter, no DC, duration within spec, clean start and end, no clicks,
 * RMS in range, spectral centroid in the intended band; ambience under a loudness ceiling,
 * without dropouts, clicks or jumps, including across a scene crossfade.
 * Dev-only (audio-demo.html).
 */
import { AmbiencePlayer } from './ambience';
import { activeRange, dbfs, dcOffset, loudnessCurve, maxJump, mixDown, peak, quietJump, rms, spectrum } from './analysis';
import { toPlayerScene } from './engine';
import { buildGraph } from './graph';
import { AMBIENCE_LEVEL } from './levels';
import { mulberry32 } from './random';
import { RECIPES, SFX_LIST, type Tier } from './recipes';
import { spawnSfx } from './sfxvoice';
import type { AmbienceScene, Sfx } from './types';

export const SR = 48000;

export interface Metric {
  name: string;
  value: number;
  unit: string;
  ok: boolean;
  limit: string;
}

export interface CheckResult {
  name: string;
  kind: 'sfx' | 'ambience';
  pass: boolean;
  metrics: Metric[];
  /** Mono render for thumbnails. */
  wave: Float32Array;
  mags: Float64Array;
  ms: number;
}

const RMS_RANGE: Record<Tier, readonly [number, number]> = {
  ui: [-44, -16],
  small: [-42, -14],
  event: [-40, -12],
  big: [-38, -10],
  fanfare: [-38, -10],
};

const render = async (seconds: number, build: (ctx: OfflineAudioContext) => void): Promise<Float32Array[]> => {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  build(ctx);
  const buf = await ctx.startRendering();
  return [buf.getChannelData(0), buf.getChannelData(1)];
};

const renderSfx = (sfx: Sfx, seed: number, o: { reverb: boolean; limiter: boolean }): Promise<Float32Array[]> => {
  const recipe = RECIPES[sfx];
  const tail = o.reverb ? 1.9 : 0.3;
  return render(recipe.dur + tail, (ctx) => {
    const g = buildGraph(ctx, { rand: mulberry32(seed), reverb: o.reverb, limiter: o.limiter });
    spawnSfx(g, sfx, recipe.build(mulberry32(seed)), 0, 1, false);
  });
};

const m = (name: string, value: number, unit: string, ok: boolean, limit: string): Metric => ({ name, value, unit, ok, limit });

export const checkSfx = async (sfx: Sfx, seed = 1): Promise<CheckResult> => {
  const t0 = performance.now();
  const recipe = RECIPES[sfx];
  const [wet, pre, dry] = await Promise.all([
    renderSfx(sfx, seed, { reverb: true, limiter: true }),
    renderSfx(sfx, seed, { reverb: true, limiter: false }),
    renderSfx(sfx, seed, { reverb: false, limiter: true }),
  ]);
  const dryMono = mixDown(dry);
  const pk = peak(wet);
  const prePk = peak(pre);
  const range = activeRange(dry, 0.001);
  const [a, b] = range ?? [0, 0];
  const durMs = ((b - a) / SR) * 1000;
  const dryPeak = peak(dry);
  const head = Math.max(...Array.from(dryMono.subarray(a, a + 10), (x) => Math.abs(x)));
  const tailLevel = peak(dry.map((c) => c.subarray(c.length - Math.floor(0.2 * SR))));
  const rmsDb = dbfs(rms(dry, a, b + 1));
  const [lo, hi] = RMS_RANGE[recipe.tier];
  const spec = spectrum(dryMono, SR);
  const metrics = [
    m('non-silent', dbfs(pk), 'dBFS', pk > 0.01, '> -40'),
    m('peak', dbfs(pk), 'dBFS', dbfs(pk) <= -1, '<= -1'),
    m('pre-limiter peak', dbfs(prePk), 'dBFS', dbfs(prePk) <= 0, '<= 0'),
    m('DC offset', Math.abs(dcOffset(dry, a, b + 1)), '', Math.abs(dcOffset(dry, a, b + 1)) < 0.002, '< 0.002'),
    m('duration', durMs, 'ms', durMs >= 50 && durMs <= recipe.dur * 1000 + 30, `50–${Math.round(recipe.dur * 1000 + 30)}`),
    m('start', head / (dryPeak || 1), 'x peak', head / (dryPeak || 1) < 0.3, '< 0.3 in 0.2 ms'),
    m('end', tailLevel, '', tailLevel < 0.0005, '< 0.0005'),
    m('clicks', quietJump(dryMono, SR), 'jump', quietJump(dryMono, SR) < 0.01, '< 0.01'),
    m('RMS', rmsDb, 'dBFS', rmsDb >= lo && rmsDb <= hi, `${lo}…${hi}`),
    m('centroid', spec.centroid, 'Hz', spec.centroid >= recipe.band[0] && spec.centroid <= recipe.band[1], `${recipe.band[0]}–${recipe.band[1]}`),
  ];
  return { name: sfx, kind: 'sfx', pass: metrics.every((x) => x.ok), metrics, wave: mixDown(wet), mags: spec.mags, ms: performance.now() - t0 };
};

export interface AmbienceCase {
  name: string;
  scene: AmbienceScene;
  /** Optional second scene switched to halfway (crossfade check). */
  then?: AmbienceScene;
}

export const AMBIENCE_CASES: AmbienceCase[] = [
  { name: 'ancient', scene: { age: 'ancient' } },
  { name: 'classical', scene: { age: 'classical' } },
  { name: 'exploration', scene: { age: 'exploration' } },
  { name: 'modern', scene: { age: 'modern' } },
  { name: 'ancient + crisis', scene: { age: 'ancient', crisis: true } },
  ...['egyptian', 'greek', 'chinese', 'arab', 'norse', 'inuit', 'mongol', 'spanish'].map((c) => ({
    name: `classical · ${c}`,
    scene: { age: 'classical' as const, cultures: { [c]: 1 } },
  })),
  { name: 'hybrid greek .6 + egyptian .4', scene: { age: 'classical', cultures: { greek: 0.6, egyptian: 0.4 } } },
  { name: 'crossfade ancient → classical crisis + mongol', scene: { age: 'ancient' }, then: { age: 'classical', crisis: true, cultures: { mongol: 0.8 } } },
];

export const AMBIENCE_SECONDS = 24;

export const renderAmbience = (c: AmbienceCase, seed = 7, seconds = AMBIENCE_SECONDS): Promise<Float32Array[]> =>
  render(seconds, (ctx) => {
    const g = buildGraph(ctx, { rand: mulberry32(seed) });
    g.ambDry.gain.value = AMBIENCE_LEVEL;
    g.ambWet.gain.value = AMBIENCE_LEVEL;
    const player = new AmbiencePlayer(g, g.ambDry, g.ambWet, mulberry32(seed + 1));
    const first = toPlayerScene(c.scene);
    if (!first) return;
    player.setScene(first, 0);
    const half = c.then ? seconds / 2 : seconds;
    // Pump in 0.1 s steps exactly like the live scheduler.
    for (let t = 0; t < half; t += 0.1) player.pump(t, 0.5);
    const second = c.then ? toPlayerScene(c.then) : null;
    if (second) {
      player.setScene(second, half);
      for (let t = half; t < seconds; t += 0.1) player.pump(t, 0.5);
    }
  });

export const checkAmbience = async (c: AmbienceCase, seed = 7): Promise<CheckResult> => {
  const t0 = performance.now();
  const chans = await renderAmbience(c, seed);
  const mono = mixDown(chans);
  const from = Math.floor(4 * SR); // after the 3 s fade-in
  const pk = peak(chans);
  const r = dbfs(rms(chans, from));
  const curve = loudnessCurve(mono.subarray(from), SR, 0.4);
  const minWin = Math.min(...curve);
  let maxStep = 0;
  for (let i = 1; i < curve.length; i++) maxStep = Math.max(maxStep, Math.abs((curve[i] ?? 0) - (curve[i - 1] ?? 0)));
  const dc = Math.abs(dcOffset(chans, from));
  const qj = quietJump(mono, SR);
  const mj = maxJump(mono);
  const metrics = [
    m('non-silent', r, 'dBFS', r > -60, '> -60'),
    m('peak (ceiling)', dbfs(pk), 'dBFS', dbfs(pk) <= -4, '<= -4'),
    m('RMS @100', r, 'dBFS', r >= -32 && r <= -16, '-32…-16'),
    m('RMS @50 (default)', r - 12.04, 'dBFS', r - 12.04 >= -44 && r - 12.04 <= -28, '-44…-28'),
    m('DC offset', dc, '', dc < 0.002, '< 0.002'),
    m('no dropouts', minWin, 'dBFS min 0.4 s', minWin > -60, '> -60'),
    m('smooth', maxStep, 'dB step', maxStep < 18, '< 18 per 0.4 s'),
    m('clicks', qj, 'jump', qj < 0.01, '< 0.01'),
    m('max jump', mj, '', mj < 0.3, '< 0.3'),
  ];
  return { name: c.name, kind: 'ambience', pass: metrics.every((x) => x.ok), metrics, wave: mono, mags: spectrum(mono.subarray(from, from + SR * 8), SR).mags, ms: performance.now() - t0 };
};

/** Every check by name: 'tap #1' … and the ambience case names. */
export const selfCheckJobs = (seeds: readonly number[] = [1, 2]): string[] => [
  ...SFX_LIST.flatMap((sfx) => seeds.map((seed) => `${sfx} #${seed}`)),
  ...AMBIENCE_CASES.map((c) => c.name),
];

export const runJob = async (name: string): Promise<CheckResult> => {
  const amb = AMBIENCE_CASES.find((c) => c.name === name);
  if (amb) return checkAmbience(amb);
  const [sfx, seed] = name.split(' #');
  const r = await checkSfx(sfx as Sfx, Number(seed) || 1);
  r.name = name;
  return r;
};

export const runSelfCheck = async (onResult?: (r: CheckResult) => void, jobs: readonly string[] = selfCheckJobs()): Promise<CheckResult[]> => {
  const out: CheckResult[] = [];
  for (const job of jobs) {
    const r = await runJob(job);
    out.push(r);
    onResult?.(r);
  }
  return out;
};
