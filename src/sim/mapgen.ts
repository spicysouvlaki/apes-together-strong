/**
 * Map generation (GDD §7 "Map"). STUB — owned by the map-gen task of workstream 1.
 * Signature is fixed; the sim core calls it from createGame.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { Hex } from '@contracts/hex';
import type { MapSize, MapState } from '@contracts/sim-api';
import type { HasRng } from './rng';

export interface GeneratedMap {
  map: MapState;
  /** Fair start tiles, at least `players` of them, best-separated first. */
  starts: Hex[];
  /** Sites for city-states, at least `cityStates` of them, away from starts and each other. */
  cityStateSites: Hex[];
}

export const MAP_DIMENSIONS: Record<MapSize, { width: number; height: number; cityStates: number }> = {
  small: { width: 48, height: 30, cityStates: 4 },
  standard: { width: 64, height: 40, cityStates: 6 },
  large: { width: 80, height: 50, cityStates: 8 },
};

export const generateMap = (
  _size: MapSize,
  _players: number,
  _content: ContentBundle,
  _rng: HasRng,
): GeneratedMap => {
  throw new Error('TODO(sim): generateMap not implemented');
};
