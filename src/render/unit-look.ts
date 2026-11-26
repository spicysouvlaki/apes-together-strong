/**
 * Pure unit-art logic (art pass 4, GDD §11 "units are small painted figurines"): which toy
 * figurine a unit gets, how its base reads (owner relation), where units stand when several
 * share a tile, which way they face, and the combat lunge. No three.js here, so it is unit
 * tested (tests/render-units.test.ts); scene/figurines.ts builds the geometry and
 * scene/world.ts draws it.
 */
import { AGES, type Age } from '@contracts/content-schemas';
import { HEX_DIRECTIONS, hexDistance, type Hex } from '@contracts/hex';
import { CITY_STATE_PREFIX, RAIDER_PLAYER } from '@contracts/sim-api';

/**
 * Every figurine look. Each class has an early (ancient) and a later (classical and beyond)
 * silhouette so an upgrade is visible on the board; civilians and famous people have their own.
 */
export const LOOKS = [
  'warband',
  'spearman',
  'slinger',
  'archer',
  'chariot',
  'horseArcher',
  'ram',
  'catapult',
  'canoe',
  'galley',
  'settler',
  'scout',
  'merchant',
  'general',
  'explorer',
] as const;
export type Look = (typeof LOOKS)[number];

/** The fields of a content unit definition the art reads (content/units.json). */
export interface UnitArtDef {
  unitClass: string;
  age?: Age | string;
  figureKind?: string;
  canFound?: boolean;
  canTrade?: boolean;
  vision?: number;
}

/** [early, later] look per military class. */
const CLASS_LOOKS: Record<string, readonly [Look, Look]> = {
  infantry: ['warband', 'spearman'],
  ranged: ['slinger', 'archer'],
  cavalry: ['chariot', 'horseArcher'],
  siege: ['ram', 'catapult'],
  naval: ['canoe', 'galley'],
};

/**
 * Look for a unit, from its content definition (data-driven: no unit ids here). Military classes
 * pick by age (ancient = early look); civilians by what they can do (found -> settler family with
 * an ox cart, trade -> merchant with a pack animal, long sight -> scout); famous people by figure
 * kind (explorer vs general). `def` may be missing (stale content): fall back on the class.
 */
export const unitLook = (unitClass: string, def: UnitArtDef | undefined): Look => {
  const fk = def?.figureKind;
  if (unitClass === 'commander') return fk === 'explorer' ? 'explorer' : 'general';
  if (unitClass === 'civilian') {
    if (fk === 'explorer') return 'explorer';
    if (fk !== undefined) return 'general';
    if (def?.canFound) return 'settler';
    if (def?.canTrade) return 'merchant';
    if ((def?.vision ?? 2) >= 3) return 'scout';
    return 'settler';
  }
  const pair = CLASS_LOOKS[unitClass] ?? CLASS_LOOKS.infantry;
  if (!pair) return 'warband';
  const ageIx = def?.age ? AGES.indexOf(def.age as Age) : 0;
  return ageIx > 0 ? pair[1] : pair[0];
};

/** Looks that float (naval hulls bob instead of swaying, no plinth). */
export const isShipLook = (look: Look): boolean => look === 'canoe' || look === 'galley';

/** Famous people stand a little taller on their base (GDD §3 "figures are special"). */
export const isFigureLook = (look: Look): boolean => look === 'general' || look === 'explorer';

/**
 * How the viewer relates to a unit's owner; drives the base rim (white = yours, dark = rival,
 * red = at war, grey = city-state, dark red + pennon = raiders).
 */
export type UnitRelation = 'own' | 'rival' | 'war' | 'cityState' | 'raider';

export const unitRelation = (viewer: string | null, owner: string, atWar: boolean): UnitRelation => {
  if (viewer === null || owner === viewer) return 'own';
  if (owner === RAIDER_PLAYER) return 'raider';
  if (owner.startsWith(CITY_STATE_PREFIX)) return atWar ? 'war' : 'cityState';
  return atWar ? 'war' : 'rival';
};

/** Hostile to the viewer: units that face each other across a front. */
export const isHostile = (r: UnitRelation): boolean => r === 'war' || r === 'raider';

// --- Stacking ---------------------------------------------------------------------------------

export interface StackSpot {
  /** Offset in the camera frame: +x = screen right, +z = toward the camera (world units). */
  dx: number;
  dz: number;
  scale: number;
}

/**
 * Where each unit on one tile stands. Units are ordered military first. One unit stands in the
 * middle; a military + civilian pair stand side by side, the soldier in front and full size, the
 * civilian a step back and smaller, so both silhouettes read. In a settlement the units step out
 * onto a forecourt at the front edge (toward the camera) instead of vanishing into the buildings.
 * Offsets are in the camera frame; the caller rotates them by the view yaw.
 */
export const stackLayout = (count: number, settled: boolean): StackSpot[] => {
  const out: StackSpot[] = [];
  const fz = settled ? 0.42 : 0;
  if (count <= 1) {
    out.push({ dx: settled ? -0.04 : 0, dz: fz, scale: settled ? 0.8 : 1 });
    return out;
  }
  if (count === 2) {
    if (settled) {
      out.push({ dx: -0.2, dz: fz + 0.04, scale: 0.78 });
      out.push({ dx: 0.24, dz: fz - 0.1, scale: 0.64 });
    } else {
      out.push({ dx: -0.2, dz: 0.16, scale: 0.92 });
      out.push({ dx: 0.26, dz: -0.2, scale: 0.74 });
    }
    return out;
  }
  const r = settled ? 0.26 : 0.32;
  for (let k = 0; k < count; k++) {
    // First (military) at the front, the rest fanned behind it.
    const a = Math.PI / 2 + (k / count) * Math.PI * 2;
    out.push({ dx: Math.cos(a) * r, dz: fz * 0.6 + Math.sin(a) * r * 0.8, scale: 0.68 });
  }
  return out;
};

/** Rotate a camera-frame offset into world x/z for view yaw (camera sits toward +z at yaw 0). */
export const cameraToWorld = (dx: number, dz: number, yaw: number): { x: number; z: number } => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: dx * c + dz * s, z: -dx * s + dz * c };
};

// --- Facing -----------------------------------------------------------------------------------

/** Figure heading (rotation about +y) that points its front (local −z) along world (dx, dz). */
export const headingToward = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

const wrap = (a: number): number => {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
};

/**
 * At rest a figurine shows its face, like a toy turned to the viewer on a shelf: the travel
 * heading is folded into the camera-facing half (left/right kept, at most 70° off the camera).
 * The fold is continuous (no flip as the view rotates). "Toward the camera" is heading yaw + π.
 */
export const REST_TURN = (70 * Math.PI) / 180;
export const restHeading = (heading: number, yaw: number, broadside = false): number => {
  const toCam = yaw + Math.PI;
  const d = wrap(heading - toCam);
  // Ships rest broadside-on (hull, oars and sail all show), bow left or right as they travelled.
  if (broadside) return wrap(toCam + (d >= 0 ? 1 : -1) * Math.PI * 0.42);
  return wrap(toCam + REST_TURN * Math.sin(d));
};

/**
 * The adjacent hostile a unit squares up to (nearest by direction order), or null. Two armies on
 * neighbouring tiles then face each other across the edge.
 */
export const facingTarget = (at: Hex, hostiles: readonly Hex[]): Hex | null => {
  for (const d of HEX_DIRECTIONS) {
    const n = { q: at.q + d.q, r: at.r + d.r };
    if (hostiles.some((h) => h.q === n.q && h.r === n.r)) return n;
  }
  return null;
};

/** Shortest-path blend between two angles (t 0..1). */
export const lerpAngle = (a: number, b: number, t: number): number => a + wrap(b - a) * t;

// --- Combat -----------------------------------------------------------------------------------

export const LUNGE_MS = 460;

/**
 * Lunge curve for an attack (0 at rest, 1 at full reach): a fast strike out (first 30 %), a
 * short hold, then an eased step back.
 */
export const lungeCurve = (t: number): number => {
  if (t <= 0 || t >= 1) return 0;
  if (t < 0.3) {
    const k = t / 0.3;
    return 1 - (1 - k) * (1 - k);
  }
  if (t < 0.42) return 1;
  const k = (t - 0.42) / 0.58;
  return 1 - k * k * (3 - 2 * k);
};

export interface AttackCandidate {
  id: string;
  at: Hex;
  owner: string;
  /** ms timestamp of this unit's last move (-Infinity if none seen). */
  movedAt: number;
  /** Attack range (1 melee, 2 ranged/siege). */
  range: number;
}

/**
 * Who attacked `target`, given only what the renderer sees (the combat flash carries just the
 * hex): the selected unit if it is in range, else the in-range unit that moved most recently,
 * else the nearest in-range unit of a different owner than the defenders. Null: just shake.
 */
export const pickAttacker = (
  target: Hex,
  candidates: readonly AttackCandidate[],
  selected: string | null,
  defenderOwners: readonly string[],
): AttackCandidate | null => {
  const inRange = candidates.filter((c) => {
    const d = hexDistance(c.at, target);
    return d >= 1 && d <= Math.max(1, c.range) && !defenderOwners.includes(c.owner);
  });
  if (inRange.length === 0) return null;
  const sel = selected !== null ? inRange.find((c) => c.id === selected) : undefined;
  if (sel) return sel;
  let best: AttackCandidate | null = null;
  for (const c of inRange) {
    if (!best) best = c;
    else if (c.movedAt > best.movedAt) best = c;
    else if (c.movedAt === best.movedAt && hexDistance(c.at, target) < hexDistance(best.at, target)) best = c;
  }
  return best;
};

/** HP pips shown over a damaged unit (5 pips = 20 HP each; any damage hides at least part of one). */
export const HP_PIPS = 5;
export const hpPips = (hp: number, max: number): number => Math.max(0, Math.min(HP_PIPS, Math.ceil((hp / max) * HP_PIPS - 1e-9)));
