/**
 * Envelopes as pure point lists (time, value) that always start and end at exactly 0, so no
 * voice can click. Exponential decays are approximated with linear segments, which also
 * keeps Safari happy (no setTargetAtTime tails that never reach zero).
 */

export type EnvShape =
  /** Pluck/strike: fast attack then an exponential-looking decay to 0 at the end. */
  | { kind: 'perc'; attack: number; /** steepness, ~time constants over the decay */ curve?: number }
  /** Sustained: attack, decay to sustain level, hold, release to 0 at the end. */
  | { kind: 'adsr'; attack: number; decay: number; sustain: number; release: number };

export type EnvPoint = readonly [time: number, value: number];

const SEGMENTS = 10;

/** Normalised exponential fall from 1 to exactly 0 over x in [0,1]. */
const expFall = (x: number, c: number): number => (Math.exp(-c * x) - Math.exp(-c)) / (1 - Math.exp(-c));

export const envPoints = (shape: EnvShape, dur: number, peak: number): EnvPoint[] => {
  const pts: EnvPoint[] = [[0, 0]];
  if (dur <= 0) return pts;
  if (shape.kind === 'perc') {
    const a = Math.min(Math.max(shape.attack, 0.0005), dur * 0.5);
    const c = shape.curve ?? 5;
    pts.push([a, peak]);
    for (let i = 1; i <= SEGMENTS; i++) {
      const x = i / SEGMENTS;
      pts.push([a + (dur - a) * x, i === SEGMENTS ? 0 : peak * expFall(x, c)]);
    }
    return pts;
  }
  // Scale the stages down proportionally when the note is shorter than a+d+r.
  const total = shape.attack + shape.decay + shape.release;
  const k = total > dur * 0.95 ? (dur * 0.95) / total : 1;
  const a = Math.max(shape.attack * k, 0.001);
  const d = shape.decay * k;
  const r = Math.max(shape.release * k, 0.005);
  const s = peak * shape.sustain;
  pts.push([a, peak]);
  if (d > 0) pts.push([a + d, s]);
  const relStart = Math.max(a + d, dur - r);
  pts.push([relStart, s]);
  const relSegs = 6;
  for (let i = 1; i <= relSegs; i++) {
    const x = i / relSegs;
    pts.push([relStart + (dur - relStart) * x, i === relSegs ? 0 : s * expFall(x, 3.5)]);
  }
  return pts;
};

/** Linear interpolation of a point list at time t (0 outside). */
export const envAt = (pts: readonly EnvPoint[], t: number): number => {
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    if (!p0 || !p1) continue;
    if (t <= p1[0]) {
      if (t < p0[0]) return 0;
      const span = p1[0] - p0[0];
      return span <= 0 ? p1[1] : p0[1] + ((p1[1] - p0[1]) * (t - p0[0])) / span;
    }
  }
  return 0;
};

/**
 * Overlay short spikes on a base envelope: paper crackle, gravel. Each grain is a 2 ms rise to
 * `amp * peak` above the base and a 12 ms fall back to it. Grains are assumed >= 15 ms apart.
 */
export const withGrains = (
  base: readonly EnvPoint[],
  grains: readonly (readonly [time: number, amp: number])[],
  peak: number,
): EnvPoint[] => {
  const end = base[base.length - 1]?.[0] ?? 0;
  const extra: EnvPoint[] = [];
  for (const [t, amp] of grains) {
    if (t - 0.002 <= 0 || t + 0.012 >= end) continue;
    extra.push([t - 0.002, envAt(base, t - 0.002)], [t, envAt(base, t) + amp * peak], [t + 0.012, envAt(base, t + 0.012)]);
  }
  // Grain points win over base points that fall inside a grain.
  const inGrain = (t: number): boolean => grains.some(([g]) => t > g - 0.002 && t < g + 0.012);
  return [...base.filter(([t]) => !inGrain(t)), ...extra].sort((a, b) => a[0] - b[0]);
};

/** Write a point list onto an AudioParam starting at t0. */
export const applyEnv = (param: AudioParam, pts: readonly EnvPoint[], t0: number): void => {
  param.setValueAtTime(0, t0);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p) param.linearRampToValueAtTime(p[1], t0 + p[0]);
  }
};
