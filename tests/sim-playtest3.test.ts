/**
 * Sim fixes from the third hands-on playtest (two games by hand, small map, quick speed):
 * war entries that outlived a captured city-state, treasury warnings and honest desertion,
 * contact by sighting and shared landmasses, scouts' later work, walls that stay down under
 * siege with a legible breach, a rotating start-of-turn order, and raider warnings.
 */
import { describe, expect, it } from 'vitest';
import { hexDistance } from '@contracts/hex';
import { RAIDER_PLAYER, warKey, type GameSetup, type SimEvent } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { applyCommand, queries, sim } from '../src/sim';
import { DISBAND_REFUND_SHARE, LOOKOUT_VISION, WALL_BASE_HP, WALL_HEAL_PER_TURN } from '../src/sim/constants';
import { pruneWars } from '../src/sim/diplomacy';
import { tileAt } from '../src/sim/lookup';
import { warnOfRaiders } from '../src/sim/raids';
import { startOfTurnForPlayer, startOfTurnOrder, worldPhase } from '../src/sim/turn';
import { visionRadius } from '../src/sim/units';
import { MET_SOURCE, contactsOf } from '../src/sim/voice';
import { addSettlement, addUnit, at, ctxOf, fixtureContent, fixtureState } from './helpers/fixture';

const content = fixtureContent();

const notices = (events: readonly SimEvent[]): string[] => events.flatMap((e) => (e.type === 'notice' ? [e.text] : []));

describe('wars never outlive their parties (playtest 3: the war with captured Ugarit stayed forever)', () => {
  const withCityState = () => {
    const state = fixtureState({ width: 14, height: 10 });
    addSettlement(state, 'p1', at(2, 2), { name: 'Home' });
    const cs = addSettlement(state, 'cs:cs_one', at(7, 5), { name: 'Ugarit', isCapital: true, population: 3 });
    state.cityStates.cs_one = { id: 'cs_one', settlement: cs.id, envoys: {}, suzerain: null, alive: true };
    state.wars[warKey('p1', 'cs:cs_one')] = 1;
    return { state, cs };
  };

  it('capturing a city-state ends the war with it', () => {
    const { state, cs } = withCityState();
    cs.hp = 0;
    const w = addUnit(state, 'p1', 'warrior', at(6, 5), content);
    const r = applyCommand(state, 'p1', { type: 'attack', unit: w.id, target: cs.at }, content);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.settlements[cs.id]?.owner).toBe('p1');
    expect(r.state.cityStates.cs_one?.alive).toBe(false);
    expect(r.state.wars).toEqual({});
  });

  it('the turn-start sweep drops entries whose city-state or player is gone, and keeps live wars', () => {
    const { state } = withCityState();
    state.cityStates.cs_one!.alive = false;
    state.wars[warKey('p1', 'p2')] = 3;
    state.players.p2!.alive = false;
    state.wars[warKey('p1', 'p3')] = 4; // no such player
    pruneWars(state);
    expect(state.wars).toEqual({});
    const live = withCityState().state;
    live.wars[warKey('p1', 'p2')] = 2;
    pruneWars(live);
    expect(Object.keys(live.wars).sort()).toEqual([warKey('p1', 'cs:cs_one'), warKey('p1', 'p2')].sort());
  });
});

describe('treasury warnings and honest desertion (playtest 3: gold ran dry without a word)', () => {
  const army = (gold: number, warriors: number) => {
    const state = fixtureState({ width: 14, height: 10 });
    const s = addSettlement(state, 'p1', at(4, 4), { name: 'Waset' });
    for (let i = 0; i < warriors; i++) addUnit(state, 'p1', 'warrior', at(5 + (i % 4), 3 + Math.floor(i / 4)), content);
    state.players.p1!.stock.gold = gold;
    return { state, s };
  };

  it('says so when soldiers start to cost more than the towns earn, once', () => {
    const { state } = army(10, 8);
    const ctx = ctxOf(state, content);
    startOfTurnForPlayer(ctx, 'p1');
    expect(state.players.p1!.income.gold).toBeLessThan(0);
    const said = notices(ctx.events);
    expect(said.some((t) => /^Your treasury is shrinking: 8 soldiers cost more than your towns earn\.$/.test(t))).toBe(true);
    const again = ctxOf(state, content);
    state.turn++;
    startOfTurnForPlayer(again, 'p1');
    expect(notices(again.events).some((t) => /shrinking/.test(t))).toBe(false);
  });

  it('warns when the treasury will be empty within three turns', () => {
    const { state } = army(40, 8);
    const ctx = ctxOf(state, content);
    startOfTurnForPlayer(ctx, 'p1');
    const income = state.players.p1!.income.gold;
    expect(income).toBeLessThan(0);
    let warned = notices(ctx.events).some((t) => /treasury will be empty/.test(t));
    for (let i = 0; i < 12 && !warned; i++) {
      state.turn++;
      const c = ctxOf(state, content);
      startOfTurnForPlayer(c, 'p1');
      if (notices(c.events).some((t) => /treasury will be empty in (one turn|\d turns); then unpaid soldiers start to desert\./.test(t))) {
        warned = true;
        expect(state.players.p1!.stock.gold + 3 * state.players.p1!.income.gold).toBeLessThanOrEqual(0);
      }
    }
    expect(warned).toBe(true);
  });

  it('a deserter is named, and a famous person’s unit never deserts', () => {
    const { state } = army(0, 6);
    addUnit(state, 'p1', 'general', at(4, 4), content, { figure: 'some_general' });
    const ctx = ctxOf(state, content);
    const before = Object.keys(state.units).length;
    startOfTurnForPlayer(ctx, 'p1');
    expect(Object.keys(state.units).length).toBe(before - 1);
    expect(Object.values(state.units).some((u) => u.figure === 'some_general')).toBe(true);
    expect(notices(ctx.events)).toContain('Warrior deserted: the treasury is empty and the soldiers went unpaid. Disband units or raise more gold.');
  });
});

describe('first contact (playtest 3: no rival met in 43 turns on the small map)', () => {
  it('seeing a rival’s unit is contact: one greeting from the AI, remembered by both sides', () => {
    const state = fixtureState({ width: 20, height: 10 });
    state.players.p2!.isHuman = false;
    addSettlement(state, 'p1', at(2, 5), { name: 'Home' });
    addSettlement(state, 'p2', at(17, 5), { name: 'Far' });
    const scout = addUnit(state, 'p1', 'scout', at(7, 5), content);
    addUnit(state, 'p2', 'scout', at(12, 5), content);
    expect(contactsOf(state, 'p1').p2).toBeUndefined();
    const r = applyCommand(state, 'p1', { type: 'moveUnit', unit: scout.id, to: at(9, 5) }, content);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const greetings = notices(r.events).filter((t) => t.includes('“'));
    expect(greetings).toHaveLength(1);
    expect(r.state.players.p1!.effects.some((e) => e.source === MET_SOURCE + 'p2' && e.modifiers.length === 0)).toBe(true);
    expect(contactsOf(r.state, 'p2').p1).toBe(true);
    // No second greeting on the next sighting.
    const r2 = applyCommand(r.state, 'p1', { type: 'moveUnit', unit: scout.id, to: at(10, 5) }, content);
    expect(r2.ok && notices(r2.events).filter((t) => t.includes('“'))).toEqual([]);
  });

  it('a human start never sits alone on its landmass when another start shares one', () => {
    const real = loadContent();
    for (let seed = 1; seed <= 6; seed++) {
      const setup: GameSetup = {
        seed,
        mapSize: 'small',
        speed: 'quick',
        players: ['p1', 'p2', 'p3'].map((id, i) => ({
          id,
          isHuman: i === 0,
          leader: real.leaders[i]?.id ?? '',
          dream: real.dreams[i]?.id ?? '',
          colors: { primary: '#000000', secondary: '#ffffff' },
          skinTone: 0,
        })),
      };
      const { state } = sim.createGame(setup, real);
      const land = (id: string): number => {
        const u = Object.values(state.units).find((x) => x.owner === id);
        return u ? (tileAt(state.map, u.at)?.continent ?? -1) : -1;
      };
      expect(['p2', 'p3'].some((id) => land(id) === land('p1')), `seed ${seed}`).toBe(true);
    }
  });
});

describe('scouts after the map is charted (playtest 3: idle by turn 27)', () => {
  it('a scout may fortify as a lookout and sees farther; other civilians cannot fortify', () => {
    const state = fixtureState();
    addSettlement(state, 'p1', at(2, 2));
    const scout = addUnit(state, 'p1', 'scout', at(5, 5), content);
    const settler = addUnit(state, 'p1', 'settler', at(6, 6), content);
    const base = visionRadius(state, scout, content);
    const r = applyCommand(state, 'p1', { type: 'fortify', unit: scout.id }, content);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = r.state.units[scout.id];
    expect(after && visionRadius(r.state, after, content)).toBe(base + LOOKOUT_VISION);
    const bad = applyCommand(state, 'p1', { type: 'fortify', unit: settler.id }, content);
    expect(bad.ok).toBe(false);
  });

  it('disbanding inside your borders returns a share of the cost as gold, with a notice; outside, nothing', () => {
    const state = fixtureState();
    const home = addSettlement(state, 'p1', at(4, 4));
    const inside = addUnit(state, 'p1', 'warrior', home.at, content);
    const outside = addUnit(state, 'p1', 'scout', at(10, 8), content);
    const r = applyCommand(state, 'p1', { type: 'disbandUnit', unit: inside.id }, content);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const refund = Math.floor(30 * DISBAND_REFUND_SHARE);
    expect(r.state.players.p1!.stock.gold).toBe(refund);
    expect(notices(r.events)).toContain(`Warrior disbanded; ${refund} gold returned to the treasury.`);
    const r2 = applyCommand(r.state, 'p1', { type: 'disbandUnit', unit: outside.id }, content);
    expect(r2.ok && r2.state.players.p1!.stock.gold).toBe(refund);
  });
});

describe('sieges (playtest 3: walls healed between assaults; captures took 3+ turns)', () => {
  const siege = (enemyAt: { col: number; row: number }) => {
    const state = fixtureState({ width: 14, height: 10 });
    const s = addSettlement(state, 'p2', at(7, 5), { population: 3 });
    s.hp = 40;
    state.wars[warKey('p1', 'p2')] = 1;
    addUnit(state, 'p1', 'slinger', at(enemyAt.col, enemyAt.row), content);
    return { state, s };
  };

  it('walls do not heal while an enemy unit stands within two tiles (archers bombard from range)', () => {
    const { state, s } = siege({ col: 9, row: 5 });
    expect(hexDistance(s.at, at(9, 5))).toBe(2);
    startOfTurnForPlayer(ctxOf(state, content), 'p2');
    expect(s.hp).toBe(40);
  });

  it('they heal once the besiegers are gone', () => {
    const { state, s } = siege({ col: 12, row: 5 });
    startOfTurnForPlayer(ctxOf(state, content), 'p2');
    expect(s.hp).toBe(40 + WALL_HEAL_PER_TURN);
  });

  it('city-state walls follow the same rule in the world phase', () => {
    const state = fixtureState({ width: 14, height: 10 });
    const cs = addSettlement(state, 'cs:cs_one', at(7, 5), { population: 3 });
    state.cityStates.cs_one = { id: 'cs_one', settlement: cs.id, envoys: {}, suzerain: null, alive: true };
    cs.hp = 30;
    addSettlement(state, 'p1', at(1, 1));
    state.wars[warKey('p1', 'cs:cs_one')] = 1;
    addUnit(state, 'p1', 'slinger', at(9, 5), content);
    worldPhase(ctxOf(state, content));
    expect(cs.hp).toBe(30);
  });

  it('the preview tells the walls left and how many such attacks breach them', () => {
    const state = fixtureState({ width: 14, height: 10 });
    const s = addSettlement(state, 'p2', at(7, 5), { population: 3 });
    state.wars[warKey('p1', 'p2')] = 1;
    const w = addUnit(state, 'p1', 'warrior', at(6, 5), content);
    const pv = queries.combatPreview(state, w.id, s.at, content);
    expect(pv?.kind).toBe('walls');
    if (!pv) return;
    const left = pv.factors.find((f) => f.label === 'Wall strength left after this attack');
    const attacks = pv.factors.find((f) => f.label === 'Attacks like this to breach the walls');
    expect(left?.value).toBe(WALL_BASE_HP - pv.damageToDefender.expected);
    expect(attacks?.value).toBe(Math.ceil(WALL_BASE_HP / pv.damageToDefender.expected));
  });

  it('a ram hits walls more than twice as hard as a warrior (real content)', () => {
    const real = loadContent();
    const state = fixtureState({ width: 14, height: 10 });
    const s = addSettlement(state, 'p2', at(7, 5), { population: 3 });
    state.wars[warKey('p1', 'p2')] = 1;
    const w = addUnit(state, 'p1', 'warrior_band', at(6, 5), real);
    const ram = addUnit(state, 'p1', 'ram', at(8, 5), real);
    const pw = queries.combatPreview(state, w.id, s.at, real);
    const pr = queries.combatPreview(state, ram.id, s.at, real);
    expect(pw && pr).toBeTruthy();
    expect(pr!.damageToDefender.expected).toBeGreaterThan(2 * pw!.damageToDefender.expected);
  });
});

describe('turn order (playtest 3: the first seat always invited figures first)', () => {
  it('the start-of-turn order rotates every turn', () => {
    const state = fixtureState({ players: 3 });
    const seen = new Set<string>();
    for (let t = 1; t <= 3; t++) {
      state.turn = t;
      const order = startOfTurnOrder(state);
      expect([...order].sort()).toEqual(['p1', 'p2', 'p3']);
      seen.add(order[0] ?? '');
    }
    expect(seen.size).toBe(3);
  });
});

describe('raider warnings (playtest 3: both towns pillaged without warning)', () => {
  it('an unguarded settlement with raiders two days off gets one plain warning; a guarded one none', () => {
    const state = fixtureState({ width: 16, height: 10 });
    const open = addSettlement(state, 'p1', at(4, 5), { name: 'Waset' });
    const guarded = addSettlement(state, 'p1', at(12, 5), { name: 'Iunu', isCapital: false });
    addUnit(state, 'p1', 'warrior', guarded.at, content);
    addUnit(state, RAIDER_PLAYER, 'warrior', at(8, 5), content);
    expect(hexDistance(open.at, at(8, 5))).toBeLessThanOrEqual(4);
    const ctx = ctxOf(state, content);
    warnOfRaiders(ctx);
    expect(notices(ctx.events)).toEqual(['Raiders are two days from Waset, and no one guards it.']);
  });
});

describe('a player who follows the guide weathers the collapse (playtest 3)', () => {
  it('one fortified warrior per settlement: no unit lost, nothing pillaged, over a whole crisis', () => {
    const real = loadContent();
    for (let seed = 1; seed <= 6; seed++) {
      const state = fixtureState({ width: 30, height: 22, players: 1, seed });
      state.players.p1!.leader = real.leaders[0]?.id ?? '';
      state.players.p1!.dream = real.dreams[0]?.id ?? '';
      const a = addSettlement(state, 'p1', at(10, 10), { name: 'Waset', population: 5 });
      const b = addSettlement(state, 'p1', at(16, 11), { name: 'Iunu', kind: 'town', isCapital: false, population: 3 });
      const guards = [addUnit(state, 'p1', 'warrior_band', a.at, real, { fortified: true }), addUnit(state, 'p1', 'warrior_band', b.at, real, { fortified: true })];
      state.crisis = { id: 'collapse', stage: 1, awaiting: [] };
      state.ageProgress = 75;
      state.turn = 40;
      const ctx = ctxOf(state, real);
      for (let t = 0; t < 14; t++) {
        worldPhase(ctx);
        state.turn++;
        startOfTurnForPlayer(ctx, 'p1');
      }
      expect(Object.values(state.units).some((u) => u.owner === RAIDER_PLAYER), `seed ${seed}: raiders came`).toBe(true);
      for (const g of guards) expect(state.units[g.id], `seed ${seed}`).toBeDefined();
      expect(notices(ctx.events).filter((t) => /pillaged/.test(t)), `seed ${seed}`).toEqual([]);
    }
  });
});
