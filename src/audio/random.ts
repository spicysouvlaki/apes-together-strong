/**
 * Audio-side randomness. Audio lives outside the sim, so live playback may use Math.random;
 * tests and the self-check use the seeded generator so results are reproducible.
 */
export type Rand = () => number;

export const mulberry32 = (seed: number): Rand => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const liveRand: Rand = () => Math.random();

export const range = (r: Rand, lo: number, hi: number): number => lo + (hi - lo) * r();
export const chance = (r: Rand, p: number): boolean => r() < p;
export const pick = <T>(r: Rand, xs: readonly T[]): T => {
  const x = xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))];
  if (x === undefined) throw new Error('pick from empty list');
  return x;
};
/** Symmetric jitter in [-amt, amt]. */
export const jitter = (r: Rand, amt: number): number => (r() * 2 - 1) * amt;
