import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import {
  LOOKS,
  REST_TURN,
  cameraToWorld,
  facingTarget,
  headingToward,
  hpPips,
  lerpAngle,
  lungeCurve,
  pickAttacker,
  restHeading,
  stackLayout,
  unitLook,
  unitRelation,
  type AttackCandidate,
} from '../src/render/unit-look';
import { roadRiverCrossings } from '../src/render/rivers';

const content = loadContent();
const def = (id: string) => content.units.find((u) => u.id === id);

const angDiff = (a: number, b: number): number => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
};

describe('unit looks', () => {
  it('every content unit gets a look, and upgrades change the silhouette', () => {
    for (const u of content.units) expect(LOOKS).toContain(unitLook(u.unitClass, u));
    for (const u of content.units) {
      if (!u.upgradesTo) continue;
      const next = def(u.upgradesTo);
      expect(next).toBeDefined();
      expect(unitLook(u.unitClass, u)).not.toBe(unitLook(next?.unitClass ?? '', next));
    }
  });

  it('picks by class and age, civilians by ability, famous people by figure kind', () => {
    expect(unitLook('infantry', { unitClass: 'infantry', age: 'ancient' })).toBe('warband');
    expect(unitLook('infantry', { unitClass: 'infantry', age: 'classical' })).toBe('spearman');
    expect(unitLook('naval', { unitClass: 'naval', age: 'modern' })).toBe('galley');
    expect(unitLook('civilian', { unitClass: 'civilian', canFound: true })).toBe('settler');
    expect(unitLook('civilian', { unitClass: 'civilian', canTrade: true })).toBe('merchant');
    expect(unitLook('civilian', { unitClass: 'civilian', vision: 3 })).toBe('scout');
    expect(unitLook('civilian', { unitClass: 'civilian', figureKind: 'explorer', canTrade: true, vision: 3 })).toBe('explorer');
    expect(unitLook('commander', { unitClass: 'commander', figureKind: 'general' })).toBe('general');
    // Missing / stale content still draws something sensible.
    expect(unitLook('cavalry', undefined)).toBe('chariot');
    expect(unitLook('mystery', undefined)).toBe('warband');
    expect(unitLook('civilian', undefined)).toBe('settler');
  });

  it('base relation: yours, rival, war, city-state, raiders', () => {
    expect(unitRelation('p1', 'p1', false)).toBe('own');
    expect(unitRelation(null, 'p2', true)).toBe('own');
    expect(unitRelation('p1', 'p2', false)).toBe('rival');
    expect(unitRelation('p1', 'p2', true)).toBe('war');
    expect(unitRelation('p1', 'cs:byblos', false)).toBe('cityState');
    expect(unitRelation('p1', 'cs:byblos', true)).toBe('war');
    expect(unitRelation('p1', 'raiders', true)).toBe('raider');
  });

  it('HP pips: 5 pips, any damage costs at least part of one', () => {
    expect(hpPips(100, 100)).toBe(5);
    expect(hpPips(99, 100)).toBe(5);
    expect(hpPips(80, 100)).toBe(4);
    expect(hpPips(45, 100)).toBe(3);
    expect(hpPips(1, 100)).toBe(1);
    expect(hpPips(0, 100)).toBe(0);
  });
});

describe('stacking and facing', () => {
  it('military stands in front (toward the camera) and full size; civilians step back', () => {
    const [mil, civ] = stackLayout(2, false);
    expect(mil?.scale).toBeGreaterThan(0.9);
    expect((civ?.scale ?? 1) < 1).toBe(true);
    expect((mil?.dz ?? 0) > (civ?.dz ?? 0)).toBe(true);
    // Side by side: their bases (radius ~0.4 at unit scale) barely overlap on screen.
    expect(Math.abs((mil?.dx ?? 0) - (civ?.dx ?? 0))).toBeGreaterThan(0.35);
  });

  it('in a settlement units stand on the forecourt toward the camera, inside the hex', () => {
    for (const n of [1, 2, 3]) {
      for (const s of stackLayout(n, true)) {
        expect(s.dz).toBeGreaterThan(0.05);
        expect(Math.hypot(s.dx, s.dz)).toBeLessThan(0.75);
      }
    }
  });

  it('camera-frame offsets rotate with the view', () => {
    const a = cameraToWorld(0, 1, 0);
    expect(a.x).toBeCloseTo(0);
    expect(a.z).toBeCloseTo(1);
    const b = cameraToWorld(1, 0, Math.PI / 2);
    expect(b.x).toBeCloseTo(0);
    expect(b.z).toBeCloseTo(-1);
  });

  it('rest heading shows the face (within REST_TURN of the camera), continuously', () => {
    const yaw = 0.3;
    const toCam = yaw + Math.PI;
    for (let h = -Math.PI; h <= Math.PI; h += 0.1) {
      expect(angDiff(restHeading(h, yaw), toCam)).toBeLessThanOrEqual(REST_TURN + 1e-6);
      expect(angDiff(restHeading(h, yaw), restHeading(h + 0.01, yaw))).toBeLessThan(0.05);
    }
    // Ships rest broadside.
    expect(angDiff(restHeading(0, 0, true), Math.PI)).toBeGreaterThan(1);
  });

  it('faces an adjacent hostile; the two sides face each other', () => {
    const me = { q: 3, r: 3 };
    const foe = { q: 4, r: 3 };
    expect(facingTarget(me, [foe, { q: 9, r: 9 }])).toEqual(foe);
    expect(facingTarget(me, [{ q: 6, r: 3 }])).toBeNull();
    const h1 = headingToward(1, 0);
    const h2 = headingToward(-1, 0);
    expect(angDiff(h1, h2)).toBeCloseTo(Math.PI);
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1);
  });
});

describe('combat', () => {
  const c = (id: string, q: number, r: number, owner: string, movedAt = -Infinity, range = 1): AttackCandidate => ({ id, at: { q, r }, owner, movedAt, range });

  it('lunge strikes out fast, holds, returns to rest', () => {
    expect(lungeCurve(0)).toBe(0);
    expect(lungeCurve(1)).toBe(0);
    expect(lungeCurve(0.35)).toBe(1);
    expect(lungeCurve(0.15)).toBeGreaterThan(0.5);
    expect(lungeCurve(0.9)).toBeLessThan(0.2);
  });

  it('attacker: selected in range, else most recent mover, never the defender side', () => {
    const t = { q: 5, r: 5 };
    const units = [c('a', 4, 5, 'p1', 10), c('b', 6, 5, 'p1', 50), c('d', 5, 4, 'p2', 99), c('far', 9, 9, 'p1', 100)];
    expect(pickAttacker(t, units, 'a', ['p2'])?.id).toBe('a');
    expect(pickAttacker(t, units, null, ['p2'])?.id).toBe('b');
    expect(pickAttacker(t, units, 'far', ['p2'])?.id).toBe('b');
    // Ranged units reach two hexes.
    expect(pickAttacker(t, [c('s', 7, 5, 'p1', 0, 2)], null, ['p2'])?.id).toBe('s');
    expect(pickAttacker(t, [c('s', 7, 5, 'p1', 0, 1)], null, ['p2'])).toBeNull();
  });
});

describe('bridges', () => {
  it('a road crossing a river gets one bridge at the crossing, along the road', () => {
    const roads = [{ ax: -1, az: 0, bx: 1, bz: 0 }];
    const rivers = [{ ax: 0, az: -1, bx: 0, bz: 1 }];
    const b = roadRiverCrossings(roads, rivers);
    expect(b).toHaveLength(1);
    expect(b[0]?.x).toBeCloseTo(0);
    expect(b[0]?.z).toBeCloseTo(0);
    expect(b[0]?.angle).toBeCloseTo(0);
  });

  it('touching end points (a road leaving a riverside town) and parallels are not bridges', () => {
    expect(roadRiverCrossings([{ ax: 0, az: 0, bx: 1, bz: 0 }], [{ ax: 0, az: 0, bx: 0, bz: 1 }])).toHaveLength(0);
    expect(roadRiverCrossings([{ ax: 0, az: 0, bx: 1, bz: 0 }], [{ ax: 0, az: 0.5, bx: 1, bz: 0.5 }])).toHaveLength(0);
  });

  it('nearby crossings merge', () => {
    const roads = [{ ax: -1, az: 0, bx: 1, bz: 0 }, { ax: -1, az: 0.1, bx: 1, bz: 0.1 }];
    expect(roadRiverCrossings(roads, [{ ax: 0, az: -1, bx: 0, bz: 1 }])).toHaveLength(1);
  });
});

describe('scatter hash', () => {
  it('unit01 stays uniform for shifted hashes (variation must not collapse to ~0)', async () => {
    const { hashTile, unit01 } = await import('../src/render/scatter');
    for (const shift of [0, 4, 8, 16]) {
      let lo = 0;
      for (let i = 0; i < 400; i++) if (unit01(hashTile(i, 7, 3) >>> shift) < 0.5) lo++;
      expect(lo).toBeGreaterThan(150);
      expect(lo).toBeLessThan(250);
    }
  });
});
