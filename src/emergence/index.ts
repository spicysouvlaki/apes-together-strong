/**
 * Emergence engine public surface (GDD §3, §4). Owned by workstream 2.
 * The sim core and src/sim/ages call these; signatures are fixed. All functions taking a
 * SimCtx mutate ctx.state (already a clone) and push to ctx.events.
 *
 * Files: signals.ts (measure x[s]) → affinity.ts (A[c], hints) → points.ts (gp pools) →
 * offers.ts (draw, deeds, legends) → figures.ts (commands) / cabinet.ts / lifecycle.ts;
 * queries.ts for the read-only queries; constants.ts for every tuning number.
 */
import { GP_KINDS, type ContentBundle, type GpKind } from '@contracts/content-schemas';
import type { CultureId, PlayerId, PlayerState } from '@contracts/sim-api';
import type { SimCtx } from '../sim/ctx';
import { updateAffinity } from './affinity';
import { GP_START_THRESHOLD } from './constants';
import { addMissingSeats } from './cabinet';
import { tickSeatedTurns } from './lifecycle';
import { checkDeeds, createPointsOffers, dropOffer, maybeOfferLegend } from './offers';
import { accrueGp, gpGain } from './points';
import { measurePlayer, signalContributions } from './signals';
import { homeSettlement } from './util';

export { addAffinity } from './affinity';
export { handleFigureCommand } from './figures';
export { syncCabinet, cabinetSeats } from './cabinet';
export {
  onSettlementCaptured,
  onPlayerEliminated,
  onFigureUnitDefeated,
  retireFigures,
  onAgeStarted,
  ancestorYields,
} from './lifecycle';
export { figureActions, cultureWeights } from './queries';

/** Initial emergence fields for a new player (zeroed affinity for every culture, GP pools at 0, thresholds at 60). */
export const initEmergence = (
  content: ContentBundle,
): Pick<PlayerState, 'affinity' | 'hintsShown' | 'gp' | 'gpThreshold' | 'legendSlotUsed' | 'seatedTurns'> => {
  const affinity: Record<CultureId, number> = {};
  const hintsShown: Record<CultureId, number> = {};
  for (const c of content.cultures) {
    affinity[c.id] = 0;
    hintsShown[c.id] = 0;
  }
  const gp = {} as Record<GpKind, number>;
  const gpThreshold = {} as Record<GpKind, number>;
  for (const k of GP_KINDS) {
    gp[k] = 0;
    gpThreshold[k] = GP_START_THRESHOLD;
  }
  return { affinity, hintsShown, gp, gpThreshold, legendSlotUsed: false, seatedTurns: {} };
};

/**
 * Once per player at the start of each turn, after the sim has computed yields/income and
 * `player.stats`: measure signals, update affinity (A ← 0.98·A + Σ w·x), fire 50/100 hints,
 * accrue great-people points, check deeds, create offers when pools cross thresholds, offer
 * the age's legend, and tick seatedTurns. The sim resets the `...ThisTurn` stats after this.
 */
export const emergenceTick = (ctx: SimCtx, player: PlayerId): void => {
  const { state, content } = ctx;
  const p = state.players[player];
  if (!p || !p.alive) return;
  addMissingSeats(state, player, content);
  const measures = measurePlayer(state, player, content);
  const contributions = signalContributions(state, player, content, measures);
  updateAffinity(ctx, player, contributions);
  accrueGp(state, player, gpGain(state, player, content, measures));
  // A player without a settlement cannot host a figure (`chooseOffer` needs a home), and an
  // offer it cannot accept would block `endTurn` forever. So: no offers or deeds while
  // homeless, and offers left over from before the last settlement fell are withdrawn
  // (points offers refund their threshold).
  if (!homeSettlement(state, player)) {
    for (const o of state.offers.slice()) if (o.player === player) dropOffer(state, o.id, true);
    tickSeatedTurns(state, player, content);
    return;
  }
  checkDeeds(ctx, player);
  createPointsOffers(ctx, player, contributions);
  maybeOfferLegend(ctx, player, contributions);
  tickSeatedTurns(state, player, content);
};
