/**
 * Territory border edges (GDD §11: ownership readable at a glance). Pure: given per-tile owners,
 * emit one edge per (owned tile, side) whose neighbor has a different owner or is off the map.
 * Each side of a contested frontier is drawn by its own owner, inset into its own tile, so two
 * neighbors' colors sit side by side instead of overdrawing each other.
 *
 * `buildBorderMesh` turns those edges into ONE continuous inked band per territory: each edge
 * is a stack of inset strips (ink keyline, owner primary, thin secondary rule, soft inner wash)
 * whose ends are mitred against the next boundary edge, so the outline runs unbroken around
 * convex corners (two edges of one tile) and concave corners (the boundary steps onto a
 * same-owner neighbor), and each strip sits on its own tile's top (hugging heights, with a
 * small riser where neighbors differ in height). Only outer edges ever produce geometry.
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

// --- Continuous band mesh ---------------------------------------------------------------------

/** Hex apothem for unit-radius pointy-top hexes (center to edge line). */
export const APOTHEM = Math.sqrt(3) / 2;
const TAN30 = Math.tan(Math.PI / 6);
const COS30 = Math.cos(Math.PI / 6);

/** World angle bucket (k·60°, atan2(z, x)) of each HEX_DIRECTIONS entry. */
export const DIR_BUCKET: readonly number[] = HEX_DIRECTIONS.map((d) => {
  const w = hexToWorld(d);
  const k = Math.round(Math.atan2(w.z, w.x) / (Math.PI / 3));
  return ((k % 6) + 6) % 6;
});
/** Inverse of DIR_BUCKET: HEX_DIRECTIONS index for angle bucket k. */
export const BUCKET_DIR: readonly number[] = [0, 1, 2, 3, 4, 5].map((k) => DIR_BUCKET.indexOf(k));

/**
 * Local outline of one strip of an edge band. Local frame: the edge faces +x (its line is
 * x = APOTHEM, z from -0.5 to 0.5); the strip spans insets d0..d1 (d0 nearer the edge).
 * An end is mitred on the radial line through the corner when the boundary turns around this
 * tile (convex), or on the shared edge with the neighbor when the boundary continues onto it
 * (concave). Returns [x,z] for outer-start, outer-end, inner-end, inner-start (start = -z).
 */
export const bandStripLocal = (d0: number, d1: number, startConvex: boolean, endConvex: boolean): [number, number][] => {
  const endZ = (d: number, convex: boolean): number => (convex ? (APOTHEM - d) * TAN30 : (0.5 * APOTHEM + 0.5 * d) / COS30);
  return [
    [APOTHEM - d0, -endZ(d0, startConvex)],
    [APOTHEM - d0, endZ(d0, endConvex)],
    [APOTHEM - d1, endZ(d1, endConvex)],
    [APOTHEM - d1, -endZ(d1, startConvex)],
  ];
};

export type BorderInk = 'ink' | 'primary' | 'secondary';
export interface BorderStrip {
  /** Insets from the edge line (world units), d0 < d1. */
  d0: number;
  d1: number;
  ink: BorderInk;
  /** Opacity at the outer (d0) and inner (d1) side. */
  a0: number;
  a1: number;
  /** Cut by the owner's colorblind pattern (when patterns are on). */
  pattern: boolean;
}

/**
 * The band, outside in (GDD §11, Atlas Chronicle): a fine iron-gall keyline, the owner's
 * primary, a hairline of paper, a thin secondary rule, and a soft wash fading into the land.
 * Inner edge of the flat tile top is at inset ~0.108 (scene/geometry BEVEL_INSET), so the band
 * starts just inside it. The deepest inset must stay below √3/4 (≈0.433): a concave mitre runs
 * d/sin60° along the shared edge, and must not reach that edge's midpoint (tested).
 */
export const BORDER_STRIPS: readonly BorderStrip[] = [
  { d0: 0.11, d1: 0.126, ink: 'ink', a0: 0.7, a1: 0.9, pattern: false },
  { d0: 0.126, d1: 0.205, ink: 'primary', a0: 0.96, a1: 0.96, pattern: true },
  { d0: 0.214, d1: 0.232, ink: 'secondary', a0: 0.92, a1: 0.92, pattern: false },
  { d0: 0.232, d1: 0.42, ink: 'primary', a0: 0.3, a1: 0, pattern: false },
];

export interface BorderTileInfo {
  /** World x/z of tile centers and drawn top heights, by tile index. */
  x: ArrayLike<number>;
  z: ArrayLike<number>;
  top: ArrayLike<number>;
}

export interface BorderColors {
  primary: readonly [number, number, number];
  secondary: readonly [number, number, number];
  ink: readonly [number, number, number];
  pattern: number;
}

/** Growable vertex buffers for the band mesh (non-indexed triangles). */
export interface BorderMeshData {
  /** xyz per vertex. */
  pos: Float32Array;
  /** Linear RGBA per vertex. */
  col: Float32Array;
  /** t (along, world units), u (0..1 across the strip), pattern id (-1 = never cut). */
  pat: Float32Array;
  vertexCount: number;
  /** Edge (tile, HEX_DIRECTIONS index) that produced each triangle group, for tests/debug. */
  quadTile: Int32Array;
  quadDir: Int8Array;
  quadCount: number;
}

export const createBorderMeshData = (vertexCapacity = 1024): BorderMeshData => ({
  pos: new Float32Array(vertexCapacity * 3),
  col: new Float32Array(vertexCapacity * 4),
  pat: new Float32Array(vertexCapacity * 3),
  vertexCount: 0,
  quadTile: new Int32Array(vertexCapacity / 6),
  quadDir: new Int8Array(vertexCapacity / 6),
  quadCount: 0,
});

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

const ensure = (m: BorderMeshData, extraVerts: number): void => {
  const need = m.vertexCount + extraVerts;
  if (need * 3 <= m.pos.length && (m.quadCount + extraVerts / 6 + 1) <= m.quadTile.length) return;
  let cap = Math.max(64, m.pos.length / 3);
  while (cap < need) cap *= 2;
  const grow = <T extends Float32Array | Int32Array | Int8Array>(a: T, n: number, make: (n: number) => T): T => {
    const b = make(n);
    b.set(a.subarray(0, Math.min(a.length, n)) as never);
    return b;
  };
  m.pos = grow(m.pos, cap * 3, (n) => new Float32Array(n));
  m.col = grow(m.col, cap * 4, (n) => new Float32Array(n));
  m.pat = grow(m.pat, cap * 3, (n) => new Float32Array(n));
  const qcap = Math.max(m.quadTile.length * 2, Math.ceil(cap / 6) + 8);
  m.quadTile = grow(m.quadTile, qcap, (n) => new Int32Array(n));
  m.quadDir = grow(m.quadDir, qcap, (n) => new Int8Array(n));
};

/**
 * Build the merged band mesh for every edge in `edges` (from computeBorderEdges). `include`
 * must be the same filter used there (a hidden same-owner neighbor does not continue the
 * outline). `colors(i)` gives the owner colors (sRGB 0..1) for owned tile i.
 */
export const buildBorderMesh = (
  edges: BorderEdgeList,
  owners: readonly (string | null)[],
  width: number,
  height: number,
  include: (i: number) => boolean,
  tiles: BorderTileInfo,
  colors: (i: number) => BorderColors,
  out: BorderMeshData,
  strips: readonly BorderStrip[] = BORDER_STRIPS,
  lift = 0.012,
): BorderMeshData => {
  out.vertexCount = 0;
  out.quadCount = 0;
  const sameAt = (i: number, h: { q: number; r: number }, bucket: number): number => {
    const dir = HEX_DIRECTIONS[BUCKET_DIR[((bucket % 6) + 6) % 6] ?? 0];
    if (!dir) return -1;
    const j = tileIndex({ q: h.q + dir.q, r: h.r + dir.r }, width, height);
    if (j < 0 || !include(j) || (owners[j] ?? null) !== (owners[i] ?? null)) return -1;
    return j;
  };
  const v = (x: number, y: number, z: number, c: readonly [number, number, number], a: number, t: number, u: number, p: number): void => {
    const k = out.vertexCount++;
    out.pos[k * 3] = x;
    out.pos[k * 3 + 1] = y;
    out.pos[k * 3 + 2] = z;
    out.col[k * 4] = lin(c[0]);
    out.col[k * 4 + 1] = lin(c[1]);
    out.col[k * 4 + 2] = lin(c[2]);
    out.col[k * 4 + 3] = a;
    out.pat[k * 3] = t;
    out.pat[k * 3 + 1] = u;
    out.pat[k * 3 + 2] = p;
  };
  for (let e = 0; e < edges.count; e++) {
    const i = edges.tile[e] ?? 0;
    const d = edges.dir[e] ?? 0;
    if ((owners[i] ?? null) === null) continue;
    const h = hexAtIndex(i, width);
    const k = DIR_BUCKET[d] ?? 0;
    // End (+z local) is toward bucket k+1, start toward k-1. Concave when that neighbor is ours.
    const endN = sameAt(i, h, k + 1);
    const startN = sameAt(i, h, k - 1);
    const theta = (k * Math.PI) / 3;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const cx = tiles.x[i] ?? 0;
    const cz = tiles.z[i] ?? 0;
    const y = (tiles.top[i] ?? 0) + lift;
    const col = colors(i);
    const strip0 = strips.length * 6 + (endN >= 0 ? strips.length * 6 : 0) + (startN >= 0 ? strips.length * 6 : 0);
    ensure(out, strip0);
    out.quadTile[out.quadCount] = i;
    out.quadDir[out.quadCount] = d;
    out.quadCount++;
    // Along-edge coordinate continuous across the tile's edges (pattern dashes line up).
    const t0 = k * 1.0;
    for (const st of strips) {
      const pts = bandStripLocal(st.d0, st.d1, startN < 0, endN < 0);
      const rgb = st.ink === 'ink' ? col.ink : st.ink === 'primary' ? col.primary : col.secondary;
      const p = st.pattern ? col.pattern : -1;
      const W = (j: number): [number, number] => {
        const q = pts[j] ?? [0, 0];
        return [cx + c * q[0] - s * q[1], cz + s * q[0] + c * q[1]];
      };
      const [ax, az] = W(0);
      const [bx, bz] = W(1);
      const [qx, qz] = W(2);
      const [dx, dz] = W(3);
      const ta = t0 + (pts[0]?.[1] ?? 0) + 0.5;
      const tb = t0 + (pts[1]?.[1] ?? 0) + 0.5;
      const tq = t0 + (pts[2]?.[1] ?? 0) + 0.5;
      const td = t0 + (pts[3]?.[1] ?? 0) + 0.5;
      // Two triangles, wound to face +y.
      v(ax, y, az, rgb, st.a0, ta, 0, p);
      v(bx, y, bz, rgb, st.a0, tb, 0, p);
      v(qx, y, qz, rgb, st.a1, tq, 1, p);
      v(ax, y, az, rgb, st.a0, ta, 0, p);
      v(qx, y, qz, rgb, st.a1, tq, 1, p);
      v(dx, y, dz, rgb, st.a1, td, 1, p);
      // Riser where the outline steps onto a neighbor of a different height (drawn once, by
      // the higher tile, down to the lower one's top).
      const riser = (n: number, ox: number, oz: number, ix: number, iz: number, tt: number): void => {
        if (n < 0) return;
        const yn = (tiles.top[n] ?? 0) + lift;
        if (yn >= y - 1e-4) return;
        v(ox, y, oz, rgb, st.a0, tt, 0, p);
        v(ix, y, iz, rgb, st.a1, tt, 1, p);
        v(ix, yn, iz, rgb, st.a1, tt, 1, p);
        v(ox, y, oz, rgb, st.a0, tt, 0, p);
        v(ix, yn, iz, rgb, st.a1, tt, 1, p);
        v(ox, yn, oz, rgb, st.a0, tt, 0, p);
      };
      riser(endN, bx, bz, qx, qz, tb);
      riser(startN, ax, az, dx, dz, ta);
    }
  }
  return out;
};
