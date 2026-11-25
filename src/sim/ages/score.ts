/** Legacy score (GDD §8). */
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameState, PlayerId } from '@contracts/sim-api';
import {
  SCORE_PER_FIGURE,
  SCORE_PER_HYBRID,
  SCORE_PER_SEATED_FIGURE,
  SCORE_PER_SIGNATURE_EXTRA,
  SCORE_PER_TRADITION,
} from './constants';

/**
 * 10 per figure still owned (any state except consumed; retired ancestors count) + 15 per
 * tradition (+25 more for a signature) + 40 per hybrid + 5 per seated figure + legacy points.
 */
export const score = (state: GameState, player: PlayerId, content: ContentBundle): number => {
  const p = state.players[player];
  if (!p) return 0;
  let total = p.legacyPoints;
  for (const id of Object.keys(state.figures)) {
    const f = state.figures[id];
    if (!f || f.owner !== player || f.location.state === 'consumed') continue;
    total += SCORE_PER_FIGURE;
    if (f.location.state === 'seated') total += SCORE_PER_SEATED_FIGURE;
  }
  for (const id of p.traditions) {
    total += SCORE_PER_TRADITION;
    if (content.traditions.find((t) => t.id === id)?.tier === 'signature') total += SCORE_PER_SIGNATURE_EXTRA;
  }
  total += p.hybrids.length * SCORE_PER_HYBRID;
  return total;
};
