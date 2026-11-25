/**
 * Resource placement (GDD §7 "Map"). Fully data-driven: every resource in content/resources.json
 * is eligible on exactly the terrains its `terrains` list names, so new resources need no code.
 * Luxuries cluster around a few regional centers so regions differ (and pull different
 * cultures through resource signals, GDD §4).
 */
import type { ContentBundle, Resource } from '@contracts/content-schemas';
import { nextFloat, nextInt, shuffle, weightedIndex, type HasRng } from '../rng';
import { dist, type Grid } from './grid';

/** ~1 resource per 8 land tiles (counting coastal fish against the land total). */
const LAND_TILES_PER_RESOURCE = 8;
const CLASS_WEIGHT: Record<Resource['class'], number> = { bonus: 1, strategic: 0.7, luxury: 1.8 };
/** Water tiles are plentiful; damp their acceptance so sea resources don't crowd out land ones. */
const WATER_ACCEPT = 0.3;
const LUXURY_REGION_RADIUS = 5;

export const placeResources = (
  g: Grid,
  terrain: readonly string[],
  isWater: (i: number) => boolean,
  landCount: number,
  content: ContentBundle,
  h: HasRng,
): (string | null)[] => {
  const out: (string | null)[] = new Array<string | null>(g.size).fill(null);
  const resources = content.resources;
  const eligible: number[][] = resources.map(() => []);
  const byTerrain = new Map<string, number[]>();
  resources.forEach((res, k) => {
    for (const t of res.terrains) {
      const list = byTerrain.get(t) ?? [];
      list.push(k);
      byTerrain.set(t, list);
    }
  });
  for (let i = 0; i < g.size; i++) {
    for (const k of byTerrain.get(terrain[i] as string) ?? []) (eligible[k] as number[]).push(i);
  }

  // Luxury region centers, spread apart from each other so each region has its own flavor.
  const centers: number[][] = resources.map(() => []);
  const allCenters: number[] = [];
  const regionsPerLuxury = landCount > 900 ? 2 : landCount > 450 ? 2 : 1;
  resources.forEach((res, k) => {
    const cands = eligible[k] as number[];
    if (res.class !== 'luxury' || cands.length === 0) return;
    for (let r = 0; r < regionsPerLuxury; r++) {
      let best = -1;
      let bestD = -1;
      for (let s = 0; s < 10; s++) {
        const c = cands[nextInt(h, cands.length)] as number;
        let d = 99;
        for (const o of allCenters) d = Math.min(d, dist(g, c, o));
        if (d > bestD) {
          bestD = d;
          best = c;
        }
      }
      (centers[k] as number[]).push(best);
      allCenters.push(best);
    }
  });
  const regionWeight = (k: number, i: number): number => {
    const cs = centers[k] as number[];
    let w = 0;
    for (const c of cs) w = Math.max(w, Math.exp(-dist(g, c, i) / LUXURY_REGION_RADIUS));
    return w;
  };

  const free = (i: number): boolean =>
    out[i] === null && !(g.neighbors[i] as number[]).some((n) => out[n] !== null);
  let placed = 0;

  // Pass 1: every resource whose terrain exists appears at least once (signals depend on them).
  for (const k of shuffle(h, resources.map((_, k) => k))) {
    const cands = (eligible[k] as number[]).filter(free);
    if (cands.length === 0) continue;
    const res = resources[k] as Resource;
    const w = cands.map((i) => (res.class === 'luxury' ? regionWeight(k, i) + 0.01 : 1));
    out[cands[weightedIndex(h, w)] as number] = res.id;
    placed++;
  }

  // Pass 2: fill to the target density.
  const target = Math.round(landCount / LAND_TILES_PER_RESOURCE);
  const cands: number[] = [];
  for (let i = 0; i < g.size; i++) if ((byTerrain.get(terrain[i] as string) ?? []).length > 0) cands.push(i);
  for (const i of shuffle(h, cands)) {
    if (placed >= target) break;
    if (!free(i)) continue;
    if (isWater(i) && nextFloat(h) > WATER_ACCEPT) continue;
    const ks = byTerrain.get(terrain[i] as string) ?? [];
    const w = ks.map((k) => {
      const res = resources[k] as Resource;
      return CLASS_WEIGHT[res.class] * (res.class === 'luxury' ? regionWeight(k, i) : 1);
    });
    let total = 0;
    for (const x of w) total += x;
    if (total < 0.15) continue;
    out[i] = (resources[ks[weightedIndex(h, w)] as number] as Resource).id;
    placed++;
  }
  return out;
};
