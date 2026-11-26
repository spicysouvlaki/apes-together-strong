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
 * - Posture toward the human (src/sim/voice.ts, from the leader archetype): an aggressor or a
 *   rival prefers the human's towns as targets; a trader or a wary neighbour sues for peace
 *   with the human as soon as the war allows.
 * - City-states: an aggressive AI with a ready strike force takes a weakly held city-state on
 *   its border when it has no stake in it (few envoys, not its suzerain).
 */
import { hexDistance } from '@contracts/hex';
import { CITY_STATE_PREFIX, isCityStateOwner, warKey, type PlayerId, type Settlement } from '@contracts/sim-api';
import { MIN_WAR_TURNS, PEACE_INFLUENCE_COST } from '../sim/constants';
import { WAR_DECLARED_TEXT } from '../sim/diplomacy';
import { ci, tileAt } from '../sim/lookup';
import { posture, warHeldBack } from '../sim/voice';
import { peaceTerms, stoodDownFrom, warGoalOf, warIntentsBy, warObjectiveFor } from '../sim/war-intent';
import { exec, me, type AiCtx } from './ctx';
import { hashStr } from './util';
import { cityStatesAtWar, enemiesAtWar, militaryPower, ownSettlements } from './world';

/** War-target score bonus for a human rival, by posture (legible opponents, GDD §9). */
export const HUMAN_TARGET_BONUS: Record<ReturnType<typeof posture>, number> = { aggressor: 4, rival: 2, trader: 0, wary: 0 };
/** A city-state is a target only within this distance of our nearest settlement (we border it). */
export const CS_WAR_DISTANCE = 6;
/** Our strike force must exceed a city-state's local defence by this factor ("clearly pays"). */
export const CS_WAR_EDGE = 1.8;
/** We leave alone city-states where we have more than this many envoys. */
export const CS_WAR_MAX_OWN_ENVOYS = 1;

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
/** Happiness below which an AI not ahead in a war seeks peace (war weariness, wave 13). */
export const WEARY_HAPPINESS = -2;
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
    // Wave 13: a war on a human is announced over one city (src/sim/war-intent.ts); weigh that
    // city only, so the AI fights for what it named.
    const named = state.players[rival]?.isHuman === true ? (warGoalOf(state, ai.player, rival) ?? warObjectiveFor(state, ai.player, rival)?.id ?? null) : null;
    for (const s of theirs) {
      if (named !== null && s.id !== named) continue;
      if (!ours.has(continent(s.at))) continue;
      if (theirs.length === 1 && state.age === 'ancient' && !isCityStateOwner(rival)) continue;
      let distance = Infinity;
      for (const o of own) distance = Math.min(distance, hexDistance(o.at, s.at));
      if (distance > MAX_WAR_DISTANCE) continue;
      const defense = localDefense(ai, s);
      // Prefer towns over capitals, close over far, and weak over strong.
      const human = state.players[rival]?.isHuman === true ? HUMAN_TARGET_BONUS[posture(state, ai.player, ai.content)] : 0;
      const score = -defense * 0.5 - distance * 1.5 - (s.isCapital ? 6 : 0) + (s.kind === 'town' ? 2 : 0) + s.population * 0.3 + human;
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
    (id) =>
      id !== ai.player &&
      ai.state.players[id]?.alive === true &&
      ai.state.turn - lastDeclaredOn(ai, id) >= REDECLARE_TURNS &&
      !stoodDownFrom(ai.state, ai.player, id),
  );

/**
 * The settlement our army fights for: the announced objective of a war on a human while the
 * enemy still holds it (wave 13: the AI commits to what it named), else the best target now.
 */
export const committedWarTarget = (ai: AiCtx, foes: readonly PlayerId[]): WarTarget | null => {
  for (const foe of foes) {
    const goal = warGoalOf(ai.state, ai.player, foe);
    const s = goal ? ai.state.settlements[goal] : undefined;
    if (!s || s.owner !== foe) continue;
    const own = ownSettlements(ai.state, ai.player);
    let distance = Infinity;
    for (const o of own) distance = Math.min(distance, hexDistance(o.at, s.at));
    return { rival: foe, settlement: s, distance, defense: localDefense(ai, s) };
  }
  return pickWarTarget(ai, foes);
};

/** Is a threat still worth carrying out? Our force near the named city still has an edge. */
const threatStillHolds = (ai: AiCtx, target: PlayerId, objective: string): boolean => {
  const s = ai.state.settlements[objective];
  if (!s || s.owner !== target || !ai.state.players[target]?.alive) return false;
  if (enemiesAtWar(ai.state, ai.player).length > 0) return false;
  const force = strikeForce(ai, s.at);
  const mine = militaryPower(ai.state, ai.player, ai.content);
  const theirs = Math.max(1, militaryPower(ai.state, target, ai.content));
  // Looser than the bar for threatening at all, so a threat is not dropped on a whim; a real
  // garrison (the answer the warning asked for) tips it.
  return force.units >= 2 && force.power >= localDefense(ai, s) * WAR_THREAT_HOLD_EDGE && mine >= theirs * 0.9;
};

/** A threatened city's defence must stay below our local force over this factor, or we stand down. */
export const WAR_THREAT_HOLD_EDGE = 1.3;

/**
 * Carry out or withdraw our open threats (wave 13): when one is due and still holds, declare
 * (the sim starts the war); when it no longer holds, stand down (`makePeace` with no war).
 * Returns true while a threat is pending, so no other war is started meanwhile.
 */
export const followThroughThreats = (ai: AiCtx): boolean => {
  let pending = false;
  for (const t of warIntentsBy(ai.state, ai.player)) {
    if (!threatStillHolds(ai, t.target, t.objective)) {
      exec(ai, { type: 'makePeace', target: t.target });
      continue;
    }
    if (ai.state.turn >= t.due) exec(ai, { type: 'declareWar', target: t.target });
    else pending = true;
  }
  return pending;
};

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

/**
 * A city-state worth taking: within CS_WAR_DISTANCE of our border, where we have at most
 * CS_WAR_MAX_OWN_ENVOYS envoys and are not suzerain, and not one we declared on recently.
 */
export const pickCityStateTarget = (ai: AiCtx): WarTarget | null => {
  const { state } = ai;
  const candidates: PlayerId[] = [];
  for (const id of Object.keys(state.cityStates)) {
    const cs = state.cityStates[id];
    if (!cs || !cs.alive || cs.suzerain === ai.player) continue;
    if ((cs.envoys[ai.player] ?? 0) > CS_WAR_MAX_OWN_ENVOYS) continue;
    const owner = CITY_STATE_PREFIX + id;
    if (state.turn - lastDeclaredOn(ai, owner) < REDECLARE_TURNS) continue;
    candidates.push(owner);
  }
  const t = pickWarTarget(ai, candidates);
  return t && t.distance <= CS_WAR_DISTANCE ? t : null;
};

export const considerWar = (ai: AiCtx, _military: number): void => {
  const { state, player, content } = ai;
  if (followThroughThreats(ai)) return;
  if (state.turn < EARLIEST_WAR_TURN) return;
  if (enemiesAtWar(state, player).length > 0 || cityStatesAtWar(state, player).length > 0) return;
  // Consider it now and then, not every turn.
  if (hashStr(`${state.seed}|${player}|war|${Math.floor(state.turn / 3)}`) % 3 !== 0) return;
  const aggr = aggression(ai);
  // A human we warned lately (first contact, borders touching) gets the promised grace.
  const target = pickWarTarget(ai, livingRivals(ai).filter((id) => !warHeldBack(state, player, id)));
  if (!target) {
    considerCityStateWar(ai);
    return;
  }
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
  else considerCityStateWar(ai);
};

/** Aggressive AIs only: take a bordering city-state when the local edge is clear. */
const considerCityStateWar = (ai: AiCtx): void => {
  if (aggression(ai) < 1) return;
  const target = pickCityStateTarget(ai);
  if (!target) return;
  const force = strikeForce(ai, target.settlement.at);
  if (force.units >= 3 && force.support && force.power >= target.defense * CS_WAR_EDGE) {
    exec(ai, { type: 'declareWar', target: target.rival });
  }
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
    // Wave 13: peace terms make the score of the war matter (src/sim/war-intent.ts).
    const terms = peaceTerms(state, player, enemy);
    const ahead = terms?.payee === player;
    // War weariness grows with the war (src/sim/yields.ts): a sour home front ends wars we are not winning.
    const weary = me(ai).happiness < WEARY_HAPPINESS && !ahead;
    // An announced objective still in enemy hands: we keep fighting for it (no early peace).
    const goal = warGoalOf(state, player, enemy);
    const objectiveOpen = goal !== null && state.settlements[goal]?.owner === enemy;
    const declaredByUs = lastDeclaredOn(ai, enemy) >= began;
    // Traders and wary neighbours the human attacked offer peace as soon as the war allows,
    // unless they are winning it (then the human pays the terms).
    const pose = posture(state, player, content);
    const conciliatory = state.players[enemy]?.isHuman === true && !declaredByUs && (pose === 'trader' || pose === 'wary') && captured === null && !ahead;
    if (losing || weary || stalemate || conciliatory || ((consolidated || spent) && !objectiveOpen)) exec(ai, { type: 'makePeace', target: enemy });
  }
  // City-state wars end once the city is taken (the war lapses) or when they stall.
  for (const cs of cityStatesAtWar(state, player)) {
    const began = state.wars[warKey(player, cs)];
    if (began === undefined || state.turn - began < MIN_WAR_TURNS || me(ai).stock.influence < PEACE_INFLUENCE_COST) continue;
    if (state.turn - began >= STALEMATE_TURNS || pickWarTarget(ai, [cs]) === null) exec(ai, { type: 'makePeace', target: cs });
  }
};
