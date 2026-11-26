/**
 * Art-directed palette for the diorama look (GDD §11, CLAUDE.md "Art and audio direction").
 *
 * One place for every render-side color decision: light, atmosphere, paper and ink, soil
 * strata, water, and the muted-pastel biome grade applied on top of the readability grade in
 * terrain-style.ts. Terrain colors still come from content (CLAUDE.md rule 4); here we only
 * pull them into one harmonious family (softer chroma, lifted lightness, a shared warm cast)
 * while keeping every land pair distinguishable. Pure and deterministic; unit-tested.
 */
import { mix, parseHexColor, type Rgb } from './colors';
import { deltaE, labToRgb, rgbToLab, type Lab } from './terrain-style';

/** sRGB hex colors. Shaders receive them converted to linear. */
export const ART = {
  // Light: warm key from the upper left, cool fill from the opposite side, soft sky/ground.
  sun: '#ffe9c9',
  sunIntensity: 0.62,
  fill: '#b4c9ea',
  fillIntensity: 0.22,
  sky: '#fff3df',
  ground: '#8d8578',
  hemiIntensity: 0.56,
  // Atmosphere.
  bgTop: '#c9d8de',
  bgHorizon: '#efe4cc',
  bgBottom: '#e2d2b2',
  haze: '#ece2cc',
  vignette: '#3b2a1a',
  // Paper and ink (fog of war, strategic atlas, labels).
  paper: '#efe2c4',
  paperShade: '#d8c39a',
  ink: '#4a3826',
  // Soil "cake slice" strata, top to base.
  strata0: '#8e6d4c',
  strata1: '#735539',
  strata2: '#53402e',
  // Board plinth (sides of the whole map).
  plinth0: '#7d5d40',
  plinth1: '#5a4230',
  // Water.
  waterShallow: '#79c2bd',
  waterDeep: '#2c6688',
  foam: '#f7f1e2',
  riverBank: '#6b5a42',
  // Blob shadows.
  shadow: '#2b2016',
} as const;

export const artRgb = (k: keyof typeof ART): Rgb => {
  const v = ART[k];
  return typeof v === 'string' ? parseHexColor(v) : [v, v, v];
};

/** Land pairs stay at least this far apart (CIE76) after the pastel grade. */
export const MIN_ART_LAND_DE = 14;

/**
 * Muted-pastel grade of the (already readability-graded) terrain colors: chroma x0.8, lightness
 * lifted toward the middle-high range, and a small shared warm cast so biomes read as one
 * family. Water keeps more chroma (it's the anchor hue) and gets the teal/deep pair below.
 */
export const artDirectTerrain = (graded: ReadonlyMap<string, Rgb>, water: ReadonlyMap<string, boolean>): Map<string, Rgb> => {
  const out = new Map<string, Rgb>();
  for (const [id, c] of graded) {
    const lab = rgbToLab(c);
    if (water.get(id)) {
      out.set(id, labToRgb([lab[0] * 0.95 + 4, lab[1] * 0.9, lab[2] * 0.9]));
      continue;
    }
    const graded2: Lab = [lab[0] * 0.86 + 11, lab[1] * 0.82, lab[2] * 0.8 + 1];
    out.set(id, labToRgb(graded2));
  }
  return out;
};

/** Smallest land-pair distance of a palette (test helper, also used for a debug check). */
export const minLandDistance = (pal: ReadonlyMap<string, Rgb>, water: ReadonlyMap<string, boolean>): number => {
  const ids = [...pal.keys()].filter((id) => !water.get(id));
  let best = Infinity;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = pal.get(ids[i] ?? '');
      const b = pal.get(ids[j] ?? '');
      if (a && b) best = Math.min(best, deltaE(rgbToLab(a), rgbToLab(b)));
    }
  }
  return best;
};

// --- Surface kinds (micro-detail and top texture) ------------------------------------------

/**
 * What a land top is made of, for the procedural detail (tufts, ripples, drifts, cracks).
 * Derived from the color and climate, never from terrain ids, so new terrains just work.
 */
export const SURFACE = { grass: 0, dry: 1, sand: 2, snow: 3, tundra: 4, rock: 5 } as const;
export type SurfaceKind = (typeof SURFACE)[keyof typeof SURFACE];

export const surfaceKind = (
  color: Rgb,
  opts: { mountain?: boolean; climate?: string } = {},
): SurfaceKind => {
  if (opts.mountain) return SURFACE.rock;
  const [l, a, b] = rgbToLab(color);
  if (l > 86 && Math.hypot(a, b) < 14) return SURFACE.snow;
  if (a < -12) return SURFACE.grass;
  if (b > 18 && a > -1 && l > 76) return SURFACE.sand;
  if (b > 20) return SURFACE.dry;
  return opts.climate === 'polar' ? SURFACE.snow : SURFACE.tundra;
};

// --- Strata -----------------------------------------------------------------------------------

export interface Strata {
  /** Turf/sand lip just under the top edge (top color, shaded). */
  lip: Rgb;
  /** Soil bands, top to base. */
  band0: Rgb;
  band1: Rgb;
  band2: Rgb;
}

/**
 * Side colors of a tile column: a lip of the top material, then soil bands that get darker
 * toward the base (the "cake slice", GDD §11). Sandy and snowy tops get paler soil.
 */
export const strataFor = (top: Rgb, kind: SurfaceKind): Strata => {
  const s0 = artRgb('strata0');
  const s1 = artRgb('strata1');
  const s2 = artRgb('strata2');
  const pale = kind === SURFACE.sand ? 0.35 : kind === SURFACE.snow ? 0.25 : kind === SURFACE.rock ? 0.2 : 0.08;
  const rockGrey: Rgb = [0.55, 0.52, 0.5];
  const tint = kind === SURFACE.rock ? rockGrey : top;
  return {
    lip: mix(top, [0, 0, 0], 0.18),
    band0: mix(s0, tint, pale + 0.1),
    band1: mix(s1, tint, pale * 0.6),
    band2: mix(s2, tint, pale * 0.3),
  };
};

// --- Per-tile variation -----------------------------------------------------------------------

/** Small deterministic height and brightness jitter so the board never reads as a flat grid. */
export const tileVariation = (h: number): { dy: number; tint: number } => {
  const a = (h & 0xff) / 255;
  const b = ((h >>> 8) & 0xff) / 255;
  return { dy: (a - 0.5) * 0.05, tint: 0.95 + b * 0.09 };
};

/** Multiply a color's brightness (clamped). */
export const scaleRgb = (c: Rgb, k: number): Rgb => [
  Math.min(1, c[0] * k),
  Math.min(1, c[1] * k),
  Math.min(1, c[2] * k),
];

// --- Settlement materials by age --------------------------------------------------------------

/**
 * Materials shift by age (GDD §11): mud brick / timber -> cut stone -> plaster -> brick.
 * `ageIndex` is AGES.indexOf(state.age).
 */
export const ageMaterial = (base: Rgb, ageIndex: number): Rgb => {
  switch (ageIndex) {
    case 0:
      return base;
    case 1:
      return mix(base, parseHexColor('#cfc5b3'), 0.35);
    case 2:
      return mix(base, parseHexColor('#f1ebdf'), 0.35);
    default:
      return mix(base, parseHexColor('#a65c46'), 0.35);
  }
};

/** City wall material by age: rammed earth -> stone -> dressed stone -> brick. */
export const wallMaterial = (base: Rgb, ageIndex: number): Rgb => {
  const target = ['#b39a72', '#bdb4a3', '#cbc3b2', '#9c6a52'][Math.max(0, Math.min(3, ageIndex))] ?? '#bdb4a3';
  return mix(base, parseHexColor(target), 0.6);
};
