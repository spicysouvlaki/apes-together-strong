/**
 * Turn structure (GDD §5): players act in `playerOrder`; after the last living player ends
 * their turn the world phase runs (raiders, city-states, age meter and crises), then the
 * next turn's start-of-turn sim runs for every living player.
 */
import { YIELDS } from '@contracts/content-schemas';
import { hexDistance, hexNeighbors } from '@contracts/hex';
import { RAIDER_PLAYER, isCityStateOwner, type GameState, type PlayerId, type Unit } from '@contracts/sim-api';
import { emergenceTick } from '../emergence';
import { agesWorldPhase, updateMilestones } from './ages';
import { attackTargetsOf, checkEliminations, isHostile, planAttack, resolveAttack } from './combat';
import { WALL_HEAL_PER_TURN } from './constants';
import type { SimCtx } from './ctx';
import { pruneTradeRoutes } from './diplomacy';
import { ci, hexOfIndex, playerSettlements, unitsAt } from './lookup';
import { empireModifiers } from './modifiers';
import { advanceResearch } from './research';
import { growSettlement, produceInSettlement } from './settlements';
import { findPaths, refreshUnitsOf, removeUnit, unitUpkeep, updateExplored } from './units';
import { STOCK_YIELDS, computeEmpire, computeHappiness } from './yields';

const hostileAdjacent = (state: GameState, owner: PlayerId, at: { q: number; r: number }): boolean => {
  for (const n of hexNeighbors(at)) {
    for (const u of unitsAt(state, n)) if (u.unitClass !== 'civilian' && isHostile(state, owner, u.owner)) return true;
  }
  return false;
};

/**
 * The treasury is empty and the army's upkeep is unpaid: gold resets to 0 and the weakest
 * (then newest) non-figure military unit deserts. One per turn, so a player can react.
 */
export const desertForUpkeep = (ctx: SimCtx, player: PlayerId): void => {
  const { state, content } = ctx;
  const p = state.players[player];
  if (!p) return;
  p.stock.gold = 0;
  let pick: Unit | null = null;
  let pickStr = Infinity;
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (!u || u.owner !== player || u.unitClass === 'civilian' || u.figure) continue;
    const str = ci(content).units[u.type]?.strength ?? 0;
    if (str < pickStr || (str === pickStr && pick !== null && u.id > pick.id)) {
      pickStr = str;
      pick = u;
    }
  }
  if (!pick) return;
  removeUnit(ctx, pick.id);
  ctx.events.push({ type: 'notice', player, text: 'Unpaid soldiers deserted: the treasury is empty.' });
};

/** Start-of-turn sim for one player (GDD §5 "start-of-turn sim"). */
export const startOfTurnForPlayer = (ctx: SimCtx, player: PlayerId): void => {
  const { state, content } = ctx;
  const p = state.players[player];
  if (!p || !p.alive) return;
  if (p.anarchyTurns > 0) p.anarchyTurns--;
  p.effects = p.effects.filter((e) => e.untilTurn === -1 || e.untilTurn >= state.turn);
  const emp = empireModifiers(state, player, content);

  unitUpkeep(ctx, player, emp);

  p.happiness = computeHappiness(state, player, content, emp);
  const { income, perSettlement } = computeEmpire(state, player, content, emp);
  for (const y of STOCK_YIELDS) p.stock[y] = Math.round((p.stock[y] + income[y]) * 100) / 100;
  if (p.stock.gold < 0) desertForUpkeep(ctx, player);
  const nextIncome = {} as typeof income;
  for (const y of YIELDS) nextIncome[y] = income[y];
  p.income = nextIncome;

  for (const s of playerSettlements(state, player)) {
    const y = perSettlement[s.id];
    if (!y) continue;
    growSettlement(ctx, s, y, p.happiness);
    produceInSettlement(ctx, s, y, emp);
  }

  advanceResearch(ctx, player, 'tech', income.science);
  advanceResearch(ctx, player, 'civic', income.culture);

  // Siege counters and wall repair (deeds read siegeTurnsHeld).
  for (const s of playerSettlements(state, player)) {
    const besieged = hostileAdjacent(state, player, s.at);
    if (besieged && s.hp < s.maxHp) {
      s.siegeTurns++;
      p.stats.siegeTurnsHeld = Math.max(p.stats.siegeTurnsHeld, s.siegeTurns);
    } else {
      s.siegeTurns = 0;
    }
    if (!besieged) s.hp = Math.min(s.maxHp, s.hp + WALL_HEAL_PER_TURN);
  }

  updateExplored(state, player, content);
  emergenceTick(ctx, player);
  updateMilestones(ctx, player);
  p.stats.battlesWonThisTurn = 0;
  p.stats.citiesCapturedThisTurn = 0;
};

export const firstAlive = (state: GameState): PlayerId | undefined =>
  state.playerOrder.find((pid) => state.players[pid]?.alive);

/** Advance to the next turn: turn++, then every living player's start-of-turn. */
export const beginNextTurn = (ctx: SimCtx): void => {
  const { state } = ctx;
  state.turn++;
  pruneTradeRoutes(state);
  for (const pid of state.playerOrder) startOfTurnForPlayer(ctx, pid);
  state.currentPlayer = firstAlive(state) ?? state.currentPlayer;
  ctx.events.push({ type: 'turnStarted', turn: state.turn });
};

// --- World phase ------------------------------------------------------------------

const raiderTarget = (state: GameState, u: Unit): { q: number; r: number } | null => {
  let best: { q: number; r: number } | null = null;
  let bestD = Infinity;
  for (const sid of Object.keys(state.settlements)) {
    const s = state.settlements[sid];
    if (!s) continue;
    const d = hexDistance(u.at, s.at);
    if (d < bestD) {
      bestD = d;
      best = s.at;
    }
  }
  for (const id of Object.keys(state.units)) {
    const o = state.units[id];
    if (!o || o.owner === RAIDER_PLAYER) continue;
    const d = hexDistance(u.at, o.at);
    if (d < bestD) {
      bestD = d;
      best = o.at;
    }
  }
  return best;
};

const raiderAttack = (ctx: SimCtx, u: Unit, goal: { q: number; r: number }): boolean => {
  const targets = attackTargetsOf(ctx.state, u, ctx.content);
  if (targets.length === 0) return false;
  let pick = targets[0];
  let bestD = Infinity;
  for (const t of targets) {
    const d = hexDistance(t, goal);
    if (d < bestD) {
      bestD = d;
      pick = t;
    }
  }
  if (!pick) return false;
  const plan = planAttack(ctx.state, u, pick, ctx.content);
  if (typeof plan === 'string') return false;
  resolveAttack(ctx, u, pick, plan);
  return true;
};

/** Raiders (GDD §5 "Collapse") move toward and attack the nearest settlement or unit. */
export const moveRaiders = (ctx: SimCtx): void => {
  const { state, content } = ctx;
  refreshUnitsOf(state, RAIDER_PLAYER, content);
  const ids = Object.keys(state.units).filter((id) => state.units[id]?.owner === RAIDER_PLAYER);
  for (const id of ids) {
    const u = state.units[id];
    if (!u) continue;
    const goal = raiderTarget(state, u);
    if (!goal) continue;
    if (raiderAttack(ctx, u, goal)) continue;
    const paths = findPaths(state, u, content);
    let bestIdx = -1;
    let bestD = hexDistance(u.at, goal);
    for (const idx of paths.endable) {
      const d = hexDistance(hexOfIndex(state.map, idx), goal);
      if (d < bestD) {
        bestD = d;
        bestIdx = idx;
      }
    }
    if (bestIdx >= 0) {
      u.at = hexOfIndex(state.map, bestIdx);
      // Raiders may always strike after closing in, even if the move used every point.
      u.movesLeft = Math.max(1, paths.remaining.get(bestIdx) ?? 0);
      u.fortified = false;
      raiderAttack(ctx, u, goal);
    }
  }
  checkEliminations(ctx, null);
};

/** City-state walls heal when no hostile unit is adjacent. */
const healCityStates = (state: GameState): void => {
  for (const sid of Object.keys(state.settlements)) {
    const s = state.settlements[sid];
    if (!s || !isCityStateOwner(s.owner)) continue;
    if (!hostileAdjacent(state, s.owner, s.at)) s.hp = Math.min(s.maxHp, s.hp + WALL_HEAL_PER_TURN);
  }
};

export const worldPhase = (ctx: SimCtx): void => {
  moveRaiders(ctx);
  healCityStates(ctx.state);
  agesWorldPhase(ctx);
};

/**
 * A player is blocked from ending the turn only by an open offer or an owed crisis response.
 * Offers do not block a player with no settlement: they cannot be accepted (no home for the
 * figure) and are withdrawn at the player's next turn start (src/emergence emergenceTick).
 */
export const endTurnBlocker = (state: GameState, player: PlayerId): string | null => {
  if (state.offers.some((o) => o.player === player) && playerSettlements(state, player).length > 0) return 'Answer the figure offer first';
  if (state.crisis?.awaiting.includes(player)) return 'Choose a crisis response first';
  return null;
};

export const endTurn = (ctx: SimCtx, player: PlayerId): string | null => {
  const { state } = ctx;
  const blocked = endTurnBlocker(state, player);
  if (blocked) return blocked;
  const order = state.playerOrder;
  const at = order.indexOf(player);
  for (let i = at + 1; i < order.length; i++) {
    const pid = order[i];
    if (pid && state.players[pid]?.alive) {
      state.currentPlayer = pid;
      return null;
    }
  }
  worldPhase(ctx);
  if (state.phase === 'playing') beginNextTurn(ctx);
  else state.currentPlayer = firstAlive(state) ?? state.currentPlayer;
  return null;
};

