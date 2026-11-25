/**
 * Ages: age meter, crises, transitions, refinement, naming, legacy milestones, score,
 * game end (GDD §5, §6, §8). Owned by the ages task of workstream 1.
 * The sim core calls these; signatures are fixed. Functions taking a SimCtx mutate
 * ctx.state (already a clone) and push to ctx.events.
 */
import type { Command, PlayerId } from '@contracts/sim-api';
import type { SimCtx } from '../ctx';
import { AGE_METER_MAX } from './constants';
import { advanceCrisis, chooseCrisisResponse, runCrisisBehaviors } from './crisis';
import { tickAgeMeter } from './meter';
import { setCivName } from './naming';
import { adoptHybrid, adoptTradition } from './refinement';
import { beginTransition, endGame, finishTransition } from './transition';

export { addAgeProgress } from './meter';
export { updateMilestones, milestones } from './milestones';
export { refinementOptions } from './refinement';
export { score } from './score';

/**
 * World phase, once per turn after every player has ended their turn and before the next
 * turn's start-of-turn sim: +1 meter per turn (scaled by game speed), start the crisis at 70,
 * fire crisis stages at 70/80/90 (filling `crisis.awaiting`), run crisis behaviors (raiders,
 * popLoss, unrest), and at 100 either begin the transition (phase 'transition', recap per
 * player, figures retire) or, in the final age, end the game (phase 'ended', `result`).
 */
export const agesWorldPhase = (ctx: SimCtx): void => {
  const { state } = ctx;
  if (state.phase !== 'playing') return;
  tickAgeMeter(ctx);
  if (state.ageProgress >= AGE_METER_MAX) {
    ctx.events.push({ type: 'ageEnded', age: state.age });
    if (state.age === state.finalAge) endGame(ctx);
    else beginTransition(ctx);
    return;
  }
  advanceCrisis(ctx);
  runCrisisBehaviors(ctx);
};

/**
 * Handles chooseCrisisResponse, adoptTradition, adoptHybrid, nameCiv, finishTransition.
 * Returns an error string, or null on success. When the last player finishes the transition
 * this starts the next age (soft reset, trees swap, phase back to 'playing').
 */
export const handleAgesCommand = (ctx: SimCtx, player: PlayerId, command: Command): string | null => {
  const p = ctx.state.players[player];
  if (!p || !p.alive) return 'Unknown or eliminated player';
  switch (command.type) {
    case 'chooseCrisisResponse':
      return chooseCrisisResponse(ctx, player, command.option);
    case 'adoptTradition':
      return adoptTradition(ctx, player, command.tradition);
    case 'adoptHybrid':
      return adoptHybrid(ctx, player, command.hybrid);
    case 'nameCiv': {
      const recap = ctx.state.transition?.recap[player];
      if (ctx.state.phase !== 'transition' || !recap) return 'Name your civilization at an age transition';
      if (recap.done) return 'Refinement finished';
      return setCivName(ctx, player, command.name);
    }
    case 'finishTransition':
      return finishTransition(ctx, player);
    default:
      return `Not an ages command: ${command.type}`;
  }
};
