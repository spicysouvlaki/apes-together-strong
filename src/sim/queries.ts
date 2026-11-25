/**
 * Read-only query surface (`SimQueries` in src/contracts/sim-api.ts). STUB — owned by the
 * sim core, which implements the map/settlement/unit/tree queries here and re-exports the
 * figure queries from src/emergence and the refinement/legacy queries from src/sim/ages.
 */
import type { SimQueries } from '@contracts/sim-api';
import { cabinetSeats, cultureWeights, figureActions } from '../emergence';
import { milestones, refinementOptions, score } from './ages';

const todo = (name: string) => (): never => {
  throw new Error(`TODO(sim): queries.${name} not implemented`);
};

export const queries: SimQueries = {
  reachable: todo('reachable'),
  attackTargets: todo('attackTargets'),
  canFound: todo('canFound'),
  tradeTargets: todo('tradeTargets'),
  productionOptions: todo('productionOptions'),
  settlementYields: todo('settlementYields'),
  workedTiles: todo('workedTiles'),
  growthCost: todo('growthCost'),
  upgradeCost: todo('upgradeCost'),
  settlementCap: todo('settlementCap'),
  researchOptions: todo('researchOptions'),
  governmentOptions: todo('governmentOptions'),
  visibleTiles: todo('visibleTiles'),
  atWar: todo('atWar'),
  envoyCost: todo('envoyCost'),
  cabinetSeats,
  figureActions,
  cultureWeights,
  refinementOptions,
  milestones,
  score,
  pendingDecisions: todo('pendingDecisions'),
};
