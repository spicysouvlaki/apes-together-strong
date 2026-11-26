/**
 * Sim rules from the wave 13 playtest ("more chore than play"): war warnings with a named
 * objective, stand-down and tribute, peace terms, growing war weariness, no small talk at war,
 * capped production overflow, bursts that reach research, and the standings query.
 */
import { describe, expect, it } from 'vitest';
import { warKey, type SimEvent } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { chooseCrisisResponse } from '../src/sim/ages/crisis';
import {
  IDLE_PRODUCTION_TO_GOLD,
  PRODUCTION_CARRY_SHARE,
  STOOD_DOWN_SOURCE,
  WAR_INTENT_GRACE_TURNS,
  WAR_TRIBUTE_INFLUENCE,
  WAR_WARNING_TURNS,
  WAR_WEARINESS_MAX,
  WAR_WEARINESS_PER_WAR,
  WAR_WEARINESS_TURNS_PER_POINT,
} from '../src/sim/constants';
import { declareWar, makePeace } from '../src/sim/diplomacy';
import { hasMet, standings } from '../src/sim/queries';
import { produceInSettlement } from '../src/sim/settlements';
import { MET_SOURCE, isWarWarningText, speak, speakerName } from '../src/sim/voice';
import { lapseThreats, peaceTerms, threatsAgainst, warGoalOf, warIntentOf } from '../src/sim/war-intent';
import { warWeariness } from '../src/sim/yields';
import { addSettlement, at, ctxOf, fixtureContent, fixtureState } from './helpers/fixture';

const content = fixtureContent();
const notices = (events: SimEvent[]) => events.filter((e): e is Extract<SimEvent, { type: 'notice' }> => e.type === 'notice');

/** p1 human with a capital and a border town; p2 an AI with a capital nearby. */
const world = () => {
  const state = fixtureState({ width: 16, height: 10 });
  state.players.p1!.isHuman = true;
  state.players.p2!.isHuman = false;
  addSettlement(state, 'p1', at(1, 1), { name: 'Home' });
  const town = addSettlement(state, 'p1', at(6, 5), { name: 'Borderton', kind: 'town', isCapital: false });
  addSettlement(state, 'p2', at(11, 5), { name: 'Theirs' });
  state.turn = 40;
  return { state, town };
};

describe('war warnings (AI on a human)', () => {
  it('the first declaration is a voiced threat naming a city; the war comes WAR_WARNING_TURNS later', () => {
    const { state, town } = world();
    const ctx = ctxOf(state, content);
    expect(declareWar(ctx, 'p2', 'p1')).toBeNull();
    expect(state.wars[warKey('p1', 'p2')]).toBeUndefined();
    const [n] = notices(ctx.events);
    expect(n?.player).toBe('p1');
    expect(n?.kind).toBe('other');
    expect(n?.settlement).toBe(town.id);
    expect(n?.amount).toBe(WAR_WARNING_TURNS.normal);
    // In the leader's voice (the UI renders "<speaker>: “…”" as a voiced slip), naming the city.
    expect(n?.text.startsWith(`${speakerName(state, 'p2', content)}: “`)).toBe(true);
    expect(n?.text).toContain('Borderton');
    expect(isWarWarningText(n?.text ?? '')).toBe(true);
    expect(threatsAgainst(state, 'p1')).toEqual([{ by: 'p2', target: 'p1', objective: town.id, due: 40 + WAR_WARNING_TURNS.normal }]);
    // Too early: refused, still no war.
    state.turn += 2;
    expect(declareWar(ctxOf(state, content), 'p2', 'p1')).toMatch(/warned them/);
    // Due: the war begins, and the threatened city is its announced goal.
    state.turn = 40 + WAR_WARNING_TURNS.normal;
    expect(declareWar(ctxOf(state, content), 'p2', 'p1')).toBeNull();
    expect(state.wars[warKey('p1', 'p2')]).toBe(state.turn);
    expect(warGoalOf(state, 'p2', 'p1')).toBe(town.id);
    expect(warIntentOf(state, 'p2', 'p1')).toBeNull();
  });

  it('a human declaring war, or an AI on an AI, is immediate', () => {
    const { state } = world();
    expect(declareWar(ctxOf(state, content), 'p1', 'p2')).toBeNull();
    expect(state.wars[warKey('p1', 'p2')]).toBe(40);
    const ai = fixtureState({ players: 2 });
    ai.players.p1!.isHuman = false;
    addSettlement(ai, 'p1', at(1, 1));
    addSettlement(ai, 'p2', at(8, 5));
    expect(declareWar(ctxOf(ai, content), 'p2', 'p1')).toBeNull();
    expect(ai.wars[warKey('p1', 'p2')]).toBeDefined();
  });

  it('the AI can stand down; the human can pay tribute; an ignored threat lapses — each with a line', () => {
    const { state } = world();
    declareWar(ctxOf(state, content), 'p2', 'p1');
    let ctx = ctxOf(state, content);
    expect(makePeace(ctx, 'p2', 'p1')).toBeNull();
    expect(warIntentOf(state, 'p2', 'p1')).toBeNull();
    expect(state.players.p2!.effects.some((e) => e.source === STOOD_DOWN_SOURCE + 'p1')).toBe(true);
    expect(notices(ctx.events)[0]?.text).toContain(speakerName(state, 'p2', content));

    const b = world().state;
    declareWar(ctxOf(b, content), 'p2', 'p1');
    expect(makePeace(ctxOf(b, content), 'p1', 'p2')).toMatch(/influence/);
    b.players.p1!.stock.influence = WAR_TRIBUTE_INFLUENCE + 5;
    ctx = ctxOf(b, content);
    expect(makePeace(ctx, 'p1', 'p2')).toBeNull();
    expect(b.players.p1!.stock.influence).toBe(5);
    expect(warIntentOf(b, 'p2', 'p1')).toBeNull();
    expect(notices(ctx.events)).toHaveLength(1);

    const c = world().state;
    declareWar(ctxOf(c, content), 'p2', 'p1');
    c.turn += WAR_WARNING_TURNS.normal + WAR_INTENT_GRACE_TURNS + 1;
    ctx = ctxOf(c, content);
    lapseThreats(ctx, 'p2');
    expect(warIntentOf(c, 'p2', 'p1')).toBeNull();
    expect(notices(ctx.events)).toHaveLength(1);
  });
});

describe('war stakes', () => {
  it('peace terms: the side behind pays gold to the other', () => {
    const { state } = world();
    declareWar(ctxOf(state, content), 'p1', 'p2');
    state.players.p1!.stats.unitsLost += 4; // p2 killed four of p1's units
    state.players.p1!.stock.gold = 200;
    state.players.p2!.stock.gold = 0;
    state.turn += 10;
    const terms = peaceTerms(state, 'p1', 'p2');
    expect(terms?.payer).toBe('p1');
    expect(terms?.payee).toBe('p2');
    const gold = terms?.gold ?? 0;
    expect(gold).toBeGreaterThan(0);
    state.players.p1!.stock.influence = 100;
    const ctx = ctxOf(state, content);
    expect(makePeace(ctx, 'p1', 'p2')).toBeNull();
    expect(state.players.p1!.stock.gold).toBe(200 - gold);
    expect(state.players.p2!.stock.gold).toBe(gold);
    expect(notices(ctx.events).some((n) => n.player === 'p1' && n.amount === -gold)).toBe(true);
  });

  it('a close war costs nothing at peace', () => {
    const { state } = world();
    declareWar(ctxOf(state, content), 'p1', 'p2');
    state.turn += 10;
    expect(peaceTerms(state, 'p1', 'p2')).toBeNull();
  });

  it('war weariness grows with the war, up to a cap', () => {
    const { state } = world();
    declareWar(ctxOf(state, content), 'p1', 'p2');
    expect(warWeariness(state, 'p1')).toEqual({ p2: WAR_WEARINESS_PER_WAR });
    state.turn += WAR_WEARINESS_TURNS_PER_POINT * 2;
    expect(warWeariness(state, 'p1')).toEqual({ p2: WAR_WEARINESS_PER_WAR + 2 });
    state.turn += 1000;
    expect(warWeariness(state, 'p2')).toEqual({ p1: WAR_WEARINESS_MAX });
  });
});

describe('voice manners', () => {
  it('no friendly small talk while at war or under threat; no remarks from an unmet people', () => {
    const { state } = world();
    let ctx = ctxOf(state, content);
    speak(ctx, 'p2', 'p1', 'figureWanted', { f: 'Someone' });
    expect(notices(ctx.events)).toHaveLength(0); // never met
    state.players.p1!.effects.push({ source: MET_SOURCE + 'p2', untilTurn: Number.MAX_SAFE_INTEGER, modifiers: [] });
    ctx = ctxOf(state, content);
    speak(ctx, 'p2', 'p1', 'figureWanted', { f: 'Someone' });
    expect(notices(ctx.events)).toHaveLength(1);
    state.wars[warKey('p1', 'p2')] = state.turn;
    ctx = ctxOf(state, content);
    speak(ctx, 'p2', 'p1', 'borders');
    speak(ctx, 'p2', 'p1', 'wonderTheirs', { w: 'X', c: 'Theirs' });
    expect(notices(ctx.events)).toHaveLength(0);
    speak(ctx, 'p2', 'p1', 'peace');
    expect(notices(ctx.events)).toHaveLength(1);
  });

  it('standings list only met rivals, with the score breakdown', () => {
    const { state } = world();
    state.players.p2!.legacyPoints = 30;
    expect(standings(state, 'p1', content).map((r) => r.player)).toEqual(['p1']);
    expect(hasMet(state, 'p1', 'p2')).toBe(false);
    state.players.p1!.effects.push({ source: MET_SOURCE + 'p2', untilTurn: Number.MAX_SAFE_INTEGER, modifiers: [] });
    const rows = standings(state, 'p1', content);
    expect(rows.map((r) => r.player)).toEqual(['p2', 'p1']);
    expect(rows[0]?.breakdown).toMatchObject({ legacy: 30, total: 30 });
  });
});

describe('banked production (wave 13 churn)', () => {
  const yields = (production: number) => ({ food: 0, production, gold: 0, science: 0, culture: 0, faith: 0, happiness: 0, influence: 0 });

  it('a big bank pays for queued items this turn, then carries at most a capped share', () => {
    const state = fixtureState();
    const city = addSettlement(state, 'p1', at(4, 4));
    const warrior = content.units.find((u) => u.id === 'warrior')!.cost;
    city.production = { item: 'warrior', progress: warrior * 10 };
    city.queue = ['warrior', 'warrior'];
    const ctx = ctxOf(state, content);
    produceInSettlement(ctx, city, yields(1), []);
    // Three warriors this turn (the item and both queued), nothing left waiting.
    expect(ctx.events.filter((e) => e.type === 'productionCompleted')).toHaveLength(3);
    expect(city.queue).toBeUndefined();
    const left = warrior * 10 + 1 - 3 * warrior;
    const cap = warrior * PRODUCTION_CARRY_SHARE;
    expect(city.production.progress).toBe(cap);
    expect(state.players.p1!.stock.gold).toBeCloseTo((left - cap) * IDLE_PRODUCTION_TO_GOLD, 5);
  });

  it('ordinary overflow carries over unchanged', () => {
    const state = fixtureState();
    const city = addSettlement(state, 'p1', at(4, 4));
    const warrior = content.units.find((u) => u.id === 'warrior')!.cost;
    city.production = { item: 'warrior', progress: warrior - 1 };
    produceInSettlement(ctxOf(state, content), city, yields(3), []);
    expect(city.production.progress).toBe(2);
    expect(state.players.p1!.stock.gold).toBe(0);
  });
});

describe('science and culture rewards reach research', () => {
  it('a crisis response with +culture advances the civic tree', () => {
    const real = loadContent();
    const crisis = real.crises.find((c) => c.stages.some((s) => s.options.some((o) => (o.stock.culture ?? 0) > 0)));
    expect(crisis).toBeDefined();
    if (!crisis) return;
    const stageIdx = crisis.stages.findIndex((s) => s.options.some((o) => (o.stock.culture ?? 0) > 0));
    const option = crisis.stages[stageIdx]!.options.find((o) => (o.stock.culture ?? 0) > 0)!;
    const state = fixtureState();
    state.crisis = { id: crisis.id, stage: stageIdx + 1, awaiting: ['p1'] };
    expect(chooseCrisisResponse(ctxOf(state, real), 'p1', option.id)).toBeNull();
    expect(state.players.p1!.research.civic.progress).toBe(option.stock.culture);
    expect(state.players.p1!.stock.culture).toBe(0);
  });
});
