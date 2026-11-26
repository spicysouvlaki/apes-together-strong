/**
 * Playtest 3 clarity rules: relation markers in a war, floating damage numbers, siege breaches,
 * and the per-tile record/replay cache behind incremental setState.
 */
import { BoxGeometry, Group, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { settlementLayout, type SettlementLayoutInput } from '../src/render/architecture';
import { damageSpec, isFixedLabel, labelKey, labelSpec, sealSpec } from '../src/render/labels';
import { Instances, RECORD_STRIDE, replayRecord } from '../src/render/scene/instances';
import { relationMarkers, unitRelation } from '../src/render/unit-look';

describe('relation markers (enemies, neutrals, rivals part at a glance)', () => {
  it('hostiles get the red ring and crossed swords; raiders keep their pennon; others none', () => {
    expect(relationMarkers('war')).toEqual({ warRing: true, swords: true, pennon: false });
    expect(relationMarkers('raider')).toEqual({ warRing: true, swords: true, pennon: true });
    for (const r of ['own', 'rival', 'cityState'] as const) expect(relationMarkers(r)).toEqual({ warRing: false, swords: false, pennon: false });
    // A city-state at war with the viewer is an enemy, not a neutral.
    expect(relationMarkers(unitRelation('p1', 'cs:ugarit', true)).swords).toBe(true);
    expect(relationMarkers(unitRelation('p1', 'cs:ugarit', false)).swords).toBe(false);
  });
});

describe('floating damage numbers', () => {
  it('are fixed labels with their own atlas key per amount', () => {
    const a = damageSpec(29);
    expect(a.damage).toBe(29);
    expect(isFixedLabel(a)).toBe(true);
    expect(isFixedLabel(sealSpec(1))).toBe(true);
    expect(isFixedLabel(labelSpec({ name: 'Ugarit', population: 3, isCapital: false }, '#9c9a96'))).toBe(false);
    expect(labelKey(a)).toBe(labelKey(damageSpec(29)));
    expect(labelKey(a)).not.toBe(labelKey(damageSpec(30)));
    expect(labelKey(a)).not.toBe(labelKey(sealSpec(29)));
    expect(damageSpec(12.6).damage).toBe(13);
    expect(damageSpec(-4).damage).toBe(0);
  });
});

describe('siege damage on walls', () => {
  const base: SettlementLayoutInput = {
    id: 'ugarit',
    kind: 'city',
    population: 4,
    capital: false,
    cityState: true,
    age: 0,
    weights: [{ motif: 'generic', weight: 1 }],
    damage: 0,
    primary: [0.6, 0.6, 0.6],
  };
  const dark = (c: readonly number[]): boolean => (c[0] ?? 1) < 0.25 && (c[1] ?? 1) < 0.2;

  it('breaches appear with damage (one per third of wall lost), deterministic', () => {
    const intact = settlementLayout(base).pieces.filter((p) => p.k === 'block' && dark(p.c)).length;
    expect(intact).toBe(0);
    const light = settlementLayout({ ...base, damage: 0.2 });
    const heavy = settlementLayout({ ...base, damage: 0.9 });
    const gaps = (l: ReturnType<typeof settlementLayout>): number => l.pieces.filter((p) => p.k === 'block' && dark(p.c) && p.sx > 0.1).length;
    expect(gaps(light)).toBe(1);
    expect(gaps(heavy)).toBe(3);
    expect(settlementLayout({ ...base, damage: 0.9 })).toEqual(heavy);
    // Breaches sit on the wall ring (radius ~0.8), never inside the town.
    for (const p of heavy.pieces.filter((q) => q.k === 'block' && dark(q.c) && q.sx > 0.1)) {
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(0.7);
      expect(Math.hypot(p.x, p.z)).toBeLessThan(0.9);
    }
  });
});

describe('per-tile record / replay (incremental setState)', () => {
  it('replaying a recorded tile reproduces its instances exactly', () => {
    const parent = new Group();
    const geo = new BoxGeometry(1, 1, 1);
    const mat = new MeshBasicMaterial();
    const a = new Instances(geo, mat, 4, parent, 'a', 0, 'aInst', 4);
    const b = new Instances(geo.clone(), mat, 4, parent, 'b', 0, 'aInst', 4);
    const rec: number[] = [];
    a.recorder = rec;
    a.recordId = 0;
    a.begin();
    a.push(1, 2, 3, 0.5, 0.6, 0.7, 0.3, [0.2, 0.4, 0.6], 1, 2, 3, 4);
    a.push(-1, 0, 4, 1, 1, 1, 1.2, [0.9, 0.1, 0.1], 0, 5, 0, 0);
    a.recorder = null;
    a.end();
    expect(rec.length).toBe(2 * RECORD_STRIDE);
    b.begin();
    replayRecord([b], rec);
    b.end();
    expect(b.count).toBe(2);
    expect(Array.from(b.mesh.instanceMatrix.array).slice(0, 32)).toEqual(Array.from(a.mesh.instanceMatrix.array).slice(0, 32));
    expect(Array.from(b.mesh.instanceColor?.array ?? []).slice(0, 6)).toEqual(Array.from(a.mesh.instanceColor?.array ?? []).slice(0, 6));
    const auxA = a.geometry.getAttribute('aInst').array;
    const auxB = b.geometry.getAttribute('aInst').array;
    expect(Array.from(auxB).slice(0, 8)).toEqual(Array.from(auxA).slice(0, 8));
  });
});
