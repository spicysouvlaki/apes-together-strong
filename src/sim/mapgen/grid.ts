/**
 * Index-based hex grid helpers for map generation: the map is row-major odd-r offset
 * (src/contracts/sim-api.ts MapState), so generation works on flat tile indices and converts to
 * axial only where the contract needs it.
 */
import { HEX_DIRECTIONS, axialToOffset, hexDistance, offsetToAxial, type Hex } from '@contracts/hex';

export interface Grid {
  width: number;
  height: number;
  size: number;
  /** Axial coordinates per index. */
  hex: Hex[];
  /** In-bounds neighbor indices per index (the map does not wrap). */
  neighbors: number[][];
  /** Isotropic world-ish coordinates for noise sampling (pointy-top, unit spacing). */
  wx: Float64Array;
  wy: Float64Array;
}

export const makeGrid = (width: number, height: number): Grid => {
  const size = width * height;
  const hex: Hex[] = [];
  const wx = new Float64Array(size);
  const wy = new Float64Array(size);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      hex.push(offsetToAxial({ col, row }));
      wx[i] = col + (row & 1 ? 0.5 : 0);
      wy[i] = row * 0.866;
    }
  }
  const neighbors: number[][] = [];
  for (let i = 0; i < size; i++) {
    const h = hex[i] as Hex;
    const list: number[] = [];
    for (const d of HEX_DIRECTIONS) {
      const { col, row } = axialToOffset({ q: h.q + d.q, r: h.r + d.r });
      if (col >= 0 && col < width && row >= 0 && row < height) list.push(row * width + col);
    }
    neighbors.push(list);
  }
  return { width, height, size, hex, neighbors, wx, wy };
};

export const dist = (g: Grid, a: number, b: number): number => hexDistance(g.hex[a] as Hex, g.hex[b] as Hex);

/** Multi-source BFS distance (in steps) over tiles where `passable(i)` holds. Unreached = Infinity. */
export const bfs = (g: Grid, sources: readonly number[], passable: (i: number) => boolean): Float64Array => {
  const d = new Float64Array(g.size).fill(Infinity);
  const queue: number[] = [];
  for (const s of sources) {
    d[s] = 0;
    queue.push(s);
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head] as number;
    const next = (d[cur] as number) + 1;
    for (const n of g.neighbors[cur] as number[]) {
      if (d[n] !== Infinity || !passable(n)) continue;
      d[n] = next;
      queue.push(n);
    }
  }
  return d;
};

/** Connected components of tiles where `member(i)` holds. Returns component id per tile (-1 = none). */
export const components = (g: Grid, member: (i: number) => boolean): { id: Int32Array; sizes: number[] } => {
  const id = new Int32Array(g.size).fill(-1);
  const sizes: number[] = [];
  for (let i = 0; i < g.size; i++) {
    if (id[i] !== -1 || !member(i)) continue;
    const c = sizes.length;
    let count = 0;
    const stack = [i];
    id[i] = c;
    while (stack.length > 0) {
      const cur = stack.pop() as number;
      count++;
      for (const n of g.neighbors[cur] as number[]) {
        if (id[n] === -1 && member(n)) {
          id[n] = c;
          stack.push(n);
        }
      }
    }
    sizes.push(count);
  }
  return { id, sizes };
};

/** Indices within `radius` of `i` (including `i`), clipped to the map. */
export const inRange = (g: Grid, i: number, radius: number): number[] => {
  const h = g.hex[i] as Hex;
  const out: number[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      const { col, row } = axialToOffset({ q: h.q + dq, r: h.r + dr });
      if (col >= 0 && col < g.width && row >= 0 && row < g.height) out.push(row * g.width + col);
    }
  }
  return out;
};
