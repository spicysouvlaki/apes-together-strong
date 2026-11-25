/**
 * Unit lifecycle helpers shared with src/emergence (deploy, free_unit) and src/sim/ages
 * (raiders). STUB — owned by the sim core, which also keeps the rest of the unit rules here.
 * These two signatures are fixed.
 */
import type { Hex } from '@contracts/hex';
import type { FigureId, PlayerId, UnitId } from '@contracts/sim-api';
import type { SimCtx } from './ctx';

/**
 * Create a unit of content type `typeId` for `owner` on `at`, or on the nearest free legal
 * tile if `at` is occupied by another unit of the same stacking layer. Returns the new id,
 * or null if no tile within 3 is free. `figure` marks a deployed figure-unit.
 */
export const spawnUnit = (
  _ctx: SimCtx,
  _owner: PlayerId,
  _typeId: string,
  _at: Hex,
  _figure: FigureId | null = null,
): UnitId | null => {
  throw new Error('TODO(sim): spawnUnit not implemented');
};

/** Delete a unit from the state (no figure handling; callers deal with `unit.figure` first). */
export const removeUnit = (_ctx: SimCtx, _unit: UnitId): void => {
  throw new Error('TODO(sim): removeUnit not implemented');
};
