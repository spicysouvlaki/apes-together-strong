/**
 * Measured statistics about a player, shared by deeds (src/emergence) and legacy
 * milestones (src/sim/ages). STUB — owned by the sim core. Signature is fixed.
 */
import type { ContentBundle, StatMeasure } from '@contracts/content-schemas';
import type { GameState, PlayerId } from '@contracts/sim-api';

/** Current value of `measure` for `player` (see StatMeasure in content-schemas.ts). */
export const statValue = (
  _state: GameState,
  _player: PlayerId,
  _measure: StatMeasure,
  _param: string | undefined,
  _content: ContentBundle,
): number => {
  throw new Error('TODO(sim): statValue not implemented');
};
