/**
 * `queries.combatPreview` (GDD §7 "Combat"): shares the strength breakdowns with the real
 * resolution, so its expected damage matches the mean of many real attacks; never mutates or
 * draws from the RNG; null when the attack is impossible or the target unseen. Also the
 * settler-hint fix: `settleSites` only lists sites the settler can reach.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Hex } from '@contracts/hex';
import { warKey, type Command, type GameState } from '@contracts/sim-api';

vi.mock('../src/emergence', () => ({
  initEmergence: () => ({ affinity: {}, hintsShown: {}, gp: {}, gpThreshold: {}, legendSlotUsed: false, seatedTurns: {} }),
  emergenceTick: vi.fn(),
  addAffinity: vi.fn(),
  handleFigureCommand: vi.fn(() => null),
  syncCabinet: vi.fn(),
  onSettlementCaptured: vi.fn(),
  onPlayerEliminated: vi.fn(),
  onFigureUnitDefeated: vi.fn(),
  retireFigures: vi.fn(() => []),
  onAgeStarted: vi.fn(),
  ancestorYields: vi.fn(() => ({})),
  cabinetSeats: vi.fn(() => []),
  figureActions: vi.fn(),
  cultureWeights: vi.fn(() => ({})),
}));
vi.mock('../src/sim/ages', () => ({
  addAgeProgress: vi.fn(),
  endGame: vi.fn((ctx: { state: GameState }) => {
    ctx.state.phase = 'ended';
  }),
  agesWorldPhase: vi.fn(),
  updateMilestones: vi.fn(),
  handleAgesCommand: vi.fn(() => null),
  refinementOptions: vi.fn(() => []),
  milestones: vi.fn(() => []),
  score: vi.fn(() => 0),
}));

import { applyCommand, queries } from '../src/sim';
import { attackStrength, defenseStrength, settlementStrength } from '../src/sim/combat';
import { RIVER_CROSSING_PENALTY } from '../src/sim/constants';
import { seedRng } from '../src/sim/rng';
import { tileIndex } from '../src/sim/lookup';
import { addSettlement, addUnit, at, fixtureContent, fixtureState, setTile } from './helpers/fixture';

const content = fixtureContent();

/** Mean damage over many real resolutions with different RNG states. */
const realMean = (state: GameState, unit: string, target: Hex, n = 300): { toD: number; toA: number } => {
  let toD = 0;
  let toA = 0;
  for (let i = 0; i < n; i++) {
    const s = { ...state, rng: seedRng(1000 + i) } as GameState;
    const r = applyCommand(s, 'p1', { type: 'attack', unit, target } as Command, content);
    if (!r.ok) throw new Error(r.error);
    const ev = r.events.find((e) => e.type === 'combat');
    if (!ev || ev.type !== 'combat') throw new Error('no combat event');
    toD += ev.damageToDefender;
    toA += ev.damageToAttacker;
  }
  return { toD: toD / n, toA: toA / n };
};

const scene = (): GameState => {
  const state = fixtureState({ width: 14, height: 12 });
  for (const p of Object.values(state.players)) p.explored.fill(1);
  addSettlement(state, 'p1', at(1, 1));
  addSettlement(state, 'p2', at(10, 9));
  return state;
};

describe('combatPreview', () => {
  it('melee vs a unit: expected damage is the mean of real resolutions; factors explain the strengths', () => {
    const state = scene();
    const a = addUnit(state, 'p1', 'warrior', at(5, 5), content);
    const d = addUnit(state, 'p2', 'warrior', at(6, 5), content, { fortified: true, hp: 80 });
    setTile(state, d.at, { feature: 'hills', river: true });
    addUnit(state, 'p1', 'warrior', at(6, 4), content); // flanking
    state.wars[warKey('p1', 'p2')] = 1;
    const before = JSON.stringify(state);
    const pv = queries.combatPreview(state, a.id, d.at, content);
    expect(JSON.stringify(state)).toBe(before); // no mutation, no RNG draw
    expect(pv).not.toBeNull();
    expect(pv!.kind).toBe('unit');
    expect(pv!.needsWar).toBe(false);
    expect(pv!.attackerStrength).toBe(attackStrength(state, a, { at: d.at, unitClass: d.unitClass, settlement: false }, false, content));
    expect(pv!.defenderStrength).toBe(defenseStrength(state, d, a.unitClass, content));
    const labels = pv!.factors.map((f) => `${f.side}:${f.label}:${f.value}`);
    expect(labels).toContain('defender:Hills:3');
    expect(labels).toContain('defender:Fortified:5');
    expect(labels).toContain(`attacker:River crossing:${-RIVER_CROSSING_PENALTY}`);
    expect(labels).toContain('attacker:Flanking:2');
    expect(labels).toContain('defender:Wounds:-2');
    const mean = realMean(state, a.id, d.at);
    expect(Math.abs(mean.toD - pv!.damageToDefender.expected)).toBeLessThan(1.5);
    expect(Math.abs(mean.toA - pv!.damageToAttacker.expected)).toBeLessThan(1.5);
    expect(pv!.damageToDefender.min).toBeLessThanOrEqual(pv!.damageToDefender.expected);
    expect(pv!.damageToDefender.max).toBeGreaterThanOrEqual(pv!.damageToDefender.expected);
  });

  it('ranged: no return damage', () => {
    const state = scene();
    const r = addUnit(state, 'p1', 'slinger', at(4, 5), content);
    const d = addUnit(state, 'p2', 'warrior', at(6, 5), content);
    state.wars[warKey('p1', 'p2')] = 1;
    const pv = queries.combatPreview(state, r.id, d.at, content)!;
    expect(pv.ranged).toBe(true);
    expect(pv.damageToAttacker).toEqual({ expected: 0, min: 0, max: 0 });
    expect(Math.abs(realMean(state, r.id, d.at).toD - pv.damageToDefender.expected)).toBeLessThan(1.5);
  });

  it('walls: damage capped at the walls, matches real resolutions; walls down means capture', () => {
    const state = scene();
    const s = addSettlement(state, 'p2', at(7, 6), { population: 3, isCapital: false });
    const a = addUnit(state, 'p1', 'warrior', at(6, 6), content);
    state.wars[warKey('p1', 'p2')] = 1;
    const pv = queries.combatPreview(state, a.id, s.at, content)!;
    expect(pv.kind).toBe('walls');
    expect(pv.defenderStrength).toBe(settlementStrength(state, s, content));
    expect(pv.factors.some((f) => f.side === 'defender' && f.label === 'Population' && f.value === 3)).toBe(true);
    const mean = realMean(state, a.id, s.at);
    expect(Math.abs(mean.toD - pv.damageToDefender.expected)).toBeLessThan(1.5);
    expect(Math.abs(mean.toA - pv.damageToAttacker.expected)).toBeLessThan(1.5);
    s.hp = 0;
    const cap = queries.combatPreview(state, a.id, s.at, content)!;
    expect(cap.kind).toBe('capture');
    expect(cap.outlook).toBe('decisive');
    const r = applyCommand(state, 'p1', { type: 'attack', unit: a.id, target: s.at }, content);
    expect(r.ok && r.state.settlements[s.id]?.owner).toBe('p1');
  });

  it('previews as if at war (needsWar) and is null when the attack is impossible or unseen', () => {
    const state = scene();
    const a = addUnit(state, 'p1', 'warrior', at(5, 5), content);
    const d = addUnit(state, 'p2', 'warrior', at(6, 5), content);
    const pv = queries.combatPreview(state, a.id, d.at, content)!;
    expect(pv.needsWar).toBe(true);
    expect(pv.damageToDefender.expected).toBeGreaterThan(0);
    expect(queries.combatPreview(state, a.id, at(9, 5), content)).toBeNull(); // out of range, nothing there
    expect(queries.combatPreview(state, a.id, a.at, content)).toBeNull(); // own tile
    expect(queries.combatPreview(state, 'nope', d.at, content)).toBeNull();
    a.hasAttacked = true;
    expect(queries.combatPreview(state, a.id, d.at, content)).toBeNull();
    a.hasAttacked = false;
    a.movesLeft = 0;
    expect(queries.combatPreview(state, a.id, d.at, content)).toBeNull();
    // Unseen target: a long-range, short-sighted unit cannot preview what it cannot see.
    const longbow = { ...content, units: content.units.map((u) => (u.id === 'slinger' ? { ...u, range: 3, vision: 1 } : u)) };
    const far = fixtureState({ width: 30, height: 10 });
    const r = addUnit(far, 'p1', 'slinger', at(2, 5), longbow);
    const hidden = addUnit(far, 'p2', 'warrior', at(5, 5), longbow);
    far.wars[warKey('p1', 'p2')] = 1;
    expect(queries.visibleTiles(far, 'p1', longbow)).not.toContain(tileIndex(far.map, hidden.at));
    expect(queries.combatPreview(far, r.id, hidden.at, longbow)).toBeNull();
    addUnit(far, 'p1', 'scout', at(5, 4), longbow); // now someone sees it
    expect(queries.combatPreview(far, r.id, hidden.at, longbow)).not.toBeNull();
  });

  it('outlook: decisive for a sure kill, reckless against a much stronger defender', () => {
    const state = scene();
    const a = addUnit(state, 'p1', 'warrior', at(5, 5), content);
    const weak = addUnit(state, 'p2', 'warrior', at(6, 5), content, { hp: 5 });
    state.wars[warKey('p1', 'p2')] = 1;
    expect(queries.combatPreview(state, a.id, weak.at, content)!.outlook).toBe('decisive');
    weak.hp = 100;
    a.hp = 20;
    setTile(state, weak.at, { feature: 'hills' });
    weak.fortified = true;
    expect(queries.combatPreview(state, a.id, weak.at, content)!.outlook).toBe('reckless');
  });
});

describe('settleSites lists only reachable sites', () => {
  it('skips tiles held by another unit of the settler layer and land without a route', () => {
    const state = fixtureState({ width: 20, height: 20 });
    for (const p of Object.values(state.players)) p.explored.fill(1);
    const settler = addUnit(state, 'p1', 'settler', at(5, 5), content);
    const blocker = addUnit(state, 'p1', 'scout', at(8, 5), content);
    // An island cut off by mountains.
    for (let c = 12; c <= 18; c++) for (let r = 0; r < 20; r++) if (c === 12 || c === 18) setTile(state, at(c, r), { terrain: 'mountain' });
    const sites = queries.settleSites(state, settler.id, content);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.some((s) => s.hex.q === blocker.at.q && s.hex.r === blocker.at.r)).toBe(false);
    for (const s of sites) {
      const own = s.hex.q === settler.at.q && s.hex.r === settler.at.r;
      expect(own || queries.pathTo(state, settler.id, s.hex, content) !== null).toBe(true);
    }
    expect(sites.some((s) => { const c = s.hex.q + (s.hex.r - (s.hex.r & 1)) / 2; return c > 12 && c < 18; })).toBe(false);
    // Deterministic, ties in map order.
    expect(queries.settleSites(state, settler.id, content)).toEqual(sites);
  });
});
