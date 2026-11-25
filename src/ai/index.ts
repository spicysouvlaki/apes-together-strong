/**
 * Rival AI entry point (GDD §9). STUB — owned by workstream 3.
 * Plays one full turn for `player` through the public Sim API only (same rules as a human)
 * and returns the resulting state plus every event emitted. Must also handle the
 * 'transition' phase (refine, name, pick a government, finishTransition) and must always
 * terminate: if nothing else is legal it ends the turn.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameState, PlayerId, Sim, SimEvent } from '@contracts/sim-api';

export const runAiTurn = (
  state: GameState,
  player: PlayerId,
  content: ContentBundle,
  sim: Sim,
): { state: GameState; events: SimEvent[] } => {
  // TODO(ai): placeholder that only ends the turn / finishes the transition.
  const command = state.phase === 'transition' ? ({ type: 'finishTransition' } as const) : ({ type: 'endTurn' } as const);
  const result = sim.applyCommand(state, player, command, content);
  if (!result.ok) return { state, events: [] };
  return { state: result.state, events: result.events };
};
