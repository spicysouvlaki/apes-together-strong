/**
 * Deterministic prop placement (trees, micro-detail, rocks) inside a hex. Pure: the same tile
 * always gets the same scatter, so props never "swim" between snapshots, and nothing here
 * touches Math.random. Positions are local to the tile center, unit hex radius, pointy-top.
 */
import type { ZoomBand } from './camera-math';

/** Integer hash of (q, r, salt) -> uint32 (a small avalanche mix). */
export const hashTile = (q: number, r: number, salt = 0): number => {
  let h = Math.imul(q | 0, 0x27d4eb2d) ^ Math.imul(r | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

/** Hash -> [0, 1). */
/**
 * Hash -> [0, 1). Re-mixes its input first: callers routinely pass shifted hashes
 * (`unit01(h >>> 8)`), which with a plain division only ever reached [0, 2^-8) (art pass 4 found
 * jungle tiles drawing only palms and temperate woods only broadleaf because of this).
 */
export const unit01 = (h: number): number => {
  let x = Math.imul((h >>> 0) ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

const COS30 = Math.cos(Math.PI / 6);

/** True when local point (x, z) lies inside a pointy-top hex of radius `r`. */
export const insideHex = (x: number, z: number, r: number): boolean => {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  // Pointy-top: flat sides at x = ±r·cos30, slanted sides through (0, ±r).
  return ax <= r * COS30 && ax * 0.5 + az * COS30 <= r * COS30;
};

export interface ScatterOptions {
  /** Hex radius points must stay inside (keeps props on the top, off the chamfer). */
  radius?: number;
  /** Minimum spacing between points. */
  minDist?: number;
  /** Keep this radius around the center clear (e.g. for a settlement or resource). */
  clearCenter?: number;
  /** Extra clear circle (x, z, r), e.g. the resource marker spot. */
  clear?: readonly [number, number, number];
}

/**
 * Up to `count` well-spaced points inside the hex, written as x,z pairs into `out`.
 * Returns how many were placed (rejection sampling with a bounded number of tries).
 */
export const scatterInHex = (
  q: number,
  r: number,
  salt: number,
  count: number,
  out: Float32Array,
  opts: ScatterOptions = {},
): number => {
  const radius = opts.radius ?? 0.74;
  const minD2 = (opts.minDist ?? 0.2) ** 2;
  const clear2 = (opts.clearCenter ?? 0) ** 2;
  const cap = Math.min(count, Math.floor(out.length / 2));
  let n = 0;
  for (let k = 0; k < count * 8 && n < cap; k++) {
    const h1 = hashTile(q, r, salt * 131 + k * 2);
    const h2 = hashTile(q, r, salt * 131 + k * 2 + 1);
    const x = (unit01(h1) * 2 - 1) * radius;
    const z = (unit01(h2) * 2 - 1) * radius;
    if (!insideHex(x, z, radius)) continue;
    if (x * x + z * z < clear2) continue;
    if (opts.clear) {
      const dx = x - opts.clear[0];
      const dz = z - opts.clear[1];
      if (dx * dx + dz * dz < opts.clear[2] * opts.clear[2]) continue;
    }
    let ok = true;
    for (let j = 0; j < n; j++) {
      const dx = (out[j * 2] ?? 0) - x;
      const dz = (out[j * 2 + 1] ?? 0) - z;
      if (dx * dx + dz * dz < minD2) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    out[n * 2] = x;
    out[n * 2 + 1] = z;
    n++;
  }
  return n;
};

export type RenderQuality = 'low' | 'high';

/**
 * Micro-detail density multiplier: full at close zoom, sparse at regional, none at strategic or
 * on low quality (budget: micro-detail is the first thing to go).
 */
export const microDensity = (band: ZoomBand, quality: RenderQuality): number => {
  if (quality === 'low' || band === 'strategic') return 0;
  return band === 'close' ? 1 : 0.4;
};

/** How many trees a wooded tile gets. Fewer on low quality; fewer when a settlement sits there. */
export const treeCount = (base: number, quality: RenderQuality, settled: boolean): number => {
  const n = quality === 'low' ? Math.ceil(base * 0.6) : base;
  return settled ? Math.min(n, 2) : n;
};
