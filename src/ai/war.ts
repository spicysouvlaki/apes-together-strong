/**
 * War and peace (GDD §9 "operational: settle/build/war goals"). Kept simple and readable:
 *
 * - A war has a goal: one enemy settlement, preferably a poorly defended border town
 *   (`pickWarTarget`). Every AI scores the same public information — unit positions, walls,
 *   population — and treats a human neighbour exactly like an AI one.
 * - Aggressive personalities (warmonger, opportunist; expansionists boxed in) first build a
 *   strike force with ranged or siege support near the border (`warPreparation`), and declare
 *   only once it clearly outmatches the target's local defence. Any AI may pounce on an almost
 *   undefended neighbour.
 * - Peace: the attacker settles after taking a town (or when the war stalls or turns against
 *   it); the defender sues as soon as it is losing. A rival's last settlement is not a goal in
 *   the ancient age, so eliminations stay rare before the classical age.
 */
import { hexDistance } from '@contracts/hex';
import { warKey, type PlayerId, type Settlement } from '@contracts/sim-api';
import { MIN_WAR_TURNS, PEACE_INFLUENCE_COST } from '../sim/constants';
import { WAR_DECLARED_TEXT } from '../sim/diplomacy';
import { ci, tileAt } from '../sim/lookup';
import { exec, me, type AiCtx } from './ctx';
import { hashStr } from './util';
import { enemiesAtWar, militaryPower, ownSettlements } from './world';

/** No AI starts a war before this turn. */
export const EARLIEST_WAR_TURN = 20;
/** Max distance between our nearest settlement and the goal settlement. */
export const MAX_WAR_DISTANCE = 11;
/** Our units within this distance of the goal count toward the strike force. */
export const STRIKE_RADIUS = 7;
/** Enemy units within this distance of the goal defend it. */
const LOCAL_DEFENSE_RADIUS = 3;
/** After this many turns of war without a capture, a stalemate ends in peace. */
const STALEMATE_TURNS = 22;
/** A war that has taken a settlement ends this many turns after the capture (consolidate). */
const CONSOLIDATE_TURNS = 3;
/** No new war on the same rival this soon after the last declaration on them. */
const REDECLARE_TURNS = 30;

export interface WarTarget {
  rival: PlayerId;
  settlement: Settlement;
  /** Our nearest settlement's distance to it. */
  distance: number;
  /** Enemy power standing within LOCAL_DEFENSE_RADIUS plus the walls' own strength. */
  defense: number;
}

const unitPower = (ai: AiCtx, type: string, hp: number): number => {
  const def = ci(ai.content).units[type];
  if (!def) return 0;
  return Math.max(def.strength, def.rangedStrength ?? 0) * (0.5 + hp / 200);
};

/** Our military near `at`: total power, unit count, and whether ranged or siege support is there. */
export const strikeForce = (ai: AiCtx, at: { q: number; r: number }, radius = STRIKE_RADIUS): { power: number; units: number; support: boolean } => {
  let power = 0;
  let units = 0;
  let support = false;
  for (const id of Object.keys(ai.state.units)) {
    const u = ai.state.units[id];
    if (!u || u.owner !== ai.player || u.unitClass === 'civilian' || u.unitClass === 'naval') continue;
    if (hexDistance(u.at, at) > radius) continue;
    power += unitPower(ai, u.type, u.hp);
    units++;
    const def = ci(ai.content).units[u.type];
    if (def && (def.rangedStrength !== undefined || def.siegeBonus > 0)) support = true;
  }
  return { power, units, support };
};

const localDefense = (ai: AiCtx, s: Settlement): number => {
  let power = 0;
  for (const id of Object.keys(ai.state.units)) {
    const u = ai.state.units[id];
    if (!u || u.owner !== s.owner || u.unitClass === 'civilian') continue;
    if (hexDistance(u.at, s.at) > LOCAL_DEFENSE_RADIUS) continue;
    // A garrison inside the walls counts double (it fights with the garrison bonus behind walls).
    const inside = u.at.q === s.at.q && u.at.r === s.at.r;
    power += unitPower(ai, u.type, u.hp) * (inside ? 1.6 : 1);
  }
  // The walls fight too: roughly a unit of the age's strength while they stand.
  return power + (s.hp / s.maxHp) * 15 + s.population;
};

/**
 * The best settlement of `rivals` to take: close to our border, weakly held, smaller, and on our
 * landmass. A rival's last settlement is skipped in the ancient age (eliminations stay rare).
 */
export const pickWarTarget = (ai: AiCtx, rivals: readonly PlayerId[]): WarTarget | null => {
  const { state } = ai;
  const own = ownSettlements(state, ai.player);
  if (own.length === 0) return null;
  const continent = (h: { q: number; r: number }): number => tileAt(state.map, h)?.continent ?? -1;
  const ours = new Set(own.map((s) => continent(s.at)));
  let best: WarTarget | null = null;
  let bestScore = -Infinity;
  for (const rival of rivals) {
    const theirs = ownSettlements(state, rival);
    if (theirs.length === 0) continue;
    for (const s of theirs) {
      if (!ours.has(continent(s.at))) continue;
      if (theirs.length === 1 && state.age === 'ancient') continue;
      let distance = Infinity;
      for (const o of own) distance = Math.min(distance, hexDistance(o.at, s.at));
      if (distance > MAX_WAR_DISTANCE) continue;
      const defense = localDefense(ai, s);
      // Prefer towns over capitals, close over far, and weak over strong.
      const score = -defense * 0.5 - distance * 1.5 - (s.isCapital ? 6 : 0) + (s.kind === 'town' ? 2 : 0) + s.population * 0.3;
      if (score > bestScore || (score === bestScore && best !== null && s.id < best.settlement.id)) {
        bestScore = score;
        best = { rival, settlement: s, distance, defense };
      }
    }
  }
  return best;
};

/** How eager this personality is to start wars (0 = never on its own initiative). */
export const aggression = (ai: AiCtx): number => {
  const pe = ai.persona;
  return pe.w.warmonger + 0.6 * pe.w.opportunist + 0.3 * pe.w.expansionist;
};

const lastDeclaredOn = (ai: AiCtx, rival: PlayerId): number => {
  const chron = me(ai).chronicle;
  for (let i = chron.length - 1; i >= 0; i--) {
    const e = chron[i];
    if (e && e.kind === 'war' && e.ref === rival && e.text === WAR_DECLARED_TEXT) return e.turn;
  }
  return -Infinity;
};

/** Living rivals we have not declared on recently (so wars do not follow one another back to back). */
const livingRivals = (ai: AiCtx): PlayerId[] =>
  ai.state.playerOrder.filter(
    (id) => id !== ai.player && ai.state.players[id]?.alive === true && ai.state.turn - lastDeclaredOn(ai, id) >= REDECLARE_TURNS,
  );

/**
 * The war this AI is building toward (no declaration yet), or null. Used by the economy to
 * raise and shape the army, and by the tactical layer to stage units on the border.
 */
export const warPreparation = (ai: AiCtx): WarTarget | null => {
  const { state } = ai;
  if (aggression(ai) <= 0 || state.turn < EARLIEST_WAR_TURN - 8) return null;
  if (enemiesAtWar(state, ai.player).length > 0) return null;
  const target = pickWarTarget(ai, livingRivals(ai));
  if (!target) return null;
  const mine = militaryPower(state, ai.player, ai.content);
  const theirs = Math.max(1, militaryPower(state, target.rival, ai.content));
  // Only prepare against someone we can plausibly beat: not when they out-arm us badly.
  return mine * (1 + 0.4 * aggression(ai)) >= theirs ? target : null;
};

export const considerWar = (ai: AiCtx, _military: number): void => {
  const { state, player, content } = ai;
  if (state.turn < EARLIEST_WAR_TURN) return;
  if (enemiesAtWar(state, player).length > 0) return;
  // Consider it now and then, not every turn.
  if (hashStr(`${state.seed}|${player}|war|${Math.floor(state.turn / 3)}`) % 3 !== 0) return;
  const aggr = aggression(ai);
  const target = pickWarTarget(ai, livingRivals(ai));
  if (!target) return;
  const force = strikeForce(ai, target.settlement.at);
  const mine = militaryPower(state, player, content);
  const theirs = Math.max(1, militaryPower(state, target.rival, content));
  // Aggressive AIs strike with a real local edge and support; everyone pounces on a neighbour
  // whose border town is nearly undefended while their whole army is far smaller than ours.
  const ready =
    aggr > 0
      ? force.units >= 3 && force.support && force.power >= target.defense * (1.9 - 0.25 * Math.min(2, aggr)) && mine >= theirs * (1.25 - 0.1 * Math.min(2, aggr))
      : force.units >= 3 && force.power >= target.defense * 3 && mine >= theirs * 2.2;
  if (ready) exec(ai, { type: 'declareWar', target: target.rival });
};

/** Turn of our latest capture since `since` (this war), or null. Read from our own chronicle. */
const lastCaptureTurn = (ai: AiCtx, since: number): number | null => {
  const chron = me(ai).chronicle;
  for (let i = chron.length - 1; i >= 0; i--) {
    const e = chron[i];
    if (!e || e.turn < since) break;
    if (e.kind === 'war' && e.text.endsWith(' was taken.')) return e.turn;
  }
  return null;
};

export const considerPeace = (ai: AiCtx): void => {
  const { state, player, content } = ai;
  for (const enemy of enemiesAtWar(state, player)) {
    const began = state.wars[warKey(player, enemy)];
    if (began === undefined || state.turn - began < MIN_WAR_TURNS) continue;
    if (me(ai).stock.influence < PEACE_INFLUENCE_COST) continue;
    const mine = militaryPower(state, player, content);
    const theirs = militaryPower(state, enemy, content);
    const aggressive = aggression(ai) > 0;
    const losing = mine < theirs * (aggressive ? 0.8 : 1.1);
    const captured = lastCaptureTurn(ai, began);
    const consolidated = captured !== null && state.turn - captured >= CONSOLIDATE_TURNS;
    // Nothing worth taking left within reach: the war has done what it could.
    const spent = pickWarTarget(ai, [enemy]) === null;
    const stalemate = captured === null && state.turn - began >= STALEMATE_TURNS + (aggressive ? 6 : 0);
    if (losing || consolidated || spent || stalemate) exec(ai, { type: 'makePeace', target: enemy });
  }
};
