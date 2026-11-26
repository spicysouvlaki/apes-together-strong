import { describe, expect, it } from 'vitest';
import terrain from '../content/terrain.json';
import cultures from '../content/cultures.json';
import traditions from '../content/traditions.json';
import hybrids from '../content/hybrids.json';
import { parseHexColor, type Rgb } from '../src/render/colors';
import { gradeTerrainColors } from '../src/render/terrain-style';
import { MIN_ART_LAND_DE, SURFACE, ageMaterial, artDirectTerrain, minLandDistance, strataFor, surfaceKind, tileVariation } from '../src/render/palette';
import { hashTile, insideHex, microDensity, scatterInHex, treeCount } from '../src/render/scatter';
import {
  MOTIFS,
  buildCultureIndex,
  houseCount,
  landmarkFor,
  motifWeights,
  pickMotif,
  settlementLayout,
  type SettlementLayoutInput,
} from '../src/render/architecture';
import { DETAIL_SIZE, fillMapField, generateDetailTexels, waterDistance } from '../src/render/textures';

type T = { id: string; color: string; water?: boolean };
const terrains = (terrain as T[]).map((t) => ({ id: t.id, color: t.color, water: t.water ?? false }));
const water = new Map(terrains.map((t) => [t.id, t.water]));
const art = artDirectTerrain(gradeTerrainColors(terrains), water);
const lum = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('render palette', () => {
  it('keeps every shipped land terrain distinguishable after the pastel grade', () => {
    expect(minLandDistance(art, water)).toBeGreaterThanOrEqual(MIN_ART_LAND_DE);
  });

  it('classifies surfaces from color and climate, not ids', () => {
    const at = (id: string): Rgb => art.get(id) ?? [0, 0, 0];
    expect(surfaceKind(at('grassland'))).toBe(SURFACE.grass);
    expect(surfaceKind(at('desert'))).toBe(SURFACE.sand);
    expect(surfaceKind(at('snow'))).toBe(SURFACE.snow);
    expect(surfaceKind(at('steppe'))).toBe(SURFACE.dry);
    expect(surfaceKind(at('mountain'), { mountain: true })).toBe(SURFACE.rock);
  });

  it('strata darken toward the base and the lip follows the top', () => {
    const top = parseHexColor('#9cbf7a');
    const s = strataFor(top, SURFACE.grass);
    expect(lum(s.band0)).toBeGreaterThan(lum(s.band1));
    expect(lum(s.band1)).toBeGreaterThan(lum(s.band2));
    expect(lum(s.lip)).toBeLessThan(lum(top));
  });

  it('per-tile variation is small, deterministic and bounded', () => {
    for (let i = 0; i < 200; i++) {
      const v = tileVariation(hashTile(i, i * 3, 1));
      expect(Math.abs(v.dy)).toBeLessThanOrEqual(0.025);
      expect(v.tint).toBeGreaterThanOrEqual(0.95);
      expect(v.tint).toBeLessThanOrEqual(1.04);
    }
    expect(tileVariation(12345)).toEqual(tileVariation(12345));
  });

  it('materials shift by age and stay put in the first age', () => {
    const mud = parseHexColor('#d9b98a');
    expect(ageMaterial(mud, 0)).toEqual(mud);
    expect(ageMaterial(mud, 1)).not.toEqual(mud);
    expect(ageMaterial(mud, 3)).not.toEqual(ageMaterial(mud, 1));
  });
});

describe('render prop scatter', () => {
  it('places well-spaced points inside the hex, deterministically', () => {
    const a = new Float32Array(32);
    const b = new Float32Array(32);
    const n = scatterInHex(3, -7, 5, 6, a, { radius: 0.72, minDist: 0.25 });
    expect(n).toBeGreaterThan(3);
    expect(scatterInHex(3, -7, 5, 6, b, { radius: 0.72, minDist: 0.25 })).toBe(n);
    expect([...a]).toEqual([...b]);
    for (let i = 0; i < n; i++) {
      expect(insideHex(a[i * 2] ?? 9, a[i * 2 + 1] ?? 9, 0.72)).toBe(true);
      for (let j = 0; j < i; j++) {
        const d = Math.hypot((a[i * 2] ?? 0) - (a[j * 2] ?? 0), (a[i * 2 + 1] ?? 0) - (a[j * 2 + 1] ?? 0));
        expect(d).toBeGreaterThanOrEqual(0.25 - 1e-6);
      }
    }
  });

  it('respects clear circles', () => {
    const a = new Float32Array(40);
    const n = scatterInHex(1, 1, 2, 20, a, { clearCenter: 0.4, clear: [0.36, -0.3, 0.2] });
    for (let i = 0; i < n; i++) {
      const x = a[i * 2] ?? 0;
      const z = a[i * 2 + 1] ?? 0;
      expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(0.4);
      expect(Math.hypot(x - 0.36, z + 0.3)).toBeGreaterThanOrEqual(0.2);
    }
  });

  it('micro-detail density follows zoom band and quality', () => {
    expect(microDensity('close', 'high')).toBe(1);
    expect(microDensity('regional', 'high')).toBeLessThan(1);
    expect(microDensity('strategic', 'high')).toBe(0);
    expect(microDensity('close', 'low')).toBe(0);
    expect(treeCount(5, 'low', false)).toBeLessThan(treeCount(5, 'high', false));
    expect(treeCount(5, 'high', true)).toBeLessThanOrEqual(2);
  });
});

describe('render architecture kits', () => {
  const idx = buildCultureIndex({ cultures, traditions, hybrids });

  it('every shipped culture maps to a known motif kit', () => {
    for (const c of cultures) expect(MOTIFS).toContain(c.architecture);
  });

  it('the naming culture dominates; traditions and hybrids blend in', () => {
    const plain = motifWeights('egyptian', [], [], idx);
    expect(plain).toEqual([{ motif: 'nile', weight: 1 }]);
    const greek = traditions.filter((t) => t.culture === 'greek').map((t) => t.id);
    const mixed = motifWeights('egyptian', greek, [], idx);
    expect(mixed[0]?.motif).toBe('nile');
    expect(mixed.find((w) => w.motif === 'aegean')?.weight ?? 0).toBeGreaterThan(0.1);
    const andalus = hybrids.find((h) => h.cultures.includes('arab') && h.cultures.includes('spanish'));
    expect(andalus).toBeDefined();
    const hybrid = motifWeights('spanish', [], [andalus?.id ?? ''], idx);
    const motifs = hybrid.map((w) => w.motif);
    expect(motifs).toContain('iberian');
    expect(motifs).toContain('arabian');
    expect(hybrid.reduce((s, w) => s + w.weight, 0)).toBeCloseTo(1, 6);
  });

  it('unknown cultures fall back to the generic kit', () => {
    expect(motifWeights('atlantean', [], [], idx)).toEqual([{ motif: 'generic', weight: 1 }]);
    expect(pickMotif([{ motif: 'nile', weight: 0.5 }, { motif: 'aegean', weight: 0.5 }], 0.7)).toBe('aegean');
  });

  const base: SettlementLayoutInput = {
    id: 's1',
    kind: 'city',
    population: 6,
    capital: false,
    cityState: false,
    age: 0,
    weights: [{ motif: 'nile', weight: 1 }],
    damage: 0,
    primary: [0.2, 0.4, 0.8],
  };

  it('is deterministic, walls ring cities, towns have none', () => {
    const a = settlementLayout(base);
    expect(settlementLayout(base)).toEqual(a);
    expect(a.pieces.some((p) => p.k === 'wall')).toBe(true);
    const town = settlementLayout({ ...base, kind: 'town', population: 2 });
    expect(town.pieces.some((p) => p.k === 'wall')).toBe(false);
    expect(town.pieces.length).toBeLessThan(a.pieces.length);
    expect(a.pieces[a.flag]?.k).toBe('flag');
  });

  it('grows with population and keeps pieces on the tile', () => {
    expect(houseCount('city', 12, false, false)).toBeGreaterThan(houseCount('city', 2, false, false));
    expect(houseCount('city', 6, true, false)).toBeGreaterThan(houseCount('city', 6, false, false));
    const big = settlementLayout({ ...base, population: 12, capital: true });
    for (const p of big.pieces) expect(Math.hypot(p.x, p.z)).toBeLessThan(1);
  });

  it('a hybrid city mixes motif kits; ages shift wall materials', () => {
    const hybrid = settlementLayout({
      ...base,
      population: 12,
      weights: [
        { motif: 'nile', weight: 0.5 },
        { motif: 'aegean', weight: 0.5 },
      ],
    });
    // Aegean houses bring gable roofs; Nile houses are flat-roofed blocks.
    expect(hybrid.pieces.some((p) => p.k === 'gable')).toBe(true);
    const stone = settlementLayout({ ...base, age: 2 });
    const wallA = settlementLayout(base).pieces.find((p) => p.k === 'wall')?.c;
    const wallB = stone.pieces.find((p) => p.k === 'wall')?.c;
    expect(wallA).not.toEqual(wallB);
  });

  it('built wonders get a landmark; unknown wonders a generic monument', () => {
    expect(landmarkFor('great_pyramid')).toBe('pyramid');
    expect(landmarkFor('not_a_wonder')).toBe('monument');
    const plain = settlementLayout(base);
    const withWonder = settlementLayout({ ...base, wonders: ['great_pyramid'] });
    expect(withWonder.pieces.length).toBeGreaterThan(plain.pieces.length);
  });
});

describe('render procedural textures', () => {
  it('detail texels are deterministic and use the full range', () => {
    const a = generateDetailTexels(32, 3);
    expect(a.length).toBe(32 * 32 * 4);
    expect([...generateDetailTexels(32, 3)]).toEqual([...a]);
    const r = [...a].filter((_, i) => i % 4 === 0);
    expect(Math.max(...r) - Math.min(...r)).toBeGreaterThan(100);
    expect(DETAIL_SIZE).toBeGreaterThanOrEqual(64);
  });

  it('water distance grows away from land and is capped', () => {
    // A 1D strip: land at 0, water after (neighbors left/right only).
    const n = 8;
    const out = new Uint8Array(n);
    waterDistance(
      n,
      (i) => i > 0,
      (i, d) => (d === 0 ? (i + 1 < n ? i + 1 : -1) : d === 3 ? i - 1 : -1),
      out,
      4,
    );
    expect([...out]).toEqual([0, 1, 2, 3, 4, 4, 4, 4]);
    const field = fillMapField(n, out, new Uint8Array([2, 2, 1, 1, 0, 0, 0, 0]), new Uint8Array(n * 4));
    expect(field[0]).toBe(0);
    expect(field[4 * 4]).toBe(255);
    expect(field[1]).toBe(255); // known
    expect(field[4 * 4 + 1]).toBe(0); // unexplored
  });
});
