/**
 * Small deterministic helpers for the AI: string hashing (the AI's only "randomness"; it never
 * touches `state.rng`), neighbour tables and land distance fields for multi-turn movement.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import { hexNeighbors } from '@contracts/hex';
import type { GameState, MapState, Tile } from '@contracts/sim-api';
import { FEATURE_MOVE_COST } from '../sim/constants';
import { ci, hexOfIndex, tileIndex } from '../sim/lookup';

/** FNV-1a, 32 bit. */
export const hashStr = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** Deterministic value in [0, 1). */
export const hash01 = (s: string): number => hashStr(s) / 4294967296;

const neighborCache = new Map<string, Int32Array>();

/** neighbours[i*6 + k] = index of the k-th neighbour of tile i, or -1. Cached per map size. */
export const neighborTable = (map: MapState): Int32Array => {
  const key = `${map.width}x${map.height}`;
  let t = neighborCache.get(key);
  if (!t) {
    const n = map.width * map.height;
    t = new Int32Array(n * 6).fill(-1);
    for (let i = 0; i < n; i++) {
      const ns = hexNeighbors(hexOfIndex(map, i));
      for (let k = 0; k < 6; k++) {
        const h = ns[k];
        if (h) t[i * 6 + k] = tileIndex(map, h);
      }
    }
    neighborCache.set(key, t);
  }
  return t;
};

export const isWaterTile = (tile: Tile, content: ContentBundle): boolean => ci(content).terrain[tile.terrain]?.water ?? false;

/** Cost for a land unit to enter `tile`, or 0 when impassable (water, mountains). */
export const landStepCost = (tile: Tile, content: ContentBundle): number => {
  const terrain = ci(content).terrain[tile.terrain];
  if (!terrain || terrain.water || terrain.moveCost === null) return 0;
  const feat = tile.feature ? (FEATURE_MOVE_COST[tile.feature] ?? 0) : 0;
  return Math.max(terrain.moveCost, feat);
};

export const UNREACHABLE = 1 << 29;

/**
 * Land movement cost from every tile to the nearest of `sources` (Dijkstra with a bucket
 * queue; costs are small integers). Foreign settlements block passage but can be sources.
 * Tiles further than `maxCost` stay UNREACHABLE. With `waterCost` > 0 water tiles are
 * passable at that cost (land units that can embark, e.g. settlers crossing to new shores).
 */
export const landField = (
  state: GameState,
  content: ContentBundle,
  sources: readonly number[],
  maxCost = 200,
  owner?: string,
  waterCost = 0,
): Int32Array => {
  const stepCost = (t: Tile): number => landStepCost(t, content) || (waterCost > 0 && isWaterTile(t, content) ? waterCost : 0);
  const map = state.map;
  const n = map.tiles.length;
  const dist = new Int32Array(n).fill(UNREACHABLE);
  const nb = neighborTable(map);
  const buckets: number[][] = [];
  for (const s of sources) {
    if (s < 0 || s >= n) continue;
    dist[s] = 0;
    (buckets[0] ??= []).push(s);
  }
  for (let c = 0; c <= maxCost && c < buckets.length + 3; c++) {
    const b = buckets[c];
    if (!b) continue;
    for (let j = 0; j < b.length; j++) {
      const i = b[j] as number;
      if ((dist[i] as number) !== c) continue;
      const tile = map.tiles[i];
      if (!tile) continue;
      // Leaving a tile we cannot stand on (a foreign settlement source) is fine; it costs its neighbours' entry.
      const enter = stepCost(tile);
      const leave = enter > 0 ? enter : 1;
      for (let k = 0; k < 6; k++) {
        const m = nb[i * 6 + k] as number;
        if (m < 0) continue;
        const mt = map.tiles[m];
        if (!mt || stepCost(mt) === 0) continue;
        if (mt.settlement && owner !== undefined) {
          const s = state.settlements[mt.settlement];
          if (s && s.owner !== owner) continue;
        }
        const nd = c + leave;
        if (nd < (dist[m] as number) && nd <= maxCost) {
          dist[m] = nd;
          (buckets[nd] ??= []).push(m);
        }
      }
    }
  }
  return dist;
};

/** Movement cost over water only (ships), from every tile to the nearest of `sources`. */
export const waterField = (state: GameState, content: ContentBundle, sources: readonly number[], maxCost = 60): Int32Array => {
  const map = state.map;
  const n = map.tiles.length;
  const dist = new Int32Array(n).fill(UNREACHABLE);
  const nb = neighborTable(map);
  let frontier: number[] = [];
  for (const s of sources) {
    if (s < 0 || s >= n) continue;
    dist[s] = 0;
    frontier.push(s);
  }
  for (let c = 0; c < maxCost && frontier.length > 0; c++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (let k = 0; k < 6; k++) {
        const m = nb[i * 6 + k] as number;
        if (m < 0 || (dist[m] as number) <= c + 1) continue;
        const mt = map.tiles[m];
        if (!mt || !isWaterTile(mt, content)) continue;
        dist[m] = c + 1;
        next.push(m);
      }
    }
    frontier = next;
  }
  return dist;
};
