/** Read-only figure queries (SimQueries), built on the same validators as the commands. */
import type { ContentBundle } from '@contracts/content-schemas';
import type { CultureId, FigureActions, FigureId, GameState, PlayerId } from '@contracts/sim-api';
import { SEATED_TURNS_PER_WEIGHT } from './constants';
import { activateError, consumeError, deployError, recallError, seatError, unseatError } from './figures';
import { figureDef, ownSettlements } from './util';

const NONE: FigureActions = {
  seat: [],
  deploy: [],
  canUnseat: false,
  canRecall: false,
  canActivate: false,
  canConsume: false,
};

export const figureActions = (state: GameState, figure: FigureId, content: ContentBundle): FigureActions => {
  const fs = state.figures[figure];
  if (!fs) return { ...NONE, seat: [], deploy: [] };
  const owner = fs.owner;
  const p = state.players[owner];
  if (!p) return { ...NONE, seat: [], deploy: [] };
  return {
    seat: Object.keys(p.cabinet).filter((key) => seatError(state, owner, figure, key, content) === null),
    deploy: ownSettlements(state, owner)
      .filter((s) => deployError(state, owner, figure, s.id, content) === null)
      .map((s) => s.id),
    canUnseat: unseatError(state, owner, figure, content) === null,
    canRecall: recallError(state, owner, figure, content) === null,
    canActivate: activateError(state, owner, figure, content) === null,
    canConsume: consumeError(state, owner, figure, content) === null,
  };
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
