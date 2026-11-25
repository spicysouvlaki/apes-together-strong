/**
 * Tile stacking heights ("diorama" look, GDD §11). Pure; shared by the scene builders and by
 * picking, so a tap on a raised hill resolves to the hill and not the tile behind it.
 */
import type { Tile } from '@contracts/sim-api';

/** Top of water tiles: flat, slightly below land. */
export const WATER_TOP = 0.04;
/** Top of flat land at elevation 0. */
export const LAND_TOP = 0.16;
/** Extra height per elevation step (hills, highlands). */
export const ELEVATION_STEP = 0.22;
/** Elevation is clamped so a bad map value can't build a tower. */
export const MAX_ELEVATION = 4;
/** Unexplored tiles are drawn as a flat parchment sheet at this height (hides relief). */
export const FOG_TOP = 0.1;
/** Height of a mountain's peak cone above its tile top. */
export const MOUNTAIN_PEAK = 0.9;
/** How far below y = 0 the prism sides extend (the "cake slice"). */
export const BASE_Y = -0.35;

export interface HeightInfo {
  isWater: boolean;
  isMountain: boolean;
}

/** World y of a tile's top face. */
export const tileTop = (tile: Pick<Tile, 'elevation' | 'feature'>, info: HeightInfo): number => {
  if (info.isWater) return WATER_TOP;
  let e = Number.isFinite(tile.elevation) ? Math.max(0, Math.min(MAX_ELEVATION, tile.elevation)) : 0;
  // Hills read as hills even if the map generator left elevation at 0.
  if (tile.feature === 'hills' && e < 1) e = 1;
  if (info.isMountain && e < 2) e = 2;
  return LAND_TOP + ELEVATION_STEP * e;
};
