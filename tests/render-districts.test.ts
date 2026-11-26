/**
 * Districts on REAL generated maps (playtest 3: pop 5–7 cities showed no districts because
 * real starts sit among hills, woods and resources). Reads the map exactly as the renderer does
 * (districts.ts districtNeighbor + terrain-style RESOURCE_ART).
 */
import { describe, expect, it } from 'vitest';
import { HEX_DIRECTIONS, type Hex } from '../src/contracts/hex';
import type { MapState } from '../src/contracts/sim-api';
import { loadContent } from '../src/content';
import { districtNeighbor, districtPlan, type DistrictNeighbor } from '../src/render/districts';
import { tileIndex } from '../src/render/layout';
import { RESOURCE_ART } from '../src/render/terrain-style';
import { generateMap } from '../src/sim/mapgen';
import { seedRng } from '../src/sim/rng';

const content = loadContent();
const water = new Map(content.terrain.map((t) => [t.id, t.water]));
const mountain = new Map(content.terrain.map((t) => [t.id, !t.water && t.moveCost === null]));

const neighborsOf = (map: MapState, at: Hex): DistrictNeighbor[] => {
  const out: DistrictNeighbor[] = [];
  HEX_DIRECTIONS.forEach((d, dir) => {
    const t = map.tiles[tileIndex({ q: at.q + d.q, r: at.r + d.r }, map.width, map.height)];
    if (!t) return;
    const nb = districtNeighbor(dir, {
      water: water.get(t.terrain) ?? false,
      mountain: mountain.get(t.terrain) ?? false,
      feature: t.feature,
      resource: t.resource ? (RESOURCE_ART[t.resource]?.prop ?? 'other') : null,
      settled: false,
    });
    if (nb) out.push(nb);
  });
  return out;
};

const plan = (id: string, pop: number, kind: 'town' | 'city', neighbors: DistrictNeighbor[]) =>
  districtPlan({ id, population: pop, kind, capital: false, cityState: false, neighbors });

describe('districts on real generated maps', () => {
  const maps = [1, 7, 42, 2026].flatMap((seed) =>
    (['small', 'standard'] as const).map((size) => ({ seed, size, g: generateMap(size, 4, content, { rng: seedRng(seed) }) })),
  );

  it('every start: pop 3 shows fields (or terraces), pop 6 shows at least two districts', () => {
    for (const { seed, size, g } of maps) {
      g.starts.forEach((at, k) => {
        const nb = neighborsOf(g.map, at);
        const id = `s${seed}-${size}-${k}`;
        expect(plan(id, 3, 'town', nb).length, `${id} pop 3`).toBeGreaterThanOrEqual(1);
        expect(plan(id, 6, 'town', nb).length, `${id} pop-6 town`).toBeGreaterThanOrEqual(2);
        expect(plan(id, 6, 'city', nb).length, `${id} pop-6 city`).toBeGreaterThanOrEqual(3);
      });
    }
  });

  it('almost every plausible city site shows ≥ 2 districts at pop 6', () => {
    let sites = 0;
    let ok = 0;
    for (const { g } of maps) {
      const { map } = g;
      for (const t of map.tiles) {
        if (water.get(t.terrain) || mountain.get(t.terrain)) continue;
        const nb = neighborsOf(map, t);
        // A plausible site: at least three usable neighbors (not a lone spit of land).
        if (nb.length < 3) continue;
        sites++;
        if (plan(`t${t.q},${t.r}`, 6, 'city', nb).length >= 2) ok++;
      }
    }
    expect(sites).toBeGreaterThan(500);
    expect(ok / sites).toBeGreaterThanOrEqual(0.99);
  });

  it('fallbacks: hills terrace, woods host a camp, ore a quarry, herds a pasture', () => {
    const ring = (n: Partial<DistrictNeighbor>[]): DistrictNeighbor[] => n.map((x, dir) => ({ dir, water: false, open: false, ...x }));
    const kinds = (nb: DistrictNeighbor[]) => plan('x', 8, 'town', nb).map((d) => d.kind);
    expect(kinds(ring([{ hills: true }, { hills: true }]))).toEqual(['terraces', 'terraces']);
    expect(kinds(ring([{ wooded: true }]))).toEqual(['camp']);
    expect(kinds(ring([{ resource: 'ore' }]))).toEqual(['quarry']);
    expect(kinds(ring([{ resource: 'animal' }]))).toEqual(['pasture']);
    // Open land still wins first: the first fields go on open land, not the hills.
    expect(plan('x', 2, 'town', ring([{ hills: true }, { open: true }]))).toEqual([{ dir: 1, kind: 'fields' }]);
  });
});
