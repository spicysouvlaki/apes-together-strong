/**
 * Tactical layer (GDD §9 "per-unit scoring"): settlers found towns at good sites, scouts walk
 * to the nearest unexplored land, merchants open routes, and the army garrisons settlements,
 * answers raiders and invaders, and in wartime gathers and attacks the nearest enemy settlement
 * without suiciding weak units. Movement over several turns follows land distance fields.
 */
import { hexDistance, type Hex } from '@contracts/hex';
import type { Settlement, Unit } from '@contracts/sim-api';
import { attackStrength, defenseStrength, planAttack, settlementStrength } from '../sim/combat';
import { tradeRouteCap } from '../sim/diplomacy';
import { ci, tileIndex } from '../sim/lookup';
import { queries } from '../sim/queries';
import { exec, me, type AiCtx } from './ctx';
import type { EmpirePlan } from './economy';
import { pickWarTarget } from './war';
import { ownedLuxuries, siteLegal, siteScore } from './sites';
import { UNREACHABLE, landField, landStepCost } from './util';
import { enemiesAtWar, hostilesNear, isMilitary, ownSettlements, ownUnits } from './world';

const unitById = (ai: AiCtx, id: string): Unit | undefined => ai.state.units[id];

/**
 * Move a unit one turn along `field` (lower is closer). Never ends on a tile with field below
 * `minField` (to stop short of a target). Returns true when it moved.
 */
export const moveAlong = (ai: AiCtx, unitId: string, field: Int32Array, minField = 0): boolean => {
  const u = unitById(ai, unitId);
  if (!u || u.movesLeft <= 0) return false;
  const here = field[tileIndex(ai.state.map, u.at)] ?? UNREACHABLE;
  let best: Hex | null = null;
  let bestF = here;
  let bestCost = Infinity;
  for (const r of queries.reachable(ai.state, unitId, ai.content)) {
    const f = field[tileIndex(ai.state.map, r.hex)] ?? UNREACHABLE;
    if (f < minField || f >= UNREACHABLE) continue;
    if (f < bestF || (f === bestF && best !== null && r.cost < bestCost)) {
      bestF = f;
      best = r.hex;
      bestCost = r.cost;
    }
  }
  if (!best || bestF >= here) return false;
  return exec(ai, { type: 'moveUnit', unit: unitId, to: best });
};

const idxOf = (ai: AiCtx, h: Hex): number => tileIndex(ai.state.map, h);

const ownSettlementField = (ai: AiCtx): Int32Array =>
  landField(ai.state, ai.content, ownSettlements(ai.state, ai.player).map((s) => idxOf(ai, s.at)), 60, ai.player);

// --- Settlers -----------------------------------------------------------------------

/** Turn-1 capital: found where the settler stands unless a clearly better spot is in reach. */
const foundCapital = (ai: AiCtx, u: Unit): void => {
  const { state, player, content } = ai;
  const lux = ownedLuxuries(state, player, content);
  const hereIdx = idxOf(ai, u.at);
  const here = siteLegal(state, player, hereIdx, content) ? siteScore(state, player, hereIdx, content, ai.persona, lux) : -Infinity;
  let best: Hex | null = null;
  let bestScore = here;
  if (state.turn <= 2) {
    for (const r of queries.reachable(state, u.id, content)) {
      const i = idxOf(ai, r.hex);
      if (!siteLegal(state, player, i, content)) continue;
      const s = siteScore(state, player, i, content, ai.persona, lux);
      if (s > bestScore * 1.15 + 2) {
        bestScore = s;
        best = r.hex;
      }
    }
  }
  if (best) exec(ai, { type: 'moveUnit', unit: u.id, to: best });
  if (!exec(ai, { type: 'foundSettlement', unit: u.id })) {
    // Not legal here (rare): walk to any legal reachable tile and found.
    for (const r of queries.reachable(ai.state, u.id, content)) {
      if (!siteLegal(ai.state, player, idxOf(ai, r.hex), content)) continue;
      if (exec(ai, { type: 'moveUnit', unit: u.id, to: r.hex }) && exec(ai, { type: 'foundSettlement', unit: u.id })) return;
    }
  }
};

export const moveSettlers = (ai: AiCtx, plan: EmpirePlan): void => {
  const { content } = ai;
  const settlers = ownUnits(ai.state, ai.player).filter((u) => ci(content).units[u.type]?.canFound);
  for (const s0 of settlers) {
    const u = unitById(ai, s0.id);
    if (!u) continue;
    if (ownSettlements(ai.state, ai.player).length === 0) {
      foundCapital(ai, u);
      continue;
    }
    if (hostilesNear(ai.state, ai.player, u.at, 2).length > 0) {
      const t = ai.state.map.tiles[idxOf(ai, u.at)];
      if (!t?.settlement) moveAlong(ai, u.id, ownSettlementField(ai));
      continue;
    }
    // Best unclaimed site by score minus travel.
    const fromHere = landField(ai.state, content, [idxOf(ai, u.at)], 40);
    let target = -1;
    let bestScore = -Infinity;
    for (const site of plan.sites) {
      if (ai.claimedSites.includes(site.idx)) continue;
      const d = fromHere[site.idx] ?? UNREACHABLE;
      if (d >= UNREACHABLE) continue;
      const s = site.score - d * 0.8;
      if (s > bestScore) {
        bestScore = s;
        target = site.idx;
      }
    }
    if (target < 0) {
      // Nowhere to go: wait in a city.
      continue;
    }
    ai.claimedSites.push(target);
    const hereIdx = idxOf(ai, u.at);
    if (hereIdx === target) {
      exec(ai, { type: 'foundSettlement', unit: u.id });
      continue;
    }
    moveAlong(ai, u.id, landField(ai.state, content, [target], 60));
    const after = unitById(ai, u.id);
    if (after && idxOf(ai, after.at) === target) exec(ai, { type: 'foundSettlement', unit: u.id });
  }
};

// --- Scouts and merchants -------------------------------------------------------------

const isScout = (ai: AiCtx, u: Unit): boolean => {
  const d = ci(ai.content).units[u.type];
  return !!d && d.unitClass === 'civilian' && !d.canFound && !d.canTrade && !d.figureKind;
};

export const moveScouts = (ai: AiCtx): void => {
  const scouts = ownUnits(ai.state, ai.player).filter((u) => isScout(ai, u));
  if (scouts.length === 0) return;
  const explored = me(ai).explored;
  const sources: number[] = [];
  ai.state.map.tiles.forEach((t, i) => {
    if (!explored[i] && landStepCost(t, ai.content) > 0) sources.push(i);
  });
  const field = sources.length ? landField(ai.state, ai.content, sources, 80) : null;
  for (const s of scouts) {
    if (hostilesNear(ai.state, ai.player, s.at, 2).length > 0) {
      moveAlong(ai, s.id, ownSettlementField(ai));
      continue;
    }
    if (field && (field[idxOf(ai, s.at)] ?? UNREACHABLE) < UNREACHABLE && moveAlong(ai, s.id, field)) continue;
    // Nothing left to explore by land: go home and stay alive.
    const t = ai.state.map.tiles[idxOf(ai, s.at)];
    if (t?.owner !== ai.player) moveAlong(ai, s.id, ownSettlementField(ai));
  }
};

const merchantDestination = (ai: AiCtx, u: Unit): Settlement | null => {
  const { state, player } = ai;
  const home = ownSettlements(state, player);
  const enemies = enemiesAtWar(state, player);
  let best: Settlement | null = null;
  let bestD = Infinity;
  for (const id of Object.keys(state.settlements)) {
    const s = state.settlements[id];
    if (!s || s.owner === player || enemies.includes(s.owner)) continue;
    if (state.tradeRoutes.some((r) => r.owner === player && r.to === s.id)) continue;
    if (!home.some((h) => hexDistance(h.at, s.at) <= 10)) continue;
    const d = hexDistance(u.at, s.at);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
};

export const moveMerchants = (ai: AiCtx): void => {
  const merchants = ownUnits(ai.state, ai.player).filter((u) => ci(ai.content).units[u.type]?.canTrade && !u.figure);
  for (const m of merchants) {
    const open = (): boolean => {
      const owned = ai.state.tradeRoutes.filter((r) => r.owner === ai.player).length;
      if (owned >= tradeRouteCap(ai.state, ai.player, ai.content)) return false;
      const targets = queries.tradeTargets(ai.state, m.id, ai.content);
      for (const t of targets) if (exec(ai, { type: 'openTradeRoute', unit: m.id, to: t })) return true;
      return false;
    };
    if (open()) continue;
    const dest = merchantDestination(ai, m);
    if (!dest) continue;
    moveAlong(ai, m.id, landField(ai.state, ai.content, [idxOf(ai, dest.at)], 40, ai.player), 1);
    if (unitById(ai, m.id)) open();
  }
};

// --- Military -------------------------------------------------------------------------

const expectedDamage = (sa: number, sd: number): number => 30 * Math.exp(0.04 * (sa - sd));

/** Utility of attacking `target` with `u` (−Infinity = don't). */
const attackScore = (ai: AiCtx, u: Unit, target: Hex): number => {
  const { state, content } = ai;
  const plan = planAttack(state, u, target, content);
  if (typeof plan === 'string') return -Infinity;
  const commander = u.unitClass === 'commander';
  if (plan.defender) {
    const d = plan.defender;
    const sa = attackStrength(state, u, { at: target, unitClass: d.unitClass, settlement: false }, plan.ranged, content);
    const sd = defenseStrength(state, d, u.unitClass, content);
    const dmgD = expectedDamage(sa, sd);
    const dmgA = plan.ranged ? 0 : expectedDamage(sd, sa);
    if (dmgA * 1.25 >= u.hp) return -Infinity;
    const kill = dmgD * 0.85 >= d.hp;
    if (commander && !kill) return -Infinity;
    if (!plan.ranged && !kill && dmgA > dmgD * 1.2) return -Infinity;
    return (Math.min(dmgD, d.hp) / d.hp) * 10 + (kill ? 12 : 0) - (dmgA / u.hp) * 8 + (d.figure ? 4 : 0);
  }
  if (plan.settlement) {
    const s = plan.settlement;
    if (s.hp <= 0) return 60; // walls down, melee walks in (planAttack already checked it may)
    if (commander) return -Infinity;
    const sa = attackStrength(state, u, { at: target, unitClass: null, settlement: true }, plan.ranged, content);
    const sd = settlementStrength(state, s, content);
    const dmgD = Math.min(s.hp, expectedDamage(sa, sd));
    const dmgA = plan.ranged ? 0 : expectedDamage(sd, sa);
    if (dmgA * 1.4 >= u.hp) return -Infinity;
    return dmgD / 8 - (dmgA / u.hp) * 6 + 1;
  }
  return 15; // undefended civilians
};

const tryAttack = (ai: AiCtx, unitId: string): boolean => {
  const u = unitById(ai, unitId);
  if (!u || u.hasAttacked || u.movesLeft <= 0) return false;
  let best: Hex | null = null;
  let bestScore = 0;
  for (const t of queries.attackTargets(ai.state, unitId, ai.content)) {
    const s = attackScore(ai, u, t);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return best !== null && exec(ai, { type: 'attack', unit: unitId, target: best });
};

const onOwnSettlement = (ai: AiCtx, u: Unit): Settlement | null => {
  const t = ai.state.map.tiles[idxOf(ai, u.at)];
  const s = t?.settlement ? ai.state.settlements[t.settlement] : undefined;
  return s && s.owner === ai.player ? s : null;
};

const fortifyIfIdle = (ai: AiCtx, u: Unit): void => {
  const cur = unitById(ai, u.id);
  if (cur && !cur.fortified && cur.movesLeft > 0 && cur.unitClass !== 'commander') exec(ai, { type: 'fortify', unit: u.id });
};

export const moveMilitary = (ai: AiCtx, plan?: EmpirePlan): void => {
  const { state, player, content } = ai;
  const mine = (): Unit[] => ownUnits(ai.state, player).filter(isMilitary);
  // Ranged first so melee can finish what they soften.
  const order = mine().sort((a, b) => {
    const ar = ci(content).units[a.type]?.rangedStrength ? 0 : 1;
    const br = ci(content).units[b.type]?.rangedStrength ? 0 : 1;
    return ar - br || (a.id < b.id ? -1 : 1);
  });
  for (const u of order) tryAttack(ai, u.id);

  const settlements = ownSettlements(ai.state, player);
  const busy = new Set<string>();

  // Garrisons: the unit standing in a settlement stays; empty settlements call the nearest free unit.
  for (const s of settlements) {
    const g = mine().find((u) => u.at.q === s.at.q && u.at.r === s.at.r && u.unitClass !== 'commander');
    if (g) {
      busy.add(g.id);
      fortifyIfIdle(ai, g);
    }
  }
  for (const s of settlements) {
    if (mine().some((u) => u.at.q === s.at.q && u.at.r === s.at.r && u.unitClass !== 'commander')) continue;
    let pick: Unit | null = null;
    let bestD = 9;
    for (const u of mine()) {
      if (busy.has(u.id) || u.unitClass === 'commander' || u.movesLeft <= 0) continue;
      const d = hexDistance(u.at, s.at);
      if (d < bestD) {
        bestD = d;
        pick = u;
      }
    }
    if (!pick) continue;
    busy.add(pick.id);
    moveAlong(ai, pick.id, landField(ai.state, content, [idxOf(ai, s.at)], 30, player));
    const after = unitById(ai, pick.id);
    if (after && after.at.q === s.at.q && after.at.r === s.at.r) fortifyIfIdle(ai, after);
  }

  // Threats near home: raiders and invaders within 3 of a settlement. Each gets up to two
  // responders (nearest free units within 6); everyone else keeps to the war plan.
  const threats: Unit[] = [];
  for (const s of settlements) for (const h of hostilesNear(ai.state, player, s.at, 3)) if (!threats.some((t) => t.id === h.id)) threats.push(h);
  const respond = new Map<string, Unit>();
  for (const t of threats) {
    const free = mine()
      .filter((u) => !busy.has(u.id) && !respond.has(u.id) && u.hp >= 45 && hexDistance(u.at, t.at) <= 6)
      .sort((a, b) => hexDistance(a.at, t.at) - hexDistance(b.at, t.at) || (a.id < b.id ? -1 : 1));
    for (const u of free.slice(0, 2)) respond.set(u.id, t);
  }
  const enemies = enemiesAtWar(ai.state, player);
  // The war goal is the same settlement the war was declared for (src/ai/war.ts), re-scored
  // each turn from public information, so the whole army converges on one place.
  const goal = enemies.length > 0 ? pickWarTarget(ai, enemies) : null;
  const target = goal?.settlement ?? null;
  const targetField = target ? landField(ai.state, content, [idxOf(ai, target.at)], 80, player) : null;
  // Gather: only close in once three units stand within 5 of the target (counted once per turn).
  const massed = target ? mine().filter((m) => m.unitClass !== 'commander' && hexDistance(m.at, target.at) <= 5).length >= 3 : false;
  const homeField = ownSettlementField(ai);
  // Preparing a war: free units stage in our settlement nearest the goal, inside our borders.
  const prepGoal = !target && plan?.preparing ? plan.warGoal : null;
  let stagingField: Int32Array | null = null;
  if (prepGoal) {
    let staging: Settlement | null = null;
    let bestD = Infinity;
    for (const s of settlements) {
      const d = hexDistance(s.at, prepGoal.settlement.at);
      if (d < bestD) {
        bestD = d;
        staging = s;
      }
    }
    if (staging) stagingField = landField(ai.state, content, [idxOf(ai, staging.at)], 40, player);
  }

  for (const u0 of mine()) {
    if (busy.has(u0.id)) continue;
    const u = unitById(ai, u0.id);
    if (!u) continue;
    // Wounded units fall back to heal.
    if (u.hp < 45 && !onOwnSettlement(ai, u)) {
      moveAlong(ai, u.id, homeField);
      continue;
    }
    if (u.hp < 45) continue;
    const threat = respond.get(u.id);
    if (threat && state.units[threat.id]) {
      moveAlong(ai, u.id, landField(ai.state, content, [idxOf(ai, threat.at)], 20), 1);
      tryAttack(ai, u.id);
      continue;
    }
    if (target && targetField) {
      const d = targetField[idxOf(ai, u.at)] ?? UNREACHABLE;
      if (d < UNREACHABLE) {
        const ranged = ci(content).units[u.type]?.rangedStrength !== undefined;
        tryAttack(ai, u.id);
        moveAlong(ai, u.id, targetField, massed ? (ranged ? 2 : 1) : 4);
        tryAttack(ai, u.id);
        continue;
      }
    }
    if (stagingField && u.unitClass !== 'commander' && (stagingField[idxOf(ai, u.at)] ?? UNREACHABLE) > 2) {
      moveAlong(ai, u.id, stagingField, 1);
      continue;
    }
    const tile = ai.state.map.tiles[idxOf(ai, u.at)];
    if (tile?.owner !== player) {
      moveAlong(ai, u.id, homeField);
      continue;
    }
    fortifyIfIdle(ai, u);
  }
};
