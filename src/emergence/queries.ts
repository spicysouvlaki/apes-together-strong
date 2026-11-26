/** Read-only figure queries (SimQueries), built on the same validators as the commands. */
import type { ContentBundle } from '@contracts/content-schemas';
import type { CultureId, FigureActions, FigureId, GameState, PlayerId } from '@contracts/sim-api';
import { SEATED_TURNS_PER_WEIGHT } from './constants';
import { slotAccepts } from './cabinet';
import { activateError, consumeError, deployError, figureUnitDef, recallError, seatError, seatName, unseatError } from './figures';
import { figureDef, ownSettlements } from './util';

const NONE: FigureActions = {
  seat: [],
  deploy: [],
  canUnseat: false,
  canRecall: false,
  canActivate: false,
  canConsume: false,
  blocked: {},
};

/**
 * What a figure can do now, and for each action that could apply to it but cannot be done
 * now, the player-facing reason (the validators' own messages, so UI and rules agree).
 * Actions that never apply are absent from `blocked`: a figure without the 'unit' use never
 * deploys, only a seated figure can be unseated, only a figure in the field recalled, and a
 * retired or consumed figure does nothing at all.
 */
export const figureActions = (state: GameState, figure: FigureId, content: ContentBundle): FigureActions => {
  const fs = state.figures[figure];
  const def = figureDef(content, figure);
  if (!fs || !def) return { ...NONE, seat: [], deploy: [], blocked: {} };
  const owner = fs.owner;
  const p = state.players[owner];
  if (!p) return { ...NONE, seat: [], deploy: [], blocked: {} };
  const cities = ownSettlements(state, owner);
  const out: FigureActions = {
    seat: Object.keys(p.cabinet).filter((key) => seatError(state, owner, figure, key, content) === null),
    deploy: cities.filter((s) => deployError(state, owner, figure, s.id, content) === null).map((s) => s.id),
    canUnseat: unseatError(state, owner, figure, content) === null,
    canRecall: recallError(state, owner, figure, content) === null,
    canActivate: activateError(state, owner, figure, content) === null,
    canConsume: consumeError(state, owner, figure, content) === null,
    blocked: {},
  };
  const where = fs.location.state;
  if (where !== 'based' && where !== 'seated' && where !== 'unit') return out;
  const blocked = out.blocked;
  if (def.uses.includes('cabinet') && where !== 'seated' && out.seat.length === 0) {
    blocked.seat = seatBlockedReason(state, owner, figure, content);
  }
  if (def.uses.includes('unit') && figureUnitDef(content, def) && where !== 'unit' && out.deploy.length === 0) {
    blocked.deploy = deployError(state, owner, figure, '', content) ?? undefined;
  }
  if (where === 'seated' && !out.canUnseat) blocked.unseat = unseatError(state, owner, figure, content) ?? undefined;
  if (where === 'unit' && !out.canRecall) blocked.recall = recallError(state, owner, figure, content) ?? undefined;
  if (def.activate && def.uses.includes('activate') && !out.canActivate) blocked.activate = activateError(state, owner, figure, content) ?? undefined;
  if (!out.canConsume) blocked.consume = consumeError(state, owner, figure, content) ?? undefined;
  for (const k of Object.keys(blocked) as (keyof FigureActions['blocked'])[]) if (blocked[k] === undefined) delete blocked[k];
  return out;
};

/**
 * Why no seat takes this figure now: anarchy, being away from a city, no seat of the
 * government accepts its kind, or every fitting seat is taken (named) or just vacated.
 */
const seatBlockedReason = (state: GameState, owner: PlayerId, figure: FigureId, content: ContentBundle): string => {
  const p = state.players[owner];
  const def = figureDef(content, figure);
  const keys = p ? Object.keys(p.cabinet) : [];
  if (!p || !def) return '';
  // Anarchy and the figure's own whereabouts first: they hold for every seat.
  if (p.anarchyTurns > 0 || state.figures[figure]?.location.state !== 'based') return seatError(state, owner, figure, '', content) ?? '';
  const fitting = keys.filter((k) => slotAccepts(content, k, def));
  if (fitting.length === 0) {
    return p.government === null ? 'Choose a government first; its cabinet has the seats.' : `Your government has no seat for a ${def.kind}.`;
  }
  const errors = fitting.map((k) => seatError(state, owner, figure, k, content));
  // A seat about to free up is the most useful thing to say; then who holds the others.
  let soonest: { key: string; turn: number } | null = null;
  for (const k of fitting) {
    const free = p.cabinetCooldown[k] ?? 0;
    if (!p.cabinet[k] && free > state.turn && (!soonest || free < soonest.turn)) soonest = { key: k, turn: free };
  }
  if (soonest) return `The ${seatName(content, soonest.key)} seat was just vacated; it is free on turn ${soonest.turn}.`;
  const holders = fitting.map((k) => p.cabinet[k]).filter((x): x is string => !!x).map((id) => figureDef(content, id)?.name ?? 'someone');
  if (holders.length === fitting.length) {
    const names = holders.length > 1 ? `${holders.slice(0, -1).join(', ')} and ${holders[holders.length - 1]}` : holders[0];
    return fitting.length === 1 ? (errors[0] ?? '') : `The fitting seats are taken by ${names}.`;
  }
  return errors.find((e) => e !== null) ?? '';
};

/**
 * Culture weight (GDD §6): figures of that culture the player holds, in any state (based,
 * seated, unit, Hall of Ancestors, consumed), + 1 per 10 seated turns. Figures captured away
 * count for their captor, not their recruiter.
 */
export const cultureWeights = (state: GameState, player: PlayerId, content: ContentBundle): Record<CultureId, number> => {
  const counts: Record<CultureId, number> = {};
  for (const id of Object.keys(state.figures)) {
    const fs = state.figures[id];
    if (!fs || fs.owner !== player) continue;
    const def = figureDef(content, id);
    if (def) counts[def.culture] = (counts[def.culture] ?? 0) + 1;
  }
  const seated = state.players[player]?.seatedTurns ?? {};
  const out: Record<CultureId, number> = {};
  for (const c of content.cultures) {
    out[c.id] = (counts[c.id] ?? 0) + Math.floor((seated[c.id] ?? 0) / SEATED_TURNS_PER_WEIGHT);
  }
  return out;
};
