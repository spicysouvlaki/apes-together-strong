/**
 * Build queue and "suggested next" for the city sheet (wave 11 playtest: about 45 refill
 * decisions per game were the biggest annoyance). Pure list edits on `Settlement.queue`; the UI
 * sends the whole list with `setProductionQueue` and the sim validates it, starts the next entry
 * when the current item completes, and skips entries that stopped being legal.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import { hexDistance } from '@contracts/hex';
import { RAIDER_PLAYER, type GameState, type ProductionOption, type SettlementId } from '@contracts/sim-api';

/** Contract: at most 3 follow-on items (sim-api `setProductionQueue`). */
export const MAX_QUEUE = 3;

/** The queue with `item` appended (unchanged when full). */
export const queueAdd = (queue: readonly string[], item: string): string[] => (queue.length >= MAX_QUEUE ? [...queue] : [...queue, item]);

/** The queue without entry `i`. */
export const queueRemove = (queue: readonly string[], i: number): string[] => queue.filter((_, j) => j !== i);

/** The queue with entry `i` moved one place up (dir -1) or down (dir 1); unchanged at an edge. */
export const queueMove = (queue: readonly string[], i: number, dir: -1 | 1): string[] => {
  const j = i + dir;
  if (i < 0 || i >= queue.length || j < 0 || j >= queue.length) return [...queue];
  const out = [...queue];
  const a = out[i] as string;
  out[i] = out[j] as string;
  out[j] = a;
  return out;
};

/**
 * Options that may follow on. Buildings and wonders are built once, so one already in production
 * or in the queue is not offered again; units may repeat.
 */
export const queueChoices = (options: readonly ProductionOption[], current: string | null, queue: readonly string[]): ProductionOption[] =>
  options.filter((o) => o.kind === 'unit' || (o.item !== current && !queue.includes(o.item)));

export interface SuggestContext {
  /** Settlement name, for the reason line. */
  name: string;
  /** No military unit stands in or next to the settlement. */
  unguarded: boolean;
  /** Raiders or an enemy at war are near. */
  threatened: boolean;
  /** The player is below the settlement cap with no founder alive or in production elsewhere. */
  roomToExpand: boolean;
  /** Unit ids that can found settlements (content `canFound`). */
  founders: ReadonlySet<string>;
  /** Unit ids of land military units (content, not civilian). */
  military: ReadonlySet<string>;
}

export interface Suggestion {
  item: string;
  /** Why, in a few words ("nothing guards Gadir"). */
  why: string;
}

/** How near an enemy must be to count as "danger is near" for the suggestion. */
const THREAT_RANGE = 3;

/** The suggestion's context from a snapshot. `atWar` and `cap` are SimQueries bound by the caller. */
export const suggestContext = (
  state: GameState,
  sid: SettlementId,
  content: ContentBundle,
  atWar: (a: string, b: string) => boolean,
  cap: number,
): SuggestContext | null => {
  const s = state.settlements[sid];
  if (!s) return null;
  const me = s.owner;
  const founders = new Set(content.units.filter((u) => u.canFound).map((u) => u.id));
  const military = new Set(content.units.filter((u) => u.unitClass !== 'civilian' && u.unitClass !== 'naval').map((u) => u.id));
  const units = Object.values(state.units);
  const unguarded = !units.some((u) => u.owner === me && u.unitClass !== 'civilian' && hexDistance(u.at, s.at) <= 1);
  const threatened = units.some((u) => u.owner !== me && (u.owner === RAIDER_PLAYER || atWar(me, u.owner)) && hexDistance(u.at, s.at) <= THREAT_RANGE);
  const owned = Object.values(state.settlements).filter((x) => x.owner === me);
  const founderOut =
    units.some((u) => u.owner === me && founders.has(u.type)) || owned.some((x) => x.id !== sid && !!x.production.item && founders.has(x.production.item));
  return { name: s.name, unguarded, threatened, roomToExpand: owned.length < cap && !founderOut, founders, military };
};

const quickest =(list: readonly ProductionOption[]): ProductionOption | undefined =>
  [...list].sort((a, b) => (a.turns ?? 999) - (b.turns ?? 999) || a.cost - b.cost || (a.item < b.item ? -1 : 1))[0];

/**
 * A simple, explainable pick for an idle city. Not advice from the rules engine: a guard when
 * nobody holds the walls and danger is near (or nobody at all), a founder while there is room
 * to grow, else the quickest building, else the quickest unit. Deterministic.
 */
export const suggestNext = (options: readonly ProductionOption[], ctx: SuggestContext): Suggestion | null => {
  const mil = options.filter((o) => o.kind === 'unit' && ctx.military.has(o.item));
  const guard = quickest(mil);
  if (guard && ctx.unguarded && ctx.threatened) return { item: guard.item, why: `danger is near and nothing guards ${ctx.name}` };
  const founder = quickest(options.filter((o) => o.kind === 'unit' && ctx.founders.has(o.item)));
  if (founder && ctx.roomToExpand) return { item: founder.item, why: 'there is room for another settlement' };
  if (guard && ctx.unguarded) return { item: guard.item, why: `nothing guards ${ctx.name}` };
  const building = quickest(options.filter((o) => o.kind === 'building'));
  if (building) return { item: building.item, why: building.turns ? `the quickest building (${building.turns} ${building.turns === 1 ? 'turn' : 'turns'})` : 'the quickest building' };
  const any = quickest(options);
  return any ? { item: any.item, why: 'the quickest thing to make' } : null;
};
