/**
 * Sim rules from the wave 11 full-game playtest (105 turns, human style): production queue,
 * capped pillage, raiders scattering at the age's end, civilian captures named in the combat
 * event, wonders carried over an age transition, notice kinds, civ-name and city-name
 * duplicates, walls sheltering the garrison, and an AI's grace period after a warning.
 */
import { describe, expect, it } from 'vitest';
import { RAIDER_PLAYER, warKey, type GameState, type SimEvent } from '@contracts/sim-api';
import { applyCommand } from '../src/sim';
import { nameKey } from '../src/sim/ages/naming';
import { beginTransition } from '../src/sim/ages/transition';
import { attack, defenseBreakdown } from '../src/sim/combat';
import { PRODUCTION_QUEUE_MAX, RAIDER_PILLAGE_GOLD_CAP, WAR_WARNING_TURNS } from '../src/sim/constants';
import { disperseRaiders, pillage, pillageGold, pillageTarget, warnOfRaiders } from '../src/sim/raids';
import {
  buyItem,
  canProduce,
  carryWonders,
  completeItem,
  createSettlement,
  pickName,
  placeKey,
  produceInSettlement,
  setProductionQueue,
} from '../src/sim/settlements';
import { treasuryNotices } from '../src/sim/turn';
import { speak, warHeldBack } from '../src/sim/voice';
import { addSettlement, addUnit, at, ctxOf, fixtureContent, fixtureState } from './helpers/fixture';

const content = fixtureContent();
const notices = (events: SimEvent[]) => events.filter((e): e is Extract<SimEvent, { type: 'notice' }> => e.type === 'notice');
const yields = (production: number) => ({ food: 0, production, gold: 0, science: 0, culture: 0, faith: 0, happiness: 0, influence: 0 });

describe('production queue (setProductionQueue)', () => {
  const world = () => {
    const state = fixtureState();
    const city = addSettlement(state, 'p1', at(4, 4), { name: 'Ur' });
    return { state, city, ctx: ctxOf(state, content) };
  };

  it('accepts up to the max of legal or later-legal items and rejects the rest', () => {
    const { state, city, ctx } = world();
    // granary waits on Pottery (not known yet): plausibly legal later, so it may be queued.
    expect(canProduce(state, city, 'granary', content)).toBe(false);
    expect(setProductionQueue(ctx, 'p1', city.id, ['warrior', 'granary', 'shrine'])).toBeNull();
    expect(city.queue).toEqual(['warrior', 'granary', 'shrine']);
    expect(PRODUCTION_QUEUE_MAX).toBe(3);
    expect(setProductionQueue(ctx, 'p1', city.id, ['warrior', 'warrior', 'warrior', 'warrior'])).toMatch(/at most 3/);
    // Units may repeat; one-off items may not, nor match the current item.
    expect(setProductionQueue(ctx, 'p1', city.id, ['warrior', 'warrior'])).toBeNull();
    expect(setProductionQueue(ctx, 'p1', city.id, ['shrine', 'shrine'])).toMatch(/already planned/);
    city.production.item = 'walls';
    expect(setProductionQueue(ctx, 'p1', city.id, ['walls'])).toMatch(/already planned/);
    city.buildings.push('shrine');
    expect(setProductionQueue(ctx, 'p1', city.id, ['shrine'])).toMatch(/already has/);
    // Not coastal: a harbor can never come here; unknown ids and figure units are refused.
    expect(setProductionQueue(ctx, 'p1', city.id, ['harbor'])).toMatch(/cannot be built/);
    expect(setProductionQueue(ctx, 'p1', city.id, ['nope'])).toMatch(/not something/);
    expect(setProductionQueue(ctx, 'p1', city.id, ['general'])).toMatch(/cannot be built/);
    expect(setProductionQueue(ctx, 'p2', city.id, ['warrior'])).toMatch(/not yours/);
    city.kind = 'town';
    expect(setProductionQueue(ctx, 'p1', city.id, ['warrior'])).toMatch(/Towns/);
    city.kind = 'city';
    // [] clears it (the field is absent again, like an old save).
    expect(setProductionQueue(ctx, 'p1', city.id, [])).toBeNull();
    expect(city.queue).toBeUndefined();
  });

  it('is a command: well-formed through applyCommand, input never mutated', () => {
    const { state, city } = world();
    const before = JSON.stringify(state);
    const r = applyCommand(state, 'p1', { type: 'setProductionQueue', settlement: city.id, items: ['warrior'] }, content);
    expect(r.ok && r.state.settlements[city.id]?.queue).toEqual(['warrior']);
    expect(JSON.stringify(state)).toBe(before);
    const bad = applyCommand(state, 'p1', { type: 'setProductionQueue', settlement: city.id, items: 'warrior' } as never, content);
    expect(bad.ok).toBe(false);
  });

  it('starts the next legal item when the current one completes, skipping illegal ones with a notice', () => {
    const { city, ctx } = world();
    city.production = { item: 'shrine', progress: 25 };
    city.queue = ['granary', 'walls'];
    produceInSettlement(ctx, city, yields(10), []);
    expect(city.buildings).toContain('shrine');
    // Pottery is still unknown: the granary is skipped (and the owner told), walls start.
    expect(city.production.item).toBe('walls');
    expect(city.production.progress).toBe(5); // progress carries over as before
    expect(city.queue).toBeUndefined();
    const skipped = notices(ctx.events).filter((e) => e.kind === 'queueSkipped');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ player: 'p1', settlement: city.id });
    expect(skipped[0]?.text).toMatch(/Granary/);
  });

  it('an idle city takes its queue at the start of its turn; buying the current item starts the next', () => {
    const { state, city, ctx } = world();
    city.queue = ['warrior', 'shrine'];
    produceInSettlement(ctx, city, yields(5), []);
    expect(city.production).toEqual({ item: 'warrior', progress: 5 });
    state.players.p1!.stock.gold = 500;
    expect(buyItem(ctx, 'p1', city.id, 'warrior')).toBeNull();
    expect(city.production.item).toBe('shrine');
    // Buying a queued building drops it from the queue quietly.
    city.queue = ['walls'];
    expect(buyItem(ctx, 'p1', city.id, 'walls')).toBeNull();
    expect(city.queue).toBeUndefined();
  });

  it('old saves without `queue` behave exactly as before', () => {
    const { state, city, ctx } = world();
    delete city.queue;
    city.production = { item: 'shrine', progress: 29 };
    produceInSettlement(ctx, city, yields(2), []);
    expect(city.production.item).toBeNull();
    expect(city.queue).toBeUndefined();
    expect(state.settlements[city.id]?.buildings).toContain('shrine');
  });

  it('a captured city loses its old owner’s queue', () => {
    const { state, city } = world();
    city.queue = ['warrior'];
    city.hp = 0;
    state.wars[warKey('p1', 'p2')] = 1;
    state.currentPlayer = 'p2';
    const u = addUnit(state, 'p2', 'warrior', at(5, 4), content);
    const r = applyCommand(state, 'p2', { type: 'attack', unit: u.id, target: city.at }, content);
    expect(r.ok && r.state.settlements[city.id]?.owner).toBe('p2');
    expect(r.ok && r.state.settlements[city.id]?.queue).toBeUndefined();
  });
});

describe('pillage takes a capped share (wave 11: a raid emptied the treasury)', () => {
  const world = (gold: number) => {
    const state = fixtureState({ width: 14, height: 10 });
    const town = addSettlement(state, 'p1', at(5, 5), { name: 'Ur', kind: 'town', isCapital: false, population: 3 });
    state.players.p1!.stock.gold = gold;
    return { state, town, ctx: ctxOf(state, content) };
  };

  it('takes min(share, cap) of the treasury and says so with kind, settlement and amount', () => {
    expect(pillageGold(51.7)).toBe(12);
    expect(pillageGold(400)).toBe(RAIDER_PILLAGE_GOLD_CAP);
    expect(pillageGold(0)).toBe(0);
    const { state, town, ctx } = world(51.7);
    pillage(ctx, addUnit(state, RAIDER_PLAYER, 'warrior', at(6, 5), content), town);
    expect(state.players.p1!.stock.gold).toBeCloseTo(39.7, 5);
    const n = notices(ctx.events).find((e) => e.kind === 'pillaged');
    expect(n).toMatchObject({ player: 'p1', settlement: town.id, amount: 12 });
    expect(n?.text).not.toMatch(/\d/);
  });

  it('a settlement is pillaged at most once per turn, however many raiders arrive', () => {
    const { state, town, ctx } = world(51.7);
    const r1 = addUnit(state, RAIDER_PLAYER, 'warrior', at(6, 5), content);
    const r2 = addUnit(state, RAIDER_PLAYER, 'warrior', at(4, 5), content);
    const r3 = addUnit(state, RAIDER_PLAYER, 'warrior', at(5, 4), content);
    pillage(ctx, r1, town);
    expect(pillageTarget(state, r2)).toBeNull(); // nothing left to take this turn
    pillage(ctx, r3, town); // e.g. through broken walls: they scatter empty-handed
    expect(state.units[r3.id]).toBeUndefined();
    expect(state.players.p1!.stock.gold).toBeCloseTo(39.7, 5);
    expect(notices(ctx.events).filter((e) => e.kind === 'pillaged')).toHaveLength(1);
    state.turn++;
    expect(pillageTarget(state, r2)?.id).toBe(town.id);
  });

  it('raider warnings carry kind and settlement', () => {
    const { state, town, ctx } = world(10);
    addUnit(state, RAIDER_PLAYER, 'warrior', at(8, 5), content);
    warnOfRaiders(ctx);
    expect(notices(ctx.events)).toEqual([expect.objectContaining({ kind: 'raiderWarning', settlement: town.id, player: 'p1' })]);
  });
});

describe('the age’s end (GDD §5 transition)', () => {
  it('raiders scatter when the age ends, and only then', () => {
    const state = fixtureState({ width: 14, height: 10 });
    addSettlement(state, 'p1', at(2, 2));
    addSettlement(state, 'p2', at(10, 7));
    const ctx = ctxOf(state, content);
    expect(disperseRaiders(ctx)).toBe(0);
    expect(ctx.events).toHaveLength(0); // nothing to say without raiders
    addUnit(state, RAIDER_PLAYER, 'warrior', at(6, 5), content);
    addUnit(state, RAIDER_PLAYER, 'warrior', at(7, 5), content);
    beginTransition(ctx);
    expect(state.phase).toBe('transition');
    expect(Object.values(state.units).some((u) => u.owner === RAIDER_PLAYER)).toBe(false);
    expect(notices(ctx.events).some((e) => e.player === null && /raider bands scatter/.test(e.text))).toBe(true);
  });

  it('a wonder of the ending age with work in it may be finished in the next age (wonderCarried)', () => {
    const state = fixtureState();
    const a = addSettlement(state, 'p1', at(3, 3), { name: 'Ur' });
    const b = addSettlement(state, 'p1', at(8, 6), { name: 'Uruk', isCapital: false });
    a.production = { item: 'pyramid', progress: 40 };
    b.production = { item: 'pyramid', progress: 0 }; // not begun: dropped silently
    const ctx = ctxOf(state, content);
    carryWonders(ctx, 'ancient');
    state.age = 'classical';
    expect(notices(ctx.events)).toEqual([expect.objectContaining({ kind: 'wonderCarried', settlement: a.id, amount: 40, player: 'p1' })]);
    expect(b.production.item).toBeNull();
    expect(canProduce(state, a, 'pyramid', content)).toBe(true);
    expect(canProduce(state, b, 'pyramid', content)).toBe(false); // only where it was begun
    produceInSettlement(ctx, a, yields(60), []);
    expect(state.wonders.pyramid?.settlement).toBe(a.id);
  });

  it('beginTransition carries the wonder past the sweep of age-long effects', () => {
    const state = fixtureState();
    addSettlement(state, 'p2', at(9, 7));
    const a = addSettlement(state, 'p1', at(3, 3), { name: 'Ur' });
    a.production = { item: 'pyramid', progress: 40 };
    beginTransition(ctxOf(state, content));
    state.age = 'classical';
    expect(canProduce(state, a, 'pyramid', content)).toBe(true);
  });

  it('a wonder of an older age is lost, its work kept for the next item (wonderLost)', () => {
    const state = fixtureState();
    const a = addSettlement(state, 'p1', at(3, 3), { name: 'Ur' });
    a.production = { item: 'pyramid', progress: 40 };
    const ctx = ctxOf(state, content);
    carryWonders(ctx, 'classical'); // the pyramid is ancient: two ages back
    expect(a.production).toEqual({ item: null, progress: 40 });
    expect(notices(ctx.events)).toEqual([expect.objectContaining({ kind: 'wonderLost', settlement: a.id, amount: 40 })]);
  });

  it('a lost wonder race says wonderLost with the banked amount, and the loser moves to its queue', () => {
    const state = fixtureState();
    const mine = addSettlement(state, 'p1', at(3, 3), { name: 'Ur' });
    const theirs = addSettlement(state, 'p2', at(9, 7), { name: 'Kish' });
    mine.production = { item: 'pyramid', progress: 30 };
    mine.queue = ['shrine'];
    const ctx = ctxOf(state, content);
    completeItem(ctx, theirs, 'pyramid');
    expect(notices(ctx.events).find((e) => e.kind === 'wonderLost')).toMatchObject({ player: 'p1', settlement: mine.id, amount: 30 });
    expect(mine.production).toEqual({ item: 'shrine', progress: 30 });
  });
});

describe('notice kinds and combat events', () => {
  it('treasury warnings are kind treasury', () => {
    const state = fixtureState();
    const ctx = ctxOf(state, content);
    treasuryNotices(ctx, 'p1', { stock: 20, income: 1 }, { stock: 20, income: -10 });
    const ns = notices(ctx.events);
    expect(ns.length).toBeGreaterThan(0);
    for (const n of ns) expect(n.kind).toBe('treasury');
  });

  it('a civilian taken without a fight names its unit def (not a wall hit)', () => {
    const state = fixtureState();
    state.wars[warKey('p1', 'p2')] = 1;
    const u = addUnit(state, 'p1', 'warrior', at(4, 4), content);
    addUnit(state, 'p2', 'settler', at(5, 4), content);
    const ctx = ctxOf(state, content);
    expect(attack(ctx, 'p1', u.id, at(5, 4))).toBeNull();
    const e = ctx.events.find((x) => x.type === 'combat');
    expect(e).toMatchObject({ defender: null, capturedUnitDef: 'settler', defenderDied: true });
  });

  it('a wall hit carries no capturedUnitDef', () => {
    const state = fixtureState();
    state.wars[warKey('p1', 'p2')] = 1;
    const s = addSettlement(state, 'p2', at(5, 4));
    const u = addUnit(state, 'p1', 'warrior', at(4, 4), content);
    const ctx = ctxOf(state, content);
    expect(attack(ctx, 'p1', u.id, s.at)).toBeNull();
    const e = ctx.events.find((x) => x.type === 'combat');
    expect(e && 'capturedUnitDef' in e).toBe(false);
  });
});

describe('names', () => {
  it('civ-name suggestions differ by more than an article or case', () => {
    expect(nameKey('the Iberian Tiānxià')).toBe(nameKey('Iberian Tiānxià'));
    expect(nameKey('The Iberian Pax')).toBe(nameKey('iberian pax'));
    expect(nameKey('the Iberian Pax')).not.toBe(nameKey('the Sinic Pax'));
  });

  it('a player city never takes a city-state’s name in another spelling', () => {
    expect(placeKey('Spártē')).toBe(placeKey('Sparta'));
    expect(placeKey('Massalía')).toBe(placeKey('Massalia'));
    expect(placeKey('B1')).not.toBe(placeKey('B2'));
    const c = fixtureContent();
    const alpha = c.cultures[0];
    if (!alpha) throw new Error('fixture');
    alpha.cityNames = ['Spártē', 'Árgos'];
    const state: GameState = fixtureState();
    createSettlement(state, 'cs:sparta', at(8, 6), { name: 'Sparta', namedFor: 'alpha', kind: 'city', isCapital: true, population: 3 });
    expect(pickName(state, 'alpha', c)).toBe('Árgos');
  });
});

describe('war pressure counterplay', () => {
  it('built walls also shelter the garrison', () => {
    const state = fixtureState();
    const s = addSettlement(state, 'p1', at(4, 4));
    const g = addUnit(state, 'p1', 'warrior', s.at, content);
    const bare = defenseBreakdown(state, g, 'infantry', content).total;
    s.buildings.push('walls');
    s.maxHp += 50;
    s.hp += 50;
    const walled = defenseBreakdown(state, g, 'infantry', content);
    expect(walled.total).toBe(bare + 5);
    expect(walled.factors).toContainEqual({ label: 'Wall buildings', value: 5 });
    s.hp = 0; // broken walls shelter no one
    expect(defenseBreakdown(state, g, 'infantry', content).total).toBeLessThan(bare);
  });

  it('an AI that warns a human (contact, borders) holds off war for the difficulty’s grace period', () => {
    const state = fixtureState();
    state.players.p1!.isHuman = true;
    addSettlement(state, 'p1', at(2, 2));
    addSettlement(state, 'p2', at(9, 7));
    state.turn = 30;
    speak(ctxOf(state, content), 'p2', 'p1', 'borders');
    expect(warHeldBack(state, 'p2', 'p1')).toBe(true);
    state.turn = 30 + WAR_WARNING_TURNS.normal;
    expect(warHeldBack(state, 'p2', 'p1')).toBe(true);
    state.turn++;
    expect(warHeldBack(state, 'p2', 'p1')).toBe(false);
    // Easy rivals wait longer than hard ones.
    expect(WAR_WARNING_TURNS.easy).toBeGreaterThan(WAR_WARNING_TURNS.normal);
    expect(WAR_WARNING_TURNS.normal).toBeGreaterThanOrEqual(5);
    expect(WAR_WARNING_TURNS.hard).toBeLessThan(WAR_WARNING_TURNS.normal);
  });
});
