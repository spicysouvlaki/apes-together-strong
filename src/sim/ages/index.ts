/**
 * Ages: age meter, crises, transitions, refinement, naming, legacy milestones, score,
 * game end (GDD §5, §6, §8). STUB — owned by the ages task of workstream 1.
 * The sim core calls these; signatures are fixed. Functions taking a SimCtx mutate
 * ctx.state (already a clone) and push to ctx.events.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { Command, GameState, MilestoneProgress, PlayerId, RefinementOption } from '@contracts/sim-api';
import type { SimCtx } from '../ctx';

const todo = (name: string): never => {
  throw new Error(`TODO(ages): ${name} not implemented`);
};

/** Add to the shared age meter (clamped 0–100) and emit `ageProgress`. Used for wonders (+1), figures recruited (+0.5), completed trees (+4), milestones (+3). */
export const addAgeProgress = (_ctx: SimCtx, _amount: number): void => todo('addAgeProgress');

/**
 * World phase, once per turn after every player has ended their turn and before the next
 * turn's start-of-turn sim: +1 meter per turn (scaled by game speed), start the crisis at 70,
 * fire crisis stages at 70/80/90 (filling `crisis.awaiting`), run crisis behaviors (raiders,
 * popLoss, unrest), and at 100 either begin the transition (phase 'transition', recap per
 * player, figures retire) or, in the final age, end the game (phase 'ended', `result`).
 */
export const agesWorldPhase = (_ctx: SimCtx): void => todo('agesWorldPhase');

/** Once per player at start of turn (after emergenceTick): award newly reached legacy milestones and refresh `player.score`. */
export const updateMilestones = (_ctx: SimCtx, _player: PlayerId): void => todo('updateMilestones');

/**
 * Handles chooseCrisisResponse, adoptTradition, adoptHybrid, nameCiv, finishTransition.
 * Returns an error string, or null on success. When the last player finishes the transition
 * this starts the next age (soft reset, trees swap, phase back to 'playing').
 */
export const handleAgesCommand = (_ctx: SimCtx, _player: PlayerId, _command: Command): string | null =>
  todo('handleAgesCommand');

// --- Queries (re-exported through src/sim/queries.ts) ---

export const refinementOptions = (
  _state: GameState,
  _player: PlayerId,
  _content: ContentBundle,
): RefinementOption[] => todo('refinementOptions');

export const milestones = (_state: GameState, _player: PlayerId, _content: ContentBundle): MilestoneProgress[] =>
  todo('milestones');

/** Legacy score (GDD §8): 10/figure + 15/tradition + 40/hybrid + 25/signature + 5/seated figure, plus legacy points. */
export const score = (_state: GameState, _player: PlayerId, _content: ContentBundle): number => todo('score');
