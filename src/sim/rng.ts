/**
 * Seeded sfc32 RNG. The four state words live in `GameState.rng`, so every draw is part of
 * the deterministic state (CLAUDE.md rule 2). All functions take any object with an `rng`
 * field and advance it in place — pass the cloned GameState (or `{ rng }` during map gen).
 */
import type { RngState } from '@contracts/sim-api';

export interface HasRng {
  rng: RngState;
}

/** Expand a numeric seed into a well-mixed sfc32 state (splitmix32, then warm-up). */
export const seedRng = (seed: number): RngState => {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const holder: HasRng = { rng: [next(), next(), next(), 1] };
  for (let i = 0; i < 12; i++) nextUint(holder);
  return holder.rng;
};

/** Next uint32. */
export const nextUint = (h: HasRng): number => {
  let [a, b, c, d] = h.rng;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = (b ^ (b >>> 9)) >>> 0;
  b = (c + (c << 3)) >>> 0;
  c = ((c << 21) | (c >>> 11)) >>> 0;
  c = (c + t) >>> 0;
  h.rng = [a, b, c, d];
  return t;
};

/** Float in [0, 1). */
export const nextFloat = (h: HasRng): number => nextUint(h) / 4294967296;

/** Integer in [0, n). */
export const nextInt = (h: HasRng, n: number): number => Math.floor(nextFloat(h) * n);

/** Float in [lo, hi). */
export const nextRange = (h: HasRng, lo: number, hi: number): number => lo + nextFloat(h) * (hi - lo);

export const pick = <T>(h: HasRng, items: readonly T[]): T => {
  const item = items[nextInt(h, items.length)];
  if (item === undefined) throw new Error('pick from empty list');
  return item;
};

/** Fisher–Yates; returns a new array. */
export const shuffle = <T>(h: HasRng, items: readonly T[]): T[] => {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextInt(h, i + 1);
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
};

/** Index drawn with probability proportional to `weights[i]` (all >= 0, not all 0). */
export const weightedIndex = (h: HasRng, weights: readonly number[]): number => {
  let total = 0;
  for (const w of weights) total += w;
  let roll = nextFloat(h) * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i] as number;
    if (roll < 0) return i;
  }
  return weights.length - 1;
};
