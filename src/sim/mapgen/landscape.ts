/**
 * Physical map pipeline (GDD §7 "Map"): continents → elevation → latitude climate bands →
 * rainfall and rivers → terrain and features. Works on flat index arrays; mapgen.ts assembles
 * the contract `Tile`s.
 */
import type { MapSize, Tile } from '@contracts/sim-api';
import { nextFloat, nextInt, nextRange, weightedIndex, type HasRng } from '../rng';
import { bfs, components, dist, type Grid } from './grid';
import { fbm, valueNoise } from './noise';
import { FEATURES, type TerrainRoles } from './roles';

export type Climate = Tile['climate'];

export interface Landscape {
  land: Uint8Array;
  /** 0 water/flat, 1 hills, 2+ mountain. */
  elevation: Int8Array;
  climate: Climate[];
  river: Uint8Array;
  terrain: string[];
  feature: (string | null)[];
  /** Landmass id per tile, 1-based; 0 = water. */
  continent: Int32Array;
  continentSizes: number[];
}

const CONTINENT_RANGE: Record<MapSize, [number, number]> = {
  small: [2, 3],
  standard: [2, 4],
  large: [3, 4],
};

/** Latitude thresholds on a 0 (equator) .. 1 (pole) scale, polar first. */
const CLIMATE_BANDS: readonly [Climate, number][] = [
  ['polar', 0.8],
  ['boreal', 0.62],
  ['temperate', 0.37],
  ['arid', 0.16],
  ['tropical', -Infinity],
];

const RAIN_BASE: Record<Climate, number> = {
  polar: -0.05,
  boreal: 0.08,
  temperate: 0.12,
  arid: -0.22,
  tropical: 0.3,
};

export const buildLandscape = (
  g: Grid,
  size: MapSize,
  roles: TerrainRoles,
  h: HasRng,
): Landscape => {
  const { width: W, height: H } = g;
  const land = shapeContinents(g, size, h);

  // Distance to water over land; 1 = coastal. Drives elevation, moisture and steppe interiors.
  const water: number[] = [];
  for (let i = 0; i < g.size; i++) if (!land[i]) water.push(i);
  const distWater = bfs(g, water, (i) => land[i] === 1);

  // --- Elevation: ridged noise (mountain chains) blended with distance from the sea.
  const ridgeBase = fbm(h, W, H, 7, 3);
  const elevNoise = fbm(h, W, H, 4, 2);
  const elevScore = new Float64Array(g.size);
  const landIdx: number[] = [];
  for (let i = 0; i < g.size; i++) {
    if (!land[i]) continue;
    landIdx.push(i);
    const ridge = 1 - Math.abs(2 * ridgeBase(g.wx[i] as number, g.wy[i] as number) - 1);
    const inland = Math.min(1, ((distWater[i] as number) - 1) / 4);
    elevScore[i] = 0.6 * ridge + 0.3 * inland + 0.25 * elevNoise(g.wx[i] as number, g.wy[i] as number);
  }
  const elevation = new Int8Array(g.size);
  const sortedByElev = landIdx.slice().sort((a, b) => (elevScore[b] as number) - (elevScore[a] as number) || a - b);
  const nMountain = Math.round(landIdx.length * 0.065);
  const nPeak = Math.round(landIdx.length * 0.015);
  const nHills = Math.round(landIdx.length * 0.16);
  sortedByElev.forEach((i, rank) => {
    elevation[i] = rank < nPeak ? 3 : rank < nMountain ? 2 : rank < nMountain + nHills ? 1 : 0;
  });

  // --- Climate: latitude with noise so bands are not straight lines.
  const latNoise = fbm(h, W, H, 6, 2);
  const midY = ((H - 1) * 0.866) / 2;
  const latitude = new Float64Array(g.size);
  const climate: Climate[] = [];
  for (let i = 0; i < g.size; i++) {
    const lat = Math.abs((g.wy[i] as number) - midY) / midY + (latNoise(g.wx[i] as number, g.wy[i] as number) - 0.5) * 0.2;
    latitude[i] = lat;
    climate.push((CLIMATE_BANDS.find(([, t]) => lat >= t) as [Climate, number])[0]);
  }

  // --- Rainfall: noise + maritime moisture + climate base.
  const rainNoise = fbm(h, W, H, 6, 3);
  const rain = new Float64Array(g.size);
  for (const i of landIdx) {
    const maritime = Math.exp(-((distWater[i] as number) - 1) / 2.5);
    rain[i] =
      0.55 * rainNoise(g.wx[i] as number, g.wy[i] as number) + 0.3 * maritime + RAIN_BASE[climate[i] as Climate];
  }

  // --- Rivers: follow the BFS gradient (through non-mountain land) to the sea, so every river
  // provably ends next to water and never crosses a mountain.
  const river = new Uint8Array(g.size);
  const riverDist = bfs(g, water, (i) => land[i] === 1 && (elevation[i] as number) < 2);
  const flowTie = valueNoise(h, W, H, 2);
  const runRiver = (src: number): void => {
    let cur = src;
    for (;;) {
      if (river[cur]) return; // joined an existing river, which already reaches the sea
      river[cur] = 1;
      const d = riverDist[cur] as number;
      if (d <= 1) return;
      let best = -1;
      let bestTie = Infinity;
      for (const n of g.neighbors[cur] as number[]) {
        if (riverDist[n] !== d - 1 || !land[n]) continue;
        const tie = flowTie(g.wx[n] as number, g.wy[n] as number);
        if (tie < bestTie) {
          bestTie = tie;
          best = n;
        }
      }
      if (best < 0) return; // unreachable by construction of the BFS
      cur = best;
    }
  };
  const nearHigh = (i: number): boolean =>
    (g.neighbors[i] as number[]).some((n) => (elevation[n] as number) >= 1);
  const sourceCands = landIdx.filter((i) => {
    const d = riverDist[i] as number;
    return d >= 3 && d !== Infinity && (elevation[i] as number) < 2;
  });
  const riverCount = Math.max(3, Math.round(landIdx.length / 55));
  const sources: number[] = [];
  const weights = sourceCands.map((i) => Math.max(0.1, rain[i] as number) * (nearHigh(i) ? 2 : 0.6));
  for (let attempt = 0; attempt < riverCount * 6 && sources.length < riverCount && sourceCands.length > 0; attempt++) {
    const k = weightedIndex(h, weights);
    const s = sourceCands[k] as number;
    if (river[s] || sources.some((o) => dist(g, o, s) < 4)) continue;
    sources.push(s);
    runRiver(s);
  }

  // --- Continents (flood fill) — needed here to guarantee an arid river per big landmass.
  const comp = components(g, (i) => land[i] === 1);
  const continent = new Int32Array(g.size);
  for (let i = 0; i < g.size; i++) continent[i] = (comp.id[i] as number) + 1;

  // Floodplains need rivers through arid land (GDD §4 signals: owned_floodplain). Make sure each
  // sizeable landmass that reaches the arid band has one, like the Nile or the Tigris.
  comp.sizes.forEach((sz, c) => {
    if (sz < 30) return;
    const arid = landIdx.filter((i) => comp.id[i] === c && climate[i] === 'arid');
    if (arid.length === 0 || arid.some((i) => river[i])) return;
    let best = -1;
    for (const i of arid) {
      const d = riverDist[i] as number;
      if (d === Infinity || river[i]) continue;
      if (best < 0 || d > (riverDist[best] as number)) best = i;
    }
    if (best >= 0 && (riverDist[best] as number) >= 2) runRiver(best);
  });

  // --- Terrain and features.
  const veg = fbm(h, W, H, 4, 2);
  const wet = fbm(h, W, H, 3, 2);
  const terrain: string[] = new Array<string>(g.size);
  const feature: (string | null)[] = new Array<string | null>(g.size).fill(null);
  for (let i = 0; i < g.size; i++) {
    if (!land[i]) {
      const coastal = (g.neighbors[i] as number[]).some((n) => land[n] === 1);
      terrain[i] = coastal ? roles.coast : roles.ocean;
      continue;
    }
    const e = elevation[i] as number;
    if (e >= 2) {
      terrain[i] = roles.mountain;
      continue;
    }
    const c = climate[i] as Climate;
    const r = rain[i] as number;
    const lat = latitude[i] as number;
    const dw = distWater[i] as number;
    const v = veg(g.wx[i] as number, g.wy[i] as number);
    const m = wet(g.wx[i] as number, g.wy[i] as number);
    const isRiver = river[i] === 1;
    let t: string;
    let f: string | null = null;
    switch (c) {
      case 'polar':
        t = lat > 0.92 || (lat > 0.86 && r < 0.35) ? roles.snow : roles.tundra;
        break;
      case 'boreal':
        if (r < 0.46 && dw >= 2 && !isRiver) t = roles.steppe;
        else if (lat > 0.72) t = roles.tundra;
        else t = r > 0.55 ? roles.grassland : roles.plains;
        if (t !== roles.steppe && r > 0.42 && v > 0.45) f = FEATURES.forest;
        break;
      case 'temperate':
        if (r < 0.44 && dw >= 2 && !isRiver) t = roles.steppe;
        else t = r < 0.62 ? roles.plains : roles.grassland;
        if (t !== roles.steppe) {
          if (r > 0.7 && m > 0.62 && (dw <= 1 || isRiver)) f = FEATURES.marsh;
          else if (r > 0.5 && v > 0.5) f = FEATURES.forest;
        }
        break;
      case 'arid':
        if (isRiver) t = roles.floodplain;
        else t = r < 0.33 ? roles.desert : r < 0.55 ? roles.plains : roles.grassland;
        break;
      case 'tropical':
        t = r < 0.55 ? roles.plains : roles.grassland;
        if (r > 0.7 && m > 0.6 && (dw <= 1 || isRiver)) f = FEATURES.marsh;
        else if (r > 0.5 && v > 0.4) f = FEATURES.jungle;
        break;
    }
    if (e === 1) {
      // Hills are a feature (Tile contract). Floodplain is flat river bottomland.
      if (t === roles.floodplain) t = roles.desert;
      f = FEATURES.hills;
    }
    terrain[i] = t;
    feature[i] = f;
  }

  // Oases: rare, isolated springs in open desert.
  for (const i of landIdx) {
    if (terrain[i] !== roles.desert || feature[i] !== null || river[i]) continue;
    const nb = g.neighbors[i] as number[];
    if (nb.some((n) => river[n] || feature[n] === FEATURES.oasis)) continue;
    if (nextFloat(h) < 0.06) feature[i] = FEATURES.oasis;
  }

  return {
    land,
    elevation,
    climate,
    river,
    terrain,
    feature,
    continent,
    continentSizes: comp.sizes,
  };
};

/**
 * Land mask: 2–4 tall continents laid out west to east so each spans several climate bands,
 * separated by ocean channels, thresholded to a land fraction of ~37–43%.
 */
const shapeContinents = (g: Grid, size: MapSize, h: HasRng): Uint8Array => {
  const { width: W, height: H } = g;
  const [lo, hi] = CONTINENT_RANGE[size];
  const n = lo + nextInt(h, hi - lo + 1);
  const worldW = W;
  const worldH = (H - 1) * 0.866;
  const slot = worldW / n;
  const centers = Array.from({ length: n }, (_, k) => ({
    x: slot * (k + 0.5) + nextRange(h, -0.12, 0.12) * slot,
    y: worldH / 2 + nextRange(h, -0.08, 0.08) * worldH,
    rx: slot * nextRange(h, 0.42, 0.52),
    ry: worldH * nextRange(h, 0.55, 0.68),
  }));
  const shape = fbm(h, W, H, 6, 4);
  const score = new Float64Array(g.size);
  for (let i = 0; i < g.size; i++) {
    const x = g.wx[i] as number;
    const y = g.wy[i] as number;
    let d1 = Infinity;
    let d2 = Infinity;
    for (const c of centers) {
      const d = Math.hypot((x - c.x) / c.rx, (y - c.y) / c.ry);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) d2 = d;
    }
    const gap = d2 - d1;
    let s = 1 - d1 + (shape(x, y) - 0.5) * 1.1;
    if (gap < 0.4) s -= (0.4 - gap) * 2.2; // ocean channel between continents
    const col = i % W;
    const edge = Math.min(col, W - 1 - col);
    if (edge <= 1) s -= 3;
    else if (edge === 2) s -= 0.35;
    score[i] = s;
  }
  const target = Math.round(g.size * nextRange(h, 0.37, 0.43));
  const order = Array.from({ length: g.size }, (_, i) => i).sort(
    (a, b) => (score[b] as number) - (score[a] as number) || a - b,
  );
  const land = new Uint8Array(g.size);
  for (let k = 0; k < target; k++) land[order[k] as number] = 1;

  // Fill tiny lakes and drop specks so coastlines read cleanly.
  const lakes = components(g, (i) => land[i] === 0);
  for (let i = 0; i < g.size; i++) if (!land[i] && (lakes.sizes[lakes.id[i] as number] as number) <= 4) land[i] = 1;
  const isles = components(g, (i) => land[i] === 1);
  for (let i = 0; i < g.size; i++) if (land[i] && (isles.sizes[isles.id[i] as number] as number) <= 2) land[i] = 0;
  return land;
};
