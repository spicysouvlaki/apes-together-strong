import { describe, expect, it } from 'vitest';
import { axialToOffset, hexDistance, hexNeighbors, type Hex } from '@contracts/hex';
import type { MapSize, MapState, Tile } from '@contracts/sim-api';
import { loadContent } from '../src/content/index';
import { generateMap, MAP_DIMENSIONS, type GeneratedMap } from '../src/sim/mapgen';
import { seedRng } from '../src/sim/rng';

const content = loadContent();
const terrainById = new Map(content.terrain.map((t) => [t.id, t]));
const isWater = (t: Tile): boolean => terrainById.get(t.terrain)?.water === true;

const gen = (seed: number, size: MapSize = 'small', players = 3): GeneratedMap =>
  generateMap(size, players, content, { rng: seedRng(seed) });

const tileAt = (map: MapState, h: Hex): Tile | undefined => {
  const { col, row } = axialToOffset(h);
  if (col < 0 || col >= map.width || row < 0 || row >= map.height) return undefined;
  return map.tiles[row * map.width + col];
};
const neighborsOf = (map: MapState, t: Tile): Tile[] =>
  hexNeighbors(t).flatMap((n) => {
    const x = tileAt(map, n);
    return x ? [x] : [];
  });

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const smallMaps = SEEDS.map((s) => gen(s));

describe('mapgen determinism', () => {
  it('same seed gives deep-equal output and advances the rng identically', () => {
    const a = { rng: seedRng(42) };
    const b = { rng: seedRng(42) };
    expect(generateMap('small', 3, content, a)).toEqual(generateMap('small', 3, content, b));
    expect(a.rng).toEqual(b.rng);
  });
  it('different seeds give different maps', () => {
    expect(gen(1).map.tiles).not.toEqual(gen(2).map.tiles);
  });
  it('output is plain JSON', () => {
    const m = gen(3);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});

describe('mapgen layout', () => {
  for (const size of ['small', 'standard', 'large'] as const) {
    it(`${size}: dimensions, axial coords, null owner/settlement`, () => {
      const { width, height } = MAP_DIMENSIONS[size];
      const { map } = gen(7, size, size === 'small' ? 3 : size === 'standard' ? 5 : 7);
      expect(map.width).toBe(width);
      expect(map.height).toBe(height);
      expect(map.tiles).toHaveLength(width * height);
      map.tiles.forEach((t, i) => {
        const { col, row } = axialToOffset(t);
        expect(row * width + col).toBe(i);
        expect(t.owner).toBeNull();
        expect(t.settlement).toBeNull();
      });
    });
  }

  it('large map generates in under 300 ms and small in under 50 ms', () => {
    gen(99, 'large', 7); // warm up
    let t0 = performance.now();
    gen(100, 'large', 7);
    expect(performance.now() - t0).toBeLessThan(300);
    t0 = performance.now();
    gen(101, 'small', 3);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe.each(SEEDS)('small map, seed %i', (seed) => {
  const m = smallMaps[seed - 1] as GeneratedMap;
  const { map } = m;
  const land = map.tiles.filter((t) => !isWater(t));

  it('uses only content terrains and contract features, with consistent elevation', () => {
    const features = new Set([null, 'forest', 'hills', 'jungle', 'marsh', 'oasis']);
    for (const t of map.tiles) {
      expect(terrainById.has(t.terrain)).toBe(true);
      expect(features.has(t.feature)).toBe(true);
      if (isWater(t)) {
        expect(t.elevation).toBe(0);
        expect(t.feature).toBeNull();
        expect(t.river).toBe(false);
      } else if (t.terrain === 'mountain') expect(t.elevation).toBeGreaterThanOrEqual(2);
      else if (t.feature === 'hills') expect(t.elevation).toBe(1);
      else expect(t.elevation).toBe(0);
    }
  });

  it('land fraction is 35–45%', () => {
    const frac = land.length / map.tiles.length;
    expect(frac).toBeGreaterThanOrEqual(0.35);
    expect(frac).toBeLessThanOrEqual(0.45);
  });

  it('has every terrain/feature class the seed cultures need', () => {
    const terrains = new Set(map.tiles.map((t) => t.terrain));
    const feats = new Set(map.tiles.map((t) => t.feature));
    for (const t of ['tundra', 'snow', 'desert', 'floodplain', 'steppe', 'coast', 'ocean', 'mountain', 'grassland', 'plains'])
      expect(terrains, t).toContain(t);
    for (const f of ['forest', 'hills']) expect(feats, f).toContain(f);
  });

  it('coast is exactly the water next to land', () => {
    for (const t of map.tiles) {
      if (!isWater(t)) continue;
      const nearLand = neighborsOf(map, t).some((n) => !isWater(n));
      expect(t.terrain).toBe(nearLand ? 'coast' : 'ocean');
    }
  });

  it('places resources only on their allowed terrains at a sensible density', () => {
    const allowed = new Map(content.resources.map((r) => [r.id, new Set(r.terrains)]));
    let count = 0;
    for (const t of map.tiles) {
      if (t.resource === null) continue;
      count++;
      expect(allowed.get(t.resource)?.has(t.terrain), `${t.resource} on ${t.terrain}`).toBe(true);
    }
    const perLand = land.length / count;
    expect(perLand).toBeGreaterThanOrEqual(6);
    expect(perLand).toBeLessThanOrEqual(10);
  });

  it('rivers run on land and every river system reaches water', () => {
    const seen = new Set<Tile>();
    for (const t of map.tiles) {
      if (!t.river || seen.has(t)) continue;
      expect(isWater(t)).toBe(false);
      expect(t.terrain).not.toBe('mountain');
      // Flood the connected river system and check it touches water somewhere.
      let reaches = false;
      const stack = [t];
      seen.add(t);
      while (stack.length > 0) {
        const cur = stack.pop() as Tile;
        for (const n of neighborsOf(map, cur)) {
          if (isWater(n)) reaches = true;
          if (n.river && !seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      expect(reaches).toBe(true);
    }
  });

  it('floodplain only on arid rivers', () => {
    for (const t of map.tiles) if (t.terrain === 'floodplain') expect(t.river && t.climate === 'arid').toBe(true);
  });

  it('continent ids are consistent landmasses', () => {
    for (const t of map.tiles) {
      if (isWater(t)) {
        expect(t.continent).toBe(0);
        continue;
      }
      expect(t.continent).toBeGreaterThan(0);
      for (const n of neighborsOf(map, t)) if (!isWater(n)) expect(n.continent).toBe(t.continent);
    }
    // Distinct ids are distinct landmasses: each id's tiles are connected (checked by the
    // neighbor rule above plus a flood from one tile covering the id's full count).
    const byId = new Map<number, Tile[]>();
    for (const t of land) byId.set(t.continent, [...(byId.get(t.continent) ?? []), t]);
    for (const [, tiles] of byId) {
      const seen = new Set<Tile>([tiles[0] as Tile]);
      const stack = [tiles[0] as Tile];
      while (stack.length > 0)
        for (const n of neighborsOf(map, stack.pop() as Tile))
          if (!isWater(n) && !seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
      expect(seen.size).toBe(tiles.length);
    }
  });

  it('gives 3+ well-separated, viable starts', () => {
    expect(m.starts.length).toBeGreaterThanOrEqual(3);
    const real = m.starts.slice(0, 3);
    for (let a = 0; a < real.length; a++)
      for (let b = a + 1; b < real.length; b++)
        expect(hexDistance(real[a] as Hex, real[b] as Hex)).toBeGreaterThanOrEqual(10);
    for (const s of m.starts) {
      const t = tileAt(map, s) as Tile;
      expect(isWater(t)).toBe(false);
      expect(terrainById.get(t.terrain)?.moveCost).not.toBeNull();
      expect(t.terrain).not.toBe('snow');
      expect(neighborsOf(map, t).filter((n) => !isWater(n)).length).toBeGreaterThanOrEqual(4);
      expect(land.filter((x) => x.continent === t.continent).length).toBeGreaterThanOrEqual(30);
      const kinds = new Set<string>();
      for (const x of land)
        if (hexDistance(x, t) <= 3) {
          kinds.add(x.terrain);
          if (x.feature) kinds.add(`f:${x.feature}`);
        }
      expect(kinds.size).toBeGreaterThanOrEqual(3);
    }
  });

  it('city-state sites are enough, on land, and spaced from starts and each other', () => {
    expect(m.cityStateSites.length).toBeGreaterThanOrEqual(MAP_DIMENSIONS.small.cityStates + 2);
    const real = m.starts.slice(0, 3);
    m.cityStateSites.forEach((c, k) => {
      const t = tileAt(map, c) as Tile;
      expect(isWater(t)).toBe(false);
      expect(terrainById.get(t.terrain)?.moveCost).not.toBeNull();
      for (const s of real) expect(hexDistance(c, s)).toBeGreaterThanOrEqual(6);
      for (const o of m.cityStateSites.slice(k + 1)) expect(hexDistance(c, o)).toBeGreaterThanOrEqual(6);
    });
  });
});

describe('mapgen variety across seeds', () => {
  it('starts land in different climates on most maps', () => {
    let diverse = 0;
    for (const m of smallMaps) {
      const climates = new Set(m.starts.slice(0, 3).map((s) => (tileAt(m.map, s) as Tile).climate));
      if (climates.size === 3) diverse++;
    }
    expect(diverse).toBeGreaterThanOrEqual(15);
  });
  it('generates 2–4 major continents', () => {
    for (const m of smallMaps) {
      const sizes = new Map<number, number>();
      for (const t of m.map.tiles) if (t.continent > 0) sizes.set(t.continent, (sizes.get(t.continent) ?? 0) + 1);
      const major = [...sizes.values()].filter((n) => n >= 30).length;
      expect(major).toBeGreaterThanOrEqual(2);
      expect(major).toBeLessThanOrEqual(4);
    }
  });
});
