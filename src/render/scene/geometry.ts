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

export const disposeAll = (gs: readonly BufferGeometry[]): void => {
  for (const g of gs) g.dispose();
};
