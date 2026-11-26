/**
 * Fair start and city-state site selection (GDD §7 "Map": fair starts, each reaching 3+ biomes).
 * Starts are spread far apart and deliberately into different climates, so players begin with
 * different home signals for the emergence engine (GDD §4).
 */
import type { ContentBundle } from '@contracts/content-schemas';
import { FEATURE_YIELDS } from '../constants';
import type { Climate } from './landscape';
import { dist, inRange, type Grid } from './grid';

export interface SiteInput {
  g: Grid;
  terrain: readonly string[];
  feature: readonly (string | null)[];
  resource: readonly (string | null)[];
  river: Uint8Array;
  climate: readonly Climate[];
  continent: Int32Array;
  continentSizes: readonly number[];
  isWater: (i: number) => boolean;
  /** Excluded from starts and city-state sites (snow). */
  barren: (i: number) => boolean;
  content: ContentBundle;
}

interface Cand {
  i: number;
  q: number;
  climate: Climate;
  /** Counts toward the climate-diversity bonus (uncompensated tropical starts do not). */
  diverse: boolean;
}

/** Minimum landmass size for a start: room for the capital plus 2+ more settlements. */
const START_CONTINENT_MIN = 30;
const START_LAND_RADIUS4_MIN = 26;
const START_FOOD_MIN = 15;
const START_KINDS_MIN = 3;
const SITE_SPACING = 6;
/**
 * Start quality (fun-and-fairness pass 2). Food beyond this many points within 2 tiles adds
 * nothing: food-rich jungle starts used to win the quality ranking, so the first seat (the
 * human's) started tropical in ~half of all maps, then grew a big, unproductive, unhappy
 * capital and finished last. Production counts instead, per point.
 */
const START_FOOD_CAP = 26;
const START_PRODUCTION_WEIGHT = 1.4;
/**
 * No culture's signals reward tropical land (content/signals.json), and jungle is slow land:
 * a tropical start needs compensating geography (a river or coast at the center, or a luxury
 * within 2) to rank as a good start or to count toward climate diversity. Otherwise it is
 * pushed down the ranking by this much, so it is chosen only when nothing better exists.
 */
const TROPICAL_UNCOMPENSATED_PENALTY = 8;

const tileFood = (s: SiteInput, foodOf: Map<string, number>, i: number): number =>
  (foodOf.get(s.terrain[i] as string) ?? 0) + (foodOf.get(`res:${s.resource[i] ?? ''}`) ?? 0);

const foodTable = (content: ContentBundle): Map<string, number> => {
  const m = new Map<string, number>();
  for (const t of content.terrain) m.set(t.id, t.yields.food ?? 0);
  for (const r of content.resources) m.set(`res:${r.id}`, r.yields.food ?? 0);
  return m;
};

const tileProduction = (s: SiteInput, i: number): number => {
  const t = s.content.terrain.find((x) => x.id === s.terrain[i]);
  const f = s.feature[i];
  const r = s.resource[i] ? s.content.resources.find((x) => x.id === s.resource[i]) : undefined;
  return (t?.yields.production ?? 0) + (f ? (FEATURE_YIELDS[f]?.production ?? 0) : 0) + (r?.yields.production ?? 0);
};

const hasLuxuryWithin = (s: SiteInput, i: number, radius: number): boolean =>
  inRange(s.g, i, radius).some((j) => {
    const id = s.resource[j];
    return id !== null && id !== undefined && s.content.resources.find((r) => r.id === id)?.class === 'luxury';
  });

const passableLand = (s: SiteInput, i: number): boolean => {
  if (s.isWater(i) || s.barren(i)) return false;
  const t = s.content.terrain.find((x) => x.id === s.terrain[i]);
  return t !== undefined && t.moveCost !== null;
};

/** Distinct land terrain + feature kinds within `radius`. */
export const kindsWithin = (
  g: Grid,
  terrain: readonly string[],
  feature: readonly (string | null)[],
  isWater: (i: number) => boolean,
  i: number,
  radius: number,
): number => {
  const kinds = new Set<string>();
  for (const j of inRange(g, i, radius)) {
    if (isWater(j)) continue;
    kinds.add(`t:${terrain[j] as string}`);
    const f = feature[j];
    if (f) kinds.add(`f:${f}`);
  }
  return kinds.size;
};

export const startCandidates = (s: SiteInput): Cand[] => {
  const { g } = s;
  const food = foodTable(s.content);
  const out: Cand[] = [];
  for (let i = 0; i < g.size; i++) {
    if (!passableLand(s, i)) continue;
    const col = i % g.width;
    const row = Math.floor(i / g.width);
    if (col < 2 || col > g.width - 3 || row < 2 || row > g.height - 3) continue;
    const climate = s.climate[i] as Climate;
    if (climate === 'polar') continue;
    if ((s.continentSizes[(s.continent[i] as number) - 1] ?? 0) < START_CONTINENT_MIN) continue;
    const nb = g.neighbors[i] as number[];
    if (nb.filter((n) => !s.isWater(n)).length < 4) continue;
    const kinds = kindsWithin(g, s.terrain, s.feature, s.isWater, i, 3);
    if (kinds < START_KINDS_MIN) continue;
    let f = 0;
    let prod = 0;
    let res = 0;
    for (const j of inRange(g, i, 2)) {
      f += tileFood(s, food, j);
      if (!s.isWater(j)) prod += tileProduction(s, j);
      if (s.river[j]) f += 0.5;
      if (s.resource[j] !== null && j !== i) res++;
    }
    if (f < START_FOOD_MIN) continue;
    const land4 = inRange(g, i, 4).filter((j) => !s.isWater(j)).length;
    if (land4 < START_LAND_RADIUS4_MIN) continue;
    const coastal = nb.some((n) => s.isWater(n));
    let q =
      Math.min(f, START_FOOD_CAP) + START_PRODUCTION_WEIGHT * prod + 1.5 * kinds + (s.river[i] ? 3 : 0) + (coastal ? 2 : 0) + res + (s.feature[i] === 'hills' ? 1 : 0);
    const compensated = climate !== 'tropical' || s.river[i] === 1 || coastal || hasLuxuryWithin(s, i, 2);
    if (!compensated) q -= TROPICAL_UNCOMPENSATED_PENALTY;
    out.push({ i, q, climate, diverse: compensated });
  }
  return out;
};

const minDistTo = (g: Grid, i: number, set: readonly number[]): number => {
  let d = Infinity;
  for (const j of set) d = Math.min(d, dist(g, i, j));
  return d;
};

/**
 * Greedy farthest-point selection with a climate-diversity bonus, run from several seeds;
 * the set with the best (min pairwise distance, distinct climates, quality) wins.
 * Returns `count` starts followed by up to `extra` more, best first.
 */
/**
 * Playtest 3 ("never met a rival in 43 turns on the small map"): starts used to be pushed as
 * far apart as the map allowed (20–40 tiles on a 48-wide map) and, on every seed tried, onto
 * different landmasses. Separation beyond `cap` now earns nothing, and each pair of starts
 * sharing a landmass earns SHARED_LAND_BONUS, so rivals live within reach of a scout.
 */
export interface StartOptions {
  /** Separation beyond this counts no more (default 24, the old behaviour). */
  cap?: number;
  /** Landmass id per tile; when given, starts sharing one are preferred. */
  continent?: Int32Array;
}
const SHARED_LAND_BONUS = 9;

export const chooseStarts = (g: Grid, cands: readonly Cand[], count: number, extra: number, opts: StartOptions = {}): number[] => {
  const cap = opts.cap ?? 24;
  const land = (i: number): number => opts.continent?.[i] ?? 0;
  const sharedPairs = (set: readonly Cand[]): number => {
    if (!opts.continent) return 0;
    let n = 0;
    for (let a = 0; a < set.length; a++) for (let b = a + 1; b < set.length; b++) if (land((set[a] as Cand).i) === land((set[b] as Cand).i)) n++;
    return n;
  };
  if (cands.length === 0) return [];
  const qMax = Math.max(...cands.map((c) => c.q));
  const qMin = Math.min(...cands.map((c) => c.q));
  const qn = (c: Cand): number => (qMax > qMin ? (c.q - qMin) / (qMax - qMin) : 1);
  const byQ = cands.slice().sort((a, b) => b.q - a.q || a.i - b.i);

  const grow = (first: Cand, n: number, chosen: Cand[] = [first]): Cand[] => {
    while (chosen.length < n) {
      const climates = new Set(chosen.filter((c) => c.diverse).map((c) => c.climate));
      let best: Cand | null = null;
      let bestScore = -Infinity;
      for (const c of cands) {
        const d = minDistTo(
          g,
          c.i,
          chosen.map((x) => x.i),
        );
        if (d < 4) continue;
        const sameLand = opts.continent ? chosen.filter((x) => land(x.i) === land(c.i)).length : 0;
        const score = Math.min(d, cap + 6) + 6 * qn(c) + (!c.diverse || climates.has(c.climate) ? 0 : 5) + 3 * sameLand;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (!best) break;
      chosen.push(best);
    }
    return chosen;
  };

  let bestSet: Cand[] = [];
  let bestValue = -Infinity;
  const seeds = byQ.slice(0, 8);
  // Also seed from the best candidate of each climate, so diverse sets get a fair shot.
  for (const c of byQ) if (c.diverse && !seeds.some((s) => s.climate === c.climate)) seeds.push(c);
  for (const seed of seeds) {
    const set = grow(seed, count);
    let minD = Infinity;
    for (let a = 0; a < set.length; a++)
      for (let b = a + 1; b < set.length; b++) minD = Math.min(minD, dist(g, (set[a] as Cand).i, (set[b] as Cand).i));
    if (set.length < 2) minD = 30;
    const climates = new Set(set.filter((c) => c.diverse).map((c) => c.climate)).size;
    const quality = set.reduce((acc, c) => acc + qn(c), 0) / Math.max(1, set.length);
    const value = set.length * 1000 + Math.min(minD, cap) * 2 + climates * 4 + quality * 3 + SHARED_LAND_BONUS * sharedPairs(set);
    if (value > bestValue) {
      bestValue = value;
      bestSet = set;
    }
  }
  const full = grow(bestSet[0] as Cand, count + extra, bestSet.slice());
  return full.map((c) => c.i);
};

/** City-state sites: ≥ SITE_SPACING from every start and each other, spread across climates. */
export const chooseCityStateSites = (s: SiteInput, starts: readonly number[], want: number): number[] => {
  const { g } = s;
  const cands: Cand[] = [];
  for (let i = 0; i < g.size; i++) {
    if (!passableLand(s, i)) continue;
    if ((s.continentSizes[(s.continent[i] as number) - 1] ?? 0) < 8) continue;
    const nb = g.neighbors[i] as number[];
    if (nb.filter((n) => !s.isWater(n)).length < 3) continue;
    if (minDistTo(g, i, starts) < SITE_SPACING) continue;
    const kinds = kindsWithin(g, s.terrain, s.feature, s.isWater, i, 2);
    if (kinds < 2) continue;
    cands.push({ i, q: kinds + (s.river[i] ? 1 : 0) + (nb.some((n) => s.isWater(n)) ? 1 : 0), climate: s.climate[i] as Climate, diverse: true });
  }
  const chosen: Cand[] = [];
  while (chosen.length < want) {
    const climates = new Map<Climate, number>();
    for (const c of chosen) climates.set(c.climate, (climates.get(c.climate) ?? 0) + 1);
    let best: Cand | null = null;
    let bestScore = -Infinity;
    for (const c of cands) {
      const d = minDistTo(
        g,
        c.i,
        chosen.map((x) => x.i),
      );
      if (d < SITE_SPACING) continue;
      const ds = Math.min(d, 12) + Math.min(minDistTo(g, c.i, starts), 10) * 0.5;
      const score = ds + c.q * 0.5 - 3 * (climates.get(c.climate) ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen.map((c) => c.i);
};
