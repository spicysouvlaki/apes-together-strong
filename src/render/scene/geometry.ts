/**
 * Procedural low-poly geometry for the diorama (GDD §11). Built once per renderer; each is
 * shared by one instanced layer. Conventions: base at y = 0, unit hex radius, pointy-top
 * (corner 0 at −30°). Vertex colors are LINEAR; a vertex whose red is negative is "team
 * colored" (instanceColor × −r, see materials.ts propMaterial).
 */
import {
  BoxGeometry,
  BufferGeometry,
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
import type { Rgb } from '../colors';
import { parseHexColor } from '../colors';
import { hashTile, unit01 } from '../scatter';
import { hexCorner } from '../layout';

/** Visual hex radius: slightly under 1 so a hairline seam shows the soil sides. */
export const TILE_RADIUS = 0.975;
/** Chamfer: the top's flat part ends this far inside the edge and drops by BEVEL_DROP. */
export const BEVEL_INSET = 0.1;
export const BEVEL_DROP = 0.055;

const toLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** sRGB hex -> linear Rgb (vertex colors). */
export const lin = (hex: string): Rgb => {
  const c = parseHexColor(hex);
  return [toLin(c[0]), toLin(c[1]), toLin(c[2])];
};
/** Team-colored vertex marker: instanceColor × shade. */
export const team = (shade = 1): Rgb => [-shade, 0, 0];

const pushTri = (out: number[], a: number[], b: number[], c: number[]): void => {
  out.push(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);
};

const flatGeometry = (pos: number[], colors?: number[]): BufferGeometry => {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  if (colors) g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.computeVertexNormals(); // non-indexed => faceted normals
  return g;
};

/** Paint every vertex of `g` one color (adds/overwrites the color attribute). */
export const paint = (g: BufferGeometry, c: Rgb): BufferGeometry => {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c[0];
    a[i * 3 + 1] = c[1];
    a[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new Float32BufferAttribute(a, 3));
  return g;
};

/** Paint by vertex height: color = f(y) (gradients, baked AO toward the ground). */
const paintBy = (g: BufferGeometry, f: (x: number, y: number, z: number) => Rgb): BufferGeometry => {
  const p = g.getAttribute('position');
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = f(p.getX(i), p.getY(i), p.getZ(i));
    a[i * 3] = c[0];
    a[i * 3 + 1] = c[1];
    a[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new Float32BufferAttribute(a, 3));
  return g;
};

const scaleRgb = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/**
 * Merge parts (each painted) into one faceted, non-indexed geometry with position/normal/color.
 * `smooth` keeps the parts' own normals (rounded hills) instead of recomputing faceted ones.
 */
export const assemble = (parts: BufferGeometry[], smooth = false): BufferGeometry => {
  const norm = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (!g.getAttribute('color')) paint(g, [1, 1, 1]);
    if (!smooth) {
      g.deleteAttribute('normal');
      g.computeVertexNormals();
    }
    return g;
  });
  const out = mergeGeometries(norm, false);
  if (!out) throw new Error('render: failed to merge geometry');
  return out;
};

const baseAt0 = (g: BufferGeometry, height: number): BufferGeometry => {
  g.translate(0, height / 2, 0);
  return g;
};

// --- Tiles ------------------------------------------------------------------------------------

/**
 * Land prism: flat top, two-step chamfer, and sides whose bottom vertices sit at the sentinel
 * y = −1 (the shader drops them to the column depth from aInst.y). Vertex color = painted
 * gradient (center lifted, chamfer catching light, lip darker).
 */
export const landTileGeometry = (): BufferGeometry => {
  const pos: number[] = [];
  const col: number[] = [];
  const R = TILE_RADIUS;
  const r0 = R - BEVEL_INSET;
  const r1 = R - BEVEL_INSET * 0.35;
  const y1 = -BEVEL_DROP * 0.35;
  const y2 = -BEVEL_DROP;
  const tri = (a: number[], b: number[], c: number[], ka: number, kb: number, kc: number): void => {
    pushTri(pos, a, b, c);
    col.push(ka, ka, ka, kb, kb, kb, kc, kc, kc);
  };
  for (let i = 0; i < 6; i++) {
    const a = hexCorner(i);
    const b = hexCorner((i + 1) % 6);
    const P = (c: { x: number; z: number }, r: number, y: number): number[] => [c.x * r, y, c.z * r];
    // Top (winding so normals face +y).
    tri([0, 0, 0], P(b, r0, 0), P(a, r0, 0), 1.07, 0.99, 0.99);
    // Chamfer step 1 and 2.
    tri(P(a, r0, 0), P(b, r0, 0), P(b, r1, y1), 0.99, 0.99, 1.0);
    tri(P(a, r0, 0), P(b, r1, y1), P(a, r1, y1), 0.99, 1.0, 1.0);
    tri(P(a, r1, y1), P(b, r1, y1), P(b, R, y2), 1.0, 1.0, 0.9);
    tri(P(a, r1, y1), P(b, R, y2), P(a, R, y2), 1.0, 0.9, 0.9);
    // Side down to the sentinel.
    const at = P(a, R, y2);
    const bt = P(b, R, y2);
    const ab = P(a, R, -1);
    const bb = P(b, R, -1);
    tri(at, bb, ab, 1, 1, 1);
    tri(at, bt, bb, 1, 1, 1);
  }
  return flatGeometry(pos, col);
};

/** Flat hexagon at y = 0, facing up (water, parchment, overlays). */
export const hexFlatGeometry = (radius: number): BufferGeometry => {
  const pos: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = hexCorner(i);
    const b = hexCorner((i + 1) % 6);
    pushTri(pos, [0, 0, 0], [b.x * radius, 0, b.z * radius], [a.x * radius, 0, a.z * radius]);
  }
  return flatGeometry(pos);
};

/** Flat disc at y = 0 facing up, radius 1 (glows, blob shadows). */
export const flatDiscGeometry = (segments = 20): BufferGeometry => {
  const g = new RingGeometry(0, 1, segments, 1);
  g.rotateX(-Math.PI / 2);
  g.deleteAttribute('uv');
  return g;
};

/** Flat hexagonal outline at y = 0 (flash ring). */
export const hexRingGeometry = (inner: number, outer: number): BufferGeometry => {
  // RingGeometry lives in x/y; θ in x/y maps to −θ in x/z after rotateX(−90°), and the
  // pointy-top corner set {±30°, ±90°, ±150°} is symmetric under negation.
  const g = new RingGeometry(inner, outer, 6, 1, Math.PI / 6);
  g.rotateX(-Math.PI / 2);
  return g;
};

/** Board plinth: a box from y = 0 down to −1 with darkening soil strata (scaled per map). */
export const plinthGeometry = (c0: Rgb, c1: Rgb): BufferGeometry => {
  const g = new BoxGeometry(1, 1, 1, 1, 4, 1);
  g.translate(0, -0.5, 0);
  return assemble([
    paintBy(g, (_x, y) => {
      const t = -y;
      const c = t < 0.3 ? c0 : c1;
      return scaleRgb(c, 1 - t * 0.45);
    }),
  ]);
};

export const coneGeometry = (radius: number, height: number, segments = 6): BufferGeometry =>
  baseAt0(new ConeGeometry(radius, height, segments), height);

export const discGeometry = (radius: number, height: number, segments = 12): BufferGeometry =>
  baseAt0(new CylinderGeometry(radius, radius, height, segments), height);

export const boxGeometry = (w: number, h: number, d: number): BufferGeometry => baseAt0(new BoxGeometry(w, h, d), h);

/** A flat ring for figure-units / commanders (gold) and relation rims. */
export const baseRingGeometry = (radius: number, tube: number): BufferGeometry => {
  const g = new TorusGeometry(radius, tube, 4, 20);
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
  pushTri(pos, a0, b0, a1);
  pushTri(pos, b0, b1, a1);
  return flatGeometry(pos);
};

/** Flat ribbon of unit length along +x from x = 0, `width` wide (river segments). */
export const ribbonGeometry = (width: number): BufferGeometry => {
  const pos: number[] = [];
  const h = width / 2;
  // Split lengthwise so the cross-section shading interpolates (banks vs. channel).
  for (const [z0, z1] of [
    [-h, 0],
    [0, h],
  ] as const) {
    pushTri(pos, [0, 0, z0], [0, 0, z1], [1, 0, z0]);
    pushTri(pos, [0, 0, z1], [1, 0, z1], [1, 0, z0]);
  }
  return flatGeometry(pos);
};

/** Flat disc used at river junctions (same material, radial cross-section). */
export const riverNodeGeometry = (radius: number): BufferGeometry => {
  const g = new RingGeometry(0, radius, 12, 1);
  g.rotateX(-Math.PI / 2);
  g.deleteAttribute('uv');
  return g;
};

// --- Relief ---------------------------------------------------------------------------------------

/** Soft rounded mounds for hills (smooth normals; tinted with the tile color). */
export const hillMoundGeometry = (): BufferGeometry => {
  const bump = (r: number, x: number, z: number, h: number): BufferGeometry => {
    const g = new SphereGeometry(r, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, h / r, 1);
    g.translate(x, 0, z);
    g.deleteAttribute('uv');
    return paintBy(g, (_x, y) => {
      const k = 0.86 + Math.min(1, y / h) * 0.2;
      return [k, k, k * 0.97];
    });
  };
  // One broad rise filling most of the tile plus two softer shoulders: reads as terrain, not bushes.
  return assemble([bump(0.62, -0.04, 0.04, 0.2), bump(0.36, 0.3, -0.26, 0.17), bump(0.3, -0.34, 0.3, 0.12)], true);
};

const ROCK = lin('#a39b90');
const ROCK_DARK = lin('#6f685f');
const SNOW = lin('#f4f7f8');
const SNOW_SHADE = lin('#dfe8ef');

/**
 * Faceted mountain: a main peak plus shoulders, jittered for ridgelines, with crisp per-face
 * snow caps (face color by its centroid height so caps stay hard-edged).
 */
export const mountainGeometry = (variant: number): BufferGeometry => {
  const peak = (r: number, h: number, x: number, z: number, seed: number): BufferGeometry => {
    const g = new ConeGeometry(r, h, 7, 3);
    g.translate(0, h / 2, 0);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > h - 1e-4) {
        p.setX(i, p.getX(i) + (unit01(hashTile(seed, 99, 1)) - 0.5) * r * 0.3);
        continue;
      }
      if (y < 1e-4) continue;
      // Same jitter for coincident vertices (keyed by rounded position) keeps the mesh closed.
      const kx = Math.round(p.getX(i) * 1000);
      const kz = Math.round(p.getZ(i) * 1000);
      const ky = Math.round(y * 1000);
      const j = unit01(hashTile(kx + seed, kz, ky));
      const s = 0.78 + j * 0.42;
      p.setX(i, p.getX(i) * s);
      p.setZ(i, p.getZ(i) * s);
      p.setY(i, y + (j - 0.5) * h * 0.12);
    }
    g.translate(x, 0, z);
    const ng = g.toNonIndexed();
    ng.deleteAttribute('uv');
    // Per-face colors.
    const pos = ng.getAttribute('position');
    const colArr = new Float32Array(pos.count * 3);
    for (let f = 0; f < pos.count; f += 3) {
      const cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
      const cx = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3;
      const line = h * (0.6 + (unit01(hashTile(Math.round(cx * 100), seed, 5)) - 0.5) * 0.14);
      const t = Math.min(1, cy / h);
      let c: Rgb = [
        ROCK_DARK[0] + (ROCK[0] - ROCK_DARK[0]) * t,
        ROCK_DARK[1] + (ROCK[1] - ROCK_DARK[1]) * t,
        ROCK_DARK[2] + (ROCK[2] - ROCK_DARK[2]) * t,
      ];
      if (cy > line) c = (f / 3) % 2 === 0 ? SNOW : SNOW_SHADE;
      for (let k = 0; k < 3; k++) {
        colArr[(f + k) * 3] = c[0];
        colArr[(f + k) * 3 + 1] = c[1];
        colArr[(f + k) * 3 + 2] = c[2];
      }
    }
    ng.setAttribute('color', new Float32BufferAttribute(colArr, 3));
    return ng;
  };
  const parts =
    variant === 0
      ? [peak(0.5, 1.0, -0.05, 0.02, 11), peak(0.34, 0.62, 0.36, 0.18, 23), peak(0.3, 0.5, -0.36, -0.26, 37)]
      : [peak(0.44, 0.86, 0.14, -0.08, 41), peak(0.42, 0.78, -0.26, 0.16, 53), peak(0.22, 0.36, 0.38, 0.36, 67)];
  return assemble(parts);
};

/** Boulder / pebble: a squashed jittered icosahedron (tinted per instance). */
export const rockGeometry = (): BufferGeometry => {
  const g = new IcosahedronGeometry(0.5, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const kx = Math.round(p.getX(i) * 100);
    const kz = Math.round(p.getZ(i) * 100);
    const ky = Math.round(p.getY(i) * 100);
    const s = 0.8 + unit01(hashTile(kx, ky, kz)) * 0.35;
    p.setXYZ(i, p.getX(i) * s, Math.max(-0.1, p.getY(i) * s * 0.6), p.getZ(i) * s);
  }
  g.translate(0, 0.1, 0);
  return assemble([paintBy(g, (_x, y) => scaleRgb([1, 1, 1], 0.72 + Math.min(1, y / 0.4) * 0.38))]);
};

// --- Vegetation -------------------------------------------------------------------------------------

const TRUNK = lin('#6d4c33');
const PINE_D = lin('#2f5a3c');
const PINE_M = lin('#3f7048');
const PINE_L = lin('#5b8a52');
const LEAF_D = lin('#4d7a3a');
const LEAF_M = lin('#6a9646');
const LEAF_L = lin('#8fb35a');
const JUNGLE_D = lin('#22573a');
const JUNGLE_M = lin('#2f7444');
const JUNGLE_L = lin('#4c9150');
const PALM_LEAF = lin('#5f9a45');
const PALM_TRUNK = lin('#9a7650');

/** Conifer: trunk + three stacked cones, dark to light (forest; height ≈ 0.6). */
export const coniferGeometry = (): BufferGeometry => {
  const trunk = paint(baseAt0(new CylinderGeometry(0.03, 0.04, 0.12, 5), 0.12), TRUNK);
  const tier = (r: number, h: number, y: number, c: Rgb): BufferGeometry => {
    const g = new ConeGeometry(r, h, 7, 1, true);
    g.translate(0, y + h / 2, 0);
    return paint(g, c);
  };
  return assemble([trunk, tier(0.2, 0.26, 0.08, PINE_D), tier(0.16, 0.24, 0.22, PINE_M), tier(0.11, 0.2, 0.36, PINE_L)]);
};

/** Broadleaf: trunk + a cluster of three leafy blobs in three tones. */
export const broadleafGeometry = (): BufferGeometry => {
  const trunk = paint(baseAt0(new CylinderGeometry(0.03, 0.045, 0.2, 5), 0.2), TRUNK);
  const blob = (r: number, x: number, y: number, z: number, c: Rgb): BufferGeometry => {
    const g = new IcosahedronGeometry(r, 0);
    g.scale(1, 0.85, 1);
    g.translate(x, y, z);
    return paint(g, c);
  };
  return assemble([
    trunk,
    blob(0.17, 0, 0.3, 0, LEAF_M),
    blob(0.12, 0.1, 0.25, 0.06, LEAF_D),
    blob(0.11, -0.06, 0.4, -0.04, LEAF_L),
  ]);
};

/** Jungle canopy: wide, layered, darker crowns. */
export const jungleGeometry = (): BufferGeometry => {
  const trunk = paint(baseAt0(new CylinderGeometry(0.035, 0.05, 0.3, 5), 0.3), TRUNK);
  const blob = (r: number, x: number, y: number, z: number, c: Rgb): BufferGeometry => {
    const g = new IcosahedronGeometry(r, 0);
    g.scale(1.25, 0.6, 1.25);
    g.translate(x, y, z);
    return paint(g, c);
  };
  return assemble([
    trunk,
    blob(0.2, 0, 0.34, 0, JUNGLE_M),
    blob(0.15, 0.12, 0.28, -0.08, JUNGLE_D),
    blob(0.13, -0.1, 0.44, 0.06, JUNGLE_L),
    blob(0.12, -0.06, 0.24, -0.12, JUNGLE_D),
  ]);
};

/** Palm: leaning segmented trunk and drooping fronds (oasis, arid kits). Height ≈ 1. */
export const palmGeometry = (): BufferGeometry => {
  const parts: BufferGeometry[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const seg = new CylinderGeometry(0.035 - i * 0.004, 0.045 - i * 0.004, 0.2, 5);
    seg.translate(x, y + 0.1, 0);
    parts.push(paint(seg, scaleRgb(PALM_TRUNK, 1 - (i % 2) * 0.15)));
    x += 0.025 + i * 0.01;
    y += 0.19;
  }
  for (let k = 0; k < 6; k++) {
    const leaf = new ConeGeometry(0.06, 0.38, 3);
    leaf.scale(1, 1, 0.25);
    leaf.rotateZ(-Math.PI / 2 - 0.5);
    leaf.translate(0.17, -0.07, 0);
    leaf.rotateY((k / 6) * Math.PI * 2 + 0.3);
    leaf.translate(x, y, 0);
    parts.push(paint(leaf, k % 2 ? PALM_LEAF : scaleRgb(PALM_LEAF, 0.8)));
  }
  const nuts = new IcosahedronGeometry(0.04, 0);
  nuts.translate(x, y - 0.03, 0);
  parts.push(paint(nuts, lin('#6b4a2c')));
  return assemble(parts);
};

// --- Micro detail -------------------------------------------------------------------------------------

/** Grass tuft: a few thin blades, dark base to light tips (tinted with the tile color). */
export const tuftGeometry = (): BufferGeometry => {
  const parts: BufferGeometry[] = [];
  const blades: [number, number, number, number][] = [
    [0, 0, 0.09, 0],
    [0.025, 0.01, 0.07, 0.35],
    [-0.02, 0.015, 0.075, -0.4],
    [0.005, -0.025, 0.06, 0.2],
  ];
  for (const [x, z, h, tilt] of blades) {
    const g = new ConeGeometry(0.012, h, 3, 1, true);
    g.translate(0, h / 2, 0);
    g.rotateZ(tilt * 0.6);
    g.rotateX(tilt * 0.3);
    g.translate(x, 0, z);
    parts.push(paintBy(g, (_x, y) => scaleRgb([1, 1, 1], 0.7 + (y / h) * 0.55)));
  }
  return assemble(parts);
};

/** Reeds with cattail heads (marsh, river banks). */
export const reedGeometry = (): BufferGeometry => {
  const parts: BufferGeometry[] = [];
  const stems: [number, number, number][] = [
    [0, 0, 0.17],
    [0.03, 0.02, 0.13],
    [-0.025, 0.02, 0.15],
  ];
  for (const [x, z, h] of stems) {
    const s = new CylinderGeometry(0.004, 0.006, h, 3);
    s.translate(x, h / 2, z);
    parts.push(paint(s, lin('#6f8f4c')));
    const head = new CylinderGeometry(0.011, 0.011, 0.04, 4);
    head.translate(x, h - 0.01, z);
    parts.push(paint(head, lin('#6b4a2e')));
  }
  return assemble(parts);
};

/** Snow drift: a long low faceted bank. */
export const driftGeometry = (): BufferGeometry => {
  const g = new SphereGeometry(0.5, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, 0.18, 0.4);
  return assemble([paintBy(g, (_x, y) => scaleRgb([1, 1, 1], 0.92 + y * 0.6))]);
};

/** Wildflower sprinkle: tiny colored blobs (fixed vertex colors). */
export const flowerGeometry = (): BufferGeometry => {
  const parts: BufferGeometry[] = [];
  const cols = ['#f3e9d2', '#f0c74a', '#e7a1b0', '#f3e9d2', '#c9b6e8'];
  for (let i = 0; i < 5; i++) {
    const g = new IcosahedronGeometry(0.016, 0);
    const a = i * 2.4;
    g.translate(Math.cos(a) * 0.05 * (i % 3), 0.03 + (i % 2) * 0.01, Math.sin(a) * 0.05 * (i % 3));
    parts.push(paint(g, lin(cols[i] ?? '#ffffff')));
  }
  return assemble(parts);
};

// --- Resource props -------------------------------------------------------------------------------------

export const RESOURCE_PROPS = ['grain', 'orchard', 'animal', 'ore', 'sea', 'goods'] as const;
export type ResourcePropKind = (typeof RESOURCE_PROPS)[number];

/** Resource props: fixed tones plus a team-colored accent (instanceColor = resource accent). */
export const resourcePropGeometry = (kind: ResourcePropKind): BufferGeometry => {
  switch (kind) {
    case 'grain': {
      const parts: BufferGeometry[] = [];
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1;
        const g = new ConeGeometry(0.045, 0.16, 6);
        g.rotateX(Math.PI);
        g.translate(Math.cos(a) * 0.07, 0.08, Math.sin(a) * 0.07);
        parts.push(paint(g, team(1)));
        const band = new CylinderGeometry(0.026, 0.026, 0.02, 6);
        band.translate(Math.cos(a) * 0.07, 0.07, Math.sin(a) * 0.07);
        parts.push(paint(band, lin('#8a6a3a')));
      }
      return assemble(parts);
    }
    case 'orchard': {
      const parts: BufferGeometry[] = [];
      for (let i = 0; i < 2; i++) {
        const x = i === 0 ? -0.06 : 0.07;
        const t = new CylinderGeometry(0.012, 0.016, 0.08, 4);
        t.translate(x, 0.04, 0);
        parts.push(paint(t, TRUNK));
        const c = new IcosahedronGeometry(0.075, 0);
        c.translate(x, 0.12, 0);
        parts.push(paint(c, LEAF_D));
        for (let k = 0; k < 3; k++) {
          const f = new IcosahedronGeometry(0.02, 0);
          const a = k * 2.1 + i;
          f.translate(x + Math.cos(a) * 0.06, 0.11 + (k % 2) * 0.04, Math.sin(a) * 0.06);
          parts.push(paint(f, team(1)));
        }
      }
      return assemble(parts);
    }
    case 'animal': {
      const parts: BufferGeometry[] = [];
      const beast = (x: number, z: number, rot: number, s: number): void => {
        const add = (g: BufferGeometry, c: Rgb): void => {
          g.scale(s, s, s);
          g.rotateY(rot);
          g.translate(x, 0, z);
          parts.push(paint(g, c));
        };
        const body = new BoxGeometry(0.06, 0.055, 0.13);
        body.translate(0, 0.085, 0);
        add(body, team(1));
        const neck = new BoxGeometry(0.035, 0.06, 0.04);
        neck.rotateX(0.5);
        neck.translate(0, 0.12, -0.07);
        add(neck, team(0.95));
        const head = new BoxGeometry(0.035, 0.035, 0.06);
        head.translate(0, 0.15, -0.1);
        add(head, team(0.9));
        for (const [lx, lz] of [
          [-0.02, -0.045],
          [0.02, -0.045],
          [-0.02, 0.045],
          [0.02, 0.045],
        ] as const) {
          const leg = new BoxGeometry(0.014, 0.06, 0.014);
          leg.translate(lx, 0.03, lz);
          add(leg, lin('#3b2f28'));
        }
      };
      beast(-0.05, 0.02, 0.4, 1);
      beast(0.08, -0.04, -0.6, 0.85);
      return assemble(parts);
    }
    case 'ore': {
      const parts: BufferGeometry[] = [];
      const stones: [number, number, number, number][] = [
        [0, 0, 0.09, 0.2],
        [0.07, 0.04, 0.07, -0.4],
        [-0.06, 0.05, 0.06, 0.8],
      ];
      for (const [x, z, s, r] of stones) {
        const g = new BoxGeometry(s, s * 0.7, s * 0.9);
        g.rotateY(r);
        g.translate(x, (s * 0.7) / 2, z);
        parts.push(paint(g, lin('#9c968c')));
      }
      for (let i = 0; i < 3; i++) {
        const g = new OctahedronGeometry(0.03, 0);
        g.translate(-0.02 + i * 0.04, 0.08 + (i % 2) * 0.02, -0.03 + (i % 2) * 0.05);
        parts.push(paint(g, team(1.1)));
      }
      return assemble(parts);
    }
    case 'sea': {
      const ring = new TorusGeometry(0.11, 0.012, 3, 16);
      ring.rotateX(Math.PI / 2);
      ring.translate(0, 0.01, 0);
      const fish = new ConeGeometry(0.03, 0.11, 4);
      fish.rotateZ(-Math.PI / 2 + 0.6);
      fish.translate(0.02, 0.09, 0);
      const tail = new ConeGeometry(0.025, 0.04, 3);
      tail.rotateZ(Math.PI / 2 + 0.6);
      tail.translate(-0.05, 0.05, 0);
      return assemble([paint(ring, lin('#f4efe2')), paint(fish, team(1)), paint(tail, team(0.85))]);
    }
    case 'goods': {
      const crate = new BoxGeometry(0.1, 0.08, 0.09);
      crate.translate(-0.03, 0.04, 0);
      const bale = new CylinderGeometry(0.04, 0.04, 0.12, 7);
      bale.rotateZ(Math.PI / 2);
      bale.translate(0.05, 0.04, 0.04);
      const bale2 = new CylinderGeometry(0.035, 0.035, 0.1, 7);
      bale2.rotateZ(Math.PI / 2);
      bale2.translate(0.01, 0.11, 0.0);
      return assemble([paint(crate, lin('#8a6440')), paint(bale, team(1)), paint(bale2, team(0.85))]);
    }
  }
};

/** Class marker for unknown resource ids (bonus = ball, luxury = gem, strategic = block). */
export const resourceShapeGeometry = (cls: 'bonus' | 'luxury' | 'strategic'): BufferGeometry => {
  switch (cls) {
    case 'bonus': {
      const g = new IcosahedronGeometry(0.08, 1);
      g.translate(0, 0.09, 0);
      return assemble([paint(g, team(1))]);
    }
    case 'luxury': {
      const g = new OctahedronGeometry(0.09);
      g.scale(0.85, 1.35, 0.85);
      g.translate(0, 0.13, 0);
      return assemble([paint(g, team(1))]);
    }
    case 'strategic':
      return assemble([paint(boxGeometry(0.13, 0.13, 0.13), team(1))]);
  }
};

// --- Building pieces (architecture.ts PieceKind) ------------------------------------------------------

/** Unit block with a baked darker foot (ambient occlusion where it meets the ground). */
const blockPiece = (): BufferGeometry => {
  const g = new BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return assemble([paintBy(g, (_x, y) => scaleRgb([1, 1, 1], 0.78 + y * 0.24))]);
};

/** Gable roof: triangular prism, ridge along x, 1 × 1 × 1, slight eave overhang baked in. */
const gablePiece = (): BufferGeometry => {
  const pos: number[] = [];
  const A = [-0.5, 0, -0.5];
  const B = [0.5, 0, -0.5];
  const C = [0.5, 0, 0.5];
  const D = [-0.5, 0, 0.5];
  const E = [-0.5, 1, 0];
  const F = [0.5, 1, 0];
  pushTri(pos, A, E, F);
  pushTri(pos, A, F, B);
  pushTri(pos, D, C, F);
  pushTri(pos, D, F, E);
  pushTri(pos, A, D, E);
  pushTri(pos, B, F, C);
  pushTri(pos, A, B, C);
  pushTri(pos, A, C, D);
  return paintBy(flatGeometry(pos), (_x, y) => scaleRgb([1, 1, 1], 0.86 + y * 0.18));
};

/** Upturned (sinic) roof: concave hip roof with lifted corners. */
const eavePiece = (): BufferGeometry => {
  const pos: number[] = [];
  const ring = (t: number): number[][] => {
    // t = 0 eave edge .. 1 ridge. Concave profile; corners lift at the eave.
    const s = 0.5 * (1 - t) * (1 - t * 0.35) + 0.04 * t;
    const y = 1 - (1 - t) * (1 - t);
    return [
      [-s, y + (1 - t) * 0.22, -s],
      [s, y + (1 - t) * 0.22, -s],
      [s, y + (1 - t) * 0.22, s],
      [-s, y + (1 - t) * 0.22, s],
    ].map((p, i) => {
      // Mid-edge points sag (no lift): emitted separately below.
      void i;
      return p;
    });
  };
  const steps = [0, 0.35, 0.7, 1];
  for (let k = 0; k < steps.length - 1; k++) {
    const a = ring(steps[k] ?? 0);
    const b = ring(steps[k + 1] ?? 1);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const a0 = a[i] ?? [];
      const a1 = a[j] ?? [];
      const b0 = b[i] ?? [];
      const b1 = b[j] ?? [];
      // Mid points of the eave edge sit lower than the corners: split each side.
      const am = [((a0[0] ?? 0) + (a1[0] ?? 0)) / 2, (a0[1] ?? 0) - (k === 0 ? 0.2 : 0.06), ((a0[2] ?? 0) + (a1[2] ?? 0)) / 2];
      const bm = [((b0[0] ?? 0) + (b1[0] ?? 0)) / 2, (b0[1] ?? 0) - (k === 0 ? 0.06 : 0.02), ((b0[2] ?? 0) + (b1[2] ?? 0)) / 2];
      pushTri(pos, a0, b0, bm);
      pushTri(pos, a0, bm, am);
      pushTri(pos, am, bm, b1);
      pushTri(pos, am, b1, a1);
    }
  }
  // Underside.
  const e = ring(0);
  const e0 = e[0] ?? [];
  const e1 = e[1] ?? [];
  const e2 = e[2] ?? [];
  const e3 = e[3] ?? [];
  pushTri(pos, e0, e2, e1);
  pushTri(pos, e0, e3, e2);
  const g = flatGeometry(pos);
  // Normalize height to 0..1.
  g.computeBoundingBox();
  const bb = g.boundingBox;
  if (bb) {
    g.translate(0, -bb.min.y, 0);
    g.scale(1, 1 / Math.max(1e-3, bb.max.y - bb.min.y), 1);
  }
  g.computeVertexNormals();
  return paintBy(g, (_x, y) => scaleRgb([1, 1, 1], 0.85 + y * 0.2));
};

/** Ensure consistent outward winding: recompute normals per face; flip faces pointing inward. */
const outward = (g: BufferGeometry, cy: number): BufferGeometry => {
  const p = g.getAttribute('position');
  for (let f = 0; f < p.count; f += 3) {
    const ax = p.getX(f);
    const ay = p.getY(f);
    const az = p.getZ(f);
    const bx = p.getX(f + 1) - ax;
    const by = p.getY(f + 1) - ay;
    const bz = p.getZ(f + 1) - az;
    const cx = p.getX(f + 2) - ax;
    const cyy = p.getY(f + 2) - ay;
    const cz = p.getZ(f + 2) - az;
    const nx = by * cz - bz * cyy;
    const ny = bz * cx - bx * cz;
    const nz = bx * cyy - by * cx;
    const mx = (ax + p.getX(f + 1) + p.getX(f + 2)) / 3;
    const my = (ay + p.getY(f + 1) + p.getY(f + 2)) / 3 - cy;
    const mz = (az + p.getZ(f + 1) + p.getZ(f + 2)) / 3;
    if (nx * mx + ny * my + nz * mz < 0) {
      // Swap vertices 1 and 2.
      const tx = p.getX(f + 1);
      const ty = p.getY(f + 1);
      const tz = p.getZ(f + 1);
      p.setXYZ(f + 1, p.getX(f + 2), p.getY(f + 2), p.getZ(f + 2));
      p.setXYZ(f + 2, tx, ty, tz);
    }
  }
  g.computeVertexNormals();
  return g;
};

export const piecesGeometry = (kind: string): BufferGeometry => {
  switch (kind) {
    case 'block':
      return blockPiece();
    case 'gable':
      return gablePiece();
    case 'hip': {
      const g = new ConeGeometry(Math.SQRT1_2, 1, 4);
      g.rotateY(Math.PI / 4);
      g.translate(0, 0.5, 0);
      return assemble([paintBy(g, (_x, y) => scaleRgb([1, 1, 1], 0.86 + y * 0.18))]);
    }
    case 'dome': {
      const g = new SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      return assemble([paintBy(g, (_x, y) => scaleRgb([1, 1, 1], 0.84 + y * 0.36))]);
    }
    case 'eave':
      return assemble([outward(eavePiece(), 0.3)]);
    case 'cone': {
      const g = new ConeGeometry(0.5, 1, 8);
      g.translate(0, 0.5, 0);
      return assemble([paintBy(g, (_x, y) => scaleRgb([1, 1, 1], 0.84 + y * 0.2))]);
    }
    case 'cyl': {
      const g = new CylinderGeometry(0.5, 0.5, 1, 8);
      g.translate(0, 0.5, 0);
      return assemble([paintBy(g, (_x, y) => scaleRgb([1, 1, 1], 0.8 + y * 0.22))]);
    }
    case 'pylon': {
      const g = new CylinderGeometry(0.5 * 0.7, 0.5, 1, 4);
      g.rotateY(Math.PI / 4);
      g.scale(Math.SQRT2, 1, Math.SQRT2);
      g.translate(0, 0.5, 0);
      return assemble([paintBy(g, (_x, y) => scaleRgb([1, 1, 1], 0.82 + y * 0.22))]);
    }
    case 'wall':
      return wallRingGeometry();
    case 'palm':
      return palmGeometry();
    case 'flag':
      return flagGeometry();
    case 'finial': {
      const g = new OctahedronGeometry(0.5);
      g.translate(0, 0.5, 0);
      return assemble([g]);
    }
    default:
      return blockPiece();
  }
};

/** Hexagonal city wall (apothem 1, height 1) with crenellations and corner towers. */
export const wallRingGeometry = (): BufferGeometry => {
  const parts: BufferGeometry[] = [];
  const R = 1 / Math.cos(Math.PI / 6);
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    const len = R;
    // Gate gap on the south-east side.
    const segs = i === 1 ? [-0.32, 0.32] : [0];
    for (const off of segs) {
      const l = i === 1 ? len * 0.36 : len * 0.98;
      const b = new BoxGeometry(0.045, 1, l);
      b.translate(1, 0.5, off * len);
      b.rotateY(-a);
      parts.push(paint(b, [0.95, 0.95, 0.95]));
      const merlons = Math.max(2, Math.round(l / 0.12));
      for (let k = 0; k < merlons; k++) {
        const m = new BoxGeometry(0.05, 0.3, 0.05);
        m.translate(1, 1.15, off * len - l / 2 + (k + 0.5) * (l / merlons));
        m.rotateY(-a);
        parts.push(paint(m, [1.02, 1.02, 1.02]));
      }
    }
    // Corner tower.
    const c = hexCorner(i);
    const t = new CylinderGeometry(0.07, 0.08, 1.45, 6);
    t.translate(c.x * R, 0.725, c.z * R);
    parts.push(paintBy(t, (_x, y) => scaleRgb([1, 1, 1], 0.8 + (y / 1.45) * 0.25)));
  }
  return assemble(parts);
};

/** Banner cloth: x 0..1 away from the pole, y 0..1, subdivided so it can sway; team colored. */
export const flagGeometry = (): BufferGeometry => {
  const g = new PlaneGeometry(1, 1, 6, 1);
  g.translate(0.5, 0.5, 0);
  // Swallowtail: pull the middle of the free edge inward.
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    if (p.getX(i) > 0.99 && Math.abs(p.getY(i) - 0.5) < 0.01) p.setX(i, 0.8);
  }
  g.deleteAttribute('uv');
  return paint(g, team(1));
};

// --- Strategic + misc -----------------------------------------------------------------------------------

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
  const boss = new SphereGeometry(0.025, 6, 4);
  boss.translate(0, 0.12, 0.015);
  return assemble([paint(top, team(1)), paint(tip, team(1)), paint(boss, lin('#d9b445'))]);
};

export const disposeAll = (gs: readonly BufferGeometry[]): void => {
  for (const g of gs) g.dispose();
};
