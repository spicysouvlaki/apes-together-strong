/**
 * City districts (GDD §11 "growth should be visible and rewarding"): as a settlement grows it
 * spills onto the tiles around it — a ring of fields and orchards, then a workshop quarter, a
 * harbor quay when coastal, and a monument plinth for grand capitals. Before this, a pop-9 town
 * was four tiny houses on one hex and vanished at regional zoom (art review, amateur tell #1).
 *
 * Pure and deterministic (hash of the settlement id): `districtPlan` picks which neighbor gets
 * what; `districtPieces` turns one district into primitive pieces (same PieceKind kit and
 * conventions as architecture.ts: tile-local, y = 0 on the tile top).
 */
import type { Piece } from './architecture';
import type { Rgb } from './colors';
import { mix, parseHexColor } from './colors';
import { hashTile, unit01 } from './scatter';

export const DISTRICT_KINDS = ['fields', 'orchard', 'workshop', 'quay', 'plinth'] as const;
export type DistrictKind = (typeof DISTRICT_KINDS)[number];

export interface DistrictNeighbor {
  /** Neighbor slot 0..5 (caller's direction order). */
  dir: number;
  water: boolean;
  /** Flat, open land with nothing on it (no feature, resource, settlement, mountain). */
  open: boolean;
  /** Forest/jungle with nothing else on it: can be cleared for an orchard, workshop or plinth. */
  wooded?: boolean;
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

/** Population milestones (README/GDD §11): each adds one district if a tile is free. */
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

const hashStr = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

/**
 * Districts for a settlement: one per tile, milestones in order, each on the open neighbor
 * with the lowest hash rank (stable as the city grows: a field never jumps to another tile).
 * Cities count as two pop higher (they are the grander kind); capitals of pop ≥ 8 add a
 * monument plinth. Quays need a water neighbor; everything else open land.
 */
export const districtPlan = (input: DistrictPlanInput): DistrictSpot[] => {
  const seed = hashStr(input.id);
  const rank = (dir: number, salt: number): number => unit01(hashTile(seed | 0, dir, salt));
  const pop = input.population + (input.kind === 'city' || input.cityState ? 2 : 0);
  const used = new Set<number>();
  const out: DistrictSpot[] = [];
  const take = (kind: DistrictKind): void => {
    let best = -1;
    let bestRank = 3;
    for (const n of input.neighbors) {
      if (used.has(n.dir)) continue;
      const clearable = kind !== 'fields' && kind !== 'quay' && !!n.wooded;
      if (kind === 'quay' ? !n.water : !n.open && !clearable) continue;
      // Workshops prefer the tiles fields didn't want (a different salt): quarters mix. Open
      // land beats woods (a clearing is cut only when nothing open is left).
      const r = rank(n.dir, kind === 'workshop' || kind === 'plinth' ? 2 : 1) + (n.open ? 0 : 1);
      if (r < bestRank) {
        bestRank = r;
        best = n.dir;
      }
    }
    if (best < 0) return;
    used.add(best);
    out.push({ dir: best, kind });
  };
  for (const m of DISTRICT_MILESTONES) if (pop >= m.pop) take(m.kind);
  if (input.capital && pop >= 8) take('plinth');
  return out;
};

const hex = parseHexColor;
const WHEAT = hex('#dcbc62');
const BARLEY = hex('#c9b35a');
const GREEN = hex('#93b25e');
const FALLOW = hex('#b48b5c');
const FURROW = hex('#8a6a44');
const HEDGE = hex('#6f8f4a');
const WOOD = hex('#7a5536');
const PLANK = hex('#9a7652');
const STONE = hex('#b9b1a3');
const GOLD = hex('#e0b23e');
const LEAF = hex('#6f9a4a');
const FRUIT = hex('#c8573a');

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
      // Strip fields: 3–4 long plots side by side, alternating crops, inked by darker furrows.
      const plots = 3 + (s > 0.5 ? 1 : 0);
      const crops = [WHEAT, GREEN, BARLEY, FALLOW];
      const pw = 0.19;
      for (let i = 0; i < plots; i++) {
        const off = (i - (plots - 1) / 2) * (pw + 0.03);
        const len = 0.72 - Math.abs(off) * 0.55 + rnd(i) * 0.06;
        const [x, z] = rot(0, off, r0);
        const c = crops[(i + (key & 3)) % crops.length] ?? WHEAT;
        push(out, 'block', x, 0, z, len, 0.014, pw, r0, c);
        // Two furrow rules per plot (thin, darker): reads as tilled land, not a flat decal.
        for (const f of [-0.045, 0.045]) {
          const [fx, fz] = rot(0, off + f, r0);
          push(out, 'block', fx, 0.012, fz, len * 0.92, 0.006, 0.012, r0, mix(c, FURROW, 0.45));
        }
      }
      // A hedge line on the far side and a haystack.
      const [hx, hz] = rot(0, ((plots + 0.2) / 2) * (pw + 0.03), r0);
      push(out, 'block', hx, 0, hz, 0.66, 0.035, 0.03, r0, HEDGE);
      const [sx, sz] = rot(0.3, -((plots - 0.6) / 2) * (pw + 0.03), r0);
      push(out, 'cone', sx, 0.012, sz, 0.07, 0.1, 0.07, 0, BARLEY);
      break;
    }
    case 'orchard': {
      // A loose grid of round trees (trunk + canopy), a few in fruit.
      const n = s > 0.5 ? 4 : 3;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 3; j++) {
          const lx = (i - (n - 1) / 2) * 0.24 + (rnd(i * 7 + j) - 0.5) * 0.04;
          const lz = (j - 1) * 0.26 + (i % 2) * 0.06;
          const [x, z] = rot(lx, lz, r0);
          const hgt = 0.09 + rnd(i * 5 + j + 40) * 0.03;
          push(out, 'cyl', x, 0, z, 0.024, hgt, 0.024, 0, WOOD);
          const crown = 0.15 + rnd(i * 3 + j + 80) * 0.035;
          push(out, 'dome', x, hgt - 0.015, z, crown, crown * 1.4, crown, 0, rnd(i + j * 11) > 0.7 ? mix(LEAF, FRUIT, 0.35) : LEAF);
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
        const h = [0.13, 0.19, 0.25][Math.floor(rnd(i + 3) * 2.99) % 3] ?? 0.15;
        const rr = -a + Math.PI / 2;
        push(out, 'block', x, 0, z, 0.36, h + s * 0.04, 0.22, rr, style.wall);
        push(out, 'gable', x, h + s * 0.04, z, 0.39, 0.11, 0.27, rr, style.roof);
      }
      push(out, 'cyl', 0, 0, 0, 0.15, 0.1, 0.15, 0, STONE);
      push(out, 'cyl', 0.03, 0.1, 0.02, 0.05, 0.16 + s * 0.06, 0.05, 0, mix(STONE, FURROW, 0.4));
      const [ax, az] = rot(-0.24, 0.16, r0);
      push(out, 'block', ax, 0.12, az, 0.22, 0.014, 0.14, r0 + 0.1, style.accent);
      push(out, 'cyl', ax + 0.09, 0, az + 0.05, 0.016, 0.12, 0.016, 0, WOOD);
      break;
    }
    case 'quay': {
      // A plank pier from the shore toward the open water, on posts, with a moored boat.
      const [ex, ez] = [Math.cos(toCity) * 0.78, Math.sin(toCity) * 0.78];
      const len = 0.5 + s * 0.12;
      const mx = ex - Math.cos(toCity) * len * 0.5;
      const mz = ez - Math.sin(toCity) * len * 0.5;
      push(out, 'block', mx, 0.03, mz, len, 0.025, 0.11, r0, PLANK);
      for (const t of [0.15, 0.5, 0.85]) {
        for (const side of [-1, 1]) {
          const [px, pz] = rot(0, side * 0.06, r0);
          const along = len * (t - 0.5);
          push(out, 'cyl', mx - Math.cos(toCity) * along + px, -0.03, mz - Math.sin(toCity) * along + pz, 0.014, 0.09, 0.014, 0, WOOD);
        }
      }
      // Bollard and a stone landing at the shore end.
      push(out, 'block', ex - Math.cos(toCity) * 0.04, 0, ez - Math.sin(toCity) * 0.04, 0.14, 0.05, 0.2, r0, STONE);
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
  kind === 'workshop' ? [0.03, 0.1 + 0.16 + Math.max(0, Math.min(1, size)) * 0.06, 0.02] : null;
