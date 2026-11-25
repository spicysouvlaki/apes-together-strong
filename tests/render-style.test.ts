import { describe, expect, it } from 'vitest';
import terrain from '../content/terrain.json';
import resources from '../content/resources.json';
import { CITY_STATE_PREFIX, RAIDER_PLAYER } from '../src/contracts/sim-api';
import { BANNER_COLORS } from '../src/ui/shell/setup-logic';
import { CITY_STATE_COLORS, RAIDER_COLORS, parseHexColor } from '../src/render/colors';
import { EDGE_ROTATION, computeBorderEdges, createEdgeList } from '../src/render/borders';
import { computeRiverSegments } from '../src/render/rivers';
import { LabelLayout } from '../src/render/label-layout';
import { CITY_STATE_PATTERN, PATTERN, PLAYER_PATTERNS, RAIDER_PATTERN, patternFor, patternKeep } from '../src/render/patterns';
import { GhostMemory } from '../src/render/ghosts';
import { FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE } from '../src/render/colors';
import { labelKey, labelSpec, wallFraction } from '../src/render/labels';
import { MIN_LAND_DE, MIN_WATER_DE, deltaE, gradeTerrainColors, labToRgb, resourceClassOf, rgbToLab } from '../src/render/terrain-style';
import { hexAtIndex, hexToWorld, tileIndex } from '../src/render/layout';
import { HEX_DIRECTIONS } from '../src/contracts/hex';
import type { Settlement } from '../src/contracts/sim-api';

const terrainInput = (terrain as { id: string; color: string; water?: boolean }[]).map((t) => ({
  id: t.id,
  color: t.color,
  water: !!t.water,
}));

describe('render terrain grading', () => {
  it('round-trips sRGB through CIELAB', () => {
    for (const hex of ['#9cbf7a', '#5f9fb5', '#eef2f3', '#000000', '#ffffff']) {
      const c = parseHexColor(hex);
      const back = labToRgb(rgbToLab(c));
      for (let k = 0; k < 3; k++) expect(back[k]).toBeCloseTo(c[k] ?? 0, 2);
    }
  });

  it('keeps every shipped land terrain pair and land/water pair apart', () => {
    const graded = gradeTerrainColors(terrainInput);
    const labs = terrainInput.map((t) => ({ t, lab: rgbToLab(graded.get(t.id) ?? [0, 0, 0]) }));
    for (let i = 0; i < labs.length; i++) {
      for (let j = i + 1; j < labs.length; j++) {
        const a = labs[i];
        const b = labs[j];
        if (!a || !b) continue;
        const d = deltaE(a.lab, b.lab);
        if (!a.t.water && !b.t.water) expect(d, `${a.t.id} vs ${b.t.id}`).toBeGreaterThanOrEqual(MIN_LAND_DE - 1.5);
        if (a.t.water !== b.t.water) expect(d, `${a.t.id} vs ${b.t.id}`).toBeGreaterThanOrEqual(MIN_WATER_DE - 1.5);
      }
    }
  });

  it('stays close to the content author colors and is deterministic', () => {
    const a = gradeTerrainColors(terrainInput);
    const b = gradeTerrainColors(terrainInput);
    expect([...a.entries()]).toEqual([...b.entries()]);
    for (const t of terrainInput) {
      const d = deltaE(rgbToLab(parseHexColor(t.color)), rgbToLab(a.get(t.id) ?? [0, 0, 0]));
      expect(d, t.id).toBeLessThan(20);
    }
  });

  it('separates identical land colors and makes grey water blue', () => {
    const g = gradeTerrainColors([
      { id: 'a', color: '#888888', water: false },
      { id: 'b', color: '#888888', water: false },
      { id: 'w', color: '#808080', water: true },
    ]);
    expect(deltaE(rgbToLab(g.get('a') ?? [0, 0, 0]), rgbToLab(g.get('b') ?? [0, 0, 0]))).toBeGreaterThan(MIN_LAND_DE - 1.5);
    const w = g.get('w') ?? [0, 0, 0];
    expect(w[2]).toBeGreaterThan(w[0]);
  });

  it('maps every shipped resource to a marker class', () => {
    for (const r of resources as { id: string; class: string }[]) {
      expect(['bonus', 'luxury', 'strategic']).toContain(resourceClassOf(r.class));
      expect(resourceClassOf(r.class)).toBe(r.class);
    }
    expect(resourceClassOf(undefined)).toBe('bonus');
  });
});

describe('render owner colors', () => {
  it('keeps city-state and raider colors far from every banner color', () => {
    for (const special of [CITY_STATE_COLORS.primary, RAIDER_COLORS.primary]) {
      for (const b of BANNER_COLORS) {
        const d = deltaE(rgbToLab(parseHexColor(special)), rgbToLab(parseHexColor(b.hex)));
        expect(d, `${special} vs ${b.hex}`).toBeGreaterThan(25);
      }
    }
  });
});

describe('render borders', () => {
  const run = (owners: (string | null)[], w: number, h: number): { tile: number; dir: number }[] => {
    const out = createEdgeList(2);
    computeBorderEdges(owners, w, h, () => true, out);
    return Array.from({ length: out.count }, (_, k) => ({ tile: out.tile[k] ?? -1, dir: out.dir[k] ?? -1 }));
  };

  it('a lone owned tile has six border edges', () => {
    const owners = new Array<string | null>(25).fill(null);
    owners[12] = 'p1';
    expect(run(owners, 5, 5)).toHaveLength(6);
  });

  it('only outer edges: two adjacent same-owner tiles share no edge', () => {
    const owners = new Array<string | null>(25).fill(null);
    owners[12] = 'p1';
    owners[13] = 'p1';
    const edges = run(owners, 5, 5);
    expect(edges).toHaveLength(10);
    // No edge points from one owned tile at the other.
    for (const e of edges) {
      const h = hexAtIndex(e.tile, 5);
      const d = HEX_DIRECTIONS[e.dir];
      if (!d) throw new Error('bad dir');
      const ni = tileIndex({ q: h.q + d.q, r: h.r + d.r }, 5, 5);
      expect(ni === 12 || ni === 13).toBe(false);
    }
  });

  it('a frontier between two owners is drawn once from each side', () => {
    const owners = new Array<string | null>(25).fill(null);
    owners[12] = 'p1';
    owners[13] = 'p2';
    expect(run(owners, 5, 5)).toHaveLength(12);
  });

  it('map edges count as borders and the filter hides tiles', () => {
    const owners: (string | null)[] = ['p1', null, null, null];
    expect(run(owners, 2, 2)).toHaveLength(6);
    const out = createEdgeList();
    computeBorderEdges(owners, 2, 2, () => false, out);
    expect(out.count).toBe(0);
  });

  it('edge rotations turn +x toward each neighbor', () => {
    HEX_DIRECTIONS.forEach((d, i) => {
      const w = hexToWorld(d);
      const rot = EDGE_ROTATION[i] ?? 0;
      // Instances.push maps local +x to (cos rot, -sin rot) in (x, z).
      const len = Math.hypot(w.x, w.z);
      expect(Math.cos(rot)).toBeCloseTo(w.x / len, 6);
      expect(-Math.sin(rot)).toBeCloseTo(w.z / len, 6);
    });
  });
});

describe('render rivers', () => {
  // 6 x 3 map; row-major indices.
  const W = 6;
  const H = 3;
  const seg = (river: number[], water: number[] = []) =>
    computeRiverSegments(
      W,
      H,
      (i) => river.includes(i),
      (i) => water.includes(i),
    );

  it('connects a line of river tiles into one strip', () => {
    const s = seg([1, 2, 3]);
    expect(s.filter((x) => !x.mouth)).toHaveLength(2);
  });

  it('is a tree: a clump of river tiles has no cycles', () => {
    // 1, 2 (row 0) and 7, 8 (row 1) are mutually adjacent enough to form a cycle.
    const tiles = [1, 2, 7, 8];
    const s = seg(tiles);
    expect(s).toHaveLength(tiles.length - 1);
  });

  it('adds exactly one mouth per river system into adjacent water', () => {
    const s = seg([1, 2, 3], [4, 0]);
    const mouths = s.filter((x) => x.mouth);
    expect(mouths).toHaveLength(1);
    expect([0, 4]).toContain(mouths[0]?.b);
  });

  it('separate systems are separate trees and the result is deterministic', () => {
    const a = seg([0, 1, 4, 5]);
    expect(a.filter((x) => !x.mouth)).toHaveLength(2);
    expect(seg([0, 1, 4, 5])).toEqual(a);
  });
});

describe('render label layout', () => {
  const make = (rects: [number, number, number, number, number][]): LabelLayout => {
    const L = new LabelLayout(8);
    rects.forEach(([x, y, w, h, p], i) => {
      L.x[i] = x;
      L.y[i] = y;
      L.w[i] = w;
      L.h[i] = h;
      L.priority[i] = p;
    });
    L.count = rects.length;
    L.solve(0);
    return L;
  };

  it('leaves non-overlapping labels in place', () => {
    const L = make([
      [100, 100, 80, 20, 1],
      [300, 100, 80, 20, 1],
    ]);
    expect([...L.shift.slice(0, 2)]).toEqual([0, 0]);
    expect([...L.visible.slice(0, 2)]).toEqual([1, 1]);
  });

  it('moves the lower-priority label off the higher one', () => {
    const L = make([
      [100, 100, 80, 20, 1],
      [110, 105, 80, 20, 3],
    ]);
    expect(L.shift[1]).toBe(0); // capital keeps its spot
    expect(L.shift[0]).not.toBe(0);
    expect(L.visible[0]).toBe(1);
  });

  it('hides labels when every slot collides', () => {
    const rects: [number, number, number, number, number][] = [];
    for (let k = 0; k < 6; k++) rects.push([100, 100, 80, 20, 6 - k]);
    const L = make(rects);
    const shown = [...L.visible.slice(0, 6)].filter((v) => v === 1).length;
    expect(shown).toBe(4);
    expect(L.visible[0]).toBe(1);
    expect(L.visible[5]).toBe(0);
  });
});

describe('render patterns', () => {
  it('gives each player, city-states and raiders distinct patterns', () => {
    const order = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const ids = order.map((p) => patternFor(p, order));
    ids.push(patternFor(`${CITY_STATE_PREFIX}tyre`, order), patternFor(RAIDER_PLAYER, order));
    expect(new Set(ids).size).toBe(ids.length);
    expect(patternFor(`${CITY_STATE_PREFIX}x`, order)).toBe(CITY_STATE_PATTERN);
    expect(patternFor(RAIDER_PLAYER, order)).toBe(RAIDER_PATTERN);
    expect(patternFor('ghost', order)).toBe(PATTERN.solid);
    expect(PLAYER_PATTERNS.length).toBeGreaterThanOrEqual(3);
  });

  it('patterns produce visibly different cut masks', () => {
    const mask = (p: (typeof PLAYER_PATTERNS)[number]): string => {
      let s = '';
      for (let i = 0; i < 24; i++) for (let j = 0; j < 4; j++) s += patternKeep(p, i / 24, (j + 0.5) / 4) ? '1' : '0';
      return s;
    };
    const all = [...PLAYER_PATTERNS, CITY_STATE_PATTERN, RAIDER_PATTERN].map(mask);
    expect(new Set(all).size).toBe(all.length);
    // Solid keeps everything; every other pattern cuts something but keeps most of the color.
    for (const [k, m] of all.entries()) {
      const kept = m.split('').filter((c) => c === '1').length / m.length;
      if (k === 0) expect(kept).toBe(1);
      else {
        expect(kept).toBeLessThan(1);
        expect(kept).toBeGreaterThan(0.3);
      }
    }
  });
});

describe('render fog memory (ghosts)', () => {
  const city = (id: string, owner: string, pop = 3): Settlement =>
    ({
      id,
      owner,
      name: id,
      kind: 'city',
      population: pop,
      isCapital: false,
      hp: 100,
      maxHp: 100,
      at: { q: 0, r: 0 },
    }) as unknown as Settlement;

  it('remembers a rival settlement after its tile leaves sight, as last seen', () => {
    const m = new GhostMemory();
    const fog = new Uint8Array([FOG_VISIBLE, FOG_VISIBLE]);
    m.update('g1|p1', 1, 'p1', [{ tile: 0, s: city('a', 'p2', 3) }, { tile: 1, s: city('b', 'p1') }], fog);
    fog[0] = FOG_EXPLORED;
    // The rival grows while unseen; memory keeps the old population.
    m.update('g1|p1', 2, 'p1', [{ tile: 0, s: city('a', 'p2', 9) }], fog);
    const ghosts = m.ghosts(fog);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]?.g.population).toBe(3);
    // Own settlements are never ghosted.
    expect(ghosts.some((x) => x.g.owner === 'p1')).toBe(false);
  });

  it('forgets a settlement once its tile is seen empty, and resets on a new game', () => {
    const m = new GhostMemory();
    const fog = new Uint8Array([FOG_VISIBLE]);
    m.update('g1|p1', 1, 'p1', [{ tile: 0, s: city('a', 'p2') }], fog);
    fog[0] = FOG_EXPLORED;
    m.update('g1|p1', 2, 'p1', [], fog);
    expect(m.ghosts(fog)).toHaveLength(1);
    fog[0] = FOG_VISIBLE;
    m.update('g1|p1', 3, 'p1', [], fog); // razed
    fog[0] = FOG_EXPLORED;
    expect(m.ghosts(fog)).toHaveLength(0);

    fog[0] = FOG_VISIBLE;
    m.update('g1|p1', 4, 'p1', [{ tile: 0, s: city('a', 'p2') }], fog);
    expect(m.size).toBe(1);
    m.update('g2|p1', 1, 'p1', [], new Uint8Array([FOG_UNEXPLORED]));
    expect(m.size).toBe(0);
  });

  it('never ghosts unexplored or visible tiles', () => {
    const m = new GhostMemory();
    const fog = new Uint8Array([FOG_VISIBLE]);
    m.update('g|p1', 1, 'p1', [{ tile: 0, s: city('a', 'p2') }], fog);
    expect(m.ghosts(fog)).toHaveLength(0);
    expect(m.ghosts(new Uint8Array([FOG_UNEXPLORED]))).toHaveLength(0);
  });
});

describe('render label extras', () => {
  it('quantizes wall HP and keys every visual extra', () => {
    expect(wallFraction(100, 100)).toBe(1);
    expect(wallFraction(99, 100)).toBe(0.9);
    expect(wallFraction(55, 100)).toBe(0.5);
    expect(wallFraction(0, 100)).toBe(0);
    const s = { name: 'Uruk', population: 4, isCapital: false };
    const base = labelKey(labelSpec(s, '#aa0000'));
    expect(labelKey(labelSpec(s, '#aa0000', { ghost: true }))).not.toBe(base);
    expect(labelKey(labelSpec(s, '#aa0000', { war: true }))).not.toBe(base);
    expect(labelKey(labelSpec(s, '#aa0000', { pattern: 2 }))).not.toBe(base);
    expect(labelKey(labelSpec(s, '#aa0000', { wall: 0.5 }))).not.toBe(base);
    expect(labelKey(labelSpec(s, '#aa0000', { wall: 1 }))).toBe(base);
  });
});
