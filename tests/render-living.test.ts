import { describe, expect, it } from 'vitest';
import { DISTRICT_KINDS, districtPieces, districtPlan, districtSmoke, type DistrictNeighbor } from '../src/render/districts';
import { AGE_GRADES, CRISIS_GRADE, detectMoments, gradeFor, moodOf, sameMood, settlePulse } from '../src/render/mood';
import { LabelLayout, STEM_KEEP, edgeNudge } from '../src/render/label-layout';
import type { GameState } from '../src/contracts/sim-api';

const ring = (open: number[], water: number[] = [], wooded: number[] = []): DistrictNeighbor[] =>
  [0, 1, 2, 3, 4, 5].map((dir) => ({ dir, open: open.includes(dir), water: water.includes(dir), wooded: wooded.includes(dir) }));

describe('districts', () => {
  const base = { id: 's1', kind: 'town' as const, capital: false, cityState: false };

  it('a pop-1 town has no districts; growth adds them in milestone order', () => {
    expect(districtPlan({ ...base, population: 1, neighbors: ring([0, 1, 2, 3, 4, 5]) })).toEqual([]);
    const p2 = districtPlan({ ...base, population: 2, neighbors: ring([0, 1, 2, 3, 4, 5]) });
    expect(p2.map((d) => d.kind)).toEqual(['fields']);
    const p6 = districtPlan({ ...base, population: 6, neighbors: ring([0, 1, 2, 3, 4, 5]) });
    expect(p6.map((d) => d.kind)).toEqual(['fields', 'fields', 'orchard', 'workshop']);
  });

  it('is stable as the city grows (a district never jumps tiles) and uses each tile once', () => {
    const n = ring([0, 1, 2, 3, 4, 5]);
    let prev = districtPlan({ ...base, population: 2, neighbors: n });
    for (let pop = 3; pop <= 14; pop++) {
      const next = districtPlan({ ...base, population: pop, neighbors: n });
      for (const d of prev) expect(next).toContainEqual(d);
      expect(new Set(next.map((d) => d.dir)).size).toBe(next.length);
      prev = next;
    }
  });

  it('quays need water, fields need open land, workshops may clear woods', () => {
    const plan = districtPlan({ ...base, population: 7, neighbors: ring([], [2], [4]) });
    expect(plan).toContainEqual({ dir: 2, kind: 'quay' });
    expect(plan.some((d) => d.kind === 'fields')).toBe(false);
    expect(plan.find((d) => d.dir === 4)?.kind).toMatch(/orchard|workshop/);
  });

  it('cities count as grander and capitals get a monument plinth', () => {
    const plan = districtPlan({ ...base, kind: 'city', capital: true, population: 6, neighbors: ring([0, 1, 2, 3, 4, 5]) });
    expect(plan.map((d) => d.kind)).toContain('plinth');
  });

  it('pieces are deterministic, inside the hex and sized for every kind', () => {
    const style = { wall: [0.9, 0.85, 0.75] as const, roof: [0.6, 0.3, 0.2] as const, accent: [0.2, 0.4, 0.7] as const };
    for (const k of DISTRICT_KINDS) {
      const a = districtPieces(k, 1234, 0.7, 0.5, { wall: [...style.wall], roof: [...style.roof], accent: [...style.accent] });
      const b = districtPieces(k, 1234, 0.7, 0.5, { wall: [...style.wall], roof: [...style.roof], accent: [...style.accent] });
      expect(a).toEqual(b);
      expect(a.length).toBeGreaterThan(2);
      for (const p of a) expect(Math.hypot(p.x, p.z)).toBeLessThan(1);
    }
    expect(districtSmoke('workshop', 0.5)).not.toBeNull();
    expect(districtSmoke('fields', 0.5)).toBeNull();
  });
});

describe('mood', () => {
  it('each age has its own grade; crisis cools and desaturates', () => {
    expect(AGE_GRADES.ancient[0]).toBeGreaterThan(AGE_GRADES.ancient[2]);
    expect(AGE_GRADES.classical[3]).toBeGreaterThan(AGE_GRADES.ancient[3]);
    const c = gradeFor({ age: 'ancient', crisis: true });
    expect(c[3]).toBeCloseTo(AGE_GRADES.ancient[3] * CRISIS_GRADE[3]);
    expect(c[2] / c[0]).toBeGreaterThan(AGE_GRADES.ancient[2] / AGE_GRADES.ancient[0]);
    expect(sameMood(moodOf({ age: 'classical', crisis: null }), { age: 'classical', crisis: false })).toBe(true);
  });

  it('detects wonders, recruits and age changes between snapshots (never on the first)', () => {
    const mk = (over: Partial<GameState>): GameState =>
      ({
        seed: 1,
        age: 'ancient',
        wonders: {},
        settlements: { c1: { id: 'c1', owner: 'p1', isCapital: true } },
        players: { p1: { stats: { figuresRecruited: 0 } } },
        ...over,
      }) as unknown as GameState;
    const a = mk({});
    expect(detectMoments(null, a, 'p1')).toEqual([]);
    const b = mk({
      age: 'classical',
      wonders: { great_pyramid: { owner: 'p1', settlement: 'c1', turn: 9 } },
      players: { p1: { stats: { figuresRecruited: 1 } } } as unknown as GameState['players'],
    });
    expect(detectMoments(a, b, 'p1')).toEqual([
      { kind: 'wonder', settlement: 'c1' },
      { kind: 'recruit', settlement: 'c1' },
      { kind: 'age', age: 'classical' },
    ]);
    expect(detectMoments(a, { ...b, seed: 2 }, 'p1')).toEqual([]);
  });

  it('the page settle is a single bump', () => {
    expect(settlePulse(0)).toBe(0);
    expect(settlePulse(1)).toBe(0);
    expect(settlePulse(0.4)).toBeGreaterThan(0.5);
  });
});

describe('label edge nudge', () => {
  it('keeps a cartouche inside the screen, capped so the leader stays under it', () => {
    expect(edgeNudge(200, 100, 6, 369)).toBe(0);
    expect(edgeNudge(30, 100, 6, 369)).toBe(26);
    expect(edgeNudge(340, 100, 6, 369)).toBe(-21);
    expect(edgeNudge(360, 100, 6, 369)).toBe(-(50 - STEM_KEEP));
    // Anchor off screen: capped at w/2 - STEM_KEEP.
    expect(edgeNudge(-40, 100, 6, 369)).toBe(50 - STEM_KEEP);
  });

  it('solve() nudges and collides with the nudged box', () => {
    const L = new LabelLayout(4);
    L.count = 2;
    L.x[0] = 20;
    L.y[0] = 300;
    L.w[0] = 100;
    L.h[0] = 20;
    L.priority[0] = 2;
    L.x[1] = 110;
    L.y[1] = 300;
    L.w[1] = 60;
    L.h[1] = 20;
    L.priority[1] = 1;
    L.solve(2, 0, 800, 6, 369);
    expect(L.dx[0]).toBe(36);
    // Label 0 now spans 6..106 and pushes label 1 (80..140) up a slot.
    expect(L.shift[1]).toBeGreaterThan(0);
    expect(L.hit(10, 290)).toBe(0);
  });
});
