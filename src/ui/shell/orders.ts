/**
 * Standing orders (multi-turn moves and scout exploring) kept on the UI side. Pure: every rule
 * (where a unit can go this turn, the route, what is an attack) comes in through `OrderDeps`,
 * bound to SimQueries by the caller. This module only decides which legal step an order takes
 * and when the order is over. The sim never sees an order: each turn it receives one ordinary
 * `moveUnit` per unit. GDD §11 "Touch" (tap to move) extended to far tiles.
 */
import { hexDistance, hexEquals, hexNeighbors, type Hex } from '@contracts/hex';
import type { GameState, PlayerId, Tile, Unit, UnitId } from '@contracts/sim-api';
import { compareIds, tileIndexOf } from './hexutil';

/**
 * `recall`: a figure walking home; once it stands in the settlement the runner recalls it
 * (Recall only works inside an own settlement, so "walk back" is one tap, not two).
 */
/**
 * `trade`: a merchant sent to a trade partner with one "Send" (wave 11); the runner opens the
 * route as soon as the partner is in reach.
 */
export type StandingOrder = { kind: 'goto'; to: Hex; recall?: true; trade?: string } | { kind: 'explore' };
export type Orders = Readonly<Record<UnitId, StandingOrder>>;

export interface OrderDeps {
  /** SimQueries.pathTo bound to the state. */
  pathTo(unit: UnitId, to: Hex): Hex[] | null;
  /** SimQueries.reachable (hexes only). */
  reachable(unit: UnitId): Hex[];
  /** SimQueries.attackTargets: an order never steps onto one of these. */
  attackTargets(unit: UnitId): Hex[];
  /** SimQueries.atWar (raiders count as always at war). */
  hostile(a: PlayerId, b: PlayerId): boolean;
  /** Terrain is water (content terrain `water`). */
  isWater(tile: Tile): boolean;
  /**
   * Whether this unit needs the goal tile itself (a settler founding on its site) and so waits
   * beside it for our own unit to move off. Others stop beside it: two soldiers sent to the
   * same tile must not wait on each other forever (playtest 3). Default: wait.
   */
  needsExactTile?(unit: UnitId): boolean;
}

/** What an order does this turn. */
export type OrderStep =
  | { kind: 'move'; to: Hex; /** The unit will be at its goal after this move. */ arrives: boolean }
  /** Nothing to do this turn (no moves left, or blocked for now); keep the order. */
  | { kind: 'wait' }
  /** The order is over; drop it. */
  | { kind: 'done'; reason: 'arrived' | 'impossible' | 'explored' | 'enemy' | 'gone' };

/** How many frontier tiles (nearest first) the explorer tries to route to each turn. */
const EXPLORE_CANDIDATES = 40;

/**
 * The furthest tile along `path` this unit can end its move on now: the last route tile in this
 * turn's reachable set that is not an attack. Tiles it may only pass through (a friendly unit
 * stands there) are not reachable, so the walk skips them. Null when no route tile is in reach.
 */
export const furthestStep = (path: readonly Hex[], reachable: readonly Hex[], attackable: readonly Hex[]): Hex | null => {
  let best: Hex | null = null;
  for (const h of path) {
    if (reachable.some((r) => hexEquals(r, h)) && !attackable.some((a) => hexEquals(a, h))) best = h;
  }
  return best;
};

/** Is an enemy (at war with us, or raiders) on a tile next to `at`? */
export const enemyAdjacent = (state: GameState, me: PlayerId, at: Hex, hostile: OrderDeps['hostile']): boolean =>
  Object.values(state.units).some((u) => u.owner !== me && hexDistance(u.at, at) === 1 && hostile(me, u.owner));

/**
 * A unit of ours that still has moves (and is not dug in) standing next to an enemy: worth a
 * look before ending the turn (playtest: units left exposed). First in stable id order.
 */
export const exposedUnit = (state: GameState, me: PlayerId, hostile: OrderDeps['hostile']): Unit | null =>
  Object.values(state.units)
    .filter((u) => u.owner === me && u.movesLeft > 0 && !u.fortified && enemyAdjacent(state, me, u.at, hostile))
    .sort((a, b) => compareIds(a.id, b.id))[0] ?? null;

/** Explored land tiles that touch unexplored tiles, nearest to `from` first (ties: map order). */
export const frontierTiles = (state: GameState, me: PlayerId, from: Hex, isWater: OrderDeps['isWater']): Hex[] => {
  const p = state.players[me];
  if (!p) return [];
  const out: { hex: Hex; d: number; i: number }[] = [];
  state.map.tiles.forEach((t, i) => {
    if (!p.explored[i] || isWater(t)) return;
    const touchesUnknown = hexNeighbors(t).some((n) => {
      const j = tileIndexOf(state.map, n);
      return j !== null && !p.explored[j];
    });
    if (!touchesUnknown) return;
    const hex = { q: t.q, r: t.r };
    const d = hexDistance(from, hex);
    if (d > 0) out.push({ hex, d, i });
  });
  out.sort((a, b) => a.d - b.d || a.i - b.i);
  return out.map((x) => x.hex);
};

/**
 * Where an exploring unit heads now: of the nearest frontier tiles, the one with the shortest
 * known route. Null when nothing reachable is left to explore.
 */
export const exploreTarget = (state: GameState, me: PlayerId, unit: UnitId, deps: OrderDeps): { to: Hex; path: Hex[] } | null => {
  const u = state.units[unit];
  if (!u) return null;
  let best: { to: Hex; path: Hex[] } | null = null;
  for (const hex of frontierTiles(state, me, u.at, deps.isWater).slice(0, EXPLORE_CANDIDATES)) {
    if (best && hexDistance(u.at, hex) >= best.path.length) break; // can't beat it: a route is at least this long
    const path = deps.pathTo(unit, hex);
    if (path && path.length > 0 && (!best || path.length < best.path.length)) best = { to: hex, path };
  }
  return best;
};

/** One turn of a standing order for `unit` (re-planned from scratch every turn). */
export const stepOrder = (state: GameState, me: PlayerId, unit: UnitId, order: StandingOrder, deps: OrderDeps): OrderStep => {
  const u = state.units[unit];
  if (!u || u.owner !== me) return { kind: 'done', reason: 'gone' };
  if (order.kind === 'goto' && hexEquals(u.at, order.to)) return { kind: 'done', reason: 'arrived' };
  if (order.kind === 'explore' && enemyAdjacent(state, me, u.at, deps.hostile)) return { kind: 'done', reason: 'enemy' };
  let goal: Hex;
  let path: Hex[] | null;
  if (order.kind === 'goto') {
    goal = order.to;
    path = deps.pathTo(unit, goal);
    if (!path || path.length === 0) {
      // Our own unit stands on the goal (a scout on the settling site): close in beside it and
      // wait for it to move on, rather than dropping the order (playtest).
      const ownThere = Object.values(state.units).some((x) => x.owner === me && x.id !== unit && hexEquals(x.at, goal));
      if (!ownThere) return { kind: 'done', reason: 'impossible' };
      if (hexDistance(u.at, goal) === 1) return deps.needsExactTile && !deps.needsExactTile(unit) ? { kind: 'done', reason: 'arrived' } : { kind: 'wait' };
      const near = routeBeside(goal, (h) => deps.pathTo(unit, h));
      if (!near) return { kind: 'wait' };
      path = near.path;
    }
  } else {
    const t = exploreTarget(state, me, unit, deps);
    if (!t) return { kind: 'done', reason: 'explored' };
    goal = t.to;
    path = t.path;
  }
  if (u.movesLeft <= 0) return { kind: 'wait' };
  const to = furthestStep(path, deps.reachable(unit), deps.attackTargets(unit));
  if (!to) return { kind: 'wait' };
  return { kind: 'move', to, arrives: order.kind === 'goto' && hexEquals(to, goal) };
};

/** The shortest known route to a tile next to `target` (for targets that cannot be entered). */
export const routeBeside = (target: Hex, pathTo: (h: Hex) => Hex[] | null): { to: Hex; path: Hex[] } | null => {
  let best: { to: Hex; path: Hex[] } | null = null;
  for (const n of hexNeighbors(target)) {
    const path = pathTo(n);
    if (path && path.length > 0 && (!best || path.length < best.path.length)) best = { to: n, path };
  }
  return best;
};

/** Orders whose unit is gone or no longer ours are dropped (the unit died or was captured). */
export const pruneOrders = (state: GameState, me: PlayerId, orders: Orders): Orders => {
  let changed = false;
  const out: Record<UnitId, StandingOrder> = {};
  for (const [id, o] of Object.entries(orders)) {
    const u = state.units[id];
    if (u && u.owner === me) out[id] = o;
    else changed = true;
  }
  return changed ? out : orders;
};

export const withOrder = (orders: Orders, unit: UnitId, order: StandingOrder | null): Orders => {
  const out: Record<UnitId, StandingOrder> = { ...orders };
  if (order) out[unit] = order;
  else delete out[unit];
  return out;
};

/**
 * Rough turn count for a route, for the "about 3 turns" label. `cost(hex)` is the sim's move
 * cost of entering that tile; `full` the unit's moves per turn. A unit may always enter a tile
 * with any moves left (GDD §7), so a step ends the turn when moves run out.
 */
export const routeTurns = (path: readonly Hex[], movesLeft: number, full: number, cost: (h: Hex) => number): number => {
  if (path.length === 0) return 0;
  let turns = 1;
  let rem = movesLeft;
  for (const h of path) {
    if (rem <= 0) {
      turns++;
      rem = full;
    }
    rem -= cost(h);
  }
  return turns;
};

/**
 * Indices into `path` where a new turn starts (the renderer's `pathTurns` ticks), by the same
 * walk as `routeTurns`: index i means the step onto path[i] is the first of a later turn.
 * `routeTurns(...) === routeTurnStarts(...).length + 1` for any non-empty path.
 */
export const routeTurnStarts = (path: readonly Hex[], movesLeft: number, full: number, cost: (h: Hex) => number): number[] => {
  const out: number[] = [];
  let rem = movesLeft;
  path.forEach((h, i) => {
    if (rem <= 0) {
      out.push(i);
      rem = full;
    }
    rem -= cost(h);
  });
  return out;
};

/** "Arrives this turn" / "Arrives next turn" / "Arrives in 3 turns" (turns counted from now). */
export const arrivalText = (turns: number): string =>
  turns <= 1 ? 'Arrives this turn' : turns === 2 ? 'Arrives next turn' : `Arrives in ${turns - 1} turns`;

/**
 * Persisted form: orders per game, keyed by the game's seed (survives reloads; several games
 * or tabs do not clobber each other). The most recent games are kept.
 */
export interface StoredOrders {
  games: Record<string, Record<UnitId, StandingOrder>>;
}
export const STORED_GAMES_MAX = 8;
/** Keys are `s<seed>`: integer-like keys would be reordered by number, breaking "newest last". */
export const seedKey = (seed: number): string => `s${seed}`;

const isHex = (v: unknown): v is Hex => !!v && typeof v === 'object' && typeof (v as Hex).q === 'number' && typeof (v as Hex).r === 'number';

const parseOrderMap = (raw: unknown): Record<UnitId, StandingOrder> => {
  const out: Record<UnitId, StandingOrder> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, o] of Object.entries(raw as Record<string, unknown>)) {
    const ord = o as Partial<StandingOrder> & { to?: unknown };
    if (ord?.kind === 'explore') out[id] = { kind: 'explore' };
    else if (ord?.kind === 'goto' && isHex(ord.to)) {
      const to = { q: ord.to.q, r: ord.to.r };
      const trade = (ord as { trade?: unknown }).trade;
      const g: StandingOrder = (ord as { recall?: unknown }).recall === true ? { kind: 'goto', to, recall: true } : { kind: 'goto', to };
      if (typeof trade === 'string' && trade) g.trade = trade;
      out[id] = g;
    }
  }
  return out;
};

/** Orders stored for `seed`; anything malformed is dropped. */
export const parseStoredOrders = (raw: unknown, seed: number): Record<UnitId, StandingOrder> => {
  if (!raw || typeof raw !== 'object') return {};
  const games = (raw as Partial<StoredOrders>).games;
  if (!games || typeof games !== 'object') return {};
  return parseOrderMap((games as Record<string, unknown>)[seedKey(seed)]);
};

/** The store with `seed`'s orders replaced (moved to the newest place; old games trimmed). */
export const storeOrders = (raw: unknown, seed: number, orders: Readonly<Record<UnitId, StandingOrder>>): StoredOrders => {
  const prev = raw && typeof raw === 'object' && (raw as Partial<StoredOrders>).games && typeof (raw as StoredOrders).games === 'object' ? (raw as StoredOrders).games : {};
  const games: Record<string, Record<UnitId, StandingOrder>> = {};
  for (const [k, v] of Object.entries(prev)) if (k !== seedKey(seed)) games[k] = parseOrderMap(v);
  games[seedKey(seed)] = { ...orders };
  const keys = Object.keys(games);
  for (const k of keys.slice(0, Math.max(0, keys.length - STORED_GAMES_MAX))) delete games[k];
  return { games };
};

/**
 * A unit type that may explore on its own: the scout, a civilian with long sight, or a land
 * soldier (wave 11 playtest: an early warrior sent to scout far away had to be re-ordered every
 * two turns; exploring stops by itself when an enemy comes near). Never founders, traders, ships.
 */
export const canExplore = (def: { id: string; unitClass: string; vision?: number; canFound?: boolean; canTrade?: boolean } | undefined): boolean =>
  !!def &&
  !def.canFound &&
  !def.canTrade &&
  (def.id === 'scout' || (def.unitClass === 'civilian' && (def.vision ?? 0) >= 3) || MILITARY_EXPLORERS.has(def.unitClass));

const MILITARY_EXPLORERS: ReadonlySet<string> = new Set(['infantry', 'ranged', 'cavalry']);
