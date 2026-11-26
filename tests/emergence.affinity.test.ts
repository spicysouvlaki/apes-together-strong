/** Signals, affinity and hints (GDD §4 "Affinity engine", "Hidden affinity"). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalMeasure, type ContentBundle, type Signal } from '@contracts/content-schemas';
import { loadContent } from '../src/content';
import { addAffinity, emergenceTick, initEmergence } from '../src/emergence';
import { updateAffinity } from '../src/emergence/affinity';
import { AFFINITY_DECAY, AFFINITY_SCALE, HINT_COOLDOWN_TURNS, HINT_TOP_N } from '../src/emergence/constants';
import { measurePlayer, signalContributions, signalValue } from '../src/emergence/signals';
import { addSettlement, addUnit, at, claim, makeCtx, makeState, resetFakes, testContent, tileOf } from './helpers/emergence';

vi.mock('../src/sim/units', () => import('./helpers/emergence'));
vi.mock('../src/sim/stats', () => import('./helpers/emergence'));
vi.mock('../src/sim/ages', () => import('./helpers/emergence'));

const real = loadContent();

const sig = (id: string, measure: Signal['measure'], weights: Record<string, number>, param?: string): Signal => ({
  id,
  description: id,
  measure,
  hint: `your ${id}`,
  weights,
  ...(param !== undefined ? { param } : {}),
});

beforeEach(resetFakes);

describe('initEmergence', () => {
  it('zeroes every culture in content order and starts pools at 60', () => {
    const e = initEmergence(real);
    expect(Object.keys(e.affinity)).toEqual(real.cultures.map((c) => c.id));
    expect(Object.values(e.affinity).every((v) => v === 0)).toBe(true);
    expect(Object.values(e.hintsShown).every((v) => v === 0)).toBe(true);
    expect(e.gp).toEqual({ military: 0, statesman: 0, thought: 0, faith: 0, building: 0, exploration: 0 });
    expect(Object.values(e.gpThreshold).every((v) => v === 60)).toBe(true);
    expect(e.legendSlotUsed).toBe(false);
    expect(e.seatedTurns).toEqual({});
  });
});

describe('signal measures', () => {
  const content = testContent(real);
  const build = () => {
    const state = makeState(content, {
      terrain: (col, row) => ({
        terrain: col === 0 ? 'coast' : row < 5 ? 'tundra' : 'steppe',
        feature: col === 3 ? 'forest' : null,
        resource: col === 4 && row % 2 === 0 ? 'horses' : null,
        climate: row < 5 ? 'polar' : 'temperate',
      }),
    });
    const a = addSettlement(state, 'p1', at(1, 2), { population: 3 });
    const t = tileOf(state, a.at);
    if (t) t.river = true;
    addSettlement(state, 'p1', at(8, 8), { population: 2 });
    claim(state, 'p1', at(1, 2), 1);
    claim(state, 'p1', at(4, 8), 2);
    addSettlement(state, 'p2', at(12, 12), { namedFor: 'arab' });
    addSettlement(state, 'cs:ugarit', at(15, 15), { namedFor: 'greek', isCapital: false });
    state.cityStates.ugarit = { id: 'ugarit', settlement: 'x', envoys: {}, suzerain: 'p1', alive: true };
    addUnit(state, content, 'p1', 'chariot', at(1, 2));
    addUnit(state, content, 'p1', 'chariot', at(1, 2));
    addUnit(state, content, 'p1', 'warrior_band', at(1, 2));
    addUnit(state, content, 'p1', 'scout', at(1, 2));
    addUnit(state, content, 'p1', 'settler', at(1, 2));
    addUnit(state, content, 'p2', 'chariot', at(12, 12));
    const s1 = Object.keys(state.settlements)[0] as string;
    const p2s = Object.values(state.settlements).find((s) => s.owner === 'p2')?.id as string;
    const css = Object.values(state.settlements).find((s) => s.owner === 'cs:ugarit')?.id as string;
    state.tradeRoutes.push({ id: 't1', owner: 'p1', from: s1, to: p2s }, { id: 't2', owner: 'p1', from: s1, to: css });
    state.tradeRoutes.push({ id: 't3', owner: 'p2', from: p2s, to: s1 });
    const p = state.players.p1!;
    p.stats.battlesWonThisTurn = 2;
    p.stats.citiesCapturedThisTurn = 1;
    p.stats.wondersBuilt = 3;
    p.stats.envoysSent = 4;
    p.income.faith = 5;
    p.income.culture = 6;
    p.income.science = 7;
    p.income.gold = -2;
    p.techs = ['pottery', 'mining', 'iron_working'];
    for (let i = 0; i < p.explored.length / 4; i++) p.explored[i] = 1;
    return state;
  };

  const owned = (state: ReturnType<typeof build>, f: (t: (typeof state.map.tiles)[number]) => boolean): number =>
    state.map.tiles.filter((t) => t.owner === 'p1' && f(t)).length;

  it('measures every SignalMeasure', () => {
    const state = build();
    const m = measurePlayer(state, 'p1', content);
    const v = (measure: Signal['measure'], param?: string, culture = 'greek'): number =>
      signalValue(sig('s', measure, {}, param), culture, m, state, 'p1');
    expect(v('ownedTerrain', 'tundra')).toBe(owned(state, (t) => t.terrain === 'tundra'));
    expect(v('ownedTerrain', 'tundra')).toBeGreaterThan(0);
    expect(v('ownedFeature', 'forest')).toBe(owned(state, (t) => t.feature === 'forest'));
    expect(v('ownedResource', 'horses')).toBe(owned(state, (t) => t.resource === 'horses'));
    expect(v('ownedResource', 'horses')).toBeGreaterThan(0);
    expect(v('ownedClimate', 'polar')).toBe(owned(state, (t) => t.climate === 'polar'));
    expect(v('coastalSettlements')).toBe(1);
    expect(v('riverSettlements')).toBe(1);
    expect(v('settlementCount')).toBe(2);
    expect(v('totalPopulation')).toBe(5);
    expect(v('unitsOfClass', 'cavalry')).toBe(2);
    expect(v('unitsTotal')).toBe(3);
    expect(v('battlesWonThisTurn')).toBe(2);
    expect(v('citiesCapturedThisTurn')).toBe(1);
    expect(v('tradeRoutes')).toBe(2);
    // Route destinations: p2's city is named for arab; the city-state is Ugarit (arab), not its namedFor.
    expect(v('tradeRoutesWithCulture', undefined, 'arab')).toBe(2);
    expect(v('tradeRoutesWithCulture', undefined, 'greek')).toBe(0);
    expect(v('suzerainOfCulture', undefined, 'arab')).toBe(1);
    expect(v('suzerainOfCulture', undefined, 'greek')).toBe(0);
    expect(v('wondersBuilt')).toBe(3);
    expect(v('techsResearched')).toBe(2); // current age only
    expect(v('envoysSent')).toBe(4);
    expect(v('faithIncome')).toBe(5);
    expect(v('cultureIncome')).toBe(6);
    expect(v('scienceIncome')).toBe(7);
    expect(v('goldIncome')).toBe(0); // negative income is no signal
    expect(v('exploredPercent')).toBe(25);
    // Every measure in the schema is handled (no undefined fallthrough).
    for (const measure of SignalMeasure.options) expect(typeof v(measure, 'x')).toBe('number');
  });

  it('contributions are w·x per culture, only for weighted cultures', () => {
    const state = build();
    const c2: ContentBundle = {
      ...content,
      signals: [sig('horses', 'ownedResource', { mongol: 2, spanish: 0.5 }, 'horses'), sig('trade', 'tradeRoutesWithCulture', { arab: 3, greek: 3 })],
    };
    const contrib = signalContributions(state, 'p1', c2);
    const horses = owned(state, (t) => t.resource === 'horses');
    expect(contrib.mongol).toEqual({ horses: 2 * horses });
    expect(contrib.spanish).toEqual({ horses: 0.5 * horses });
    expect(contrib.arab).toEqual({ trade: 6 });
    expect(contrib.greek).toEqual({});
  });
});

describe('affinity update', () => {
  const content = testContent(real, { signals: [sig('steppe', 'ownedTerrain', { mongol: 1 }, 'steppe')] });
  const setup = () => {
    const state = makeState(content, { terrain: () => ({ terrain: 'steppe' }) });
    addSettlement(state, 'p1', at(5, 5));
    claim(state, 'p1', at(5, 5), 1); // 7 steppe tiles
    return state;
  };

  it('A ← 0.98·A + scale·Σ w·x, and decays without signals', () => {
    const state = setup();
    const ctx = makeCtx(state, content);
    state.players.p1!.affinity.mongol = 10;
    state.players.p1!.affinity.greek = 10;
    updateAffinity(ctx, 'p1', signalContributions(state, 'p1', content));
    expect(state.players.p1!.affinity.mongol).toBeCloseTo(AFFINITY_DECAY * 10 + AFFINITY_SCALE * 7, 10);
    expect(state.players.p1!.affinity.greek).toBeCloseTo(AFFINITY_DECAY * 10, 10);
  });

  it('affinityGain modifiers scale the gain (per culture and global)', () => {
    const state = setup();
    state.players.p1!.effects.push({
      source: 'test',
      untilTurn: -1,
      modifiers: [
        { scope: 'empire', effect: { kind: 'affinityGain', culture: 'mongol', percent: 50 } },
        { scope: 'empire', effect: { kind: 'affinityGain', percent: 50 } },
      ],
    });
    updateAffinity(makeCtx(state, content), 'p1', signalContributions(state, 'p1', content));
    expect(state.players.p1!.affinity.mongol).toBeCloseTo(AFFINITY_SCALE * 7 * 2, 10);
  });

  it('addAffinity grants directly, with modifiers', () => {
    const state = setup();
    const ctx = makeCtx(state, content);
    addAffinity(ctx, 'p1', 'egyptian', 20);
    expect(state.players.p1!.affinity.egyptian).toBe(20);
    state.players.p1!.effects.push({ source: 't', untilTurn: -1, modifiers: [{ scope: 'empire', effect: { kind: 'affinityGain', culture: 'egyptian', percent: 25 } }] });
    addAffinity(ctx, 'p1', 'egyptian', 20);
    expect(state.players.p1!.affinity.egyptian).toBe(45);
  });

  it('hints fire once at 50 and once at 100, naming the top signal, with no digits', () => {
    const state = setup();
    const ctx = makeCtx(state, content);
    const p = state.players.p1!;
    p.affinity.mongol = 51;
    emergenceTick(ctx, 'p1');
    let hints = ctx.events.filter((e) => e.type === 'cultureHint');
    expect(hints).toHaveLength(1);
    const first = hints[0];
    if (first?.type !== 'cultureHint') throw new Error('no hint');
    expect(first.culture).toBe('mongol');
    expect(first.text).toBe('Steppe peoples speak of your steppe.');
    expect(p.hintsShown.mongol).toBe(50);

    ctx.events.length = 0;
    emergenceTick(ctx, 'p1');
    expect(ctx.events.filter((e) => e.type === 'cultureHint')).toHaveLength(0);

    // At most one hint every HINT_COOLDOWN_TURNS turns.
    p.affinity.mongol = 102;
    emergenceTick(ctx, 'p1');
    expect(ctx.events.filter((e) => e.type === 'cultureHint')).toHaveLength(0);
    state.turn += HINT_COOLDOWN_TURNS;
    p.affinity.mongol = 102;
    emergenceTick(ctx, 'p1');
    hints = ctx.events.filter((e) => e.type === 'cultureHint');
    expect(hints).toHaveLength(1);
    expect(p.hintsShown.mongol).toBe(100);
    ctx.events.length = 0;
    p.affinity.mongol = 300;
    emergenceTick(ctx, 'p1');
    expect(ctx.events.filter((e) => e.type === 'cultureHint')).toHaveLength(0);
  });

  it('a hint fires only for a top-2 culture, and at most one per player per cooldown (fun audit pass 2)', () => {
    expect(HINT_TOP_N).toBe(2);
    const state = setup();
    const ctx = makeCtx(state, content);
    const p = state.players.p1!;
    p.affinity.mongol = 300;
    p.affinity.egyptian = 250;
    p.affinity.greek = 60; // third: past 50 but not on the player's path
    p.hintsShown.mongol = 100;
    p.hintsShown.egyptian = 100;
    emergenceTick(ctx, 'p1');
    expect(ctx.events.filter((e) => e.type === 'cultureHint')).toHaveLength(0);
    expect(p.hintsShown.greek ?? 0).toBe(0);
    // Greek overtakes Egyptian: now on the path, the hint fires.
    p.affinity.greek = 280;
    p.affinity.egyptian = 100;
    emergenceTick(ctx, 'p1');
    const hints = ctx.events.filter((e) => e.type === 'cultureHint');
    expect(hints).toHaveLength(1);
    expect(hints[0]?.type === 'cultureHint' && hints[0].culture).toBe('greek');
    // Two cultures crossing in the same window: only one is told; the other waits.
    ctx.events.length = 0;
    const state2 = setup();
    const ctx2 = makeCtx(state2, content);
    const p2 = state2.players.p1!;
    p2.affinity.mongol = 60;
    p2.affinity.egyptian = 55;
    emergenceTick(ctx2, 'p1');
    expect(ctx2.events.filter((e) => e.type === 'cultureHint')).toHaveLength(1);
    for (let t = 1; t < HINT_COOLDOWN_TURNS; t++) {
      state2.turn++;
      p2.affinity.mongol = 60;
      p2.affinity.egyptian = 55;
      emergenceTick(ctx2, 'p1');
    }
    expect(ctx2.events.filter((e) => e.type === 'cultureHint')).toHaveLength(1);
    state2.turn++;
    p2.affinity.egyptian = 55;
    emergenceTick(ctx2, 'p1');
    expect(ctx2.events.filter((e) => e.type === 'cultureHint')).toHaveLength(2);
  });

  it('hint and reason texts never contain digits (real signals and cultures)', () => {
    for (const c of real.cultures) for (const s of real.signals) expect(`${c.adjective} ${s.hint}`).not.toMatch(/\d/);
  });
});
