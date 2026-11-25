/** Small shared helpers for the ages module. */
import { AGES, type Age } from '@contracts/content-schemas';
import type { ChronicleKind, GameState, PlayerId, PlayerState } from '@contracts/sim-api';

/** Living players in turn order (deterministic iteration, CLAUDE.md rule 2). */
export const livingPlayers = (state: GameState): PlayerState[] => {
  const out: PlayerState[] = [];
  for (const id of state.playerOrder) {
    const p = state.players[id];
    if (p && p.alive) out.push(p);
  }
  return out;
};

export const ageIndex = (age: Age): number => AGES.indexOf(age);

/** The age after `age`, or null for the last one. */
export const nextAge = (age: Age): Age | null => AGES[ageIndex(age) + 1] ?? null;

/** "ancient" -> "Ancient". */
export const ageName = (age: Age): string => age.charAt(0).toUpperCase() + age.slice(1);

export const addChronicle = (
  state: GameState,
  player: PlayerId,
  kind: ChronicleKind,
  ref: string,
  text: string,
): void => {
  const p = state.players[player];
  if (!p) return;
  p.chronicle.push({ turn: state.turn, age: state.age, kind, ref, text });
};
