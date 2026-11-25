/**
 * Settlement site evaluation (operational layer, GDD §9): food, production, resources,
 * rivers, coast for seafarers, and the sim's minimum distance between settlements.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import { hexDistance } from '@contracts/hex';
import type { GameState, PlayerId, Tile } from '@contracts/sim-api';
import { FEATURE_YIELDS, MIN_SETTLEMENT_DISTANCE, RIVER_GOLD } from '../sim/constants';
import { ci, hexOfIndex, tilesInRange } from '../sim/lookup';
import type { Persona } from './persona';
import { isWaterTile } from './util';

/** Same legality test as the sim's `canFoundAt` (land, passable, unclaimed or ours, ≥4 from any settlement). */
export const siteLegal = (state: GameState, player: PlayerId, idx: number, content: ContentBundle): boolean => {
  const tile = state.map.tiles[idx];
  if (!tile || tile.settlement || isWaterTile(tile, content)) return false;
  const terrain = ci(content).terrain[tile.terrain];
  if (!terrain || terrain.moveCost === null) return false;
  if (tile.owner !== null && tile.owner !== player) return false;
  for (const id of Object.keys(state.settlements)) {
    const s = state.settlements[id];
    if (s && hexDistance(s.at, tile) <= MIN_SETTLEMENT_DISTANCE) return false;
  }
  return true;
};

/** Value of working one tile, weighted by personality. */
export const tileValue = (state: GameState, tile: Tile, content: ContentBundle, pe: Persona): number => {
  const idx = ci(content);
  const terrain = idx.terrain[tile.terrain];
  if (!terrain) return 0;
  const y: Record<string, number> = { ...terrain.yields };
  if (tile.feature) for (const [k, v] of Object.entries(FEATURE_YIELDS[tile.feature] ?? {})) y[k] = (y[k] ?? 0) + (v ?? 0);
  if (tile.resource) {
    const r = idx.resources[tile.resource];
    const ages = ['ancient', 'classical', 'exploration', 'modern'];
    if (r && ages.indexOf(r.revealAge) <= ages.indexOf(state.age)) {
      for (const [k, v] of Object.entries(r.yields)) if (k !== 'happiness') y[k] = (y[k] ?? 0) + (v ?? 0);
    }
  }
  if (tile.river) y.gold = (y.gold ?? 0) + RIVER_GOLD;
  let v = 0;
  for (const [k, amount] of Object.entries(y)) v += (amount ?? 0) * (pe.yieldW[k as keyof Persona['yieldW']] ?? 1);
  return Math.max(0, v);
};

/** How good a city would be at tile `idx` (higher is better; ~15–40 for typical land). */
export const siteScore = (state: GameState, player: PlayerId, idx: number, content: ContentBundle, pe: Persona, ownedLuxuries: readonly string[]): number => {
  const center = state.map.tiles[idx];
  if (!center) return 0;
  const at = hexOfIndex(state.map, idx);
  const res = ci(content).resources;
  let score = 0;
  let water = 0;
  let land = 0;
  let coastal = false;
  const newLux: string[] = [];
  for (const t of tilesInRange(state.map, at, 2)) {
    if (t.owner !== null && t.owner !== player) continue;
    const d = hexDistance(at, t);
    if (d === 0) continue;
    const w = isWaterTile(t, content);
    if (w) {
      water++;
      if (d === 1) coastal = true;
    } else land++;
    const ring = d === 1 ? 1 : 0.6;
    score += tileValue(state, t, content, pe) * ring * (w ? 0.6 : 1);
    if (t.resource) {
      const r = res[t.resource];
      if (r?.class === 'luxury' && !ownedLuxuries.includes(r.id) && !newLux.includes(r.id)) newLux.push(r.id);
      if (r?.class === 'strategic') score += 1;
    }
  }
  score += newLux.length * 4 * pe.yieldW.happiness;
  if (center.river) score += 3;
  if (coastal) score += 1.5 + 3 * pe.w.seafarer;
  // Mostly-water sites stay small; landlocked bits of ice or desert too.
  if (water > 12) score -= (water - 12) * 1.5;
  if (land < 5) score -= (5 - land) * 2;
  if (center.feature === 'hills') score += 1.5;
  return score;
};

/** Luxury resource ids already inside the player's borders. */
export const ownedLuxuries = (state: GameState, player: PlayerId, content: ContentBundle): string[] => {
  const res = ci(content).resources;
  const out: string[] = [];
  for (const t of state.map.tiles) {
    if (t.owner !== player || !t.resource) continue;
    const r = res[t.resource];
    if (r?.class === 'luxury' && !out.includes(r.id)) out.push(r.id);
  }
  return out;
};
