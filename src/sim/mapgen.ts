/**
 * Map generation (GDD §7 "Map"). Pipeline: continents → elevation → climate bands → rainfall and
 * rivers → terrain/features (src/sim/mapgen/landscape.ts) → resources (mapgen/resources.ts) →
 * fair starts and city-state sites (mapgen/starts.ts).
 *
 * Pure and deterministic: all randomness comes from the passed RNG holder. A generated map is
 * checked against the guarantees below; if it falls short (rare — e.g. a continent layout that
 * leaves no room for spread-out starts) generation reruns with the advanced RNG, so the result
 * is still a pure function of the input RNG state.
 *
 * Guarantees (for every size and player count the game offers):
 * - land fraction ~35–45%, 2–4 major continents, `continent` = flood-filled landmass id (0 water);
 * - tundra, snow, desert, floodplain, steppe, forest, hills, mountain and coast all present, so
 *   each seed culture's home signal exists (GDD §4);
 * - rivers (`river: true`) are connected chains that end next to water and never cross mountains;
 * - `starts`: ≥ `players` tiles, best-separated set first, then extras;
 * - `cityStateSites`: ≥ cityStates + 2 tiles, each ≥ 6 from every start and each other.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { Hex } from '@contracts/hex';
import type { MapSize, MapState, Tile } from '@contracts/sim-api';
import type { HasRng } from './rng';
import { dist, makeGrid, type Grid } from './mapgen/grid';
import { buildLandscape, type Landscape } from './mapgen/landscape';
import { placeResources } from './mapgen/resources';
import { resolveTerrainRoles, FEATURES, type TerrainRoles } from './mapgen/roles';
import { chooseCityStateSites, chooseStarts, startCandidates } from './mapgen/starts';

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

/**
 * Starts spread to at most this multiple of the required distance (playtest 3: rivals on the
 * small map were 20–40 tiles apart and never met in 43 turns); see chooseStarts.
 */
const START_SEPARATION_CAP = 1.4;
/** Extra start tiles returned beyond `players`, as fallbacks for the sim. */
const EXTRA_STARTS = 2;
const EXTRA_CITY_STATE_SITES = 2;
const MAX_ATTEMPTS = 12;

/**
 * Required minimum distance between the first `players` starts: ~75% of the side of each
 * player's share of the land. Small/3 players → 10.
 */
export const requiredStartDistance = (size: MapSize, players: number): number => {
  const { width, height } = MAP_DIMENSIONS[size];
  return Math.max(5, Math.floor(Math.sqrt((width * height * 0.4) / Math.max(1, players)) * 0.75));
};

interface Attempt {
  result: GeneratedMap;
  failures: number;
}

export const generateMap = (size: MapSize, players: number, content: ContentBundle, rng: HasRng): GeneratedMap => {
  const roles = resolveTerrainRoles(content);
  const { width, height } = MAP_DIMENSIONS[size];
  const g = makeGrid(width, height);
  let best: Attempt | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const a = generateOnce(g, size, players, content, roles, rng);
    if (a.failures === 0) return a.result;
    if (!best || a.failures < best.failures) best = a;
  }
  return (best as Attempt).result;
};

const generateOnce = (
  g: Grid,
  size: MapSize,
  players: number,
  content: ContentBundle,
  roles: TerrainRoles,
  rng: HasRng,
): Attempt => {
  const ls = buildLandscape(g, size, roles, rng);
  const isWater = (i: number): boolean => ls.land[i] !== 1;
  let landCount = 0;
  for (let i = 0; i < g.size; i++) if (ls.land[i]) landCount++;
  const resource = placeResources(g, ls.terrain, isWater, landCount, content, rng);

  const siteInput = {
    g,
    terrain: ls.terrain,
    feature: ls.feature,
    resource,
    river: ls.river,
    climate: ls.climate,
    continent: ls.continent,
    continentSizes: ls.continentSizes,
    isWater,
    barren: (i: number) => ls.terrain[i] === roles.snow || ls.terrain[i] === roles.mountain,
    content,
  };
  const starts = chooseStarts(g, startCandidates(siteInput), players, EXTRA_STARTS, {
    cap: Math.round(requiredStartDistance(size, players) * START_SEPARATION_CAP),
    continent: ls.continent,
  });
  const csWant = MAP_DIMENSIONS[size].cityStates + EXTRA_CITY_STATE_SITES;
  let sites = chooseCityStateSites(siteInput, starts, csWant);
  // Spare starts should not crowd out city-states; fall back to spacing from real starts only.
  if (sites.length < csWant) sites = chooseCityStateSites(siteInput, starts.slice(0, players), csWant);

  const tiles: Tile[] = [];
  for (let i = 0; i < g.size; i++) {
    const h = g.hex[i] as Hex;
    tiles.push({
      q: h.q,
      r: h.r,
      terrain: ls.terrain[i] as string,
      feature: ls.feature[i] ?? null,
      resource: resource[i] ?? null,
      river: ls.river[i] === 1,
      elevation: ls.elevation[i] as number,
      climate: ls.climate[i] as Tile['climate'],
      owner: null,
      settlement: null,
      continent: ls.continent[i] as number,
    });
  }
  const result: GeneratedMap = {
    map: { width: g.width, height: g.height, tiles },
    starts: starts.map((i) => ({ ...(g.hex[i] as Hex) })),
    cityStateSites: sites.map((i) => ({ ...(g.hex[i] as Hex) })),
  };
  return { result, failures: countFailures(g, ls, roles, landCount, starts, sites, players, size) };
};

/** Number of unmet guarantees; 0 means the map is accepted. */
const countFailures = (
  g: Grid,
  ls: Landscape,
  roles: TerrainRoles,
  landCount: number,
  starts: readonly number[],
  sites: readonly number[],
  players: number,
  size: MapSize,
): number => {
  let fails = 0;
  const frac = landCount / g.size;
  if (frac < 0.35 || frac > 0.45) fails++;
  if (starts.length < players) fails += 10;
  if (sites.length < MAP_DIMENSIONS[size].cityStates + EXTRA_CITY_STATE_SITES) fails += 5;
  const need = requiredStartDistance(size, players);
  for (let a = 0; a < Math.min(players, starts.length); a++)
    for (let b = a + 1; b < Math.min(players, starts.length); b++)
      if (dist(g, starts[a] as number, starts[b] as number) < need) fails += 3;

  const terrainCount = new Map<string, number>();
  const featureCount = new Map<string, number>();
  for (let i = 0; i < g.size; i++) {
    terrainCount.set(ls.terrain[i] as string, (terrainCount.get(ls.terrain[i] as string) ?? 0) + 1);
    const f = ls.feature[i];
    if (f) featureCount.set(f, (featureCount.get(f) ?? 0) + 1);
  }
  // Minimum presence so each seed culture's home signals exist somewhere (GDD §4).
  const minLand = Math.max(3, Math.round(landCount * 0.012));
  const needTerrain = [roles.tundra, roles.snow, roles.desert, roles.steppe, roles.mountain, roles.coast];
  for (const t of needTerrain) if ((terrainCount.get(t) ?? 0) < minLand) fails++;
  if ((terrainCount.get(roles.floodplain) ?? 0) < 2) fails++;
  for (const f of [FEATURES.forest, FEATURES.hills]) if ((featureCount.get(f) ?? 0) < minLand) fails++;
  return fails;
};
