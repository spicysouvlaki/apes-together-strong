/** Small shared helpers for the emergence engine. Pure; no state mutation. */
import type { ContentBundle, Figure, FigureKind, GpKind } from '@contracts/content-schemas';
import { FIGURE_KIND_TO_GP } from '@contracts/content-schemas';
import { axialToOffset, hexEquals, hexNeighbors, type Hex } from '@contracts/hex';
import type {
  CultureId,
  GameState,
  PlayerId,
  PlayerState,
  Settlement,
  Tile,
} from '@contracts/sim-api';
import { isCityStateOwner, CITY_STATE_PREFIX } from '@contracts/sim-api';

const figureIndexCache = new WeakMap<readonly Figure[], Record<string, Figure>>();

/** Content figure by id (cached per content bundle). */
export const figureDef = (content: ContentBundle, id: string): Figure | undefined => {
  let index = figureIndexCache.get(content.figures);
  if (!index) {
    index = {};
    for (const f of content.figures) index[f.id] = f;
    figureIndexCache.set(content.figures, index);
  }
  return index[id];
};

export const getPlayer = (state: GameState, id: PlayerId): PlayerState => {
  const p = state.players[id];
  if (!p) throw new Error(`unknown player ${id}`);
  return p;
};

export const tileIndex = (state: GameState, h: Hex): number => {
  const { col, row } = axialToOffset(h);
  if (col < 0 || row < 0 || col >= state.map.width || row >= state.map.height) return -1;
  return row * state.map.width + col;
};

export const tileAt = (state: GameState, h: Hex): Tile | undefined => {
  const i = tileIndex(state, h);
  return i < 0 ? undefined : state.map.tiles[i];
};

/** Settlements owned by `player`, in state key order (deterministic). */
export const ownSettlements = (state: GameState, player: PlayerId): Settlement[] => {
  const out: Settlement[] = [];
  for (const id of Object.keys(state.settlements)) {
    const s = state.settlements[id];
    if (s && s.owner === player) out.push(s);
  }
  return out;
};

/** The capital, else the first owned settlement, else null. Figures are based here. */
export const homeSettlement = (state: GameState, player: PlayerId): Settlement | null => {
  const own = ownSettlements(state, player);
  return own.find((s) => s.isCapital) ?? own[0] ?? null;
};

/** The culture a settlement "belongs to" for trade signals: city-state culture or `namedFor`. */
export const settlementCulture = (s: Settlement, content: ContentBundle): CultureId => {
  if (isCityStateOwner(s.owner)) {
    const csId = s.owner.slice(CITY_STATE_PREFIX.length);
    const def = content.cityStates.find((c) => c.id === csId);
    if (def) return def.culture;
  }
  return s.namedFor;
};

/** Number of the player's trade routes ending in a settlement of each culture. */
export const tradeRoutesByCulture = (
  state: GameState,
  player: PlayerId,
  content: ContentBundle,
): Record<CultureId, number> => {
  const out: Record<CultureId, number> = {};
  for (const r of state.tradeRoutes) {
    if (r.owner !== player) continue;
    const dest = state.settlements[r.to];
    if (!dest) continue;
    const c = settlementCulture(dest, content);
    out[c] = (out[c] ?? 0) + 1;
  }
  return out;
};

/** Number of living city-states of each culture the player is suzerain of. */
export const suzerainByCulture = (
  state: GameState,
  player: PlayerId,
  content: ContentBundle,
): Record<CultureId, number> => {
  const out: Record<CultureId, number> = {};
  for (const def of content.cityStates) {
    const cs = state.cityStates[def.id];
    if (cs && cs.alive && cs.suzerain === player) out[def.culture] = (out[def.culture] ?? 0) + 1;
  }
  return out;
};

/** Figure kinds that draw from a great-people pool. */
export const kindsForGp = (gp: GpKind): FigureKind[] =>
  (Object.keys(FIGURE_KIND_TO_GP) as Exclude<FigureKind, 'legend'>[]).filter((k) => FIGURE_KIND_TO_GP[k] === gp);

export const isWaterTerrain = (content: ContentBundle, terrain: string): boolean =>
  content.terrain.find((t) => t.id === terrain)?.water ?? false;

/** A settlement is coastal when any neighbouring tile is water. */
export const isCoastal = (state: GameState, at: Hex, content: ContentBundle): boolean => {
  for (const n of hexNeighbors(at)) {
    const t = tileAt(state, n);
    if (t && isWaterTerrain(content, t.terrain)) return true;
  }
  return false;
};

/** The player's own settlement standing on `at`, if any. */
export const ownSettlementAt = (state: GameState, player: PlayerId, at: Hex): Settlement | null =>
  ownSettlements(state, player).find((s) => hexEquals(s.at, at)) ?? null;
