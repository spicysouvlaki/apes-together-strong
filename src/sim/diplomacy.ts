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

const validTarget = (state: GameState, target: PlayerId): boolean => {
  if (isCityStateOwner(target)) return state.cityStates[target.slice(CITY_STATE_PREFIX.length)]?.alive === true;
  return state.players[target]?.alive === true;
};

export const declareWar = (ctx: SimCtx, player: PlayerId, target: PlayerId): string | null => {
  const { state } = ctx;
  if (target === player) return 'Cannot declare war on yourself';
  if (target === RAIDER_PLAYER) return 'Raiders are always hostile';
  if (!validTarget(state, target)) return 'Unknown target';
  const key = warKey(player, target);
  if (state.wars[key] !== undefined) return 'Already at war';
  state.wars[key] = state.turn;
  // Trade routes between the two stop.
  state.tradeRoutes = state.tradeRoutes.filter((r) => {
    const toOwner = state.settlements[r.to]?.owner;
    return !((r.owner === player && toOwner === target) || (r.owner === target && toOwner === player));
  });
  ctx.events.push({ type: 'warDeclared', by: player, on: target });
  addChronicle(state, player, 'war', target, `We went to war.`);
  return null;
};

export const makePeace = (ctx: SimCtx, player: PlayerId, target: PlayerId): string | null => {
  const { state } = ctx;
  const p = state.players[player];
  if (!p) return 'Unknown player';
  const key = warKey(player, target);
  const began = state.wars[key];
  if (began === undefined) return 'Not at war';
  if (state.turn - began < MIN_WAR_TURNS) return `Peace is possible after ${MIN_WAR_TURNS} turns of war`;
  if (p.stock.influence < PEACE_INFLUENCE_COST) return 'Not enough influence';
  p.stock.influence -= PEACE_INFLUENCE_COST;
  delete state.wars[key];
  ctx.events.push({ type: 'peaceMade', a: player, b: target });
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
  if (!p) return 'Unknown player';
  if (!cs || !def || !cs.alive) return 'No such city-state';
  if (state.wars[warKey(player, CITY_STATE_PREFIX + cityState)] !== undefined) return 'At war with them';
  const cost = envoyCostFor(state, player, cityState);
  if (p.stock.influence < cost) return 'Not enough influence';
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
  if (!u || u.owner !== player) return 'Not your unit';
  if (!tradeTargetsOf(state, unitId, content).includes(to)) return 'Cannot open a route to that settlement from here';
  const owned = state.tradeRoutes.filter((r) => r.owner === player).length;
  if (owned >= tradeRouteCap(state, player, content)) return 'No free trade route capacity';
  const target = state.settlements[to];
  if (!target) return 'Unknown settlement';
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

/** Drop routes whose ends changed hands or whose parties went to war. */
export const pruneTradeRoutes = (state: GameState): void => {
  state.tradeRoutes = state.tradeRoutes.filter((r) => {
    const from = state.settlements[r.from];
    const to = state.settlements[r.to];
    if (!from || !to || from.owner !== r.owner || to.owner === r.owner) return false;
    return state.wars[warKey(r.owner, to.owner)] === undefined;
  });
};
