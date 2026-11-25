/**
 * River ribbons. The contract only marks tiles as `river: true` (no edge data), so we draw a
 * river as a tree connecting adjacent river tiles center to center: a BFS spanning forest (no
 * cycles, so a clump of river tiles reads as a branching river, not a blue blob), plus one
 * mouth segment per river into adjacent water. Pure and deterministic.
 */
import { HEX_DIRECTIONS } from '@contracts/hex';
import { hexAtIndex, tileIndex } from './layout';

export interface RiverSegment {
  /** Tile index of the upstream end. */
  a: number;
  /** Tile index of the downstream end (a river tile, or a water tile for a mouth). */
  b: number;
  /** True when `b` is water. */
  mouth: boolean;
}

export const computeRiverSegments = (
  width: number,
  height: number,
  isRiver: (i: number) => boolean,
  isWater: (i: number) => boolean,
): RiverSegment[] => {
  const n = width * height;
  const seen = new Uint8Array(n);
  const out: RiverSegment[] = [];
  const queue = new Int32Array(n);
  const neighbor = (i: number, d: number): number => {
    const h = hexAtIndex(i, width);
    const dir = HEX_DIRECTIONS[d];
    if (!dir) return -1;
    return tileIndex({ q: h.q + dir.q, r: h.r + dir.r }, width, height);
  };
  for (let s = 0; s < n; s++) {
    if (seen[s] || !isRiver(s) || isWater(s)) continue;
    // BFS one river system.
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    seen[s] = 1;
    let mouthDone = false;
    while (head < tail) {
      const i = queue[head++] ?? 0;
      for (let d = 0; d < 6; d++) {
        const ni = neighbor(i, d);
        if (ni < 0) continue;
        if (isWater(ni)) {
          if (!mouthDone) {
            out.push({ a: i, b: ni, mouth: true });
            mouthDone = true;
          }
          continue;
        }
        if (seen[ni] || !isRiver(ni)) continue;
        seen[ni] = 1;
        queue[tail++] = ni;
        out.push({ a: ni, b: i, mouth: false });
      }
    }
  }
  return out;
};
