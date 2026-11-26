/**
 * Sim-core rule tests (GDD §5, §7) on a hand-built fixture. src/emergence and src/sim/ages
 * are replaced with trivial fakes so these tests exercise only sim-core rules.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hexDistance } from '@contracts/hex';
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

import * as emergence from '../src/emergence';
import * as ages from '../src/sim/ages';
import { applyCommand, queries } from '../src/sim';
import { combatDamage, defenseStrength } from '../src/sim/combat';
import {
  ANARCHY_TURNS,
  ENVOY_AFFINITY,
  ENVOY_BASE_COST,
  ENVOY_COST_STEP,
  FORTIFY_BONUS,
  HAPPINESS_BASE,
  HAPPINESS_PER_OVER_CAP,
  HEAL_IN_SETTLEMENT,
  HEAL_IN_TERRITORY,
  HEAL_RESTING,
  MIN_WAR_TURNS,
  PEACE_INFLUENCE_COST,
  SETTLEMENT_CAP,
  TRADE_ROUTE_GOLD,
  WALL_BASE_HP,
} from '../src/sim/constants';
import { conditionMatches, type CondEnv } from '../src/sim/modifiers';
import { statValue } from '../src/sim/stats';
import { beginNextTurn, startOfTurnForPlayer } from '../src/sim/turn';
import { computeHappiness, growthCost, happinessYieldPercent, settlementYields, tileYield } from '../src/sim/yields';
import { tileAt } from '../src/sim/lookup';
import { addSettlement, addUnit, at, ctxOf, fixtureContent, fixtureState, setTile } from './helpers/fixture';

const content = fixtureContent();

const run = (state: GameState, player: string, command: Command): GameState => {
  const r = applyCommand(state, player, command, content);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const fail = (state: GameState, player: string, command: Command): string => {
  const r = applyCommand(state, player, command, content);
  if (r.ok) throw new Error('expected failure');
  return r.error;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('conditions (one evaluator for every scope)', () => {
  it('evaluates tile, settlement, unit and empire fields', () => {
    const state = fixtureState();
    const s = addSettlement(state, 'p1', at(3, 3), { population: 4 });
    setTile(state, at(0, 0), { feature: 'hills', river: true, resource: 'wheat' });
    setTile(state, at(1, 0), { terrain: 'coast' });
    const tile = tileAt(state.map, at(0, 0));
    if (!tile) throw new Error('tile');
    const env: CondEnv = { state, content, player: 'p1', tile, settlement: s, unitClass: 'infantry' };
    expect(conditionMatches({ terrain: ['grassland'] }, env)).toBe(true);
    expect(conditionMatches({ terrain: ['plains'] }, env)).toBe(false);
    expect(conditionMatches({ feature: ['hills'], river: true, resource: ['wheat'] }, env)).toBe(true);
    expect(conditionMatches({ coastal: true }, env)).toBe(true);
    expect(conditionMatches({ adjacentTerrain: ['coast'] }, env)).toBe(true);
    expect(conditionMatches({ cityMinPop: 4, cityMaxPop: 4, capital: true, settlementKind: 'city' }, env)).toBe(true);
    expect(conditionMatches({ cityMinPop: 5 }, env)).toBe(false);
    expect(conditionMatches({ unitClass: ['ranged'] }, env)).toBe(false);
    expect(conditionMatches({ age: ['ancient'] }, env)).toBe(true);
    expect(conditionMatches({ atWar: false }, env)).toBe(true);
    state.wars[warKey('p1', 'p2')] = 1;
    expect(conditionMatches({ atWar: true }, env)).toBe(true);
    expect(conditionMatches({ minTradeRoutes: 1 }, env)).toBe(false);
    // Missing context never matches a condition that needs it.
    expect(conditionMatches({ capital: true }, { state, content, player: 'p1' })).toBe(false);
  });
});

describe('yields', () => {
  it('tile yield = terrain + feature + resource + river + tile modifiers; luxury happiness excluded', () => {
    const state = fixtureState();
    const t = setTile(state, at(2, 2), { feature: 'hills', river: true, resource: 'silk' });
    const plain = tileYield(state, t, 'p1', content, []);
    expect(plain.food).toBe(2);
    expect(plain.production).toBe(1);
    expect(plain.gold).toBe(1 + 2);
    expect(plain.happiness).toBe(0);
    const mods = [{ scope: 'tile' as const, when: { river: true }, effect: { kind: 'yield' as const, yield: 'production' as const, add: 1 } }];
    expect(tileYield(state, t, 'p1', content, mods).production).toBe(2);
  });

  it('works the center plus `population` best tiles', () => {
    const state = fixtureState();
    const s = addSettlement(state, 'p1', at(5, 5), { population: 2 });
    setTile(state, at(6, 5), { resource: 'wheat' });
    const worked = queries.workedTiles(state, s.id, content);
    expect(worked).toHaveLength(3);
    expect(worked).toContainEqual(at(6, 5));
  });

  it('towns turn production into gold and cannot build', () => {
    const state = fixtureState({ terrain: 'plains' });
    const s = addSettlement(state, 'p1', at(5, 5), { population: 1, kind: 'town', isCapital: false });
    const y = settlementYields(state, s, content);
    expect(y.production).toBe(0);
    expect(y.gold).toBeGreaterThan(0);
    expect(fail(state, 'p1', { type: 'setProduction', settlement: s.id, item: 'warrior' })).toMatch(/Towns/);
  });

  it('growth cost follows 5 + 4·pop + pop^1.4', () => {
    expect(growthCost(1)).toBe(10);
    expect(growthCost(5)).toBe(Math.floor(5 + 20 + Math.pow(5, 1.4)));
  });

  it('settlements grow and borders reach radius 2 at pop 3', () => {
    const state = fixtureState();
    const s = addSettlement(state, 'p1', at(5, 5), { population: 2 });
    s.foodStored = growthCost(2) - 0.5;
    const before = state.map.tiles.filter((t) => t.owner === 'p1').length;
    const ctx = ctxOf(state, content);
    startOfTurnForPlayer(ctx, 'p1');
    expect(s.population).toBe(3);
    expect(ctx.events).toContainEqual({ type: 'settlementGrew', settlement: s.id, population: 3 });
    const owned = state.map.tiles.filter((t) => t.owner === 'p1');
    expect(owned.length).toBeGreaterThan(before);
    expect(Math.max(...owned.map((t) => hexDistance(t, s.at)))).toBe(2);
  });

  it('happiness: luxuries once, −1 per pop above 5, cap penalty; celebration and unhappiness scale yields', () => {
    const state = fixtureState({ width: 30, height: 10 });
    const cap = SETTLEMENT_CAP.ancient;
    for (let i = 0; i < cap + 1; i++) addSettlement(state, 'p1', at(1 + i * 4, i % 2 === 0 ? 2 : 6), { population: 1, isCapital: i === 0 });
    const first = Object.values(state.settlements)[0];
    if (!first) throw new Error('no settlement');
    first.population = 7;
    setTile(state, at(2, 2), { resource: 'silk', owner: 'p1' });
    setTile(state, at(1, 3), { resource: 'silk', owner: 'p1' });
    expect(computeHappiness(state, 'p1', content)).toBe(HAPPINESS_BASE + 2 - 2 - HAPPINESS_PER_OVER_CAP);
    expect(happinessYieldPercent(10)).toBe(10);
    expect(happinessYieldPercent(-3)).toBe(-6);
    expect(happinessYieldPercent(5)).toBe(0);
  });
});

describe('founding', () => {
  it('first settlement is the capital city, later ones are towns; too close or on water/mountain fails', () => {
    vi.mocked(emergence.cultureWeights).mockReturnValue({ beta: 2 });
    let state = fixtureState();
    setTile(state, at(9, 1), { terrain: 'coast' });
    setTile(state, at(9, 8), { terrain: 'mountain' });
    const a = addUnit(state, 'p1', 'settler', at(2, 2), content);
    const b = addUnit(state, 'p1', 'settler', at(4, 2), content);
    const c = addUnit(state, 'p1', 'settler', at(8, 6), content);
    const w = addUnit(state, 'p1', 'settler', at(9, 1), content);
    const m = addUnit(state, 'p1', 'settler', at(9, 8), content);
    state = run(state, 'p1', { type: 'foundSettlement', unit: a.id });
    const capital = Object.values(state.settlements)[0];
    expect(capital?.isCapital).toBe(true);
    expect(capital?.kind).toBe('city');
    expect(capital?.name).toBe('B1');
    expect(state.units[a.id]).toBeUndefined();
    expect(fail(state, 'p1', { type: 'foundSettlement', unit: b.id })).toMatch(/too close|already a settlement|belongs to|water|impassable/);
    expect(queries.canFound(state, w.id, content)).toBe(false);
    expect(queries.canFound(state, m.id, content)).toBe(false);
    state = run(state, 'p1', { type: 'foundSettlement', unit: c.id });
    const town = Object.values(state.settlements)[1];
    expect(town?.kind).toBe('town');
    expect(town?.name).toBe('B2');
    expect(tileAt(state.map, at(8, 6))?.owner).toBe('p1');
  });

  it('upgradeSettlement turns a town into a city for gold', () => {
    let state = fixtureState();
    const s = addSettlement(state, 'p1', at(5, 5), { kind: 'town', isCapital: false });
    const cost = queries.upgradeCost(state, s.id, content);
    expect(fail(state, 'p1', { type: 'upgradeSettlement', settlement: s.id })).toMatch(/gold/);
    const p1 = state.players.p1;
    if (!p1) throw new Error('p1');
    p1.stock.gold = cost;
    state = run(state, 'p1', { type: 'upgradeSettlement', settlement: s.id });
    expect(state.settlements[s.id]?.kind).toBe('city');
    expect(state.players.p1?.stock.gold).toBe(0);
  });
});

describe('production', () => {
  it('completes items at start of turn and spawns units; cost modifiers apply', () => {
    let state = fixtureState({ terrain: 'plains' });
    const s = addSettlement(state, 'p1', at(5, 5));
    expect(queries.productionOptions(state, s.id, content).map((o) => o.item)).toEqual(
      expect.arrayContaining(['settler', 'warrior', 'walls', 'shrine', 'pyramid']),
    );
    // Locked: needs pottery / horses / coast / is a figure unit.
    const items = queries.productionOptions(state, s.id, content).map((o) => o.item);
    for (const locked of ['granary', 'chariot', 'harbor', 'canoe', 'general', 'spearman']) expect(items).not.toContain(locked);
    state = run(state, 'p1', { type: 'setProduction', settlement: s.id, item: 'warrior' });
    const warriorCost = queries.productionOptions(state, s.id, content).find((o) => o.item === 'warrior')?.cost;
    expect(warriorCost).toBe(30);
    const st = state.settlements[s.id];
    if (!st) throw new Error('s');
    st.production.progress = 29;
    const ctx = ctxOf(state, content);
    startOfTurnForPlayer(ctx, 'p1');
    expect(Object.values(state.units).filter((u) => u.type === 'warrior')).toHaveLength(1);
    expect(st.production.item).toBeNull();
    expect(ctx.events.some((e) => e.type === 'productionCompleted')).toBe(true);
    // Despotism: units −50% in the fixture.
    const p1 = state.players.p1;
    if (!p1) throw new Error('p1');
    p1.government = 'despotism';
    expect(queries.productionOptions(state, s.id, content).find((o) => o.item === 'warrior')?.cost).toBe(15);
  });

  it('buyItem spends gold; wonders cannot be bought', () => {
    let state = fixtureState();
    const s = addSettlement(state, 'p1', at(5, 5));
    const opt = queries.productionOptions(state, s.id, content).find((o) => o.item === 'shrine');
    if (!opt) throw new Error('shrine');
    const p1 = state.players.p1;
    if (!p1) throw new Error('p1');
    p1.stock.gold = opt.goldCost + 5;
    state = run(state, 'p1', { type: 'buyItem', settlement: s.id, item: 'shrine' });
    expect(state.settlements[s.id]?.buildings).toEqual(['shrine']);
    expect(state.players.p1?.stock.gold).toBe(5);
    expect(fail(state, 'p1', { type: 'buyItem', settlement: s.id, item: 'pyramid' })).toMatch(/Wonders/);
  });

  it('wonders are once per world and feed affinity and the age meter', () => {
    const state = fixtureState();
    const s = addSettlement(state, 'p1', at(2, 2));
    const o = addSettlement(state, 'p2', at(8, 7));
    s.production = { item: 'pyramid', progress: 100 };
    o.production = { item: 'pyramid', progress: 50 };
    const ctx = ctxOf(state, content);
    startOfTurnForPlayer(ctx, 'p1');
    expect(state.wonders.pyramid?.owner).toBe('p1');
    expect(state.players.p1?.stats.wondersBuilt).toBe(1);
    expect(emergence.addAffinity).toHaveBeenCalledWith(ctx, 'p1', 'beta', 20);
    expect(ages.addAgeProgress).toHaveBeenCalledWith(ctx, 1);
    expect(o.production.item).toBeNull();
    expect(state.players.p1?.chronicle.some((c) => c.kind === 'wonder')).toBe(true);
  });

  it('walls raise max HP', () => {
    let state = fixtureState();
    const s = addSettlement(state, 'p1', at(5, 5));
    const p1 = state.players.p1;
    if (!p1) throw new Error('p1');
    p1.stock.gold = 1000;
    state = run(state, 'p1', { type: 'buyItem', settlement: s.id, item: 'walls' });
    expect(state.settlements[s.id]?.maxHp).toBe(WALL_BASE_HP + 50);
  });
});

describe('movement', () => {
  it('hills cost 2, mountains and water block land units, embark unlocks water', () => {
    let state = fixtureState();
    setTile(state, at(3, 2), { feature: 'hills' });
    setTile(state, at(1, 2), { terrain: 'mountain' });
    setTile(state, at(2, 1), { terrain: 'coast' });
    const u = addUnit(state, 'p1', 'warrior', at(2, 2), content);
    const reach = queries.reachable(state, u.id, content);
    const costTo = (h: { q: number; r: number }) => reach.find((x) => x.hex.q === h.q && x.hex.r === h.r)?.cost;
    expect(costTo(at(3, 2))).toBe(2);
    expect(costTo(at(1, 2))).toBeUndefined();
    expect(costTo(at(2, 1))).toBeUndefined();
    const p1 = state.players.p1;
    if (!p1) throw new Error('p1');
    p1.effects.push({ source: 'test', untilTurn: -1, modifiers: [{ scope: 'empire', effect: { kind: 'unlock', what: 'embark', id: 'embark' } }] });
    expect(queries.reachable(state, u.id, content).some((x) => x.hex.q === at(2, 1).q && x.hex.r === at(2, 1).r)).toBe(true);
    state = run(state, 'p1', { type: 'moveUnit', unit: u.id, to: at(3, 2) });
    expect(state.units[u.id]?.movesLeft).toBe(0);
    expect(fail(state, 'p1', { type: 'moveUnit', unit: u.id, to: at(4, 2) })).toMatch(/no moves left/);
  });

  it('one military unit per tile; enemies block; naval units stay on water', () => {
    const state = fixtureState();
    const a = addUnit(state, 'p1', 'warrior', at(2, 2), content);
    addUnit(state, 'p1', 'warrior', at(3, 2), content);
    addUnit(state, 'p1', 'scout', at(2, 3), content);
    addUnit(state, 'p2', 'warrior', at(1, 2), content);
    const reach = queries.reachable(state, a.id, content).map((x) => `${x.hex.q},${x.hex.r}`);
    const key = (h: { q: number; r: number }) => `${h.q},${h.r}`;
    expect(reach).not.toContain(key(at(3, 2)));
    expect(reach).toContain(key(at(2, 3))); // civilian layer is separate
    expect(reach).not.toContain(key(at(1, 2)));
    setTile(state, at(6, 6), { terrain: 'coast' });
    setTile(state, at(7, 6), { terrain: 'coast' });
    const boat = addUnit(state, 'p1', 'canoe', at(6, 6), content);
    expect(queries.reachable(state, boat.id, content).map((x) => key(x.hex))).toEqual([key(at(7, 6))]);
  });

  it('marks explored tiles along the path', () => {
    let state = fixtureState();
    const u = addUnit(state, 'p1', 'scout', at(0, 0), content);
    state = run(state, 'p1', { type: 'moveUnit', unit: u.id, to: at(3, 0) });
    const idx = (col: number, row: number) => row * state.map.width + col;
    expect(state.players.p1?.explored[idx(5, 0)]).toBe(1);
  });
});

describe('combat', () => {
  it('damage = 30·e^(0.04·ΔS)·r', () => {
    expect(combatDamage(20, 20, 1)).toBe(30);
    expect(combatDamage(30, 20, 1)).toBe(Math.round(30 * Math.exp(0.4)));
    expect(combatDamage(20, 20, 0.8)).toBe(24);
  });

  it('needs war; melee trades damage; ranged takes none', () => {
    let state = fixtureState();
    const a = addUnit(state, 'p1', 'warrior', at(2, 2), content);
    const r = addUnit(state, 'p1', 'slinger', at(4, 4), content);
    const d = addUnit(state, 'p2', 'warrior', at(3, 2), content);
    const d2 = addUnit(state, 'p2', 'warrior', at(5, 5), content);
    expect(fail(state, 'p1', { type: 'attack', unit: a.id, target: d.at })).toMatch(/war/);
    state = run(state, 'p1', { type: 'declareWar', target: 'p2' });
    expect(queries.atWar(state, 'p1', 'p2')).toBe(true);
    const res = applyCommand(state, 'p1', { type: 'attack', unit: a.id, target: d.at }, content);
    if (!res.ok) throw new Error(res.error);
    const ev = res.events.find((e) => e.type === 'combat');
    expect(ev && ev.type === 'combat' && ev.damageToDefender > 0 && ev.damageToAttacker > 0).toBe(true);
    expect(res.state.units[d.id]?.hp).toBeLessThan(100);
    expect(res.state.units[a.id]?.hasAttacked).toBe(true);
    const res2 = applyCommand(res.state, 'p1', { type: 'attack', unit: r.id, target: d2.at }, content);
    if (!res2.ok) throw new Error(res2.error);
    expect(res2.state.units[r.id]?.hp).toBe(100);
    expect(res2.state.units[d2.id]?.hp).toBeLessThan(100);
  });

  it('defense: hills +3, fortified +5, −1 per 10 HP lost, combat modifiers with vs', () => {
    const state = fixtureState();
    const d = addUnit(state, 'p2', 'warrior', at(3, 2), content);
    expect(defenseStrength(state, d, 'infantry', content)).toBe(20);
    setTile(state, at(3, 2), { feature: 'hills' });
    expect(defenseStrength(state, d, 'infantry', content)).toBe(23);
    d.fortified = true;
    expect(defenseStrength(state, d, 'infantry', content)).toBe(23 + FORTIFY_BONUS);
    d.hp = 75;
    expect(defenseStrength(state, d, 'infantry', content)).toBe(23 + FORTIFY_BONUS - 2);
    state.players.p2?.effects.push({
      source: 'test',
      untilTurn: -1,
      modifiers: [{ scope: 'unit', effect: { kind: 'combat', add: 4, vs: 'cavalry' } }],
    });
    expect(defenseStrength(state, d, 'cavalry', content)).toBe(23 + FORTIFY_BONUS - 2 + 4);
    expect(defenseStrength(state, d, 'infantry', content)).toBe(23 + FORTIFY_BONUS - 2);
  });

  it('a killed figure-unit goes to the emergence engine instead of being deleted', () => {
    let state = fixtureState();
    const a = addUnit(state, 'p1', 'warrior', at(2, 2), content);
    const g = addUnit(state, 'p2', 'general', at(3, 2), content, { hp: 1, figure: 'some_general' });
    addSettlement(state, 'p2', at(7, 7)); // so p2 is not eliminated by the loss
    state.wars[warKey('p1', 'p2')] = 1;
    state = run(state, 'p1', { type: 'attack', unit: a.id, target: g.at });
    expect(emergence.onFigureUnitDefeated).toHaveBeenCalledWith(expect.anything(), g.id, 'p1');
    expect(state.units[g.id]).toBeDefined(); // the fake did not remove it
    expect(state.players.p1?.stats.battlesWon).toBe(1);
    expect(state.players.p2?.stats.unitsLost).toBe(1);
  });

  it('walls first, then a melee unit captures; the loser with nothing left is eliminated', () => {
    let state = fixtureState();
    const s = addSettlement(state, 'p2', at(5, 5), { population: 3 });
    const a = addUnit(state, 'p1', 'warrior', at(6, 5), content);
    state.wars[warKey('p1', 'p2')] = 1;
    state = run(state, 'p1', { type: 'attack', unit: a.id, target: s.at });
    expect(state.settlements[s.id]?.hp).toBeLessThan(WALL_BASE_HP);
    expect(state.settlements[s.id]?.owner).toBe('p2');
    const st = state.settlements[s.id];
    const au = state.units[a.id];
    if (!st || !au) throw new Error('missing');
    st.hp = 0;
    au.hasAttacked = false;
    au.movesLeft = 2;
    const res = applyCommand(state, 'p1', { type: 'attack', unit: a.id, target: s.at }, content);
    if (!res.ok) throw new Error(res.error);
    state = res.state;
    expect(state.settlements[s.id]?.owner).toBe('p1');
    expect(state.settlements[s.id]?.population).toBe(2);
    expect(state.units[a.id]?.at).toEqual(s.at);
    expect(tileAt(state.map, at(4, 5))?.owner).toBe('p1');
    expect(emergence.onSettlementCaptured).toHaveBeenCalled();
    expect(res.events).toContainEqual({ type: 'settlementCaptured', settlement: s.id, from: 'p2', to: 'p1' });
    expect(state.players.p2?.alive).toBe(false);
    expect(emergence.onPlayerEliminated).toHaveBeenCalledWith(expect.anything(), 'p2', 'p1');
    expect(state.players.p1?.stats.citiesCaptured).toBe(1);
  });

  it('ranged units cannot take a settlement with fallen walls', () => {
    const state = fixtureState();
    const s = addSettlement(state, 'p2', at(5, 5));
    s.hp = 0;
    const r = addUnit(state, 'p1', 'slinger', at(7, 5), content);
    state.wars[warKey('p1', 'p2')] = 1;
    expect(fail(state, 'p1', { type: 'attack', unit: r.id, target: s.at })).toMatch(/melee/);
  });

  it('city-states are attackable after declaring war on cs:<id>, and die when captured', () => {
    let state = fixtureState();
    const s = addSettlement(state, 'cs:cs_one', at(5, 5), { population: 3 });
    state.cityStates.cs_one = { id: 'cs_one', settlement: s.id, envoys: { p1: 3 }, suzerain: 'p1', alive: true };
    s.hp = 0;
    const a = addUnit(state, 'p1', 'warrior', at(6, 5), content);
    expect(fail(state, 'p1', { type: 'attack', unit: a.id, target: s.at })).toMatch(/war/);
    state = run(state, 'p1', { type: 'declareWar', target: 'cs:cs_one' });
    state = run(state, 'p1', { type: 'attack', unit: a.id, target: s.at });
    expect(state.settlements[s.id]?.owner).toBe('p1');
    expect(state.cityStates.cs_one?.alive).toBe(false);
    expect(state.cityStates.cs_one?.suzerain).toBeNull();
  });
});

describe('trees and government', () => {
  it('research completes from science; finishing the age tree adds 4 to the meter', () => {
    let state = fixtureState();
    expect(queries.researchOptions(state, 'p1', 'tech', content).map((o) => o.id)).toEqual(['pottery']);
    expect(fail(state, 'p1', { type: 'setResearch', tree: 'tech', id: 'bronze' })).toMatch(/cannot be researched yet/);
    state = run(state, 'p1', { type: 'setResearch', tree: 'tech', id: 'pottery' });
    addSettlement(state, 'p1', at(5, 5));
    const p1 = state.players.p1;
    if (!p1) throw new Error('p1');
    p1.research.tech.progress = 19.9;
    const ctx = ctxOf(state, content);
    startOfTurnForPlayer(ctx, 'p1');
    expect(p1.techs).toContain('pottery');
    expect(ctx.events).toContainEqual({ type: 'researchCompleted', player: 'p1', tree: 'tech', id: 'pottery' });
    expect(ages.addAgeProgress).not.toHaveBeenCalled();
    p1.research.tech = { current: 'bronze', progress: 30 };
    startOfTurnForPlayer(ctx, 'p1');
    expect(ages.addAgeProgress).toHaveBeenCalledWith(ctx, 4);
  });

  it('first government is free, a change costs 2 turns of anarchy that suspend government modifiers', () => {
    let state = fixtureState();
    expect(queries.governmentOptions(state, 'p1', content)).toEqual(['chiefdom', 'despotism']);
    state = run(state, 'p1', { type: 'setGovernment', government: 'despotism' });
    expect(state.players.p1?.anarchyTurns).toBe(0);
    expect(emergence.syncCabinet).toHaveBeenCalled();
    const s = addSettlement(state, 'p1', at(5, 5));
    expect(queries.productionOptions(state, s.id, content).find((o) => o.item === 'warrior')?.cost).toBe(15);
    state = run(state, 'p1', { type: 'setGovernment', government: 'chiefdom' });
    state = run(state, 'p1', { type: 'setGovernment', government: 'despotism' });
    expect(state.players.p1?.anarchyTurns).toBe(ANARCHY_TURNS);
    expect(queries.productionOptions(state, s.id, content).find((o) => o.item === 'warrior')?.cost).toBe(30);
    expect(fail(state, 'p1', { type: 'setGovernment', government: 'monarchy' })).toMatch(/not available/);
  });
});

describe('diplomacy, city-states, trade', () => {
  it('envoys cost more each time, grant affinity, and make a suzerain at 3', () => {
    let state = fixtureState();
    const s = addSettlement(state, 'cs:cs_one', at(8, 5), { population: 3 });
    state.cityStates.cs_one = { id: 'cs_one', settlement: s.id, envoys: {}, suzerain: null, alive: true };
    const p1 = state.players.p1;
    if (!p1) throw new Error('p1');
    p1.stock.influence = 1000;
    for (let i = 0; i < 3; i++) {
      expect(queries.envoyCost(state, 'p1', 'cs_one', content)).toBe(ENVOY_BASE_COST + i * ENVOY_COST_STEP);
      state = run(state, 'p1', { type: 'sendEnvoy', cityState: 'cs_one' });
    }
    expect(emergence.addAffinity).toHaveBeenCalledWith(expect.anything(), 'p1', 'beta', ENVOY_AFFINITY);
    expect(state.cityStates.cs_one?.suzerain).toBe('p1');
    expect(state.players.p1?.stats.envoysSent).toBe(3);
    expect(state.players.p1?.stock.influence).toBe(1000 - (3 * ENVOY_BASE_COST + 3 * ENVOY_COST_STEP));
  });

  it('makePeace needs 10 turns of war and influence', () => {
    let state = fixtureState();
    state = run(state, 'p1', { type: 'declareWar', target: 'p2' });
    const p1 = state.players.p1;
    if (!p1) throw new Error('p1');
    p1.stock.influence = PEACE_INFLUENCE_COST;
    expect(fail(state, 'p1', { type: 'makePeace', target: 'p2' })).toMatch(/turns/);
    state.turn += MIN_WAR_TURNS;
    state = run(state, 'p1', { type: 'makePeace', target: 'p2' });
    expect(state.wars).toEqual({});
    expect(state.players.p1?.stock.influence).toBe(0);
  });

  it('a merchant next to a foreign settlement opens a route, is consumed, and pays gold', () => {
    let state = fixtureState();
    const home = addSettlement(state, 'p1', at(2, 2));
    const foreign = addSettlement(state, 'p2', at(8, 2));
    const m = addUnit(state, 'p1', 'merchant', at(7, 2), content);
    const m2 = addUnit(state, 'p1', 'merchant', at(9, 2), content);
    expect(queries.tradeTargets(state, m.id, content)).toEqual([foreign.id]);
    state = run(state, 'p1', { type: 'openTradeRoute', unit: m.id, to: foreign.id });
    expect(state.tradeRoutes).toEqual([{ id: expect.any(String), owner: 'p1', from: home.id, to: foreign.id }]);
    expect(state.units[m.id]).toBeUndefined();
    // Capacity is 1 and the same target is taken.
    expect(fail(state, 'p1', { type: 'openTradeRoute', unit: m2.id, to: foreign.id })).toBeTruthy();
    const ctx = ctxOf(state, content);
    const before = state.players.p1?.stock.gold ?? 0;
    startOfTurnForPlayer(ctx, 'p1');
    expect((state.players.p1?.stock.gold ?? 0) - before).toBeGreaterThanOrEqual(TRADE_ROUTE_GOLD);
  });
});

describe('turn structure', () => {
  it('players act in order; the world phase and start-of-turn run after the last one', () => {
    let state = fixtureState();
    addSettlement(state, 'p1', at(2, 2));
    addSettlement(state, 'p2', at(9, 7));
    expect(fail(state, 'p2', { type: 'endTurn' })).toMatch(/turn/);
    state = run(state, 'p1', { type: 'endTurn' });
    expect(state.currentPlayer).toBe('p2');
    expect(state.turn).toBe(1);
    const res = applyCommand(state, 'p2', { type: 'endTurn' }, content);
    if (!res.ok) throw new Error(res.error);
    expect(res.state.turn).toBe(2);
    expect(res.state.currentPlayer).toBe('p1');
    expect(res.events).toContainEqual({ type: 'turnStarted', turn: 2 });
    expect(ages.agesWorldPhase).toHaveBeenCalledTimes(1);
    expect(emergence.emergenceTick).toHaveBeenCalledTimes(2);
    expect(ages.updateMilestones).toHaveBeenCalledTimes(2);
  });

  it('endTurn is blocked only by open offers and owed crisis responses', () => {
    const state = fixtureState();
    // An offer blocks only a player with a settlement to host the figure (autoplay fix).
    state.offers.push({ id: 'o0', player: 'p1', source: 'military', candidates: [], reasons: {}, deed: null, createdTurn: 1 });
    expect(applyCommand(state, 'p1', { type: 'endTurn' }, content).ok).toBe(true);
    state.offers = [];
    addSettlement(state, 'p1', at(3, 3));
    state.offers.push({ id: 'o1', player: 'p1', source: 'military', candidates: [], reasons: {}, deed: null, createdTurn: 1 });
    expect(fail(state, 'p1', { type: 'endTurn' })).toMatch(/offer/);
    state.offers = [];
    state.crisis = { id: 'c', stage: 1, awaiting: ['p1'] };
    expect(fail(state, 'p1', { type: 'endTurn' })).toMatch(/crisis/);
    state.crisis.awaiting = [];
    expect(applyCommand(state, 'p1', { type: 'endTurn' }, content).ok).toBe(true);
  });

  it('transition allows only ages commands and setGovernment; flipping back to playing starts the next turn', () => {
    let state = fixtureState();
    const u = addUnit(state, 'p1', 'warrior', at(2, 2), content);
    state.phase = 'transition';
    state.age = 'ancient';
    state.transition = { fromAge: 'ancient', toAge: 'classical', recap: {} };
    expect(fail(state, 'p1', { type: 'moveUnit', unit: u.id, to: at(3, 2) })).toMatch(/transition/);
    state = run(state, 'p2', { type: 'setGovernment', government: 'monarchy' });
    expect(state.players.p2?.government).toBe('monarchy');
    vi.mocked(ages.handleAgesCommand).mockImplementationOnce((ctx) => {
      ctx.state.phase = 'playing';
      ctx.state.age = 'classical';
      ctx.state.transition = null;
      return null;
    });
    const res = applyCommand(state, 'p1', { type: 'finishTransition' }, content);
    if (!res.ok) throw new Error(res.error);
    expect(res.state.turn).toBe(2);
    expect(res.events).toContainEqual({ type: 'turnStarted', turn: 2 });
    state.phase = 'ended';
    expect(fail(state, 'p1', { type: 'endTurn' })).toMatch(/over/);
  });

  it('heals by location, auto-upgrades in own territory, refreshes moves', () => {
    const state = fixtureState();
    addSettlement(state, 'p1', at(2, 2), { population: 3 });
    const inCity = addUnit(state, 'p1', 'warrior', at(2, 2), content, { hp: 50, movesLeft: 0 });
    const inLand = addUnit(state, 'p1', 'slinger', at(3, 2), content, { hp: 50, movesLeft: 0 });
    const rested = addUnit(state, 'p1', 'slinger', at(9, 8), content, { hp: 50 });
    const moved = addUnit(state, 'p1', 'scout', at(10, 8), content, { hp: 50, movesLeft: 0 });
    const p1 = state.players.p1;
    if (!p1) throw new Error('p1');
    p1.techs.push('bronze');
    startOfTurnForPlayer(ctxOf(state, content), 'p1');
    expect(state.units[inCity.id]?.hp).toBe(50 + HEAL_IN_SETTLEMENT);
    expect(state.units[inLand.id]?.hp).toBe(50 + HEAL_IN_TERRITORY);
    expect(state.units[rested.id]?.hp).toBe(50 + HEAL_RESTING);
    expect(state.units[moved.id]?.hp).toBe(50);
    expect(state.units[inCity.id]?.type).toBe('spearman');
    expect(state.units[moved.id]?.movesLeft).toBe(3);
  });

  it('raiders move toward and attack the nearest target in the world phase', () => {
    const state = fixtureState();
    const s = addSettlement(state, 'p1', at(2, 2));
    const r = addUnit(state, 'raiders', 'warrior', at(6, 2), content);
    state.currentPlayer = 'p2';
    const res = applyCommand(state, 'p2', { type: 'endTurn' }, content);
    if (!res.ok) throw new Error(res.error);
    const moved = res.state.units[r.id];
    expect(moved && hexDistance(moved.at, s.at)).toBeLessThan(4);
    // Raiders never need a war declaration.
    expect(queries.atWar(state, 'p1', 'raiders')).toBe(true);
  });

  it('raiders pillage a settlement with fallen walls instead of capturing it, then scatter', () => {
    const state = fixtureState();
    const s = addSettlement(state, 'p1', at(2, 2), { population: 3 });
    addSettlement(state, 'p2', at(9, 7));
    s.hp = 0;
    const r = addUnit(state, 'raiders', 'warrior', at(3, 2), content);
    state.currentPlayer = 'p2';
    const res = applyCommand(state, 'p2', { type: 'endTurn' }, content);
    if (!res.ok) throw new Error(res.error);
    expect(res.state.settlements[s.id]?.owner).toBe('p1');
    expect(res.state.settlements[s.id]?.population).toBe(2);
    expect(res.state.units[r.id]).toBeUndefined();
  });

  it('applyCommand never mutates its input', () => {
    const state = fixtureState();
    addSettlement(state, 'p1', at(2, 2));
    const u = addUnit(state, 'p1', 'warrior', at(3, 3), content);
    const before = JSON.stringify(state);
    run(state, 'p1', { type: 'moveUnit', unit: u.id, to: at(4, 3) });
    run(state, 'p1', { type: 'endTurn' });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('beginNextTurn expires timed effects', () => {
    const state = fixtureState();
    state.players.p1?.effects.push({ source: 'x', untilTurn: 1, modifiers: [] });
    beginNextTurn(ctxOf(state, content));
    expect(state.players.p1?.effects).toEqual([]);
  });
});

describe('stats and visibility', () => {
  it('statValue measures the player', () => {
    const state = fixtureState();
    addSettlement(state, 'p1', at(2, 2), { population: 4 });
    setTile(state, at(9, 1), { terrain: 'coast' });
    addSettlement(state, 'p1', at(8, 1), { isCapital: false, kind: 'town' });
    addUnit(state, 'p1', 'warrior', at(5, 5), content);
    const p1 = state.players.p1;
    if (!p1) throw new Error('p1');
    p1.techs.push('pottery', 'iron');
    expect(statValue(state, 'p1', 'settlementCount', undefined, content)).toBe(2);
    expect(statValue(state, 'p1', 'coastalSettlements', undefined, content)).toBe(1);
    expect(statValue(state, 'p1', 'largestCityPop', undefined, content)).toBe(4);
    expect(statValue(state, 'p1', 'techsResearched', undefined, content)).toBe(1);
    expect(statValue(state, 'p1', 'unitsOfClass', 'infantry', content)).toBe(1);
    expect(statValue(state, 'p1', 'ownedTerrain', 'grassland', content)).toBeGreaterThan(0);
    p1.explored.fill(1);
    expect(statValue(state, 'p1', 'exploredPercent', undefined, content)).toBe(100);
  });

  it('visibleTiles covers unit vision, settlements within 3 and owned tiles', () => {
    const state = fixtureState({ width: 20, height: 12 });
    addUnit(state, 'p1', 'warrior', at(0, 0), content);
    const vis = new Set(queries.visibleTiles(state, 'p1', content));
    const idx = (col: number, row: number) => row * state.map.width + col;
    expect(vis.has(idx(2, 0))).toBe(true);
    expect(vis.has(idx(3, 0))).toBe(false);
    addSettlement(state, 'p1', at(10, 6));
    const vis2 = new Set(queries.visibleTiles(state, 'p1', content));
    expect(vis2.has(idx(13, 6))).toBe(true);
  });

  it('pendingDecisions lists offers, research, government and idle cities', () => {
    const state = fixtureState();
    addSettlement(state, 'p1', at(2, 2));
    const d = queries.pendingDecisions(state, 'p1', content).map((x) => x.type);
    expect(d).toEqual(expect.arrayContaining(['government', 'research', 'production']));
  });
});
