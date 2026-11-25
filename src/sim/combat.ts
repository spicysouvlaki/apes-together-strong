/**
 * Combat (GDD §7 "Combat"):
 *   damage = 30 · e^(0.04 · (S_attacker − S_defender)) · r,  r ∈ [0.8, 1.2]
 * Ranged attacks take no return damage. Modifiers: terrain/feature defense, river crossing,
 * flanking, fortification, HP loss, `combat` modifiers (with `vs`), the commander aura, and
 * siege bonuses against settlements. A settlement falls when its walls are at 0 and a land
 * melee unit attacks it with no defender present.
 */
import type { ContentBundle, UnitClass } from '@contracts/content-schemas';
import { hexDistance, hexNeighbors, type Hex } from '@contracts/hex';
import {
  CITY_STATE_PREFIX,
  RAIDER_PLAYER,
  isCityStateOwner,
  warKey,
  type GameState,
  type PlayerId,
  type Settlement,
  type Unit,
  type UnitId,
} from '@contracts/sim-api';
import { onFigureUnitDefeated, onPlayerEliminated, onSettlementCaptured } from '../emergence';
import { addChronicle } from './chronicle';
import {
  COMBAT_BASE_DAMAGE,
  COMBAT_EXPONENT,
  COMBAT_RANDOM_MAX,
  COMBAT_RANDOM_MIN,
  EMBARKED_STRENGTH,
  FEATURE_DEFENSE,
  FLANKING_PER_UNIT,
  FORTIFY_BONUS,
  GARRISON_BONUS,
  HP_PER_STRENGTH_LOST,
  RAIDER_PILLAGE_GOLD,
  RIVER_CROSSING_PENALTY,
  SETTLEMENT_STRENGTH_BY_AGE,
  SETTLEMENT_STRENGTH_PER_POP,
  SETTLEMENT_STRENGTH_WALL_DIVISOR,
  UNIT_MAX_HP,
  WALL_BASE_HP,
  WORK_RADIUS,
} from './constants';
import type { SimCtx } from './ctx';
import { ci, isCivilian, isWater, playerSettlements, tileAt, tilesInRange, unitsAt } from './lookup';
import { combatBonus } from './modifiers';
import { nextRange } from './rng';
import { removeUnit, terrainAllows, unitEnv, unitModifiers } from './units';

/** Raiders are hostile to everyone; otherwise hostility needs a declared war (GDD §7). */
export const isHostile = (state: GameState, a: PlayerId, b: PlayerId): boolean => {
  if (a === b) return false;
  if (a === RAIDER_PLAYER || b === RAIDER_PLAYER) return true;
  return state.wars[warKey(a, b)] !== undefined;
};

export const combatDamage = (sa: number, sd: number, r: number): number =>
  Math.round(COMBAT_BASE_DAMAGE * Math.exp(COMBAT_EXPONENT * (sa - sd)) * r);

const hpPenalty = (hp: number): number => Math.floor((UNIT_MAX_HP - hp) / HP_PER_STRENGTH_LOST);

const isEmbarked = (state: GameState, u: Unit, content: ContentBundle): boolean => {
  if (u.unitClass === 'naval') return false;
  const t = tileAt(state.map, u.at);
  return !!t && !t.settlement && isWater(t, content);
};

const tileDefense = (state: GameState, at: Hex, content: ContentBundle): number => {
  const t = tileAt(state.map, at);
  if (!t) return 0;
  return (ci(content).terrain[t.terrain]?.defense ?? 0) + (t.feature ? (FEATURE_DEFENSE[t.feature] ?? 0) : 0);
};

export interface AttackTarget {
  at: Hex;
  unitClass: UnitClass | null;
  settlement: boolean;
}

export const attackStrength = (state: GameState, u: Unit, target: AttackTarget, ranged: boolean, content: ContentBundle): number => {
  const def = ci(content).units[u.type];
  if (!def) return 0;
  if (isEmbarked(state, u, content)) return EMBARKED_STRENGTH;
  let s = ranged ? (def.rangedStrength ?? def.strength) : def.strength;
  s += combatBonus(unitModifiers(state, u, content), unitEnv(state, u, content), target.unitClass);
  s -= hpPenalty(u.hp);
  if (target.settlement) s += def.siegeBonus;
  if (!ranged) {
    for (const n of hexNeighbors(target.at)) {
      if (n.q === u.at.q && n.r === u.at.r) continue;
      if (unitsAt(state, n).some((o) => o.owner === u.owner && !isCivilian(o))) s += FLANKING_PER_UNIT;
    }
    const from = tileAt(state.map, u.at);
    const to = tileAt(state.map, target.at);
    if (from?.river || to?.river) s -= RIVER_CROSSING_PENALTY;
  }
  return s;
};

export const defenseStrength = (state: GameState, u: Unit, attackerClass: UnitClass, content: ContentBundle): number => {
  const def = ci(content).units[u.type];
  if (!def) return 0;
  if (isEmbarked(state, u, content)) return EMBARKED_STRENGTH;
  let s = def.strength + tileDefense(state, u.at, content);
  if (u.fortified) s += FORTIFY_BONUS;
  s += combatBonus(unitModifiers(state, u, content), unitEnv(state, u, content), attackerClass);
  s -= hpPenalty(u.hp);
  const t = tileAt(state.map, u.at);
  const home = t?.settlement ? state.settlements[t.settlement] : undefined;
  if (home && home.owner === u.owner && home.hp > 0) s += GARRISON_BONUS;
  return s;
};

/** A settlement's own defense: scales with age and population, plus wall buildings and terrain. */
export const settlementStrength = (state: GameState, s: Settlement, content: ContentBundle): number =>
  SETTLEMENT_STRENGTH_BY_AGE[state.age] +
  SETTLEMENT_STRENGTH_PER_POP * s.population +
  Math.floor(Math.max(0, s.maxHp - WALL_BASE_HP) / SETTLEMENT_STRENGTH_WALL_DIVISOR) +
  tileDefense(state, s.at, content);

const roll = (state: GameState): number => nextRange(state, COMBAT_RANDOM_MIN, COMBAT_RANDOM_MAX);

// --- Deaths, captures, elimination ----------------------------------------------

const recordWin = (state: GameState, victor: PlayerId): void => {
  const p = state.players[victor];
  if (!p) return;
  p.stats.battlesWon++;
  p.stats.battlesWonThisTurn++;
  p.stats.battlesWonThisAge++;
};

/** A unit dies: figure-units go to the emergence engine instead of being deleted. */
export const killUnit = (ctx: SimCtx, unitId: UnitId, victor: PlayerId): void => {
  const u = ctx.state.units[unitId];
  if (!u) return;
  const loser = ctx.state.players[u.owner];
  if (loser) loser.stats.unitsLost++;
  if (u.figure) onFigureUnitDefeated(ctx, unitId, victor);
  else removeUnit(ctx, unitId);
};

/** Players with no settlements and no settler are out (GDD §3: the eliminator takes their figures). */
export const checkEliminations = (ctx: SimCtx, by: PlayerId | null): void => {
  const { state, content } = ctx;
  for (const pid of state.playerOrder) {
    const p = state.players[pid];
    if (!p || !p.alive) continue;
    if (playerSettlements(state, pid).length > 0) continue;
    const hasSettler = Object.keys(state.units).some((id) => {
      const u = state.units[id];
      return !!u && u.owner === pid && !!ci(content).units[u.type]?.canFound;
    });
    if (hasSettler) continue;
    p.alive = false;
    const taker = by && state.players[by] ? by : null;
    onPlayerEliminated(ctx, pid, taker);
    for (const id of Object.keys(state.units)) if (state.units[id]?.owner === pid) removeUnit(ctx, id);
    ctx.events.push({ type: 'playerEliminated', player: pid, by: taker });
    if (taker) addChronicle(state, taker, 'war', pid, `A rival people fell to us.`);
  }
};

export const captureSettlement = (ctx: SimCtx, s: Settlement, to: PlayerId, attacker: Unit): void => {
  const { state } = ctx;
  const from = s.owner;
  // Tiles this settlement worked follow it to the new owner.
  const fromSettlements = playerSettlements(state, from);
  for (const t of tilesInRange(state.map, s.at, WORK_RADIUS)) {
    if (t.owner !== from) continue;
    let best: Settlement | undefined;
    let bestD = Infinity;
    for (const o of fromSettlements) {
      const d = hexDistance(o.at, t);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (best?.id === s.id) t.owner = to;
  }
  const wasCapital = s.isCapital;
  s.owner = to;
  s.population = Math.max(1, s.population - 1);
  s.production = { item: null, progress: 0 };
  s.siegeTurns = 0;
  s.isCapital = !playerSettlements(state, to).some((o) => o.isCapital && o.id !== s.id);
  if (s.isCapital) s.kind = 'city';
  // Leftover enemy civilians on the tile are lost.
  for (const u of unitsAt(state, s.at)) if (u.owner !== to) killUnit(ctx, u.id, to);
  attacker.at = { q: s.at.q, r: s.at.r };
  state.tradeRoutes = state.tradeRoutes.filter((r) => r.from !== s.id && r.to !== s.id);
  if (isCityStateOwner(from)) {
    const cs = state.cityStates[from.slice(CITY_STATE_PREFIX.length)];
    if (cs) {
      cs.alive = false;
      if (cs.suzerain !== null) {
        cs.suzerain = null;
        ctx.events.push({ type: 'suzerainChanged', cityState: cs.id, suzerain: null });
      }
    }
  } else if (wasCapital) {
    const next = playerSettlements(state, from)[0];
    if (next) {
      next.isCapital = true;
      next.kind = 'city';
    }
  }
  onSettlementCaptured(ctx, s.id, from, to);
  const p = state.players[to];
  if (p) {
    p.stats.citiesCaptured++;
    p.stats.citiesCapturedThisTurn++;
  }
  ctx.events.push({ type: 'settlementCaptured', settlement: s.id, from, to });
  addChronicle(state, to, 'war', s.id, `${s.name} was taken.`);
  addChronicle(state, from, 'war', s.id, `${s.name} was lost.`);
  checkEliminations(ctx, to);
};

// --- The attack command ---------------------------------------------------------

export interface AttackPlan {
  ranged: boolean;
  defender: Unit | null;
  settlement: Settlement | null;
  civilians: Unit[];
}

/** What attacking `target` with `u` would hit, or an error. Shared by the command and the query. */
export const planAttack = (state: GameState, u: Unit, target: Hex, content: ContentBundle): AttackPlan | string => {
  const def = ci(content).units[u.type];
  if (!def) return 'Unknown unit';
  if (u.hasAttacked) return 'Already attacked this turn';
  if (u.movesLeft <= 0) return 'No moves left';
  const canRanged = def.rangedStrength !== undefined && def.range !== undefined;
  if (def.strength <= 0 && !canRanged) return 'This unit cannot attack';
  const tile = tileAt(state.map, target);
  if (!tile) return 'Off the map';
  const dist = hexDistance(u.at, target);
  if (dist < 1) return 'Cannot attack your own tile';
  if (canRanged ? dist > (def.range ?? 0) : dist !== 1) return 'Out of range';
  const there = unitsAt(state, target);
  const defender = there.find((o) => o.owner !== u.owner && !isCivilian(o)) ?? null;
  const civilians = there.filter((o) => o.owner !== u.owner && isCivilian(o));
  const sRaw = tile.settlement ? state.settlements[tile.settlement] : undefined;
  const settlement = sRaw && sRaw.owner !== u.owner ? sRaw : null;
  const enemyOwner = defender?.owner ?? settlement?.owner ?? civilians[0]?.owner;
  if (enemyOwner === undefined) return 'Nothing to attack there';
  if (!isHostile(state, u.owner, enemyOwner)) return 'Not at war with them';
  if (!defender && !settlement && canRanged) return 'Ranged units cannot capture civilians';
  if (settlement && !defender && settlement.hp <= 0 && canRanged) return 'Walls are down: a melee unit must take it';
  return { ranged: canRanged, defender, settlement, civilians };
};

export const attack = (ctx: SimCtx, player: PlayerId, unitId: UnitId, target: Hex): string | null => {
  const { state, content } = ctx;
  const u = state.units[unitId];
  if (!u || u.owner !== player) return 'Not your unit';
  const plan = planAttack(state, u, target, content);
  if (typeof plan === 'string') return plan;
  resolveAttack(ctx, u, target, plan);
  return null;
};

/** Apply a validated attack. Also used by raiders in the world phase. */
export const resolveAttack = (ctx: SimCtx, u: Unit, target: Hex, plan: AttackPlan): void => {
  const { state, content } = ctx;
  const { ranged, defender, settlement, civilians } = plan;
  u.hasAttacked = true;
  u.fortified = false;
  u.movesLeft = 0;
  const attackerId = u.id;
  let dmgToA = 0;
  let dmgToD = 0;
  let attackerDied = false;
  let defenderDied = false;
  let defenderOwner: PlayerId;

  if (defender) {
    defenderOwner = defender.owner;
    const sa = attackStrength(state, u, { at: target, unitClass: defender.unitClass, settlement: false }, ranged, content);
    const sd = defenseStrength(state, defender, u.unitClass, content);
    dmgToD = combatDamage(sa, sd, roll(state));
    dmgToA = ranged ? 0 : combatDamage(sd, sa, roll(state));
    defender.hp -= dmgToD;
    u.hp -= dmgToA;
    if (defender.hp <= 0 && u.hp <= 0) u.hp = 1; // the attacker staggers home
    defenderDied = defender.hp <= 0;
    attackerDied = u.hp <= 0;
    if (defenderDied) {
      recordWin(state, u.owner);
      killUnit(ctx, defender.id, u.owner);
    }
    if (attackerDied) {
      recordWin(state, defender.owner);
      killUnit(ctx, attackerId, defender.owner);
    }
    if (defenderDied && !ranged && !settlement && !attackerDied) {
      for (const c of civilians) killUnit(ctx, c.id, u.owner);
      advanceInto(state, u, target, content);
    }
  } else if (settlement) {
    defenderOwner = settlement.owner;
    if (settlement.hp > 0) {
      const sa = attackStrength(state, u, { at: target, unitClass: null, settlement: true }, ranged, content);
      const sd = settlementStrength(state, settlement, content);
      dmgToD = Math.min(settlement.hp, combatDamage(sa, sd, roll(state)));
      dmgToA = ranged ? 0 : combatDamage(sd, sa, roll(state));
      settlement.hp -= dmgToD;
      u.hp -= dmgToA;
      if (u.hp <= 0) {
        attackerDied = true;
        killUnit(ctx, attackerId, settlement.owner);
      }
    } else if (u.owner === RAIDER_PLAYER) {
      // Raiders pillage rather than rule (GDD §5 "Collapse"), then scatter with their loot,
      // so a broken settlement is not pillaged every turn while its walls cannot heal.
      settlement.population = Math.max(1, settlement.population - 1);
      const victim = state.players[settlement.owner];
      if (victim) victim.stock.gold = Math.max(0, victim.stock.gold - RAIDER_PILLAGE_GOLD);
      ctx.events.push({ type: 'notice', player: settlement.owner, text: `Raiders pillaged ${settlement.name}.` });
      removeUnit(ctx, attackerId);
    } else if (u.unitClass !== 'naval') {
      defenderDied = true;
      captureSettlement(ctx, settlement, u.owner, u);
    }
  } else {
    // Only civilians: they are lost and the attacker moves in.
    defenderOwner = civilians[0]?.owner ?? '';
    defenderDied = true;
    recordWin(state, u.owner);
    for (const c of civilians) killUnit(ctx, c.id, u.owner);
    advanceInto(state, u, target, content);
  }

  ctx.events.push({
    type: 'combat',
    attacker: attackerId,
    attackerOwner: u.owner,
    defenderOwner,
    defender: defender?.id ?? null,
    at: { q: target.q, r: target.r },
    damageToAttacker: dmgToA,
    damageToDefender: dmgToD,
    attackerDied,
    defenderDied,
  });
};

const advanceInto = (state: GameState, u: Unit, target: Hex, content: ContentBundle): void => {
  const tile = tileAt(state.map, target);
  if (!tile || !state.units[u.id]) return;
  const def = ci(content).units[u.type];
  if (!def || !terrainAllows(state, u.owner, def, tile, content, false)) return;
  if (unitsAt(state, target).length > 0) return;
  u.at = { q: target.q, r: target.r };
};

/** Every tile `u` could attack right now (for the UI and AI). */
export const attackTargetsOf = (state: GameState, u: Unit, content: ContentBundle): Hex[] => {
  const def = ci(content).units[u.type];
  if (!def) return [];
  const range = def.rangedStrength !== undefined && def.range !== undefined ? def.range : 1;
  const out: Hex[] = [];
  for (const t of tilesInRange(state.map, u.at, range)) {
    if (t.q === u.at.q && t.r === u.at.r) continue;
    if (typeof planAttack(state, u, t, content) !== 'string') out.push({ q: t.q, r: t.r });
  }
  return out;
};
