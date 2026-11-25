/**
 * Using recruited figures (GDD §3 "Figure states and actions"): seat them in fitting cabinet
 * seats, field generals in wartime, activate one-time deeds when the effect is useful, and
 * consume idle leftovers for refinement points just before the age ends when that beats the
 * +1 RP every figure gives by retiring at the transition (GDD §6).
 */
import type { Figure, LegacyTrack } from '@contracts/content-schemas';
import { hexDistance } from '@contracts/hex';
import type { FigureState, Settlement } from '@contracts/sim-api';
import { RP_PER_RETIRED_FIGURE } from '../sim/ages/constants';
import { queries } from '../sim/queries';
import { exec, me, type AiCtx } from './ctx';
import { figureOf } from './decisions';
import { modifiersScore } from './persona';
import { enemiesAtWar, ownSettlements } from './world';

/**
 * Consume a figure for RP only when it beats retiring by at least this much: a consumed
 * figure also loses its 10 legacy score (GDD §8), roughly what 2 RP of traditions buy back.
 */
const CONSUME_MIN_GAIN = 3;
/** Age meter value after which leftovers are consumed (the age ends at 100). */
const CONSUME_AT_METER = 90;

const ownFigures = (ai: AiCtx): FigureState[] => {
  const out: FigureState[] = [];
  for (const id of Object.keys(ai.state.figures)) {
    const f = ai.state.figures[id];
    if (f && f.owner === ai.player) out.push(f);
  }
  return out;
};

const seatFit = (ai: AiCtx, def: Figure, slotId: string): number => {
  let s = modifiersScore(def.cabinetModifiers, ai.persona);
  if (def.cabinetSlots.includes(slotId)) s += 2;
  // A figure that can act once (activate) is a little less valuable sitting in a chair.
  if (def.uses.includes('activate')) s -= 0.7;
  if (def.uses.includes('unit') && def.kind === 'general') s -= 0.3;
  return s;
};

export const seatFigures = (ai: AiCtx): void => {
  const p = me(ai);
  if (p.anarchyTurns > 0) return;
  for (const seat of queries.cabinetSeats(ai.state, ai.player, ai.content)) {
    if (seat.figure || seat.availableTurn > ai.state.turn) continue;
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const f of ownFigures(ai)) {
      if (f.location.state !== 'based') continue;
      const def = figureOf(ai.content, f.id);
      if (!def || !def.uses.includes('cabinet')) continue;
      const slot = ai.content.cabinetSlots.find((s) => s.id === seat.slot);
      if (!slot || !slot.accepts.includes(def.kind)) continue;
      const s = seatFit(ai, def, seat.slot);
      if (s > bestScore || (s === bestScore && best !== null && f.id < best)) {
        bestScore = s;
        best = f.id;
      }
    }
    if (best) exec(ai, { type: 'seatFigure', figure: best, slot: seat.key });
  }
};

const nearestCityTo = (ai: AiCtx, target: { q: number; r: number }): Settlement | null => {
  let best: Settlement | null = null;
  let bestD = Infinity;
  for (const s of ownSettlements(ai.state, ai.player)) {
    if (s.kind !== 'city') continue;
    const d = hexDistance(s.at, target);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
};

/** Generals take the field while at war with a player (one per war); return home in peace. */
export const fieldGenerals = (ai: AiCtx): void => {
  const enemies = enemiesAtWar(ai.state, ai.player);
  const figures = ownFigures(ai);
  const deployed = figures.filter((f) => f.location.state === 'unit');
  if (enemies.length > 0 && deployed.length < enemies.length) {
    const enemyCity = ownSettlements(ai.state, enemies[0] as string)[0];
    for (const f of figures) {
      if (f.location.state !== 'based') continue;
      const def = figureOf(ai.content, f.id);
      if (!def || def.kind !== 'general' || !def.uses.includes('unit')) continue;
      const city = enemyCity ? nearestCityTo(ai, enemyCity.at) : null;
      if (city && exec(ai, { type: 'deployFigure', figure: f.id, settlement: city.id })) break;
    }
  }
  if (enemies.length === 0) {
    for (const f of deployed) {
      if (queries.figureActions(ai.state, f.id, ai.content).canRecall) exec(ai, { type: 'recallFigure', figure: f.id });
    }
  }
};

const damagedHp = (ai: AiCtx): number => {
  let missing = 0;
  for (const id of Object.keys(ai.state.units)) {
    const u = ai.state.units[id];
    if (u && u.owner === ai.player && u.unitClass !== 'civilian') missing += 100 - u.hp;
  }
  return missing;
};

const exploredPercent = (ai: AiCtx): number => {
  const e = me(ai).explored;
  let n = 0;
  for (const v of e) n += v;
  return e.length ? (n * 100) / e.length : 100;
};

/** Is activating this figure's one-time effect worth it right now? */
const activationUseful = (ai: AiCtx, def: Figure, focus: LegacyTrack, threatened: boolean): boolean => {
  const effect = def.activate?.effect;
  if (!effect) return false;
  switch (effect) {
    case 'rush_wonder':
      return true; // the sim only allows it while a wonder is in production
    case 'production_burst': {
      const cap = ownSettlements(ai.state, ai.player).find((s) => s.isCapital);
      return !!cap && cap.production.item !== null;
    }
    case 'free_unit':
      return threatened || enemiesAtWar(ai.state, ai.player).length > 0 || ai.state.ageProgress >= 80;
    case 'heal_units':
      return damagedHp(ai) >= 150 || ai.state.ageProgress >= 85;
    case 'explore_reveal':
      return exploredPercent(ai) < 60 || ai.state.ageProgress >= 85;
    default:
      // Bursts are good any time; the classical culture track counts activations ("great works").
      return focus === 'culture' || !def.uses.includes('cabinet') || ai.state.ageProgress >= 60;
  }
};

export const activateFigures = (ai: AiCtx, focus: LegacyTrack, threatened: boolean): void => {
  for (const f of ownFigures(ai)) {
    if (f.location.state !== 'based') continue;
    const def = figureOf(ai.content, f.id);
    if (!def || !def.activate || !def.uses.includes('activate')) continue;
    if (!activationUseful(ai, def, focus, threatened)) continue;
    if (!queries.figureActions(ai.state, f.id, ai.content).canActivate) continue;
    exec(ai, { type: 'activateFigure', figure: f.id });
  }
};

/**
 * Shortly before a non-final age ends, idle figures (based, nothing better to do) whose
 * consumeValue beats the +1 RP of retiring are consumed for refinement points.
 */
export const consumeLeftovers = (ai: AiCtx): void => {
  const { state } = ai;
  if (state.age === state.finalAge || state.ageProgress < CONSUME_AT_METER) return;
  for (const f of ownFigures(ai)) {
    if (f.location.state !== 'based') continue;
    const def = figureOf(ai.content, f.id);
    if (!def) continue;
    if (def.consumeValue - RP_PER_RETIRED_FIGURE < CONSUME_MIN_GAIN) continue;
    exec(ai, { type: 'consumeFigure', figure: f.id, as: 'refinement' });
  }
};
