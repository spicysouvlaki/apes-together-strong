/** Chronicle lines (GDD §8): the end-of-game story is built from these. */
import type { ChronicleKind, GameState, PlayerId } from '@contracts/sim-api';

export const addChronicle = (state: GameState, player: PlayerId, kind: ChronicleKind, ref: string, text: string): void => {
  const p = state.players[player];
  if (!p) return;
  p.chronicle.push({ turn: state.turn, age: state.age, kind, ref, text });
};
