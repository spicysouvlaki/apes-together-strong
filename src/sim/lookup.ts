/**
 * Content id lookups and map helpers used across the sim core.
 *
 * The id indices are memoized per ContentBundle object in a WeakMap. That cache only
 * speeds up `find` over immutable content; it never changes a result, so it does not
 * break determinism (CLAUDE.md rule 2).
 */
import type {
  Building,
  CityStateDef,
  ContentBundle,
  Culture,
  Figure,
  Government,
  Resource,
  Tech,
  Terrain,
  UnitDef,
  Wonder,
} from '@contracts/content-schemas';
import { axialToOffset, hexDistance, hexesInRange, hexNeighbors, offsetToAxial, type Hex } from '@contracts/hex';
import type { GameState, MapState, PlayerId, Settlement, Tile, Unit } from '@contracts/sim-api';

export interface ContentIndex {
  units: Record<string, UnitDef>;
  buildings: Record<string, Building>;
  wonders: Record<string, Wonder>;
  techs: Record<string, Tech>;
  terrain: Record<string, Terrain>;
  resources: Record<string, Resource>;
  governments: Record<string, Government>;
  cityStates: Record<string, CityStateDef>;
  cultures: Record<string, Culture>;
  figures: Record<string, Figure>;
}

const index = <T extends { id: string }>(list: readonly T[]): Record<string, T> => {
  const out: Record<string, T> = {};
  for (const item of list) out[item.id] = item;
  return out;
};

const cache = new WeakMap<ContentBundle, ContentIndex>();

export const ci = (content: ContentBundle): ContentIndex => {
  let c = cache.get(content);
  if (!c) {
    c = {
      units: index(content.units),
      buildings: index(content.buildings),
      wonders: index(content.wonders),
      techs: index(content.techs),
      terrain: index(content.terrain),
      resources: index(content.resources),
      governments: index(content.governments),
      cityStates: index(content.cityStates),
      cultures: index(content.cultures),
      figures: index(content.figures),
    };
    cache.set(content, c);
  }
  return c;
};

// --- Map ---------------------------------------------------------------------

export const tileIndex = (map: MapState, h: Hex): number => {
  const { col, row } = axialToOffset(h);
  if (col < 0 || row < 0 || col >= map.width || row >= map.height) return -1;
  return row * map.width + col;
};

export const tileAt = (map: MapState, h: Hex): Tile | undefined => {
  const i = tileIndex(map, h);
  return i < 0 ? undefined : map.tiles[i];
};

export const hexOfIndex = (map: MapState, i: number): Hex => offsetToAxial({ col: i % map.width, row: Math.floor(i / map.width) });

/** In-bounds neighbors, in HEX_DIRECTIONS order. */
export const neighborTiles = (map: MapState, h: Hex): Tile[] => {
  const out: Tile[] = [];
  for (const n of hexNeighbors(h)) {
    const t = tileAt(map, n);
    if (t) out.push(t);
  }
  return out;
};

/** In-bounds tiles within `radius`, ordered by distance then generation order (deterministic). */
export const tilesInRange = (map: MapState, center: Hex, radius: number): Tile[] => {
  const withDist: { t: Tile; d: number }[] = [];
  for (const h of hexesInRange(center, radius)) {
    const t = tileAt(map, h);
    if (t) withDist.push({ t, d: hexDistance(center, h) });
  }
  // Array.prototype.sort is stable, so ties keep generation order.
  withDist.sort((a, b) => a.d - b.d);
  return withDist.map((x) => x.t);
};

export const isWater = (tile: Tile, content: ContentBundle): boolean => ci(content).terrain[tile.terrain]?.water ?? false;

export const isCoastalHex = (map: MapState, h: Hex, content: ContentBundle): boolean =>
  neighborTiles(map, h).some((t) => isWater(t, content));

// --- Entities ----------------------------------------------------------------

export const unitsAt = (state: GameState, h: Hex): Unit[] => {
  const out: Unit[] = [];
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (u && u.at.q === h.q && u.at.r === h.r) out.push(u);
  }
  return out;
};

/** Map from tile key "q,r" to units on it; build once per operation when scanning many tiles. */
export const unitPositions = (state: GameState): Map<string, Unit[]> => {
  const out = new Map<string, Unit[]>();
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (!u) continue;
    const k = `${u.at.q},${u.at.r}`;
    const list = out.get(k);
    if (list) list.push(u);
    else out.set(k, [u]);
  }
  return out;
};

export const isCivilian = (u: { unitClass: string }): boolean => u.unitClass === 'civilian';

export const settlementAt = (state: GameState, h: Hex): Settlement | undefined => {
  const t = tileAt(state.map, h);
  if (!t || !t.settlement) return undefined;
  return state.settlements[t.settlement];
};

export const playerSettlements = (state: GameState, player: PlayerId): Settlement[] => {
  const out: Settlement[] = [];
  for (const id of Object.keys(state.settlements)) {
    const s = state.settlements[id];
    if (s && s.owner === player) out.push(s);
  }
  return out;
};

export const capitalOf = (state: GameState, player: PlayerId): Settlement | undefined =>
  playerSettlements(state, player).find((s) => s.isCapital);

/** Current age for rules that look ahead during the transition (governments). */
export const ruleAge = (state: GameState) =>
  state.phase === 'transition' && state.transition ? state.transition.toAge : state.age;

export const round2 = (x: number): number => Math.round(x * 100) / 100;
