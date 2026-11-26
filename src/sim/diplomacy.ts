/**
 * War and peace, city-state envoys, trade routes (GDD §7 "Diplomacy", "City-states", "Trade").
 *
 * War with a city-state: `declareWar` with target `cs:<id>`; afterwards its settlement is
 * attackable and capturable. Raiders never need a declaration.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import { hexDistance } from '@contracts/hex';
import {
  CITY_STATE_PREFIX,
  RAIDER_PLAYER,
  isCityStateOwner,
  warKey,
  type GameState,
  type PlayerId,
  type SettlementId,
  type UnitId,
} from '@contracts/sim-api';
import { addAffinity } from '../emergence';
import { addChronicle } from './chronicle';
import {
  ENVOY_AFFINITY,
  ENVOY_BASE_COST,
  ENVOY_COST_STEP,
  MIN_WAR_TURNS,
  PEACE_INFLUENCE_COST,
  SUZERAIN_MIN_ENVOYS,
  TRADE_RANGE,
  TRADE_ROUTE_BASE_CAP,
} from './constants';
import { mintId, type SimCtx } from './ctx';
import { ci, playerSettlements } from './lookup';
import { empireModifiers, sumAdd } from './modifiers';
import { removeUnit } from './units';
import { speak } from './voice';

/** Chronicle line of the declaring side (annal voice; the AI also reads it to space its wars). */
export const WAR_DECLARED_TEXT = 'War was declared.';

const validTarget = (state: GameState, target: PlayerId): boolean => {
  if (isCityStateOwner(target)) return state.cityStates[target.slice(CITY_STATE_PREFIX.length)]?.alive === true;
  return state.players[target]?.alive === true;
};

export const declareWar = (ctx: SimCtx, player: PlayerId, target: PlayerId): string | null => {
  const { state } = ctx;
  if (target === player) return 'You cannot declare war on yourself.';
  if (target === RAIDER_PLAYER) return 'Raiders are already hostile to everyone.';
  if (!validTarget(state, target)) return 'There is no such civilization or city-state.';
  const key = warKey(player, target);
  if (state.wars[key] !== undefined) return 'You are already at war with them.';
  state.wars[key] = state.turn;
  // Trade routes between the two stop.
  state.tradeRoutes = state.tradeRoutes.filter((r) => {
    const toOwner = state.settlements[r.to]?.owner;
    return !((r.owner === player && toOwner === target) || (r.owner === target && toOwner === player));
  });
  ctx.events.push({ type: 'warDeclared', by: player, on: target });
  addChronicle(state, player, 'war', target, WAR_DECLARED_TEXT);
  speak(ctx, player, target, 'warOnYou');
  speak(ctx, target, player, 'warByYou');
  return null;
};

export const makePeace = (ctx: SimCtx, player: PlayerId, target: PlayerId): string | null => {
  const { state } = ctx;
  const p = state.players[player];
  if (!p) return 'That player is not in this game.';
  const key = warKey(player, target);
  const began = state.wars[key];
  if (began === undefined) return 'You are not at war with them.';
  if (state.turn - began < MIN_WAR_TURNS) {
    const left = MIN_WAR_TURNS - (state.turn - began);
    return `Peace is possible after ${MIN_WAR_TURNS} turns of war (${left} more ${left === 1 ? 'turn' : 'turns'}).`;
  }
  if (p.stock.influence < PEACE_INFLUENCE_COST)
    return `Making peace costs ${PEACE_INFLUENCE_COST} influence; you have ${Math.floor(p.stock.influence)}.`;
  p.stock.influence -= PEACE_INFLUENCE_COST;
  delete state.wars[key];
  ctx.events.push({ type: 'peaceMade', a: player, b: target });
  speak(ctx, player, target, 'peace');
  speak(ctx, target, player, 'peace');
  return null;
};

// --- City-states ---------------------------------------------------------------

export const envoyCostFor = (state: GameState, player: PlayerId, cityState: string): number =>
  ENVOY_BASE_COST + ENVOY_COST_STEP * (state.cityStates[cityState]?.envoys[player] ?? 0);

/** Most envoys (at least 3) is suzerain; a tie keeps the incumbent, otherwise nobody. */
export const recomputeSuzerain = (ctx: SimCtx, cityState: string): void => {
  const cs = ctx.state.cityStates[cityState];
  if (!cs) return;
  let max = 0;
  for (const pid of Object.keys(cs.envoys)) max = Math.max(max, cs.envoys[pid] ?? 0);
  let next: PlayerId | null = null;
  if (cs.alive && max >= SUZERAIN_MIN_ENVOYS) {
    const top = Object.keys(cs.envoys).filter((pid) => cs.envoys[pid] === max);
    if (cs.suzerain !== null && top.includes(cs.suzerain)) next = cs.suzerain;
    else if (top.length === 1) next = top[0] ?? null;
  }
  if (next !== cs.suzerain) {
    cs.suzerain = next;
    ctx.events.push({ type: 'suzerainChanged', cityState, suzerain: next });
  }
};

export const sendEnvoy = (ctx: SimCtx, player: PlayerId, cityState: string): string | null => {
  const { state, content } = ctx;
  const p = state.players[player];
  const cs = state.cityStates[cityState];
  const def = ci(content).cityStates[cityState];
  if (!p) return 'That player is not in this game.';
  if (!cs || !def || !cs.alive) return 'That city-state no longer exists.';
  if (state.wars[warKey(player, CITY_STATE_PREFIX + cityState)] !== undefined) return 'You cannot send envoys to a city-state you are at war with.';
  const cost = envoyCostFor(state, player, cityState);
  if (p.stock.influence < cost) return `An envoy costs ${cost} influence; you have ${Math.floor(p.stock.influence)}.`;
  p.stock.influence -= cost;
  cs.envoys[player] = (cs.envoys[player] ?? 0) + 1;
  p.stats.envoysSent++;
  addAffinity(ctx, player, def.culture, ENVOY_AFFINITY);
  ctx.events.push({ type: 'envoySent', player, cityState });
  recomputeSuzerain(ctx, cityState);
  return null;
};

// --- Trade -------------------------------------------------------------------------

export const tradeRouteCap = (state: GameState, player: PlayerId, content: ContentBundle): number =>
  TRADE_ROUTE_BASE_CAP + sumAdd(empireModifiers(state, player, content), 'tradeRoutes');

/** Foreign or city-state settlements the merchant stands in/next to, with a home settlement within range. */
export const tradeTargetsOf = (state: GameState, unitId: UnitId, content: ContentBundle): SettlementId[] => {
  const u = state.units[unitId];
  if (!u || !ci(content).units[u.type]?.canTrade) return [];
  const home = playerSettlements(state, u.owner);
  if (home.length === 0) return [];
  const out: SettlementId[] = [];
  for (const sid of Object.keys(state.settlements)) {
    const s = state.settlements[sid];
    if (!s || s.owner === u.owner) continue;
    if (hexDistance(s.at, u.at) > 1) continue;
    if (state.wars[warKey(u.owner, s.owner)] !== undefined) continue;
    if (state.tradeRoutes.some((r) => r.owner === u.owner && r.to === s.id)) continue;
    if (!home.some((h) => hexDistance(h.at, s.at) <= TRADE_RANGE)) continue;
    out.push(s.id);
  }
  return out;
};

export const openTradeRoute = (ctx: SimCtx, player: PlayerId, unitId: UnitId, to: SettlementId): string | null => {
  const { state, content } = ctx;
  const u = state.units[unitId];
  if (!u || u.owner !== player) return 'That unit is not yours.';
  if (!tradeTargetsOf(state, unitId, content).includes(to)) return 'This unit cannot open a trade route to that settlement from here.';
  const owned = state.tradeRoutes.filter((r) => r.owner === player).length;
  if (owned >= tradeRouteCap(state, player, content)) return 'All your trade routes are in use.';
  const target = state.settlements[to];
  if (!target) return 'That settlement no longer exists.';
  // The nearest home settlement is the route's origin (ties: first listed).
  let from = '';
  let bestD = Infinity;
  for (const h of playerSettlements(state, player)) {
    const d = hexDistance(h.at, target.at);
    if (d < bestD) {
      bestD = d;
      from = h.id;
    }
  }
  state.tradeRoutes.push({ id: mintId(state, 't'), owner: player, from, to });
  // Merchants are consumed; a figure-unit (explorer) opens the route and keeps travelling.
  if (!u.figure) removeUnit(ctx, unitId);
  ctx.events.push({ type: 'tradeRouteOpened', player, from, to });
  return null;
};

/**
 * Close a player's newest routes beyond their capacity (a crisis response or a lost bonus can
 * lower it), with a notice. Before fun audit pass 2 a lower capacity never closed anything,
 * so "Quarantine arrivals" or "Hoard grain" had no cost and the plague no remedy.
 */
export const closeRoutesOverCapacity = (ctx: SimCtx): void => {
  const { state, content } = ctx;
  for (const pid of state.playerOrder) {
    const mine = state.tradeRoutes.filter((r) => r.owner === pid);
    const over = mine.length - Math.max(0, tradeRouteCap(state, pid, content));
    if (over <= 0) continue;
    const closing = new Set(mine.slice(mine.length - over).map((r) => r.id));
    state.tradeRoutes = state.tradeRoutes.filter((r) => !closing.has(r.id));
    ctx.events.push({
      type: 'notice',
      player: pid,
      text: over === 1 ? 'A trade route closed: you no longer have the capacity to keep it.' : 'Trade routes closed: you no longer have the capacity to keep them.',
    });
  }
};

/** Is this war party still around: a living player, or a city-state that still stands? */
const warPartyAlive = (state: GameState, id: PlayerId): boolean => {
  if (isCityStateOwner(id)) return state.cityStates[id.slice(CITY_STATE_PREFIX.length)]?.alive === true;
  return state.players[id]?.alive === true;
};

/**
 * Remove every war entry with a party that no longer exists (a captured city-state, an
 * eliminated player). Playtest 3: after Ugarit fell, `wars["cs:ugarit|p1"]` stayed forever,
 * so the player kept paying war weariness against a city that was theirs. Capture and
 * elimination clear their own entries; this sweep (every turn start) catches anything else.
 */
export const pruneWars = (state: GameState): void => {
  for (const key of Object.keys(state.wars)) {
    const [a, b] = key.split('|');
    if (a === undefined || b === undefined || !warPartyAlive(state, a) || !warPartyAlive(state, b)) delete state.wars[key];
  }
};

/** Drop routes whose ends changed hands or whose parties went to war. */
export const pruneTradeRoutes = (state: GameState): void => {
  state.tradeRoutes = state.tradeRoutes.filter((r) => {
    const from = state.settlements[r.from];
    const to = state.settlements[r.to];
    if (!from || !to || from.owner !== r.owner || to.owner === r.owner) return false;
    return state.wars[warKey(r.owner, to.owner)] === undefined;
  });
};
