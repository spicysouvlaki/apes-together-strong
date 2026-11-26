/**
 * Procedural settlement architecture (GDD §11): per-culture motif kits, blended by the owner's
 * adopted traditions and hybrids so a hybrid culture LOOKS hybrid.
 *
 * Pure. `motifWeights` turns cultures into a weighted motif mix; `settlementLayout` turns a
 * settlement into a list of primitive pieces (block, gable, dome, …) in tile-local coordinates
 * that the scene draws with one instanced layer per piece kind. Motif ids come from the culture
 * `architecture` field in content/cultures.json; unknown ids fall back to a generic kit.
 *
 * Conventions: positions are relative to the tile center (x east, z south) with y = 0 on the
 * tile top; rotations follow Instances.push (about +y); every piece kind has a unit-sized
 * geometry in scene/geometry.ts (see PieceKind docs), so scale = dimensions.
 */
import type { Rgb } from './colors';
import { mix, parseHexColor } from './colors';
import { ageMaterial, wallMaterial } from './palette';
import { hashTile, insideHex, unit01 } from './scatter';

/**
 * block  unit cube, base at y = 0            gable  ridge roof, ridge along local x
 * hip    square pyramid                      dome   hemisphere (height 0.5 at sy = 1)
 * eave   curved upturned roof (sinic)        cone   cone
 * cyl    cylinder                            pylon  tapered block (top 70%)
 * wall   hexagonal crenellated ring, apothem 1 palm  palm tree, ~1 tall
 * flag   cloth, x 0..1 away from the pole, y 0..1 (sways)   finial  gold ornament
 */
export const PIECE_KINDS = ['block', 'gable', 'hip', 'dome', 'eave', 'cone', 'cyl', 'pylon', 'wall', 'palm', 'flag', 'finial'] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

export interface Piece {
  k: PieceKind;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  r: number;
  c: Rgb;
}

export const MOTIFS = ['nile', 'aegean', 'sinic', 'arabian', 'nordic', 'arctic', 'steppe', 'iberian', 'generic'] as const;
export type Motif = (typeof MOTIFS)[number];
const isMotif = (m: string): m is Motif => (MOTIFS as readonly string[]).includes(m);

// --- Culture -> motif mix -------------------------------------------------------------------

export interface CultureIndex {
  cultureMotif: ReadonlyMap<string, string>;
  traditionCulture: ReadonlyMap<string, string>;
  hybridCultures: ReadonlyMap<string, readonly string[]>;
}

export const buildCultureIndex = (content: {
  cultures?: readonly { id: string; architecture: string }[];
  traditions?: readonly { id: string; culture: string }[];
  hybrids?: readonly { id: string; cultures: readonly string[] }[];
}): CultureIndex => ({
  cultureMotif: new Map((content.cultures ?? []).map((c) => [c.id, c.architecture])),
  traditionCulture: new Map((content.traditions ?? []).map((t) => [t.id, t.culture])),
  hybridCultures: new Map((content.hybrids ?? []).map((h) => [h.id, h.cultures])),
});

export interface MotifWeight {
  motif: Motif;
  weight: number;
}

/** Weight of each adopted tradition's culture, and of each hybrid's two parent cultures. */
export const TRADITION_WEIGHT = 0.22;
export const HYBRID_WEIGHT = 0.45;
/** A culture's adopted traditions add at most this much (one culture can't swamp the city). */
const TRADITION_CAP = 0.9;

/**
 * Motif mix for a settlement: its naming culture is the base (weight 1), the owner's adopted
 * traditions and hybrids blend in their cultures' motifs. Top three, normalized, sorted.
 */
export const motifWeights = (
  namedFor: string | null | undefined,
  traditions: readonly string[],
  hybrids: readonly string[],
  idx: CultureIndex,
): MotifWeight[] => {
  const w = new Map<Motif, number>();
  const add = (culture: string | undefined, amount: number): void => {
    if (!culture) return;
    const raw = idx.cultureMotif.get(culture) ?? 'generic';
    const m: Motif = isMotif(raw) ? raw : 'generic';
    w.set(m, (w.get(m) ?? 0) + amount);
  };
  add(namedFor ?? undefined, 1);
  const perCulture = new Map<string, number>();
  for (const t of traditions) {
    const c = idx.traditionCulture.get(t);
    if (!c) continue;
    const used = perCulture.get(c) ?? 0;
    const amount = Math.min(TRADITION_WEIGHT, TRADITION_CAP - used);
    if (amount <= 0) continue;
    perCulture.set(c, used + amount);
    add(c, amount);
  }
  for (const h of hybrids) for (const c of idx.hybridCultures.get(h) ?? []) add(c, HYBRID_WEIGHT);
  let list = [...w.entries()].map(([motif, weight]) => ({ motif, weight }));
  if (list.length === 0) return [{ motif: 'generic', weight: 1 }];
  // Stable order: weight desc, then motif id.
  list.sort((a, b) => b.weight - a.weight || (a.motif < b.motif ? -1 : 1));
  const total0 = list.reduce((s, x) => s + x.weight, 0);
  list = list.filter((x, i) => i === 0 || x.weight / total0 >= 0.08).slice(0, 3);
  const total = list.reduce((s, x) => s + x.weight, 0);
  return list.map((x) => ({ motif: x.motif, weight: x.weight / total }));
};

/** Deterministic weighted pick with a [0,1) draw. */
export const pickMotif = (weights: readonly MotifWeight[], u: number): Motif => {
  let acc = 0;
  for (const w of weights) {
    acc += w.weight;
    if (u < acc) return w.motif;
  }
  return weights[weights.length - 1]?.motif ?? 'generic';
};

// --- Kit materials -----------------------------------------------------------------------------

interface KitColors {
  wall: Rgb;
  roof: Rgb;
  trim: Rgb;
  accent: Rgb;
}

const hex = parseHexColor;
const KIT: Record<Motif, KitColors> = {
  nile: { wall: hex('#cf9f6c'), roof: hex('#c4a06c'), trim: hex('#f0e4c6'), accent: hex('#3f86a6') },
  aegean: { wall: hex('#f4f0e6'), roof: hex('#c8673f'), trim: hex('#e6dccb'), accent: hex('#3d6fa8') },
  sinic: { wall: hex('#ece3d2'), roof: hex('#55656f'), trim: hex('#9b8f83'), accent: hex('#b23b2e') },
  arabian: { wall: hex('#ead6b0'), roof: hex('#f3eee3'), trim: hex('#c9a54a'), accent: hex('#3c8f8c') },
  nordic: { wall: hex('#8d6642'), roof: hex('#748f4e'), trim: hex('#5d4029'), accent: hex('#b0452f') },
  arctic: { wall: hex('#f0f5f7'), roof: hex('#c9a77c'), trim: hex('#8f8d88'), accent: hex('#6f5a44') },
  steppe: { wall: hex('#f0e7d3'), roof: hex('#cbb48c'), trim: hex('#a3452f'), accent: hex('#2f5f8f') },
  iberian: { wall: hex('#f1e7d3'), roof: hex('#c4623a'), trim: hex('#c9b99a'), accent: hex('#d0a03a') },
  generic: { wall: hex('#e9ddc5'), roof: hex('#a8644b'), trim: hex('#b8a88c'), accent: hex('#7a6a50') },
};

const GOLD = hex('#e0b23e');
const WOOD = hex('#7a5536');
const STONE = hex('#b9b1a3');

// --- Emitter -----------------------------------------------------------------------------------

class Emit {
  readonly out: Piece[] = [];
  /** Add a piece at house-local (dx, dy, dz), house at (hx, hz) rotated by hr. */
  part(
    k: PieceKind,
    hx: number,
    hz: number,
    hr: number,
    dx: number,
    dy: number,
    dz: number,
    sx: number,
    sy: number,
    sz: number,
    c: Rgb,
    extraRot = 0,
  ): void {
    const cs = Math.cos(hr);
    const sn = Math.sin(hr);
    // Same rotation convention as Instances.push: x' = c·x + s·z, z' = −s·x + c·z.
    this.out.push({ k, x: hx + cs * dx + sn * dz, y: dy, z: hz - sn * dx + cs * dz, sx, sy, sz, r: hr + extraRot, c });
  }
}

interface Ctx {
  e: Emit;
  age: number;
  rnd: (k: number) => number;
  mat: (m: Motif) => KitColors;
}

// --- Houses ------------------------------------------------------------------------------------

const house = (ctx: Ctx, m: Motif, x: number, z: number, s: number, r: number, k: number): void => {
  const { e } = ctx;
  const c = ctx.mat(m);
  const v = ctx.rnd(k * 7 + 3);
  switch (m) {
    case 'nile': {
      const h = 0.12 + v * 0.05;
      e.part('block', x, z, r, 0, 0, 0, 0.18 * s, h * s, 0.16 * s, c.wall);
      e.part('block', x, z, r, 0, h * s, 0, 0.19 * s, 0.018 * s, 0.17 * s, c.trim);
      if (v > 0.55) e.part('block', x, z, r, -0.04 * s, (h + 0.018) * s, 0.02 * s, 0.09 * s, 0.07 * s, 0.1 * s, c.wall);
      break;
    }
    case 'aegean': {
      const h = 0.11 + v * 0.04;
      e.part('block', x, z, r, 0, 0, 0, 0.16 * s, h * s, 0.15 * s, c.wall);
      e.part('gable', x, z, r, 0, h * s, 0, 0.17 * s, 0.065 * s, 0.165 * s, c.roof);
      break;
    }
    case 'sinic': {
      e.part('block', x, z, r, 0, 0, 0, 0.21 * s, 0.025 * s, 0.18 * s, c.trim);
      e.part('block', x, z, r, 0, 0.025 * s, 0, 0.16 * s, 0.1 * s, 0.13 * s, c.wall);
      e.part('eave', x, z, r, 0, 0.125 * s, 0, 0.25 * s, 0.085 * s, 0.21 * s, c.roof);
      break;
    }
    case 'arabian': {
      const h = 0.12 + v * 0.05;
      e.part('block', x, z, r, 0, 0, 0, 0.17 * s, h * s, 0.17 * s, c.wall);
      if (v > 0.5) e.part('dome', x, z, r, 0, h * s, 0, 0.12 * s, 0.14 * s, 0.12 * s, v > 0.8 ? c.accent : c.roof);
      else e.part('block', x, z, r, 0.055 * s, h * s, -0.055 * s, 0.045 * s, 0.09 * s, 0.045 * s, c.wall); // wind tower
      break;
    }
    case 'nordic': {
      e.part('block', x, z, r, 0, 0, 0, 0.3 * s, 0.075 * s, 0.13 * s, c.wall);
      e.part('gable', x, z, r, 0, 0.075 * s, 0, 0.32 * s, 0.11 * s, 0.17 * s, c.roof);
      e.part('block', x, z, r, 0.165 * s, 0.05 * s, 0, 0.012 * s, 0.13 * s, 0.03 * s, c.trim); // gable post
      break;
    }
    case 'arctic': {
      if (v > 0.4) {
        e.part('dome', x, z, r, 0, 0, 0, 0.19 * s, 0.2 * s, 0.19 * s, c.wall);
        e.part('dome', x, z, r, 0.1 * s, 0, 0, 0.08 * s, 0.1 * s, 0.07 * s, c.wall); // entrance
      } else {
        e.part('cone', x, z, r, 0, 0, 0, 0.15 * s, 0.22 * s, 0.15 * s, c.roof);
        e.part('cyl', x, z, r, 0, 0.18 * s, 0, 0.012 * s, 0.09 * s, 0.012 * s, c.accent);
      }
      break;
    }
    case 'steppe': {
      e.part('cyl', x, z, r, 0, 0, 0, 0.18 * s, 0.08 * s, 0.18 * s, c.wall);
      e.part('cone', x, z, r, 0, 0.08 * s, 0, 0.2 * s, 0.07 * s, 0.2 * s, c.roof);
      e.part('block', x, z, r, 0.085 * s, 0, 0, 0.02 * s, 0.06 * s, 0.05 * s, c.trim); // door
      break;
    }
    case 'iberian': {
      const h = 0.12 + v * 0.05;
      e.part('block', x, z, r, 0, 0, 0, 0.17 * s, h * s, 0.16 * s, c.wall);
      e.part('hip', x, z, r, 0, h * s, 0, 0.19 * s, 0.065 * s, 0.18 * s, c.roof);
      break;
    }
    case 'generic': {
      e.part('block', x, z, r, 0, 0, 0, 0.16 * s, 0.12 * s, 0.15 * s, c.wall);
      e.part('hip', x, z, r, 0, 0.12 * s, 0, 0.18 * s, 0.08 * s, 0.17 * s, c.roof);
      break;
    }
  }
};

// --- Centerpieces (cities) -----------------------------------------------------------------------

const pagoda = (ctx: Ctx, c: KitColors, x: number, z: number, r: number, tiers: number, s: number): void => {
  let y = 0;
  let w = 0.2 * s;
  ctx.e.part('block', x, z, r, 0, 0, 0, w * 1.3, 0.03 * s, w * 1.3, c.trim);
  y += 0.03 * s;
  for (let i = 0; i < tiers; i++) {
    const h = 0.09 * s;
    ctx.e.part('block', x, z, r, 0, y, 0, w, h, w, i === 0 ? c.accent : c.wall);
    y += h;
    ctx.e.part('eave', x, z, r, 0, y, 0, w * 1.6, 0.07 * s, w * 1.6, c.roof);
    y += 0.05 * s;
    w *= 0.78;
  }
  ctx.e.part('cyl', x, z, r, 0, y, 0, 0.015 * s, 0.08 * s, 0.015 * s, GOLD);
};

const center = (ctx: Ctx, m: Motif, s: number, r: number, capital: boolean): void => {
  const { e } = ctx;
  const c = ctx.mat(m);
  const x = -0.04;
  const z = -0.06;
  switch (m) {
    case 'nile': {
      e.part('block', x, z, r, 0, 0, -0.06 * s, 0.3 * s, 0.13 * s, 0.2 * s, c.wall);
      e.part('pylon', x, z, r, -0.1 * s, 0, 0.08 * s, 0.11 * s, 0.26 * s, 0.07 * s, c.wall);
      e.part('pylon', x, z, r, 0.1 * s, 0, 0.08 * s, 0.11 * s, 0.26 * s, 0.07 * s, c.wall);
      e.part('block', x, z, r, 0, 0.19 * s, 0.08 * s, 0.1 * s, 0.04 * s, 0.05 * s, c.accent);
      if (capital) {
        e.part('pylon', x, z, r, 0, 0, 0.2 * s, 0.045 * s, 0.4 * s, 0.045 * s, c.wall);
        e.part('hip', x, z, r, 0, 0.4 * s, 0.2 * s, 0.035 * s, 0.05 * s, 0.035 * s, GOLD);
      }
      break;
    }
    case 'aegean': {
      const w = capital ? 1.15 : 1;
      e.part('block', x, z, r, 0, 0, 0, 0.38 * s * w, 0.035 * s, 0.26 * s * w, c.trim);
      for (let i = 0; i < 4; i++) {
        const cx = (-0.15 + i * 0.1) * s * w;
        e.part('cyl', x, z, r, cx, 0.035 * s, 0.1 * s * w, 0.035 * s, 0.15 * s, 0.035 * s, c.wall);
        e.part('cyl', x, z, r, cx, 0.035 * s, -0.1 * s * w, 0.035 * s, 0.15 * s, 0.035 * s, c.wall);
      }
      e.part('block', x, z, r, 0, 0.035 * s, 0, 0.26 * s * w, 0.14 * s, 0.13 * s * w, c.wall);
      e.part('block', x, z, r, 0, 0.185 * s, 0, 0.38 * s * w, 0.025 * s, 0.25 * s * w, c.trim);
      e.part('gable', x, z, r, 0, 0.21 * s, 0, 0.4 * s * w, 0.08 * s, 0.27 * s * w, c.roof);
      break;
    }
    case 'sinic': {
      pagoda(ctx, c, x, z, r, capital ? 4 : 3, s);
      // Courtyard wall.
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        e.part('block', x, z, r + a, 0.2 * s, 0, 0, 0.02 * s, 0.05 * s, 0.38 * s, c.trim);
      }
      break;
    }
    case 'arabian': {
      e.part('block', x, z, r, 0, 0, 0, 0.3 * s, 0.15 * s, 0.26 * s, c.wall);
      e.part('cyl', x, z, r, 0, 0.15 * s, 0, 0.16 * s, 0.04 * s, 0.16 * s, c.wall);
      e.part('dome', x, z, r, 0, 0.19 * s, 0, 0.2 * s, 0.24 * s, 0.2 * s, capital ? GOLD : c.accent);
      e.part('cyl', x, z, r, 0.16 * s, 0, 0.12 * s, 0.05 * s, 0.42 * s, 0.05 * s, c.wall);
      e.part('dome', x, z, r, 0.16 * s, 0.42 * s, 0.12 * s, 0.065 * s, 0.08 * s, 0.065 * s, c.accent);
      break;
    }
    case 'nordic': {
      e.part('block', x, z, r, 0, 0, 0, 0.44 * s, 0.11 * s, 0.18 * s, c.wall);
      e.part('gable', x, z, r, 0, 0.11 * s, 0, 0.46 * s, 0.16 * s, 0.23 * s, c.roof);
      // Stave tower: stacked dark gables.
      const tx = -0.13 * s;
      e.part('block', x, z, r, tx, 0, 0.2 * s, 0.1 * s, 0.16 * s, 0.1 * s, c.trim);
      e.part('hip', x, z, r, tx, 0.16 * s, 0.2 * s, 0.14 * s, 0.07 * s, 0.14 * s, WOOD);
      e.part('block', x, z, r, tx, 0.2 * s, 0.2 * s, 0.06 * s, 0.08 * s, 0.06 * s, c.trim);
      e.part('hip', x, z, r, tx, 0.28 * s, 0.2 * s, 0.09 * s, 0.12 * s, 0.09 * s, WOOD);
      if (capital) e.part('cone', x, z, r, 0.22 * s, 0.11 * s, 0, 0.03 * s, 0.1 * s, 0.03 * s, GOLD);
      break;
    }
    case 'arctic': {
      e.part('dome', x, z, r, 0, 0, 0, 0.3 * s, 0.3 * s, 0.3 * s, c.wall);
      e.part('dome', x, z, r, 0.15 * s, 0, 0.02 * s, 0.11 * s, 0.13 * s, 0.1 * s, c.wall);
      inuksuk(ctx, x + 0.2 * s, z + 0.2 * s, r, 0.7 * s, c.trim);
      break;
    }
    case 'steppe': {
      e.part('cyl', x, z, r, 0, 0, 0, 0.3 * s, 0.11 * s, 0.3 * s, c.wall);
      e.part('cyl', x, z, r, 0, 0.07 * s, 0, 0.305 * s, 0.025 * s, 0.305 * s, c.trim);
      e.part('cone', x, z, r, 0, 0.11 * s, 0, 0.33 * s, 0.11 * s, 0.33 * s, c.roof);
      for (let i = 0; i < (capital ? 3 : 2); i++) {
        const bx = (-0.22 + i * 0.22) * s;
        e.part('cyl', x, z, r, bx, 0, 0.22 * s, 0.014 * s, 0.38 * s, 0.014 * s, WOOD);
        e.part('cone', x, z, r, bx, 0.38 * s, 0.22 * s, 0.05 * s, 0.1 * s, 0.05 * s, i === 1 ? c.trim : c.accent);
      }
      break;
    }
    case 'iberian': {
      e.part('block', x, z, r, -0.08 * s, 0, 0, 0.17 * s, 0.34 * s, 0.17 * s, c.trim);
      e.part('block', x, z, r, -0.08 * s, 0.34 * s, 0, 0.19 * s, 0.025 * s, 0.19 * s, c.wall);
      e.part('hip', x, z, r, -0.08 * s, 0.365 * s, 0, 0.18 * s, 0.1 * s, 0.18 * s, c.roof);
      e.part('block', x, z, r, 0.12 * s, 0, -0.02 * s, 0.24 * s, 0.13 * s, 0.14 * s, c.wall);
      e.part('hip', x, z, r, 0.12 * s, 0.13 * s, -0.02 * s, 0.26 * s, 0.06 * s, 0.16 * s, c.roof);
      for (let i = 0; i < 3; i++) e.part('cyl', x, z, r, (0.04 + i * 0.08) * s, 0, 0.07 * s, 0.025 * s, 0.11 * s, 0.025 * s, c.wall);
      if (capital) e.part('finial', x, z, r, -0.08 * s, 0.47 * s, 0, 0.05 * s, 0.05 * s, 0.05 * s, GOLD);
      break;
    }
    case 'generic': {
      e.part('block', x, z, r, 0, 0, 0, 0.22 * s, 0.36 * s, 0.22 * s, c.wall);
      e.part('hip', x, z, r, 0, 0.36 * s, 0, 0.27 * s, 0.14 * s, 0.27 * s, c.roof);
      break;
    }
  }
};

const inuksuk = (ctx: Ctx, x: number, z: number, r: number, s: number, c: Rgb): void => {
  const e = ctx.e;
  e.part('block', x, z, r, -0.03 * s, 0, 0, 0.035 * s, 0.09 * s, 0.04 * s, c);
  e.part('block', x, z, r, 0.03 * s, 0, 0, 0.035 * s, 0.09 * s, 0.04 * s, c);
  e.part('block', x, z, r, 0, 0.09 * s, 0, 0.13 * s, 0.03 * s, 0.05 * s, c);
  e.part('block', x, z, r, 0, 0.12 * s, 0, 0.06 * s, 0.07 * s, 0.045 * s, c);
  e.part('block', x, z, r, 0, 0.19 * s, 0, 0.16 * s, 0.025 * s, 0.04 * s, c);
  e.part('block', x, z, r, 0, 0.215 * s, 0, 0.045 * s, 0.045 * s, 0.04 * s, c);
};

// --- Wonder landmarks ----------------------------------------------------------------------------

export const LANDMARK_KINDS = [
  'pyramid',
  'stepPyramid',
  'temple',
  'gate',
  'greatWall',
  'dome',
  'runestone',
  'inuksuk',
  'dolmen',
  'dam',
  'aqueduct',
  'pagoda',
  'ding',
  'monument',
] as const;
export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

/**
 * Render-side art table: which silhouette a built wonder gets. Presentation only (like the
 * feature styles); any wonder not listed gets the generic monument.
 */
const LANDMARKS: Record<string, LandmarkKind> = {
  great_pyramid: 'pyramid',
  step_pyramid: 'stepPyramid',
  oracle_of_delphi: 'temple',
  parthenon: 'temple',
  lion_gate: 'gate',
  great_wall: 'greatWall',
  house_of_wisdom: 'dome',
  jelling_stones: 'runestone',
  tanum_rock_carvings: 'runestone',
  inuksuk_point: 'inuksuk',
  dolmen_of_menga: 'dolmen',
  marib_dam: 'dam',
  aqueduct_of_segovia: 'aqueduct',
  shangdu: 'pagoda',
  houmuwu_ding: 'ding',
};

export const landmarkFor = (wonderId: string): LandmarkKind => LANDMARKS[wonderId] ?? 'monument';

const landmark = (ctx: Ctx, kind: LandmarkKind, x: number, z: number, r: number, m: Motif): void => {
  const e = ctx.e;
  const sand = hex('#e3c58c');
  const marble = hex('#f3efe7');
  const grey = hex('#9e9a92');
  const c = ctx.mat(m);
  switch (kind) {
    case 'pyramid':
      e.part('hip', x, z, r, 0, 0, 0, 0.46, 0.36, 0.46, sand);
      e.part('hip', x, z, r, 0, 0.3, 0, 0.08, 0.06, 0.08, GOLD);
      break;
    case 'stepPyramid':
      for (let i = 0; i < 4; i++) e.part('block', x, z, r, 0, i * 0.07, 0, 0.44 - i * 0.09, 0.07, 0.36 - i * 0.07, sand);
      break;
    case 'temple': {
      e.part('block', x, z, r, 0, 0, 0, 0.44, 0.04, 0.3, marble);
      for (let i = 0; i < 5; i++) {
        const cx = -0.18 + i * 0.09;
        e.part('cyl', x, z, r, cx, 0.04, 0.12, 0.035, 0.18, 0.035, marble);
        e.part('cyl', x, z, r, cx, 0.04, -0.12, 0.035, 0.18, 0.035, marble);
      }
      e.part('block', x, z, r, 0, 0.22, 0, 0.44, 0.03, 0.3, marble);
      e.part('gable', x, z, r, 0, 0.25, 0, 0.46, 0.08, 0.31, marble);
      break;
    }
    case 'gate':
      e.part('block', x, z, r, -0.09, 0, 0, 0.08, 0.22, 0.1, grey);
      e.part('block', x, z, r, 0.09, 0, 0, 0.08, 0.22, 0.1, grey);
      e.part('block', x, z, r, 0, 0.22, 0, 0.28, 0.05, 0.11, grey);
      e.part('hip', x, z, r, 0, 0.27, 0, 0.14, 0.08, 0.03, sand);
      break;
    case 'greatWall':
      for (let i = 0; i < 3; i++) e.part('block', x, z, r + (i - 1) * 0.5, (i - 1) * 0.16, 0, (i % 2) * 0.05, 0.2, 0.1, 0.06, grey);
      e.part('block', x, z, r, -0.26, 0, 0, 0.09, 0.17, 0.09, grey);
      e.part('block', x, z, r, 0.26, 0, 0, 0.09, 0.17, 0.09, grey);
      e.part('hip', x, z, r, -0.26, 0.17, 0, 0.12, 0.05, 0.12, c.roof);
      e.part('hip', x, z, r, 0.26, 0.17, 0, 0.12, 0.05, 0.12, c.roof);
      break;
    case 'dome':
      e.part('block', x, z, r, 0, 0, 0, 0.32, 0.14, 0.28, hex('#ead6b0'));
      e.part('dome', x, z, r, 0, 0.14, 0, 0.24, 0.26, 0.24, hex('#3c8f8c'));
      e.part('cyl', x, z, r, -0.17, 0, 0.13, 0.04, 0.36, 0.04, hex('#ead6b0'));
      e.part('cyl', x, z, r, 0.17, 0, 0.13, 0.04, 0.36, 0.04, hex('#ead6b0'));
      break;
    case 'runestone':
      e.part('dome', x, z, r, 0, 0, 0, 0.36, 0.14, 0.3, hex('#7f9a58'));
      e.part('block', x, z, r, -0.05, 0.03, 0.05, 0.1, 0.24, 0.05, grey, 0.2);
      e.part('block', x, z, r, 0.09, 0.03, -0.02, 0.07, 0.16, 0.04, grey, -0.3);
      e.part('block', x, z, r, -0.05, 0.12, 0.076, 0.06, 0.012, 0.004, hex('#a8432f'));
      break;
    case 'inuksuk':
      inuksuk(ctx, x, z, r, 1.4, grey);
      break;
    case 'dolmen':
      e.part('block', x, z, r, -0.08, 0, 0, 0.05, 0.14, 0.12, grey, 0.1);
      e.part('block', x, z, r, 0.08, 0, 0.02, 0.05, 0.14, 0.12, grey, -0.1);
      e.part('block', x, z, r, 0, 0, -0.07, 0.12, 0.13, 0.04, grey);
      e.part('block', x, z, r, 0, 0.14, 0, 0.28, 0.04, 0.22, grey, 0.15);
      break;
    case 'dam':
      e.part('block', x, z, r, 0, 0, 0, 0.5, 0.12, 0.09, sand);
      e.part('block', x, z, r, -0.27, 0, 0, 0.06, 0.16, 0.12, grey);
      e.part('block', x, z, r, 0.27, 0, 0, 0.06, 0.16, 0.12, grey);
      break;
    case 'aqueduct':
      for (let i = 0; i < 4; i++) e.part('block', x, z, r, -0.21 + i * 0.14, 0, 0, 0.04, 0.24, 0.07, STONE);
      e.part('block', x, z, r, 0, 0.24, 0, 0.5, 0.05, 0.08, STONE);
      break;
    case 'pagoda':
      pagoda(ctx, KIT.sinic, x, z, r, 4, 1.15);
      break;
    case 'ding': {
      const bronze = hex('#6f8f6a');
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        e.part('cyl', x, z, r, Math.cos(a) * 0.08, 0, Math.sin(a) * 0.06, 0.03, 0.08, 0.03, bronze);
      }
      e.part('block', x, z, r, 0, 0.07, 0, 0.22, 0.13, 0.16, bronze);
      e.part('block', x, z, r, -0.07, 0.2, 0, 0.025, 0.06, 0.08, bronze);
      e.part('block', x, z, r, 0.07, 0.2, 0, 0.025, 0.06, 0.08, bronze);
      break;
    }
    case 'monument':
      e.part('block', x, z, r, 0, 0, 0, 0.16, 0.04, 0.16, STONE);
      e.part('pylon', x, z, r, 0, 0.04, 0, 0.07, 0.4, 0.07, c.wall);
      e.part('hip', x, z, r, 0, 0.44, 0, 0.05, 0.06, 0.05, GOLD);
      break;
  }
};

// --- Settlement layout ---------------------------------------------------------------------------

export interface SettlementLayoutInput {
  id: string;
  kind: 'town' | 'city';
  population: number;
  capital: boolean;
  cityState: boolean;
  /** AGES index (materials shift by age). */
  age: number;
  weights: readonly MotifWeight[];
  /** 0 = intact walls, 1 = breached. */
  damage: number;
  /** Owner banner color. */
  primary: Rgb;
  /** Wonders built here (ids), drawn as landmarks. */
  wonders?: readonly string[];
}

export interface SettlementLayout {
  pieces: Piece[];
  /** Footprint radius for the blob shadow / ambient occlusion under the cluster. */
  footprint: number;
  /** Banner flag piece index in `pieces` (for the capture flourish), or -1. */
  flag: number;
}

/** Houses by size: towns 2–4, cities 4–11 (+2 for capitals), growing with population. */
export const houseCount = (kind: 'town' | 'city', pop: number, capital: boolean, cityState: boolean): number => {
  if (kind === 'town' && !cityState) return Math.max(2, Math.min(4, 2 + Math.floor(pop / 3)));
  return Math.max(3, Math.min(6, 2 + Math.floor(pop * 0.45))) + (capital ? 1 : 0);
};

/** Landmark spots on the tile (outside the house ring's busiest part). */
const LANDMARK_SPOTS: readonly [number, number][] = [
  [-0.42, 0.3],
  [0.38, -0.36],
  [-0.38, -0.36],
];
const BANNER_SPOT: [number, number] = [0.44, 0.28];

export const settlementLayout = (input: SettlementLayoutInput): SettlementLayout => {
  const seed = hashTile(input.id.length, 0, 0) ^ hashString32(input.id);
  const rnd = (k: number): number => unit01(hashTile(seed, k, 77));
  const mats = new Map<Motif, KitColors>();
  const mat = (m: Motif): KitColors => {
    let c = mats.get(m);
    if (!c) {
      const k = KIT[m];
      c = { wall: ageMaterial(k.wall, input.age), roof: k.roof, trim: ageMaterial(k.trim, input.age), accent: k.accent };
      mats.set(m, c);
    }
    return c;
  };
  const ctx: Ctx = { e: new Emit(), age: input.age, rnd, mat };
  const weights = input.weights.length > 0 ? input.weights : [{ motif: 'generic' as Motif, weight: 1 }];
  const main = weights[0]?.motif ?? 'generic';
  const big = input.kind === 'city' || input.cityState;
  const rot0 = rnd(1) * Math.PI * 2;
  const pop = Math.max(1, input.population);
  const s = big ? 1.3 + Math.min(pop, 12) * 0.025 : 1.2;

  // Clear circles: center (cities), landmarks, banner.
  const wonders = (input.wonders ?? []).slice(0, LANDMARK_SPOTS.length);
  const clear: [number, number, number][] = [[BANNER_SPOT[0], BANNER_SPOT[1], 0.13]];
  if (big) clear.push([-0.04, -0.06, input.cityState ? 0.3 : 0.34]);
  wonders.forEach((_, i) => {
    const sp = LANDMARK_SPOTS[i];
    if (sp) clear.push([sp[0], sp[1], 0.27]);
  });

  // Centerpiece.
  if (input.cityState) {
    const c = mat(main);
    ctx.e.part('cyl', -0.04, -0.06, rot0, 0, 0, 0, 0.2, 0.38 + Math.min(pop, 12) * 0.012, 0.2, c.trim);
    ctx.e.part('cone', -0.04, -0.06, rot0, 0, 0.38 + Math.min(pop, 12) * 0.012, 0, 0.27, 0.2, 0.27, c.roof);
  } else if (input.kind === 'city') {
    center(ctx, main, s * (input.capital ? 1.12 : 1), rot0, input.capital);
  }

  // Houses: well-spaced, facing roughly toward the center, motif drawn from the blend.
  const n = houseCount(input.kind, pop, input.capital, input.cityState);
  const placed: [number, number][] = [];
  const minD = big ? 0.25 : 0.27;
  const limit = big ? 0.68 : 0.52;
  for (let k = 0; placed.length < n && k < n * 30; k++) {
    const a = rnd(100 + k * 2) * Math.PI * 2;
    const rr = (big ? 0.38 : 0.12) + rnd(101 + k * 2) * (limit - (big ? 0.38 : 0.12));
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    if (!insideHex(x, z, 0.8)) continue;
    if (clear.some(([cx, cz, cr]) => (x - cx) ** 2 + (z - cz) ** 2 < cr * cr)) continue;
    if (placed.some(([px, pz]) => (x - px) ** 2 + (z - pz) ** 2 < minD * minD)) continue;
    placed.push([x, z]);
  }
  placed.forEach(([x, z], k) => {
    const m = pickMotif(weights, rnd(300 + k));
    const facing = -Math.atan2(z, x) + Math.PI / 2 + (rnd(400 + k) - 0.5) * 0.5;
    const hs = (big ? 1.25 : 1.3) + rnd(500 + k) * 0.25;
    house(ctx, m, x, z, hs, facing, k);
  });

  // Motif decor: palms for the river-valley and desert kits, a corral for the steppe.
  const decorMotifs = new Set(weights.map((w) => w.motif));
  if (decorMotifs.has('nile') || decorMotifs.has('arabian')) {
    const palms = big ? 3 : 2;
    for (let i = 0; i < palms; i++) {
      const a = rot0 + i * 2.1 + 0.7;
      const x = Math.cos(a) * 0.68;
      const z = Math.sin(a) * 0.6;
      if (clear.some(([cx, cz, cr]) => (x - cx) ** 2 + (z - cz) ** 2 < cr * cr)) continue;
      const ps = 0.32 + rnd(600 + i) * 0.1;
      ctx.e.part('palm', x, z, rnd(610 + i) * 6.28, 0, 0, 0, ps, ps, ps, [1, 1, 1]);
    }
  }
  if (decorMotifs.has('steppe') && !big) {
    const cx = -0.32;
    const cz = 0.36;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.e.part('cyl', cx, cz, 0, Math.cos(a) * 0.12, 0, Math.sin(a) * 0.1, 0.012, 0.06, 0.012, WOOD);
    }
  }

  // Walls ring cities (and city-states); damage darkens them.
  if (big) {
    let wc = wallMaterial(mat(main).trim, input.age);
    if (input.damage > 0) wc = mix(wc, hex('#5e3427'), 0.25 + input.damage * 0.5);
    ctx.e.part('wall', 0, 0, 0, 0, 0, 0, 0.8, 0.09 + input.age * 0.015, 0.8, wc);
  }

  // Wonder landmarks.
  wonders.forEach((w, i) => {
    const sp = LANDMARK_SPOTS[i];
    if (sp) landmark(ctx, landmarkFor(w), sp[0], sp[1], rot0 + i, main);
  });

  // Owner banner (sways in the shader; the flag carries the colorblind pattern).
  const poleH = big ? 0.74 : 0.56;
  ctx.e.part('cyl', BANNER_SPOT[0], BANNER_SPOT[1], 0, 0, 0, 0, 0.022, poleH, 0.022, WOOD);
  const flag = ctx.e.out.length;
  ctx.e.part('flag', BANNER_SPOT[0], BANNER_SPOT[1], 0, 0.01, poleH - 0.17, 0, 0.24, 0.15, 1, input.primary);
  if (input.capital) ctx.e.part('finial', BANNER_SPOT[0], BANNER_SPOT[1], 0, 0, poleH, 0, 0.06, 0.06, 0.06, GOLD);

  return { pieces: ctx.e.out, footprint: big ? 0.78 : 0.5, flag };
};

/** FNV-1a (local copy so this module stays free of three/DOM imports beyond colors). */
const hashString32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};
