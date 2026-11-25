/**
 * Territory border edges (GDD §11: ownership readable at a glance). Pure: given per-tile owners,
 * emit one edge per (owned tile, side) whose neighbor has a different owner or is off the map.
 * Each side of a contested frontier is drawn by its own owner, inset into its own tile, so two
 * neighbors' colors sit side by side instead of overdrawing each other.
 */
import { HEX_DIRECTIONS } from '@contracts/hex';
import { hexAtIndex, hexToWorld, tileIndex } from './layout';

/** Flat list of edges: tile index, direction 0..5 (HEX_DIRECTIONS order). Reused across calls. */
export interface BorderEdgeList {
  tile: Int32Array;
  dir: Uint8Array;
  count: number;
}

export const createEdgeList = (capacity = 256): BorderEdgeList => ({
  tile: new Int32Array(capacity),
  dir: new Uint8Array(capacity),
  count: 0,
});

const pushEdge = (out: BorderEdgeList, tile: number, dir: number): void => {
  if (out.count >= out.tile.length) {
    const t = new Int32Array(out.tile.length * 2);
    t.set(out.tile);
    const d = new Uint8Array(out.dir.length * 2);
    d.set(out.dir);
    out.tile = t;
    out.dir = d;
  }
  out.tile[out.count] = tile;
  out.dir[out.count] = dir;
  out.count++;
};

/**
 * Fill `out` with every outer edge of every owner's territory. `include(i)` filters tiles
 * (e.g. skip unexplored ones). O(tiles).
 */
export const computeBorderEdges = (
  owners: readonly (string | null)[],
  width: number,
  height: number,
  include: (i: number) => boolean,
  out: BorderEdgeList,
): BorderEdgeList => {
  out.count = 0;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const owner = owners[i] ?? null;
    if (owner === null || !include(i)) continue;
    const h = hexAtIndex(i, width);
    for (let d = 0; d < 6; d++) {
      const dir = HEX_DIRECTIONS[d];
      if (!dir) continue;
      const ni = tileIndex({ q: h.q + dir.q, r: h.r + dir.r }, width, height);
      if (ni >= 0 && (owners[ni] ?? null) === owner) continue;
      pushEdge(out, i, d);
    }
  }
  return out;
};

/**
 * Instance rotation (about +y, Instances.push convention) that turns a geometry whose edge faces
 * +x (east) to face neighbor direction `d`.
 */
export const EDGE_ROTATION: readonly number[] = HEX_DIRECTIONS.map((d) => {
  const w = hexToWorld(d);
  return -Math.atan2(w.z, w.x);
});
