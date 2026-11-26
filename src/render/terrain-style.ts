/**
 * Render-side readability grading of terrain colors (GDD §11 "readable at a glance").
 *
 * Terrain colors are data (content/terrain.json) and authors pick them for taste, so close
 * pairs (plains vs steppe, grassland vs floodplain) can end up nearly identical on a small
 * phone screen. Instead of overriding ids here (content is data, CLAUDE.md rule 4), we grade
 * whatever palette content ships: in CIELAB we push land colors that are perceptually too
 * close apart, keep land clearly away from water, and make water read as water (blue enough,
 * darker than most land). Pure and deterministic; unit-tested against the shipped content.
 */
import { parseHexColor, type Rgb } from './colors';

export type Lab = [number, number, number];

const toLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const D65 = [0.95047, 1, 1.08883] as const;
const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t: number): number => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));

export const rgbToLab = (c: Rgb): Lab => {
  const r = toLin(c[0]);
  const g = toLin(c[1]);
  const b = toLin(c[2]);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / D65[0];
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / D65[1];
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / D65[2];
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const labToRgb = (lab: Lab): Rgb => {
  const fy = (lab[0] + 16) / 116;
  const fx = fy + lab[1] / 500;
  const fz = fy - lab[2] / 200;
  const x = fInv(fx) * D65[0];
  const y = fInv(fy) * D65[1];
  const z = fInv(fz) * D65[2];
  const r = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  const g = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  const b = 0.0557 * x - 0.204 * y + 1.057 * z;
  return [clamp01(toSrgb(r)), clamp01(toSrgb(g)), clamp01(toSrgb(b))];
};

/** CIE76 distance; plenty for "can a player tell these apart". */
export const deltaE = (a: Lab, b: Lab): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export interface TerrainColorInput {
  id: string;
  color: string;
  water: boolean;
}

/** Minimum distance between any two land terrains after grading. */
export const MIN_LAND_DE = 22;
/** Minimum distance between any land and any water terrain. */
export const MIN_WATER_DE = 28;
/** Water is at least this chromatic (CIELAB chroma) so it never reads as grey. */
const WATER_MIN_CHROMA = 32;

/**
 * Graded display color per terrain id. Close land pairs are pushed apart, mostly along
 * lightness and the yellow-blue axis (where terrain palettes have room), never further than
 * needed, so the content author's intent survives.
 */
export const gradeTerrainColors = (terrains: readonly TerrainColorInput[]): Map<string, Rgb> => {
  const labs: Lab[] = terrains.map((t) => rgbToLab(parseHexColor(t.color)));
  const water = terrains.map((t) => t.water);
  // Water: saturate toward its own hue; cap lightness so it sits under the land.
  for (let i = 0; i < labs.length; i++) {
    if (!water[i]) continue;
    const l = labs[i];
    if (!l) continue;
    const chroma = Math.hypot(l[1], l[2]);
    if (chroma < WATER_MIN_CHROMA) {
      const k = chroma > 1e-3 ? WATER_MIN_CHROMA / chroma : 0;
      l[1] = k ? l[1] * k : -10;
      l[2] = k ? l[2] * k : -24;
    }
    l[0] = Math.min(l[0], 74);
  }
  const step = (i: number, j: number, minDe: number, moveJOnly: boolean): boolean => {
    const a = labs[i];
    const b = labs[j];
    if (!a || !b) return false;
    const d = deltaE(a, b);
    if (d >= minDe) return false;
    // Direction a -> b, weighted toward L and b* (lightness and dryness read best on hexes).
    let dl = b[0] - a[0];
    let da = (b[1] - a[1]) * 0.5;
    let db = b[2] - a[2];
    let len = Math.hypot(dl, da, db);
    if (len < 1e-3) {
      // Identical colors: separate by lightness, deterministically by index.
      dl = j > i ? 1 : -1;
      da = 0;
      db = 0;
      len = 1;
    }
    const push = ((minDe - d) / 2) * 0.6;
    const ux = dl / len;
    const uy = da / len;
    const uz = db / len;
    if (moveJOnly) {
      b[0] += ux * push * 2;
      b[1] += uy * push * 2;
      b[2] += uz * push * 2;
    } else {
      a[0] -= ux * push;
      a[1] -= uy * push;
      a[2] -= uz * push;
      b[0] += ux * push;
      b[1] += uy * push;
      b[2] += uz * push;
    }
    return true;
  };
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < labs.length; i++) {
      for (let j = i + 1; j < labs.length; j++) {
        const wi = water[i] ?? false;
        const wj = water[j] ?? false;
        if (!wi && !wj) moved = step(i, j, MIN_LAND_DE, false) || moved;
        else if (wi && !wj) moved = step(i, j, MIN_WATER_DE, true) || moved;
        else if (!wi && wj) moved = step(j, i, MIN_WATER_DE, true) || moved;
      }
    }
    for (const l of labs) l[0] = Math.max(30, Math.min(97, l[0]));
    if (!moved) break;
  }
  const out = new Map<string, Rgb>();
  terrains.forEach((t, i) => {
    const l = labs[i];
    if (l) out.set(t.id, labToRgb(l));
  });
  return out;
};

// --- Resources ---------------------------------------------------------------------------------

export type ResourceClass = 'bonus' | 'luxury' | 'strategic';

/**
 * Marker style per resource class: shape + color classes are fixed (a legend players learn),
 * the specific resource is named in the tile sheet. Bonus = round, warm gold; luxury = diamond,
 * magenta; strategic = square block, dark steel.
 */
export const RESOURCE_CLASS_STYLE: Record<ResourceClass, { color: string }> = {
  bonus: { color: '#f2c230' },
  luxury: { color: '#d64fc4' },
  strategic: { color: '#3d4b5c' },
};

export const resourceClassOf = (cls: string | undefined): ResourceClass =>
  cls === 'luxury' || cls === 'strategic' ? cls : 'bonus';

/** Small resource props (scene/geometry resourcePropGeometry); mirrored there as RESOURCE_PROPS. */
export type ResourceArtProp = 'grain' | 'orchard' | 'animal' | 'ore' | 'sea' | 'goods';

/**
 * Render-side art table: which small prop a resource gets, and its accent color. Unknown ids
 * keep the generic class marker (ball / gem / block), so new content always shows something.
 * Districts read the prop too (a quarry grows around ore, a pasture around herds).
 */
export const RESOURCE_ART: Readonly<Record<string, { prop: ResourceArtProp; accent: string }>> = {
  wheat: { prop: 'grain', accent: '#e4c25a' },
  dates: { prop: 'orchard', accent: '#8a5228' },
  olives: { prop: 'orchard', accent: '#55642e' },
  wine: { prop: 'orchard', accent: '#7a2d55' },
  tea: { prop: 'orchard', accent: '#93c45a' },
  incense: { prop: 'goods', accent: '#eadfc4' },
  silk: { prop: 'goods', accent: '#d8628f' },
  furs: { prop: 'goods', accent: '#8f6a45' },
  amber: { prop: 'ore', accent: '#e39a2c' },
  salt: { prop: 'ore', accent: '#f6f3ec' },
  stone: { prop: 'ore', accent: '#cfc8bb' },
  copper: { prop: 'ore', accent: '#cf7a3a' },
  iron: { prop: 'ore', accent: '#6f5d55' },
  gold_ore: { prop: 'ore', accent: '#efc644' },
  fish: { prop: 'sea', accent: '#9db8c8' },
  whales: { prop: 'sea', accent: '#4f6070' },
  walrus_ivory: { prop: 'sea', accent: '#efe6d2' },
  horses: { prop: 'animal', accent: '#8f5c38' },
  cattle: { prop: 'animal', accent: '#cdb79a' },
  deer: { prop: 'animal', accent: '#b58550' },
};
