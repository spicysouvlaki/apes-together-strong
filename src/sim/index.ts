/**
 * Sim entry point implementing `Sim` (src/contracts/sim-api.ts). STUB — owned by the sim core.
 */
import type { Sim } from '@contracts/sim-api';

export const sim: Sim = {
  createGame: () => {
    throw new Error('TODO(sim): createGame not implemented');
  },
  applyCommand: () => ({ ok: false, error: 'TODO(sim): applyCommand not implemented' }),
};

export const { createGame, applyCommand } = sim;
export { queries } from './queries';
