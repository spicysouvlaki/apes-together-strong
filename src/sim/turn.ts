/**
 * Turn structure (GDD §5): players act in `playerOrder`; after the last living player ends
 * their turn the world phase runs (raiders, city-states, age meter and crises), then the
 * next turn's start-of-turn sim runs for every living player.
 */
import { YIELDS, type ContentBundle } from '@contracts/content-schemas';
import { hexDistance, hexNeighbors } from '@contracts/hex';
import { RAIDER_PLAYER, isCityStateOwner, type GameState, type PlayerId, type Unit } from '@contracts/sim-api';
import { emergenceTick } from '../emergence';
import { agesWorldPhase, updateMilestones } from './ages';
import { attackTargetsOf, checkEliminations, isHostile, planAttack, resolveAttack } from './combat';
import { WALL_HEAL_PER_TURN, WALL_SIEGE_RADIUS } from './constants';
import type { SimCtx } from './ctx';
import { closeRoutesOverCapacity, pruneTradeRoutes, pruneWars } from './diplomacy';
import { ci, hexOfIndex, playerSettlements, settlementAt, tileAt, unitsAt } from './lookup';
import { isUndefended, pillage, pillageTarget, raiderGoal, warnOfRaiders } from './raids';
import { empireModifiers } from './modifiers';
import { advanceResearch } from './research';
import { growSettlement, produceInSettlement } from './settlements';
import { findPaths, refreshUnitsOf, removeUnit, unitUpkeep, updateExplored } from './units';
import { contactsOf, greetNewContacts, hasHuman } from './voice';
import { STOCK_YIELDS, computeEmpire, computeHappiness, militaryUpkeep } from './yields';

const hostileAdjacent = (state: GameState, owner: PlayerId, at: { q: number; r: number }): boolean => {
  for (const n of hexNeighbors(at)) {
    for (const u of unitsAt(state, n)) if (u.unitClass !== 'civilian' && isHostile(state, owner, u.owner)) return true;
  }
  return false;
};

/**
 * Walls are not repaired while an enemy military unit stands within WALL_SIEGE_RADIUS
 * (playtest 3 "siege grind": archers and catapults bombard from two tiles away, so with an
 * adjacency-only rule the walls healed every turn of a siege and a capture took 3+ turns of
 * the same attacks).
 */
export const underSiege = (state: GameState, owner: PlayerId, at: { q: number; r: number }): boolean => {
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (!u || u.unitClass === 'civilian' || !isHostile(state, owner, u.owner)) continue;
    if (hexDistance(u.at, at) <= WALL_SIEGE_RADIUS) return true;
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
  const name = ci(content).units[pick.type]?.name ?? 'A unit';
  const tile = tileAt(state.map, pick.at);
  const where = tile?.settlement ? state.settlements[tile.settlement]?.name : undefined;
  removeUnit(ctx, pick.id);
  // Never silent (playtest 3): say who left and why, so the player can act.
  ctx.events.push({
    type: 'notice',
    player,
    kind: 'treasury',
    text: `${name}${where ? ` in ${where}` : ''} deserted: the treasury is empty and the soldiers went unpaid. Disband units or raise more gold.`,
  });
};

/** Gold warnings look this many turns ahead (playtest 3: the treasury ran dry without a word). */
export const TREASURY_WARNING_TURNS = 3;
/** The "shrinking" warning repeats at most this often (income can hover around zero). */
export const TREASURY_SHRINK_COOLDOWN = 12;
/** ...and only when the stock would not cover this many turns of the loss anyway. */
export const TREASURY_SHRINK_HORIZON = 15;
/** Modifier-free `TimedEffect` marking a recent "shrinking" warning. */
export const TREASURY_WARNED_SOURCE = 'treasury-warned';

/**
 * Warn the player as their treasury turns: when gold income is negative and the stock no
 * longer covers TREASURY_SHRINK_HORIZON turns of it (at most once per
 * TREASURY_SHRINK_COOLDOWN turns), and once when the stock will run out within
 * TREASURY_WARNING_TURNS turns. Both compare with the previous income and stock, so each fires
 * once per downturn.
 */
export const treasuryNotices = (ctx: SimCtx, player: PlayerId, before: { stock: number; income: number }, now: { stock: number; income: number }): void => {
  const { state } = ctx;
  const p = state.players[player];
  if (!p) return;
  const soldiers = Object.values(state.units).filter((u) => u.owner === player && u.unitClass !== 'civilian' && !u.figure).length;
  const warnedLately = p.effects.some((e) => e.source === TREASURY_WARNED_SOURCE && e.untilTurn >= state.turn);
  const shrinking = (stock: number, income: number): boolean => income < 0 && stock + TREASURY_SHRINK_HORIZON * income < 0;
  if (shrinking(now.stock, now.income) && !shrinking(before.stock, before.income) && !warnedLately) {
    p.effects.push({ source: TREASURY_WARNED_SOURCE, untilTurn: state.turn + TREASURY_SHRINK_COOLDOWN - 1, modifiers: [] });
    ctx.events.push({
      type: 'notice',
      player,
      kind: 'treasury',
      text:
        militaryUpkeep(state, player) > 0
          ? `Your treasury is shrinking: ${soldiers} soldiers cost more than your towns earn.`
          : 'Your treasury is shrinking: you spend more gold than you earn.',
    });
  }
  const runsOut = (stock: number, income: number): boolean => income < 0 && stock > 0 && stock + TREASURY_WARNING_TURNS * income <= 0;
  if (runsOut(now.stock, now.income) && !runsOut(before.stock, before.income)) {
    const turns = Math.max(1, Math.ceil(now.stock / -now.income));
    ctx.events.push({
      type: 'notice',
      player,
      kind: 'treasury',
      text: `The treasury will be empty in ${turns === 1 ? 'one turn' : `${turns} turns`}; then unpaid soldiers start to desert.`,
    });
  }
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
  const goldBefore = { stock: p.stock.gold, income: p.income.gold };
  for (const y of STOCK_YIELDS) p.stock[y] = Math.round((p.stock[y] + income[y]) * 100) / 100;
  if (p.stock.gold < 0) desertForUpkeep(ctx, player);
  else treasuryNotices(ctx, player, goldBefore, { stock: p.stock.gold, income: income.gold });
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
    if (!underSiege(state, player, s.at)) s.hp = Math.min(s.maxHp, s.hp + WALL_HEAL_PER_TURN);
  }

  const voiced = hasHuman(state);
  const contactsBefore = voiced ? contactsOf(state, player) : {};
  updateExplored(state, player, content);
  if (voiced) greetNewContacts(ctx, player, contactsBefore);
  emergenceTick(ctx, player);
  updateMilestones(ctx, player);
  p.stats.battlesWonThisTurn = 0;
  p.stats.citiesCapturedThisTurn = 0;
};

/** Recompute the shown per-turn `income` and `happiness` without paying anything out. */
export const refreshIncome = (state: GameState, player: PlayerId, content: ContentBundle): void => {
  const p = state.players[player];
  if (!p || !p.alive) return;
  const emp = empireModifiers(state, player, content);
  p.happiness = computeHappiness(state, player, content, emp);
  const { income } = computeEmpire(state, player, content, emp);
  const next = {} as typeof income;
  for (const y of YIELDS) next[y] = income[y];
  p.income = next;
};

export const firstAlive = (state: GameState): PlayerId | undefined =>
  state.playerOrder.find((pid) => state.players[pid]?.alive);

/**
 * The order of the start-of-turn sims: `playerOrder` rotated by the turn number. Offers are
 * drawn in this order, and a figure invited by two courts answers the earlier invitation
 * (src/emergence/figures.ts), so the rotation keeps any seat from always inviting first.
 * Playtest 3: with a fixed order, the first seat won every contested figure.
 */
export const startOfTurnOrder = (state: GameState): PlayerId[] => {
  const order = state.playerOrder;
  const n = order.length;
  if (n === 0) return [];
  const shift = ((state.turn % n) + n) % n;
  return [...order.slice(shift), ...order.slice(0, shift)];
};

/** Advance to the next turn: turn++, then every living player's start-of-turn. */
export const beginNextTurn = (ctx: SimCtx): void => {
  const { state } = ctx;
  state.turn++;
  pruneWars(state);
  pruneTradeRoutes(state);
  closeRoutesOverCapacity(ctx);
  for (const pid of startOfTurnOrder(state)) startOfTurnForPlayer(ctx, pid);
  state.currentPlayer = firstAlive(state) ?? state.currentPlayer;
  ctx.events.push({ type: 'turnStarted', turn: state.turn });
};

// --- World phase ------------------------------------------------------------------

/** Fallback goal when no player settlement exists: the nearest non-raider unit. */
const nearestUnit = (state: GameState, u: Unit): { q: number; r: number } | null => {
  let best: { q: number; r: number } | null = null;
  let bestD = Infinity;
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

/**
 * Raiders do not storm a player's settlement: a garrison or walls keep them out, as the
 * pillage notice promises (playtest 3: following the guide, one warrior per settlement, a
 * player still lost the garrison to wave after wave and then saw the town pillaged every turn).
 * They fight units in the open and pillage what nobody guards. City-states keep their old rule.
 */
const raiderMayStrike = (state: GameState, h: { q: number; r: number }): boolean => {
  const s = settlementAt(state, h);
  return !s || !state.players[s.owner];
};

const raiderAttack = (ctx: SimCtx, u: Unit, goal: { q: number; r: number }): boolean => {
  const targets = attackTargetsOf(ctx.state, u, ctx.content).filter((t) => raiderMayStrike(ctx.state, t));
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

/**
 * Raiders (GDD §5 "Collapse", src/sim/raids.ts) pillage an undefended settlement next to them;
 * otherwise they head for the nearest undefended settlement in reach (else the nearest
 * settlement), and fight whatever stands in their way.
 */
export const moveRaiders = (ctx: SimCtx): void => {
  const { state, content } = ctx;
  refreshUnitsOf(state, RAIDER_PLAYER, content);
  const ids = Object.keys(state.units).filter((id) => state.units[id]?.owner === RAIDER_PLAYER);
  for (const id of ids) {
    const u = state.units[id];
    if (!u) continue;
    const prey = pillageTarget(state, u);
    if (prey) {
      pillage(ctx, u, prey);
      continue;
    }
    const goal = raiderGoal(state, u) ?? nearestUnit(state, u);
    if (!goal) continue;
    const goalSettlement = settlementAt(state, goal);
    const raid = goalSettlement !== undefined && isUndefended(state, goalSettlement);
    // Bent on an easy raid, they fight only when something blocks the way.
    if (!raid && raiderAttack(ctx, u, goal)) continue;
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
      const reached = pillageTarget(state, u);
      if (reached) pillage(ctx, u, reached);
      else raiderAttack(ctx, u, goal);
    } else if (raid) {
      raiderAttack(ctx, u, goal);
    }
  }
  checkEliminations(ctx, null);
};

/** City-state walls heal when no hostile military unit is near (see `underSiege`). */
const healCityStates = (state: GameState): void => {
  for (const sid of Object.keys(state.settlements)) {
    const s = state.settlements[sid];
    if (!s || !isCityStateOwner(s.owner)) continue;
    if (!underSiege(state, s.owner, s.at)) s.hp = Math.min(s.maxHp, s.hp + WALL_HEAL_PER_TURN);
  }
};

export const worldPhase = (ctx: SimCtx): void => {
  moveRaiders(ctx);
  healCityStates(ctx.state);
  agesWorldPhase(ctx);
  warnOfRaiders(ctx);
};

/**
 * A player is blocked from ending the turn only by an open offer or an owed crisis response.
 * Offers do not block a player with no settlement: they cannot be accepted (no home for the
 * figure) and are withdrawn at the player's next turn start (src/emergence emergenceTick).
 */
export const endTurnBlocker = (state: GameState, player: PlayerId): string | null => {
  if (state.offers.some((o) => o.player === player) && playerSettlements(state, player).length > 0) return 'Answer the figure offer before ending your turn.';
  if (state.crisis?.awaiting.includes(player)) return 'Choose a response to the crisis before ending your turn.';
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

