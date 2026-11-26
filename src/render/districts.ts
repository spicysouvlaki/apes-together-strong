/**
 * City districts (GDD §11 "growth should be visible and rewarding"): as a settlement grows it
 * spills onto the tiles around it — a ring of fields and orchards, then a workshop quarter, a
 * harbor quay when coastal, and a monument plinth for grand capitals. Before this, a pop-9 town
 * was four tiny houses on one hex and vanished at regional zoom (art review, amateur tell #1).
 *
 * Playtest 3: in two real games cities of pop 5–7 showed nothing. Cause: only flat, featureless,
 * resource-free land took fields/orchards/workshops, and real starts sit among hills, woods and
 * resources (start placement favours them), so most milestones found no tile; the fields that did
 * appear were 1.4 cm-thin pastel decals that vanished against grassland. Now every milestone has
 * fallbacks by ground (`DISTRICT_FALLBACKS`): terraced fields on hills, a woodcutters' camp in
 * forest, a quarry on stone/ore, a fenced pasture around herds, and districts are bold (raised,
 * inked plots, a farmhouse, a byre) so growth reads at default zoom.
 *
 * Pure and deterministic (hash of the settlement id): `districtPlan` picks which neighbor gets
 * what; `districtPieces` turns one district into primitive pieces (same PieceKind kit and
 * conventions as architecture.ts: tile-local, y = 0 on the tile top).
 */
import type { Piece } from './architecture';
import type { Rgb } from './colors';
import { mix, parseHexColor } from './colors';
import { hashTile, unit01 } from './scatter';

export const DISTRICT_KINDS = ['fields', 'orchard', 'workshop', 'quay', 'plinth', 'terraces', 'camp', 'quarry', 'pasture'] as const;
export type DistrictKind = (typeof DISTRICT_KINDS)[number];

/** What a resource on a neighbor tile looks like (render art class, see terrain-style RESOURCE_ART). */
export type DistrictResource = 'grain' | 'orchard' | 'animal' | 'ore' | 'goods' | 'sea' | 'other';

export interface DistrictNeighbor {
  /** Neighbor slot 0..5 (caller's direction order). */
  dir: number;
  water: boolean;
  /** Flat, open land with nothing on it (no feature, resource, settlement, mountain). */
  open: boolean;
  /** Forest/jungle with nothing else on it: can be cleared for an orchard, workshop or plinth. */
  wooded?: boolean;
  /** Hills with nothing else on it: terraced fields. */
  hills?: boolean;
  /** A resource lies here (its art class); districts that suit it build around it. */
  resource?: DistrictResource | null;
}

export interface DistrictPlanInput {
  id: string;
  population: number;
  kind: 'town' | 'city';
  capital: boolean;
  cityState: boolean;
  neighbors: readonly DistrictNeighbor[];
}

export interface DistrictSpot {
  dir: number;
  kind: DistrictKind;
}

/** Population milestones (README/GDD §11): each adds one district if a tile can take it. */
export const DISTRICT_MILESTONES: readonly { pop: number; kind: DistrictKind }[] = [
  { pop: 2, kind: 'fields' },
  { pop: 3, kind: 'quay' },
  { pop: 4, kind: 'fields' },
  { pop: 5, kind: 'orchard' },
  { pop: 6, kind: 'workshop' },
  { pop: 8, kind: 'fields' },
  { pop: 10, kind: 'workshop' },
  { pop: 12, kind: 'orchard' },
];

/** Ground a neighbor offers, in the order milestones look at it. */
type Ground = 'open' | 'wooded' | 'hills' | 'water' | `res:${DistrictResource}`;

/**
 * Per milestone: which ground it prefers (tier 0) and what it builds there, then fallbacks in
 * tier order (a later tier is taken only when no earlier one is free). Quays only take water.
 */
export const DISTRICT_FALLBACKS: Record<DistrictKind, readonly (readonly [Ground, DistrictKind])[]> = {
  fields: [
    ['open', 'fields'],
    ['res:grain', 'fields'],
    ['hills', 'terraces'],
    ['res:animal', 'pasture'],
    ['wooded', 'camp'],
    ['res:ore', 'quarry'],
    ['res:orchard', 'orchard'],
  ],
  orchard: [
    ['open', 'orchard'],
    ['res:orchard', 'orchard'],
    ['wooded', 'orchard'],
    ['hills', 'terraces'],
    ['res:animal', 'pasture'],
    ['res:ore', 'quarry'],
    ['res:grain', 'fields'],
  ],
  workshop: [
    ['open', 'workshop'],
    ['res:goods', 'workshop'],
    ['res:ore', 'quarry'],
    ['wooded', 'camp'],
    ['hills', 'terraces'],
    ['res:animal', 'pasture'],
    ['res:other', 'workshop'],
  ],
  quay: [['water', 'quay']],
  plinth: [
    ['open', 'plinth'],
    ['wooded', 'plinth'],
  ],
  terraces: [['hills', 'terraces']],
  camp: [['wooded', 'camp']],
  quarry: [['res:ore', 'quarry']],
  pasture: [['res:animal', 'pasture']],
};

const hashStr = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

const offers = (n: DistrictNeighbor, g: Ground): boolean => {
  switch (g) {
    case 'open':
      return n.open;
    case 'wooded':
      return !!n.wooded;
    case 'hills':
      return !!n.hills;
    case 'water':
      return n.water;
    default:
      return !n.water && !!n.resource && `res:${n.resource}` === g;
  }
};

/**
 * Districts for a settlement: one per tile, milestones in order, each on the free neighbor with
 * the best (tier, hash rank) for that milestone's ground list (stable as the city grows: a field
 * never jumps to another tile). Cities count as two pop higher (they are the grander kind);
 * capitals of pop ≥ 8 add a monument plinth.
 */
export const districtPlan = (input: DistrictPlanInput): DistrictSpot[] => {
  const seed = hashStr(input.id);
  const rank = (dir: number, salt: number): number => unit01(hashTile(seed | 0, dir, salt));
  const pop = input.population + (input.kind === 'city' || input.cityState ? 2 : 0);
  const used = new Set<number>();
  const out: DistrictSpot[] = [];
  const take = (milestone: DistrictKind): void => {
    const options = DISTRICT_FALLBACKS[milestone];
    // Workshops prefer the tiles fields didn't want (a different salt): quarters mix.
    const salt = milestone === 'workshop' || milestone === 'plinth' ? 2 : 1;
    let best = -1;
    let bestKind: DistrictKind = milestone;
    let bestScore = Infinity;
    for (const n of input.neighbors) {
      if (used.has(n.dir)) continue;
      for (let tier = 0; tier < options.length; tier++) {
        const opt = options[tier];
        if (!opt || !offers(n, opt[0])) continue;
        const score = tier + rank(n.dir, salt);
        if (score < bestScore) {
          bestScore = score;
          best = n.dir;
          bestKind = opt[1];
        }
        break;
      }
    }
    if (best < 0) return;
    used.add(best);
    out.push({ dir: best, kind: bestKind });
  };
  for (const m of DISTRICT_MILESTONES) if (pop >= m.pop) take(m.kind);
  if (input.capital && pop >= 8) take('plinth');
  return out;
};

/**
 * Classify one neighbor tile for `districtPlan` from plain tile facts (shared by the renderer and
 * the tests so both read real maps the same way). `resource` is the resource's art class.
 */
export const districtNeighbor = (
  dir: number,
  t: { water: boolean; mountain: boolean; feature: string | null; resource: DistrictResource | null; settled: boolean },
): DistrictNeighbor | null => {
  if (t.settled) return null;
  if (t.water) return { dir, water: true, open: false };
  if (t.mountain) return null;
  if (t.resource) return { dir, water: false, open: false, resource: t.resource };
  const wooded = t.feature === 'forest' || t.feature === 'jungle';
  return { dir, water: false, open: t.feature === null, wooded, hills: t.feature === 'hills' };
};

const hex = parseHexColor;
const WHEAT = hex('#e3b948');
const BARLEY = hex('#cfa94a');
const GREEN = hex('#7fa847');
const FALLOW = hex('#a7764a');
const FURROW = hex('#6e4f30');
const INK = hex('#4a3a2a');
const HEDGE = hex('#5f8240');
const WOOD = hex('#7a5536');
const LOG = hex('#9b6a3f');
const PLANK = hex('#9a7652');
const STONE = hex('#b9b1a3');
const STONE_D = hex('#857d70');
const CUT = hex('#d8d0bf');
const GOLD = hex('#e0b23e');
const LEAF = hex('#5f9140');
const FRUIT = hex('#c8573a');
const THATCH = hex('#c9a35a');

export interface DistrictStyle {
  wall: Rgb;
  roof: Rgb;
  accent: Rgb;
}

const push = (out: Piece[], k: Piece['k'], x: number, y: number, z: number, sx: number, sy: number, sz: number, r: number, c: Rgb): void => {
  out.push({ k, x, y, z, sx, sy, sz, r, c });
};

/** Rotate local (x, z) by r (Instances.push convention). */
const rot = (x: number, z: number, r: number): [number, number] => {
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c * x + s * z, -s * x + c * z];
};

/** A small cottage (walls + gable roof) at local (x, z), facing `r`. */
const cottage = (out: Piece[], x: number, z: number, r: number, w: number, style: DistrictStyle, roof: Rgb = style.roof, y = 0): void => {
  push(out, 'block', x, y, z, w, w * 0.62, w * 0.7, r, style.wall);
  push(out, 'gable', x, y + w * 0.62, z, w * 1.1, w * 0.42, w * 0.82, r, roof);
};

/**
 * Pieces for one district on its own tile. `toCity` = world angle (atan2(dz, dx)) from this
 * tile toward the settlement, so fields line up with the town and the quay reaches the shore.
 * `size` 0..1 grows the district with the city (more plots, taller workshops).
 */
export const districtPieces = (kind: DistrictKind, key: number, toCity: number, size: number, style: DistrictStyle): Piece[] => {
  const out: Piece[] = [];
  const rnd = (k: number): number => unit01(hashTile(key | 0, k, 91));
  // Instances.push rotates by -angle in x/z: piece local +x points along (cos a, sin a) when r = -a.
  const r0 = -toCity;
  const s = Math.max(0, Math.min(1, size));
  switch (kind) {
    case 'fields': {
      // Strip fields: 3–4 raised plots side by side, alternating crops, each on a darker inked
      // bed with furrow rules (reads as tilled land at default zoom, not a pastel decal), a hedge
      // on the far side, a farmhouse at the town end and a haystack.
      const plots = 3 + (s > 0.4 ? 1 : 0);
      const crops = [WHEAT, GREEN, BARLEY, FALLOW];
      const pw = 0.18;
      for (let i = 0; i < plots; i++) {
        const off = (i - (plots - 1) / 2) * (pw + 0.035);
        const len = 0.7 - Math.abs(off) * 0.5 + rnd(i) * 0.06;
        const [x, z] = rot(-0.06, off, r0);
        const c = crops[(i + (key & 3)) % crops.length] ?? WHEAT;
        push(out, 'block', x, 0, z, len + 0.03, 0.026, pw + 0.03, r0, mix(c, INK, 0.55));
        push(out, 'block', x, 0.004, z, len, 0.036, pw, r0, c);
        for (const f of [-0.05, 0, 0.05]) {
          const [fx, fz] = rot(-0.06, off + f, r0);
          push(out, 'block', fx, 0.036, fz, len * 0.9, 0.008, 0.012, r0, mix(c, FURROW, 0.5));
        }
      }
      const [hx, hz] = rot(-0.06, ((plots + 0.3) / 2) * (pw + 0.035), r0);
      push(out, 'block', hx, 0, hz, 0.64, 0.06, 0.04, r0, HEDGE);
      // Farmhouse on the town side (local +x points toward the town).
      const [cx, cz] = rot(0.5, -0.24, r0);
      cottage(out, cx, cz, r0 + 0.3, 0.17, style, THATCH);
      const [sx, sz] = rot(0.46, 0.26, r0);
      push(out, 'cone', sx, 0, sz, 0.1, 0.15, 0.1, 0, BARLEY);
      break;
    }
    case 'terraces': {
      // Terraced hillside: the hill rebuilt as stepped strip fields climbing away from the town
      // (the renderer drops the hill mound under it). Each step is a crop strip on a dark stone
      // riser, a little higher and shorter than the one before: the stair reads at default zoom
      // and keeps the fields' language (strips, furrows), never a round target.
      const steps = 3 + (s > 0.5 ? 1 : 0);
      const crops = [GREEN, WHEAT, GREEN, BARLEY];
      const rise = 0.06;
      for (let i = 0; i < steps; i++) {
        const along = 0.36 - i * (0.66 / (steps - 1));
        const len = 0.86 - i * 0.1 + rnd(i + 50) * 0.04;
        const top = (i + 1) * rise;
        const [x, z] = rot(along, (rnd(i + 60) - 0.5) * 0.06, r0);
        push(out, 'block', x, 0, z, 0.2, top, len + 0.03, r0, mix(STONE_D, INK, 0.25));
        const c = crops[(i + (key & 1)) % crops.length] ?? GREEN;
        push(out, 'block', x - Math.cos(toCity) * 0.004, top, z - Math.sin(toCity) * 0.004, 0.17, 0.012, len, r0, c);
        for (const f of [-0.045, 0.045]) {
          const [fx, fz] = rot(along + f, 0, r0);
          push(out, 'block', fx, top + 0.01, fz, 0.012, 0.006, len * 0.92, r0, mix(c, FURROW, 0.5));
        }
      }
      // A shepherd's hut on the top step and a haystack.
      const [hx, hz] = rot(0.36 - 0.66 - 0.02, 0.22, r0);
      cottage(out, hx, hz, r0, 0.13, style, THATCH, steps * rise);
      const [sx, sz] = rot(0.36, 0.38, r0);
      push(out, 'cone', sx, 0, sz, 0.08, 0.12, 0.08, 0, BARLEY);
      break;
    }
    case 'orchard': {
      // A loose grid of round trees (trunk + canopy), a few in fruit, inside a low hedge.
      const n = s > 0.5 ? 4 : 3;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 3; j++) {
          const lx = (i - (n - 1) / 2) * 0.24 + (rnd(i * 7 + j) - 0.5) * 0.04;
          const lz = (j - 1) * 0.26 + (i % 2) * 0.06;
          const [x, z] = rot(lx, lz, r0);
          const hgt = 0.1 + rnd(i * 5 + j + 40) * 0.03;
          push(out, 'cyl', x, 0, z, 0.03, hgt, 0.03, 0, WOOD);
          const crown = 0.17 + rnd(i * 3 + j + 80) * 0.035;
          push(out, 'dome', x, hgt - 0.015, z, crown, crown * 1.45, crown, 0, rnd(i + j * 11) > 0.6 ? mix(LEAF, FRUIT, 0.4) : LEAF);
        }
      }
      break;
    }
    case 'workshop': {
      // Craft quarter: two or three low long-houses around a kiln with a chimney (smoke rises
      // from it, see `districtSmoke`), a lean-to awning in the owner's accent.
      const n = 2 + (s > 0.6 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const a = r0 + Math.PI * 0.5 + i * ((Math.PI * 2) / n);
        const x = Math.cos(a) * 0.36;
        const z = -Math.sin(a) * 0.36;
        // Height variants: a low shed, a two-storey hall, a tall loft (2–3 roof heights).
        const h = [0.15, 0.21, 0.27][Math.floor(rnd(i + 3) * 2.99) % 3] ?? 0.15;
        const rr = -a + Math.PI / 2;
        push(out, 'block', x, 0, z, 0.38, h + s * 0.04, 0.24, rr, style.wall);
        push(out, 'gable', x, h + s * 0.04, z, 0.41, 0.12, 0.29, rr, style.roof);
      }
      push(out, 'cyl', 0, 0, 0, 0.16, 0.11, 0.16, 0, STONE);
      push(out, 'cyl', 0.03, 0.11, 0.02, 0.055, 0.16 + s * 0.06, 0.055, 0, mix(STONE, FURROW, 0.4));
      const [ax, az] = rot(-0.24, 0.16, r0);
      push(out, 'block', ax, 0.12, az, 0.22, 0.014, 0.14, r0 + 0.1, style.accent);
      push(out, 'cyl', ax + 0.09, 0, az + 0.05, 0.016, 0.12, 0.016, 0, WOOD);
      break;
    }
    case 'camp': {
      // Woodcutters' camp in a clearing: a log cabin, a stacked log pile, fresh stumps and a
      // sawhorse (the trees around stay, thinned).
      const [cx, cz] = rot(0.2, -0.12, r0);
      push(out, 'block', cx, 0, cz, 0.2, 0.13, 0.16, r0, LOG);
      push(out, 'gable', cx, 0.13, cz, 0.23, 0.1, 0.2, r0, mix(LOG, INK, 0.35));
      // Log pile: three rows of long logs, narrowing upward.
      const [px, pz] = rot(-0.12, 0.14, r0);
      for (let row = 0; row < 3; row++) {
        for (let k = 0; k < 3 - row; k++) {
          const off = (k - (2 - row) / 2) * 0.06;
          const [ox, oz] = rot(0, off, r0);
          push(out, 'block', px + ox, row * 0.045, pz + oz, 0.3, 0.045, 0.05, r0, k % 2 === 0 ? LOG : mix(LOG, WOOD, 0.6));
        }
      }
      for (let k = 0; k < 4; k++) {
        const a = rnd(k + 20) * Math.PI * 2;
        const rr = 0.36 + rnd(k + 30) * 0.18;
        push(out, 'cyl', Math.cos(a) * rr, 0, Math.sin(a) * rr, 0.07, 0.04, 0.07, 0, mix(LOG, CUT, 0.35));
      }
      const [sx, sz] = rot(-0.2, -0.22, r0);
      push(out, 'block', sx, 0.06, sz, 0.18, 0.025, 0.04, r0, WOOD);
      push(out, 'block', sx, 0, sz, 0.03, 0.06, 0.1, r0, WOOD);
      break;
    }
    case 'quarry': {
      // Stone quarry: a stepped pale pit face, cut blocks stacked ready, a timber crane.
      for (let i = 0; i < 3; i++) {
        const [x, z] = rot(-0.18 + i * 0.06, -0.12 + i * 0.03, r0);
        push(out, 'block', x, 0, z, 0.46 - i * 0.12, 0.08 + i * 0.07, 0.4 - i * 0.1, r0 + 0.2, i % 2 === 0 ? CUT : STONE);
      }
      for (let k = 0; k < 4; k++) {
        const [x, z] = rot(0.26 + (k % 2) * 0.11, 0.18 + Math.floor(k / 2) * 0.1, r0);
        push(out, 'block', x, (k > 1 ? 0.06 : 0), z, 0.1, 0.06, 0.08, r0, k % 3 === 0 ? STONE : CUT);
      }
      const [mx, mz] = rot(0.22, -0.26, r0);
      push(out, 'cyl', mx, 0, mz, 0.025, 0.36, 0.025, 0, WOOD);
      const [jx, jz] = rot(0.12, -0.26, r0);
      push(out, 'block', jx, 0.33, jz, 0.26, 0.025, 0.025, r0, WOOD);
      push(out, 'block', jx - 0.0, 0.2, jz, 0.008, 0.13, 0.008, r0, FURROW);
      break;
    }
    case 'pasture': {
      // Fenced paddock with a byre: posts and rails around the herd (the resource animals graze
      // inside), a small barn at the town end.
      const posts = 12;
      for (let k = 0; k < posts; k++) {
        const a = (k / posts) * Math.PI * 2;
        const x = Math.cos(a) * 0.62;
        const z = Math.sin(a) * 0.52;
        push(out, 'cyl', x, 0, z, 0.024, 0.1, 0.024, 0, WOOD);
        const b = ((k + 0.5) / posts) * Math.PI * 2;
        const len = 2 * Math.PI * 0.57 / posts;
        push(out, 'block', Math.cos(b) * 0.61, 0.065, Math.sin(b) * 0.51, len, 0.016, 0.016, -b - Math.PI / 2, PLANK);
      }
      const [bx, bz] = rot(0.3, -0.12, r0);
      cottage(out, bx, bz, r0, 0.18, style, mix(style.roof, THATCH, 0.5));
      break;
    }
    case 'quay': {
      // A plank pier from the shore toward the open water, on posts, with a moored boat.
      const [ex, ez] = [Math.cos(toCity) * 0.78, Math.sin(toCity) * 0.78];
      const len = 0.52 + s * 0.12;
      const mx = ex - Math.cos(toCity) * len * 0.5;
      const mz = ez - Math.sin(toCity) * len * 0.5;
      push(out, 'block', mx, 0.03, mz, len, 0.03, 0.13, r0, PLANK);
      for (const t of [0.15, 0.5, 0.85]) {
        for (const side of [-1, 1]) {
          const [px, pz] = rot(0, side * 0.07, r0);
          const along = len * (t - 0.5);
          push(out, 'cyl', mx - Math.cos(toCity) * along + px, -0.03, mz - Math.sin(toCity) * along + pz, 0.016, 0.1, 0.016, 0, WOOD);
        }
      }
      // Stone landing at the shore end and a warehouse on it.
      push(out, 'block', ex - Math.cos(toCity) * 0.04, 0, ez - Math.sin(toCity) * 0.04, 0.16, 0.06, 0.24, r0, STONE);
      break;
    }
    case 'plinth': {
      // Monument plinth: stepped stone, an obelisk with a gold-leaf cap, four bollards.
      push(out, 'block', 0, 0, 0, 0.34, 0.035, 0.34, r0, STONE);
      push(out, 'block', 0, 0.035, 0, 0.22, 0.04, 0.22, r0, mix(STONE, style.wall, 0.3));
      push(out, 'pylon', 0, 0.075, 0, 0.07, 0.34 + s * 0.08, 0.07, r0, style.wall);
      push(out, 'hip', 0, 0.415 + s * 0.08, 0, 0.055, 0.06, 0.055, r0, GOLD);
      for (let k = 0; k < 4; k++) {
        const a = r0 + Math.PI / 4 + (k * Math.PI) / 2;
        push(out, 'cyl', Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24, 0.02, 0.06, 0.02, 0, STONE);
      }
      break;
    }
  }
  return out;
};

/** Tile-local chimney top (x, y, z) for districts that smoke, else null. */
export const districtSmoke = (kind: DistrictKind, size: number): [number, number, number] | null =>
  kind === 'workshop' ? [0.03, 0.11 + 0.16 + Math.max(0, Math.min(1, size)) * 0.06, 0.02] : null;
