/**
 * The mutable working context passed between sim modules while one command is applied.
 * `state` is a clone made by `applyCommand` (never the caller's input state), so modules
 * mutate it freely and push events as they go.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameState, SimEvent } from '@contracts/sim-api';

export interface SimCtx {
  state: GameState;
  content: ContentBundle;
  events: SimEvent[];
}

/** Mint a deterministic id like "u12". */
export const mintId = (state: GameState, prefix: string): string => `${prefix}${state.nextId++}`;
