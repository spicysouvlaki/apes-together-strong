/**
 * Units: lifecycle (spawn/remove, shared with src/emergence and src/sim/ages), movement and
 * pathfinding, healing, upgrades and vision (GDD §7 "Combat", "Map").
 *
 * Stacking: one military unit (any non-civilian class, commanders included) plus one
 * civilian per tile, never units of two owners on one tile.
 */
import type { ContentBundle, Modifier, UnitDef } from '@contracts/content-schemas';
import { hexDistance, hexNeighbors, type Hex } from '@contracts/hex';
import { RAIDER_PLAYER, type FigureId, type GameState, type PlayerId, type Tile, type Unit, type UnitId } from '@contracts/sim-api';
import {
  EMBARK_MOVE_COST,
  FEATURE_MOVE_COST,
  HEAL_IN_SETTLEMENT,
  HEAL_IN_TERRITORY,
  HEAL_RESTING,
  SETTLEMENT_VISION,
  UNIT_MAX_HP,
} from './constants';
import { mintId, type SimCtx } from './ctx';
import { ci, hexOfIndex, isCivilian, isWater, playerSettlements, tileAt, tileIndex, unitPositions } from './lookup';
import { canEmbark, empireModifiers, unitAdd, type CondEnv } from './modifiers';

// --- Lifecycle ---------------------------------------------------------------

/** Can a unit of this kind stand on `tile` at all (terrain and settlements; ignores other units)? */
export const terrainAllows = (
  state: GameState,
  owner: PlayerId,
  def: Pick<UnitDef, 'unitClass'>,
  tile: Tile,
  content: ContentBundle,
  embark: boolean,
): boolean => {
  if (tile.settlement) {
    const s = state.settlements[tile.settlement];
    if (!s || s.owner !== owner) return false;
    // Naval units may dock in their own settlements.
    return true;
  }
  const water = isWater(tile, content);
  if (def.unitClass === 'naval') return water;
  if (water) return embark;
  const terrain = ci(content).terrain[tile.terrain];
  return terrain !== undefined && terrain.moveCost !== null;
};

/** Is the stacking layer free for `owner` on this tile? (Other owners' units always block.) */
const layerFree = (units: readonly Unit[] | undefined, owner: PlayerId, civilian: boolean, except?: UnitId): boolean => {
  if (!units) return true;
  for (const u of units) {
    if (u.id === except) continue;
    if (u.owner !== owner) return false;
    if (isCivilian(u) === civilian) return false;
  }
  return true;
};

export const canEmbarkPlayer = (state: GameState, owner: PlayerId, content: ContentBundle): boolean =>
  owner !== RAIDER_PLAYER && canEmbark(empireModifiers(state, owner, content));

/**
 * Create a unit of content type `typeId` for `owner` on `at`, or on the nearest free legal
 * tile if `at` is occupied by another unit of the same stacking layer. Returns the new id,
 * or null if no tile within 3 is free. `figure` marks a deployed figure-unit.
 */
export const spawnUnit = (
  ctx: SimCtx,
  owner: PlayerId,
  typeId: string,
  at: Hex,
  figure: FigureId | null = null,
): UnitId | null => {
  const { state, content } = ctx;
  const def = ci(content).units[typeId];
  if (!def) return null;
  const civilian = def.unitClass === 'civilian';
  const embark = canEmbarkPlayer(state, owner, content);
  const positions = unitPositions(state);
  const candidates: { h: Hex; d: number }[] = [];
  for (let dq = -3; dq <= 3; dq++) {
    for (let dr = Math.max(-3, -dq - 3); dr <= Math.min(3, -dq + 3); dr++) {
      const h = { q: at.q + dq, r: at.r + dr };
      candidates.push({ h, d: hexDistance(at, h) });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  for (const { h, d } of candidates) {
    const tile = tileAt(state.map, h);
    if (!tile) continue;
    // Spawning a land unit never embarks it, except on the requested tile itself.
    if (!terrainAllows(state, owner, def, tile, content, false) && !(embark && d === 0 && terrainAllows(state, owner, def, tile, content, true)))
      continue;
    if (!layerFree(positions.get(`${h.q},${h.r}`), owner, civilian)) continue;
    const id = mintId(state, 'u');
    const unit: Unit = {
      id,
      owner,
      type: def.id,
      unitClass: def.unitClass,
      at: { q: h.q, r: h.r },
      hp: UNIT_MAX_HP,
      movesLeft: 0,
      fortified: false,
      hasAttacked: false,
      figure,
    };
    state.units[id] = unit;
    unit.movesLeft = maxMoves(state, unit, content);
    return id;
  }
  return null;
};

/** Delete a unit from the state (no figure handling; callers deal with `unit.figure` first). */
export const removeUnit = (ctx: SimCtx, unit: UnitId): void => {
  delete ctx.state.units[unit];
};

// --- Modifiers on units -----------------------------------------------------

/** unitModifiers of deployed friendly figure-units within 1 of `unit` (itself included): the commander aura. */
export const auraModifiers = (state: GameState, unit: Unit, content: ContentBundle): Modifier[] => {
  const out: Modifier[] = [];
  const figures = ci(content).figures;
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (!u || !u.figure || u.owner !== unit.owner) continue;
    if (hexDistance(u.at, unit.at) > 1) continue;
    const f = figures[u.figure];
    if (f) out.push(...f.unitModifiers);
  }
  return out;
};

/** Every modifier that may affect this unit: its owner's empire modifiers plus the aura. */
export const unitModifiers = (state: GameState, unit: Unit, content: ContentBundle, empire?: readonly Modifier[]): Modifier[] => [
  ...(empire ?? (unit.owner === RAIDER_PLAYER ? [] : empireModifiers(state, unit.owner, content))),
  ...auraModifiers(state, unit, content),
];

export const unitEnv = (state: GameState, unit: Unit, content: ContentBundle): CondEnv => {
  const env: CondEnv = { state, content, player: unit.owner, unitClass: unit.unitClass };
  const t = tileAt(state.map, unit.at);
  if (t) env.tile = t;
  return env;
};

export const maxMoves = (state: GameState, unit: Unit, content: ContentBundle, empire?: readonly Modifier[]): number => {
  const def = ci(content).units[unit.type];
  if (!def) return 0;
  return Math.max(1, def.moves + unitAdd(unitModifiers(state, unit, content, empire), 'movement', unitEnv(state, unit, content)));
};

export const visionRadius = (state: GameState, unit: Unit, content: ContentBundle, empire?: readonly Modifier[]): number => {
  const def = ci(content).units[unit.type];
  if (!def) return 1;
  return Math.max(1, def.vision + unitAdd(unitModifiers(state, unit, content, empire), 'vision', unitEnv(state, unit, content)));
};

// --- Movement ---------------------------------------------------------------

/** Move cost to enter `tile` (GDD §7: hills/forest cost 2, mountains impassable). */
export const stepCost = (tile: Tile, def: UnitDef, content: ContentBundle): number => {
  if (isWater(tile, content)) return def.unitClass === 'naval' ? 1 : EMBARK_MOVE_COST;
  const base = ci(content).terrain[tile.terrain]?.moveCost ?? 1;
  const feat = tile.feature ? (FEATURE_MOVE_COST[tile.feature] ?? 0) : 0;
  return Math.max(base, feat);
};

export interface PathResult {
  /** Tile index -> moves left on arrival. */
  remaining: Map<number, number>;
  /** Tile index -> previous tile index on the best path. */
  parent: Map<number, number>;
  /** Tiles where the unit may end its move (excludes its own tile). */
  endable: number[];
}

/**
 * Best-remaining-moves search. A unit may always enter a tile if it has any moves left
 * (the step uses up whatever remains), it may pass through tiles holding friendly units
 * but may not stop on a tile whose stacking layer is taken, and it never enters tiles
 * holding other owners' units or foreign settlements.
 */
export const findPaths = (state: GameState, unit: Unit, content: ContentBundle): PathResult => {
  const def = ci(content).units[unit.type];
  const remaining = new Map<number, number>();
  const parent = new Map<number, number>();
  const endable: number[] = [];
  const start = tileIndex(state.map, unit.at);
  if (!def || start < 0 || unit.movesLeft <= 0) return { remaining, parent, endable };
  const embark = def.unitClass !== 'naval' && canEmbarkPlayer(state, unit.owner, content);
  const positions = unitPositions(state);
  const civilian = isCivilian(unit);
  const max = Math.ceil(unit.movesLeft);
  const buckets: number[][] = [];
  for (let i = 0; i <= max; i++) buckets.push([]);
  remaining.set(start, unit.movesLeft);
  buckets[max]?.push(start);
  for (let b = max; b >= 1; b--) {
    const bucket = buckets[b] ?? [];
    for (let i = 0; i < bucket.length; i++) {
      const idx = bucket[i] as number;
      const rem = remaining.get(idx) ?? 0;
      if (rem <= 0) continue;
      const here = hexOfIndex(state.map, idx);
      for (const n of hexNeighbors(here)) {
        const ni = tileIndex(state.map, n);
        if (ni < 0 || ni === start) continue;
        const tile = state.map.tiles[ni];
        if (!tile || !terrainAllows(state, unit.owner, def, tile, content, embark)) continue;
        const occupants = positions.get(`${n.q},${n.r}`);
        if (occupants && occupants.some((u) => u.owner !== unit.owner)) continue;
        const left = Math.max(0, rem - stepCost(tile, def, content));
        if (left <= (remaining.get(ni) ?? -1)) continue;
        remaining.set(ni, left);
        parent.set(ni, idx);
        if (left > 0) buckets[Math.ceil(left)]?.push(ni);
      }
    }
  }
  for (const [idx] of remaining) {
    if (idx === start) continue;
    const h = hexOfIndex(state.map, idx);
    if (layerFree(positions.get(`${h.q},${h.r}`), unit.owner, civilian, unit.id)) endable.push(idx);
  }
  endable.sort((a, b) => a - b);
  return { remaining, parent, endable };
};

/** Tile indices from the unit's tile (exclusive) to `target` (inclusive). */
export const pathTo = (paths: PathResult, start: number, target: number): number[] => {
  const out: number[] = [];
  let cur: number | undefined = target;
  while (cur !== undefined && cur !== start) {
    out.push(cur);
    cur = paths.parent.get(cur);
  }
  return out.reverse();
};

export const moveUnit = (ctx: SimCtx, player: PlayerId, unitId: UnitId, to: Hex): string | null => {
  const { state, content } = ctx;
  const unit = state.units[unitId];
  if (!unit || unit.owner !== player) return 'Not your unit';
  const target = tileIndex(state.map, to);
  if (target < 0) return 'Off the map';
  const paths = findPaths(state, unit, content);
  if (!paths.endable.includes(target)) return 'Cannot reach that tile this turn';
  const start = tileIndex(state.map, unit.at);
  const path = pathTo(paths, start, target);
  unit.at = { q: to.q, r: to.r };
  unit.movesLeft = paths.remaining.get(target) ?? 0;
  unit.fortified = false;
  const p = state.players[player];
  if (p) {
    const vr = visionRadius(state, unit, content);
    for (const idx of path) revealAround(state, p.explored, hexOfIndex(state.map, idx), vr);
  }
  return null;
};

// --- Turn upkeep --------------------------------------------------------------

/**
 * Start-of-turn upkeep for one player's units (GDD §7): heal (own settlement +20, own
 * territory +10, elsewhere +5 only when the unit rested), auto-upgrade in own territory
 * once the next unit's tech is known, then refresh moves.
 */
export const unitUpkeep = (ctx: SimCtx, player: PlayerId, empire: readonly Modifier[]): void => {
  const { state, content } = ctx;
  const idx = ci(content);
  const p = state.players[player];
  const known = new Set(p?.techs ?? []);
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (!u || u.owner !== player) continue;
    const tile = tileAt(state.map, u.at);
    const rested = !u.hasAttacked && u.movesLeft >= maxMoves(state, u, content, empire);
    let heal = 0;
    if (tile?.settlement && state.settlements[tile.settlement]?.owner === player) heal = HEAL_IN_SETTLEMENT;
    else if (tile?.owner === player) heal = HEAL_IN_TERRITORY;
    else if (rested) heal = HEAL_RESTING;
    u.hp = Math.min(UNIT_MAX_HP, u.hp + heal);
    const def = idx.units[u.type];
    if (def?.upgradesTo && tile?.owner === player && !u.figure) {
      const next = idx.units[def.upgradesTo];
      if (next && (!next.requiresTech || known.has(next.requiresTech))) {
        u.type = next.id;
        u.unitClass = next.unitClass;
      }
    }
    u.hasAttacked = false;
    u.movesLeft = maxMoves(state, u, content, empire);
  }
};

/** Refresh raider units' moves (world phase). */
export const refreshUnitsOf = (state: GameState, owner: PlayerId, content: ContentBundle): void => {
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (!u || u.owner !== owner) continue;
    u.hasAttacked = false;
    u.movesLeft = maxMoves(state, u, content, []);
  }
};

// --- Vision -------------------------------------------------------------------

export const revealAround = (state: GameState, explored: number[], center: Hex, radius: number): void => {
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      const i = tileIndex(state.map, { q: center.q + dq, r: center.r + dr });
      if (i >= 0) explored[i] = 1;
    }
  }
};

/** Tile indices visible to `player`: unit vision, settlements within 3, every owned tile. Sorted. */
export const visibleTileSet = (state: GameState, player: PlayerId, content: ContentBundle): number[] => {
  const seen = new Uint8Array(state.map.tiles.length);
  const mark = (center: Hex, radius: number): void => {
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
        const i = tileIndex(state.map, { q: center.q + dq, r: center.r + dr });
        if (i >= 0) seen[i] = 1;
      }
    }
  };
  const empire = empireModifiers(state, player, content);
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (u && u.owner === player) mark(u.at, visionRadius(state, u, content, empire));
  }
  for (const s of playerSettlements(state, player)) mark(s.at, SETTLEMENT_VISION);
  state.map.tiles.forEach((t, i) => {
    if (t.owner === player) seen[i] = 1;
  });
  const out: number[] = [];
  seen.forEach((v, i) => {
    if (v) out.push(i);
  });
  return out;
};

/** Mark everything currently visible as explored. */
export const updateExplored = (state: GameState, player: PlayerId, content: ContentBundle): void => {
  const p = state.players[player];
  if (!p) return;
  for (const i of visibleTileSet(state, player, content)) p.explored[i] = 1;
};
