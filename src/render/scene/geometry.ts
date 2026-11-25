/**
 * Stand-in geometry (CLAUDE.md "Art for now"): beveled hex prisms and primitive props.
 * Every geometry here is built once per renderer and shared by an instanced layer.
 * Conventions: base at y = 0, unit hex radius, pointy-top (corner 0 at -30°).
 */
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { UnitClass } from '@contracts/content-schemas';
import { hexCorner } from '../layout';

/** Visual hex radius: slightly under 1 so a hairline seam shows the soil sides. */
export const TILE_RADIUS = 0.975;
const BEVEL_INSET = 0.08;
const BEVEL_DROP = 0.045;

const pushTri = (out: number[], a: number[], b: number[], c: number[]): void => {
  out.push(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);
};

const flatGeometry = (pos: number[]): BufferGeometry => {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals(); // non-indexed => faceted normals
  return g;
};

/** Top face at y = 0 with a bevel ring sloping down to the prism edge. */
export const hexTopGeometry = (): BufferGeometry => {
  const pos: number[] = [];
  const inner = TILE_RADIUS - BEVEL_INSET;
  for (let i = 0; i < 6; i++) {
    const a = hexCorner(i);
    const b = hexCorner((i + 1) % 6);
    // Winding chosen so normals face +y (counter-clockwise seen from above in x/z => use c, b, a).
    pushTri(pos, [0, 0, 0], [b.x * inner, 0, b.z * inner], [a.x * inner, 0, a.z * inner]);
    const ai = [a.x * inner, 0, a.z * inner];
    const bi = [b.x * inner, 0, b.z * inner];
    const ao = [a.x * TILE_RADIUS, -BEVEL_DROP, a.z * TILE_RADIUS];
    const bo = [b.x * TILE_RADIUS, -BEVEL_DROP, b.z * TILE_RADIUS];
    pushTri(pos, ai, bi, bo);
    pushTri(pos, ai, bo, ao);
  }
  return flatGeometry(pos);
};

/** Prism sides from y = 0 (top, just under the bevel) down to y = -1; scaled per instance. */
export const hexSideGeometry = (): BufferGeometry => {
  const pos: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = hexCorner(i);
    const b = hexCorner((i + 1) % 6);
    const at = [a.x * TILE_RADIUS, 0, a.z * TILE_RADIUS];
    const bt = [b.x * TILE_RADIUS, 0, b.z * TILE_RADIUS];
    const ab = [a.x * TILE_RADIUS, -1, a.z * TILE_RADIUS];
    const bb = [b.x * TILE_RADIUS, -1, b.z * TILE_RADIUS];
    // Outward-facing winding.
    pushTri(pos, at, bb, ab);
    pushTri(pos, at, bt, bb);
  }
  return flatGeometry(pos);
};

/** Flat hexagon at y = 0, facing up (territory fill, highlight fills). */
export const hexFlatGeometry = (radius: number): BufferGeometry => {
  const pos: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = hexCorner(i);
    const b = hexCorner((i + 1) % 6);
    pushTri(pos, [0, 0, 0], [b.x * radius, 0, b.z * radius], [a.x * radius, 0, a.z * radius]);
  }
  return flatGeometry(pos);
};

/** Flat hexagonal outline at y = 0 (selection ring). */
export const hexRingGeometry = (inner: number, outer: number): BufferGeometry => {
  // RingGeometry lives in x/y; θ in x/y maps to −θ in x/z after rotateX(−90°), and the
  // pointy-top corner set {±30°, ±90°, ±150°} is symmetric under negation.
  const g = new RingGeometry(inner, outer, 6, 1, Math.PI / 6);
  g.rotateX(-Math.PI / 2);
  return g;
};

const baseAt0 = (g: BufferGeometry, height: number): BufferGeometry => {
  g.translate(0, height / 2, 0);
  return g;
};

export const coneGeometry = (radius: number, height: number, segments = 6): BufferGeometry =>
  baseAt0(new ConeGeometry(radius, height, segments), height);

export const discGeometry = (radius: number, height: number, segments = 12): BufferGeometry =>
  baseAt0(new CylinderGeometry(radius, radius, height, segments), height);

export const boxGeometry = (w: number, h: number, d: number): BufferGeometry => baseAt0(new BoxGeometry(w, h, d), h);

export const markerGeometry = (): BufferGeometry => baseAt0(new OctahedronGeometry(0.085), 0.17);

/** Unit-length strip along x, centered; placed on hex edges for borders. */
export const borderStripGeometry = (): BufferGeometry => boxGeometry(1, 0.05, 0.1);

export const roofGeometry = (): BufferGeometry => {
  const g = new ConeGeometry(0.15, 0.13, 4);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.065, 0);
  return g;
};

export const starGeometry = (): BufferGeometry => baseAt0(new OctahedronGeometry(0.1), 0.2);

/** A flat ring for figure-units / commanders (gold) and selected units. */
export const baseRingGeometry = (radius: number, tube: number): BufferGeometry => {
  const g = new TorusGeometry(radius, tube, 4, 18);
  g.rotateX(Math.PI / 2);
  g.translate(0, tube, 0);
  return g;
};

/** Label quad: 1 x 1, anchored at its bottom center (the billboard pivot). */
export const labelQuadGeometry = (): BufferGeometry => {
  const g = new PlaneGeometry(1, 1);
  g.translate(0, 0.5, 0);
  return g;
};

export const headGeometry = (): BufferGeometry => new SphereGeometry(0.065, 8, 6);

const merged = (parts: BufferGeometry[]): BufferGeometry => {
  // mergeGeometries needs matching attribute sets; drop uvs (unused) and index everything.
  const norm = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    g.deleteAttribute('uv');
    return g;
  });
  const out = mergeGeometries(norm, false);
  if (!out) throw new Error('render: failed to merge unit geometry');
  return out;
};

/** Height of the head (accent sphere) for each class body, so the accent sits on top. */
export const UNIT_HEAD_Y: Record<UnitClass, number> = {
  infantry: 0.44,
  ranged: 0.42,
  cavalry: 0.4,
  siege: 0.3,
  naval: 0.5,
  civilian: 0.36,
  commander: 0.6,
};

/** Figurine body per unit class (GDD §11 "small painted figurines"; stand-in primitives). */
export const unitBodyGeometry = (cls: UnitClass): BufferGeometry => {
  switch (cls) {
    case 'infantry': {
      const g = new CapsuleGeometry(0.09, 0.2, 3, 8);
      g.translate(0, 0.19, 0);
      const shield = new BoxGeometry(0.03, 0.16, 0.13);
      shield.translate(0.1, 0.2, 0.02);
      return merged([g, shield]);
    }
    case 'ranged': {
      const body = baseAt0(new CylinderGeometry(0.075, 0.1, 0.34, 8), 0.34);
      const bow = new BoxGeometry(0.025, 0.42, 0.025);
      bow.rotateZ(0.35);
      bow.translate(0.12, 0.24, 0);
      return merged([body, bow]);
    }
    case 'cavalry': {
      const horse = new BoxGeometry(0.15, 0.16, 0.38);
      horse.translate(0, 0.16, 0);
      const neck = new BoxGeometry(0.1, 0.18, 0.1);
      neck.translate(0, 0.27, -0.16);
      const rider = new CylinderGeometry(0.06, 0.07, 0.14, 6);
      rider.translate(0, 0.3, 0.04);
      return merged([horse, neck, rider]);
    }
    case 'siege': {
      const frame = new BoxGeometry(0.3, 0.12, 0.26);
      frame.translate(0, 0.08, 0);
      const barrel = new CylinderGeometry(0.05, 0.06, 0.36, 8);
      barrel.rotateX(Math.PI / 2 - 0.4);
      barrel.translate(0, 0.2, -0.04);
      return merged([frame, barrel]);
    }
    case 'naval': {
      const hull = new CylinderGeometry(0.13, 0.08, 0.12, 3);
      hull.scale(1, 1, 2.2);
      hull.rotateY(Math.PI);
      hull.translate(0, 0.06, 0);
      const mast = new CylinderGeometry(0.015, 0.015, 0.4, 5);
      mast.translate(0, 0.28, 0);
      const sail = new BoxGeometry(0.22, 0.2, 0.015);
      sail.translate(0, 0.3, 0.02);
      return merged([hull, mast, sail]);
    }
    case 'civilian':
      return baseAt0(new ConeGeometry(0.1, 0.32, 8), 0.32);
    case 'commander': {
      const body = baseAt0(new CylinderGeometry(0.08, 0.12, 0.5, 8), 0.5);
      const cape = new BoxGeometry(0.16, 0.3, 0.03);
      cape.translate(0, 0.28, 0.1);
      return merged([body, cape]);
    }
  }
};

/**
 * One side of a hex border band, facing +x (east): the trapezoid between hex radii `outer` and
 * `inner`, cut along the corner rays so the six sides of a tile join without gaps. Rotate per
 * edge with borders.ts EDGE_ROTATION. Local x runs across the band, z along the edge.
 */
export const borderBandGeometry = (outer: number, inner: number): BufferGeometry => {
  const pos: number[] = [];
  const c = Math.cos(Math.PI / 6);
  const a0 = [outer * c, 0, -outer / 2];
  const a1 = [outer * c, 0, outer / 2];
  const b0 = [inner * c, 0, -inner / 2];
  const b1 = [inner * c, 0, inner / 2];
  // Facing +y.
  pushTri(pos, a0, b0, a1);
  pushTri(pos, b0, b1, a1);
  return flatGeometry(pos);
};

/** Flat ribbon of unit length along +x from x = 0, `width` wide (river segments). */
export const ribbonGeometry = (width: number): BufferGeometry => {
  const pos: number[] = [];
  const h = width / 2;
  pushTri(pos, [0, 0, -h], [0, 0, h], [1, 0, -h]);
  pushTri(pos, [0, 0, h], [1, 0, h], [1, 0, -h]);
  return flatGeometry(pos);
};

/** Low rounded mounds for hill tiles (two or three bumps; reads as "hills" from any zoom). */
export const hillMoundGeometry = (): BufferGeometry => {
  const bump = (r: number, x: number, z: number, h: number): BufferGeometry => {
    const g = new SphereGeometry(r, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, h / r, 1);
    g.translate(x, 0, z);
    return g;
  };
  return merged([bump(0.34, -0.2, 0.12, 0.2), bump(0.28, 0.24, -0.06, 0.16), bump(0.2, 0.02, -0.34, 0.12)]);
};

/** Broadleaf jungle tree: round crown on a short trunk (vs conifer cones for forest). */
export const broadleafGeometry = (): BufferGeometry => {
  const trunk = new CylinderGeometry(0.035, 0.045, 0.16, 5);
  trunk.translate(0, 0.08, 0);
  const crown = new IcosahedronGeometry(0.17, 0);
  crown.scale(1, 0.8, 1);
  crown.translate(0, 0.27, 0);
  return merged([trunk, crown]);
};

/** Resource marker shapes by class (terrain-style.ts RESOURCE_CLASS_STYLE). */
export const resourceShapeGeometry = (cls: 'bonus' | 'luxury' | 'strategic'): BufferGeometry => {
  switch (cls) {
    case 'bonus': {
      const g = new IcosahedronGeometry(0.1, 1);
      g.translate(0, 0.1, 0);
      return g;
    }
    case 'luxury': {
      const g = new OctahedronGeometry(0.11);
      g.scale(0.85, 1.35, 0.85);
      g.translate(0, 0.15, 0);
      return g;
    }
    case 'strategic':
      return boxGeometry(0.15, 0.15, 0.15);
  }
};

/** Low hexagonal city wall: six thin boxes on the edges of a hex of radius `r`. */
export const wallGeometry = (r: number, height: number): BufferGeometry => {
  const parts: BufferGeometry[] = [];
  const apothem = r * Math.cos(Math.PI / 6);
  for (let i = 0; i < 6; i++) {
    // Pointy-top: edge normals point at 0°, 60°, … (east first), so build the east wall and spin it.
    const b = new BoxGeometry(0.05, height, r * 1.02);
    const a = (Math.PI / 3) * i;
    b.translate(apothem, height / 2, 0);
    b.rotateY(a);
    parts.push(b);
  }
  return merged(parts);
};

/** City-state seat: a round tower with a conical roof (cities use a square keep). */
export const towerGeometry = (): BufferGeometry => {
  const body = new CylinderGeometry(0.12, 0.14, 0.46, 8);
  body.translate(0, 0.23, 0);
  const roof = new ConeGeometry(0.17, 0.2, 8);
  roof.translate(0, 0.56, 0);
  return merged([body, roof]);
};

/** Downward chevron floating over a unit that still has moves (subtle "ready" marker). */
export const readyMarkerGeometry = (): BufferGeometry => {
  const g = new ConeGeometry(0.07, 0.1, 4);
  g.rotateX(Math.PI);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.05, 0);
  return g;
};

/** Small heater shield (fortified marker); faces +z. */
export const shieldGeometry = (): BufferGeometry => {
  const top = new BoxGeometry(0.15, 0.1, 0.025);
  top.translate(0, 0.13, 0);
  const tip = new ConeGeometry(0.075 * Math.SQRT2, 0.09, 4);
  tip.rotateX(Math.PI);
  tip.rotateY(Math.PI / 4);
  tip.scale(1, 1, 0.17);
  tip.translate(0, 0.04, 0);
  return merged([top, tip]);
};

export const disposeAll = (gs: readonly BufferGeometry[]): void => {
  for (const g of gs) g.dispose();
};
