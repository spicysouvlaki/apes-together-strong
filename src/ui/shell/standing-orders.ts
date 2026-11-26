/**
 * Signals and the runner for standing orders (pure logic: orders.ts). Orders live only in the
 * UI and in localStorage keyed by the game seed, so they survive a reload of the same game.
 * At the start of each of the player's turns the runner sends one `moveUnit` per ordered unit,
 * one at a time, each after the previous snapshot has arrived.
 */
import { computed, effect, signal } from '@preact/signals';
import type { Hex } from '@contracts/hex';
import type { UnitId } from '@contracts/sim-api';
import { content, dispatch, game, lookup, me, myTurn, pushToast, q } from '../store';
import { stepCost } from '../../sim/units';
import { tileAt } from './hexutil';
import { parseStoredOrders, pruneOrders, routeBeside, storeOrders, routeTurns, stepOrder, withOrder, type OrderDeps, type Orders, type StandingOrder } from './orders';
import { skipped } from './shell-state';

const KEY = 'apes.orders.v2';

export const orders = signal<Orders>({});

/** A route previewed on the map, waiting for "Go" (or a second tap on the same tile). */
export interface PlannedRoute {
  unit: UnitId;
  /** Where the route ends (beside `tapped` when that tile cannot be entered). */
  to: Hex;
  /** The tile the player tapped; tapping it again confirms. */
  tapped: Hex;
  path: Hex[];
  turns: number;
}
export const plannedRoute = signal<PlannedRoute | null>(null);

/** Units the "next unit" cycle and the ready chevrons leave alone: skipped or under orders. */
export const resting = computed<ReadonlySet<string>>(() => {
  const ids = Object.keys(orders.value);
  if (ids.length === 0) return skipped.value;
  return new Set([...skipped.value, ...ids]);
});

export const setOrder = (unit: UnitId, order: StandingOrder | null): void => {
  orders.value = withOrder(orders.value, unit, order);
};

export const orderDeps = (): OrderDeps | null => {
  const g = game.value;
  if (!g) return null;
  return {
    pathTo: (unit, to) => q.pathTo(g, unit, to, content),
    reachable: (unit) => q.reachable(g, unit, content).map((r) => r.hex),
    attackTargets: (unit) => q.attackTargets(g, unit, content),
    hostile: (a, b) => q.atWar(g, a, b),
    isWater: (t) => !!lookup.terrain[t.terrain]?.water,
  };
};

/** Plan a route for the preview (null when no known route exists). */
export const planRoute = (unit: UnitId, to: Hex): PlannedRoute | null => {
  const g = game.value;
  const u = g?.units[unit];
  const def = u ? lookup.units[u.type] : undefined;
  if (!g || !u || !def) return null;
  let dest = to;
  let path = q.pathTo(g, unit, to, content);
  if (!path || path.length === 0) {
    // A foreign city or unit cannot be entered: march beside it instead (merchants, envoys of
    // war). The nearest reachable neighbour by route length wins.
    const near = routeBeside(to, (h) => q.pathTo(g, unit, h, content));
    if (!near) return null;
    dest = near.to;
    path = near.path;
  }
  const cost = (h: Hex): number => {
    const t = tileAt(g.map, h);
    return t ? stepCost(t, def, content) : 1;
  };
  return { unit, to: dest, tapped: to, path, turns: routeTurns(path, u.movesLeft, def.moves, cost) };
};

// --- Runner -----------------------------------------------------------------

let queue: UnitId[] = [];
let awaiting = false;

const unitName = (id: UnitId): string => {
  const u = game.value?.units[id];
  if (!u) return 'A unit';
  return (u.figure ? lookup.figures[u.figure]?.name : undefined) ?? lookup.units[u.type]?.name ?? 'A unit';
};

const DONE_TEXT: Partial<Record<string, (name: string) => string>> = {
  impossible: (n) => `${n} found no route onward and waits for orders.`,
  explored: (n) => `${n} has nothing left to explore nearby.`,
  enemy: (n) => `${n} stopped exploring: an enemy is near.`,
};

/** Send the next order's move; returns after one dispatch (the next snapshot continues). */
const pump = (): void => {
  const g = game.value;
  const my = me.value;
  const deps = orderDeps();
  if (!g || !my || !deps || !myTurn.value) {
    queue = [];
    return;
  }
  while (queue.length > 0) {
    const id = queue.shift() as UnitId;
    const order = orders.value[id];
    if (!order) continue;
    const step = stepOrder(g, my, id, order, deps);
    if (step.kind === 'wait') continue;
    if (step.kind === 'done') {
      const say = DONE_TEXT[step.reason];
      if (say && g.units[id]) pushToast(say(unitName(id)), 'info');
      setOrder(id, null);
      continue;
    }
    if (step.arrives) setOrder(id, null);
    awaiting = true;
    dispatch({ type: 'moveUnit', unit: id, to: step.to });
    return;
  }
};

/** Called by app-wiring at the start of each of the player's turns. */
export const runStandingOrders = (): void => {
  queue = Object.keys(orders.value);
  awaiting = false;
  pump();
};

/** Carry out one unit's (new) order now, e.g. right after switching Explore on. */
export const exploreNow = (unit: UnitId): void => {
  if (awaiting) {
    queue.push(unit);
    return;
  }
  queue = [unit, ...queue];
  pump();
};

/** Called by app-wiring after every snapshot or error: continue a run in progress. */
export const continueStandingOrders = (): void => {
  if (!awaiting) return;
  awaiting = false;
  pump();
};

/** True while orders are still being carried out this turn. */
export const ordersRunning = (): boolean => awaiting || queue.length > 0;

// --- Persistence ----------------------------------------------------------------

const readStored = (seed: number): Record<UnitId, StandingOrder> => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseStoredOrders(JSON.parse(raw), seed) : {};
  } catch {
    return {};
  }
};

let started = false;
/** Load orders for the current game, keep them pruned and saved. Called once from initApp. */
export const initStandingOrders = (): void => {
  if (started) return;
  started = true;
  let seed: number | null = null;
  effect(() => {
    const g = game.value;
    const my = me.value;
    if (!g || !my) {
      seed = null;
      return;
    }
    if (g.seed !== seed) {
      seed = g.seed;
      orders.value = pruneOrders(g, my, readStored(g.seed));
      plannedRoute.value = null;
      return;
    }
    const pruned = pruneOrders(g, my, orders.peek());
    if (pruned !== orders.peek()) orders.value = pruned;
  });
  effect(() => {
    const o = orders.value;
    if (seed === null) return;
    try {
      const raw = localStorage.getItem(KEY);
      localStorage.setItem(KEY, JSON.stringify(storeOrders(raw ? JSON.parse(raw) : null, seed, o)));
    } catch {
      // Storage blocked: orders last for this session only.
    }
  });
};
