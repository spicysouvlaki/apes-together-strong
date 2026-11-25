/**
 * The AI's per-turn working context and its single door into the sim: `exec`, which applies
 * one Command through `sim.applyCommand` (same rules as a human), keeps the newest state and
 * collects events. A rejected command is skipped, never thrown; a hard cap bounds the number
 * of commands per turn so a confused AI can never loop forever (GDD §9 budget).
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { Command, GameState, PlayerId, PlayerState, Sim, SimEvent } from '@contracts/sim-api';
import type { Persona } from './persona';

/** Hard cap on commands per AI turn (each one clones the state, ~1–2 ms on a small map). */
export const MAX_COMMANDS_PER_TURN = 160;

export interface AiCtx {
  state: GameState;
  readonly player: PlayerId;
  readonly content: ContentBundle;
  readonly sim: Sim;
  readonly events: SimEvent[];
  readonly persona: Persona;
  commands: number;
  rejected: number;
  /** Tile indices a settler already chose this turn, so two settlers never race for one site. */
  readonly claimedSites: number[];
}

export const me = (ai: AiCtx): PlayerState => {
  const p = ai.state.players[ai.player];
  if (!p) throw new Error(`AI: unknown player ${ai.player}`);
  return p;
};

/**
 * Apply one command. Returns true when the sim accepted it. `force` ignores the per-turn cap
 * (used only for the commands that end the turn or the transition).
 */
export const exec = (ai: AiCtx, command: Command, force = false): boolean => {
  if (!force && ai.commands >= MAX_COMMANDS_PER_TURN) return false;
  ai.commands++;
  aiDiagnostics.commands++;
  let result;
  try {
    result = ai.sim.applyCommand(ai.state, ai.player, command, ai.content);
  } catch {
    ai.rejected++;
    return false;
  }
  if (!result.ok) {
    ai.rejected++;
    const key = `${command.type}: ${result.error}`;
    aiDiagnostics.rejections[key] = (aiDiagnostics.rejections[key] ?? 0) + 1;
    return false;
  }
  ai.state = result.state;
  for (const e of result.events) ai.events.push(e);
  return true;
};

/**
 * Counters for tooling and tests (autoplay prints them). Never read by the AI's decisions,
 * so they cannot affect determinism.
 */
export const aiDiagnostics = { stepErrors: 0, lastError: '', rejections: {} as Record<string, number>, commands: 0 };

/** Run one decision step; an exception inside a step skips the step, never the turn. */
export const step = (ai: AiCtx, fn: (ai: AiCtx) => void): void => {
  try {
    fn(ai);
  } catch (err) {
    // A buggy heuristic must not stall the game (GDD §9); the turn still ends.
    aiDiagnostics.stepErrors++;
    aiDiagnostics.lastError = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  }
};
