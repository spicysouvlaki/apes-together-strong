/** Figure states and actions, cabinet, conquest, retirement, culture weight (GDD §3, §6). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentBundle, Figure } from '@contracts/content-schemas';
import type { FigureLocation, GameState } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import {
  ancestorYields,
  cabinetSeats,
  cultureWeights,
  emergenceTick,
  figureActions,
  handleFigureCommand,
  onAgeStarted,
  onFigureUnitDefeated,
  onPlayerEliminated,
  onSettlementCaptured,
  retireFigures,
  syncCabinet,
} from '../src/emergence';
import * as K from '../src/emergence/constants';
import { addSettlement, addUnit, at, makeCtx, makeState, resetFakes, testContent, testFigure } from './helpers/emergence';

vi.mock('../src/sim/units', () => import('./helpers/emergence'));
vi.mock('../src/sim/stats', () => import('./helpers/emergence'));
vi.mock('../src/sim/ages', () => import('./helpers/emergence'));

const real = loadContent();
const activators: Figure[] = [
  testFigure('act_production', 'greek', 'builder', { uses: ['activate'], activate: { effect: 'production_burst', amount: 40 } }),
  testFigure('act_culture', 'greek', 'thinker', { uses: ['activate'], activate: { effect: 'culture_burst', amount: 11 } }),
  testFigure('act_gold', 'greek', 'statesman', { uses: ['activate'], activate: { effect: 'gold_burst', amount: 12 } }),
  testFigure('act_faith', 'greek', 'spiritual', { uses: ['activate'], activate: { effect: 'faith_burst', amount: 13 } }),
  testFigure('act_influence', 'greek', 'statesman', { uses: ['activate'], activate: { effect: 'influence_burst', amount: 14 } }),
  testFigure('act_unit', 'mongol', 'general', { uses: ['activate'], activate: { effect: 'free_unit', amount: 2 } }),
  testFigure('act_heal', 'mongol', 'spiritual', { uses: ['activate'], activate: { effect: 'heal_units', amount: 30 } }),
  testFigure('act_grow', 'egyptian', 'builder', { uses: ['activate'], activate: { effect: 'grow_city' } }),
];
const base = testContent(real);
const content: ContentBundle = { ...base, figures: [...base.figures, ...activators] };

const world = (): GameState => {
  const state = makeState(content);
  addSettlement(state, 'p1', at(3, 3), { id: 'cap1' });
  addSettlement(state, 'p1', at(8, 3), { id: 'city1' });
  addSettlement(state, 'p1', at(8, 8), { id: 'town1', kind: 'town' });
  addSettlement(state, 'p2', at(14, 14), { id: 'cap2' });
  state.players.p1!.government = 'chiefdom'; // elder, warleader
  state.players.p2!.government = 'despotism';
  syncCabinet(makeCtx(state, content), 'p1');
  syncCabinet(makeCtx(state, content), 'p2');
  return state;
};

const give = (state: GameState, id: string, owner = 'p1', location: FigureLocation = { state: 'based', settlement: 'cap1' }): void => {
  state.figures[id] = { id, owner, recruitedTurn: state.turn, recruitedAge: state.age, reason: 'drawn by test', activated: false, location };
  if (location.state === 'seated') state.players[owner]!.cabinet[location.slot] = id;
};

const cmd = (state: GameState, player: string, command: Parameters<typeof handleFigureCommand>[2]) => {
  const ctx = makeCtx(state, content);
  return { err: handleFigureCommand(ctx, player, command), ctx };
};

beforeEach(resetFakes);

describe('cabinet', () => {
  it('syncCabinet builds slot keys from the government plus cabinetSlot modifiers', () => {
    const state = world();
    expect(Object.keys(state.players.p1!.cabinet)).toEqual(['elder#0', 'warleader#0']);
    expect(Object.keys(state.players.p2!.cabinet)).toEqual(['warleader#0', 'warleader#1']);
    state.players.p2!.effects.push({ source: 't', untilTurn: -1, modifiers: [{ scope: 'empire', effect: { kind: 'cabinetSlot', slot: 'warleader' } }] });
    syncCabinet(makeCtx(state, content), 'p2');
    expect(cabinetSeats(state, 'p2', content).map((s) => s.key)).toEqual(['warleader#0', 'warleader#1', 'warleader#2']);
  });

  it('syncCabinet unseats figures whose seat vanished, basing them in the capital', () => {
    const state = world();
    give(state, 'eg_general', 'p1', { state: 'seated', slot: 'warleader#0' });
    state.players.p1!.government = 'theocratic_council';
    syncCabinet(makeCtx(state, content), 'p1');
    expect(state.players.p1!.cabinet).toEqual({ 'high_priest#0': null, 'elder#0': null });
    expect(state.figures.eg_general!.location).toEqual({ state: 'based', settlement: 'cap1' });
  });

  it('seats by the slot `accepts` rule; elder takes any kind', () => {
    const state = world();
    give(state, 'eg_general');
    give(state, 'gr_statesman');
    expect(cmd(state, 'p1', { type: 'seatFigure', figure: 'gr_statesman', slot: 'warleader#0' }).err).toMatch(/suit/);
    expect(cmd(state, 'p1', { type: 'seatFigure', figure: 'gr_statesman', slot: 'elder#0' }).err).toBeNull();
    expect(cmd(state, 'p1', { type: 'seatFigure', figure: 'eg_general', slot: 'warleader#0' }).err).toBeNull();
    expect(state.players.p1!.cabinet).toEqual({ 'elder#0': 'gr_statesman', 'warleader#0': 'eg_general' });
    expect(state.figures.eg_general!.location).toEqual({ state: 'seated', slot: 'warleader#0' });
    expect(cmd(state, 'p1', { type: 'seatFigure', figure: 'eg_general', slot: 'elder#0' }).err).not.toBeNull();
  });

  it('a figure without the cabinet use cannot be seated', () => {
    const state = world();
    give(state, 'gr_legend');
    expect(cmd(state, 'p1', { type: 'seatFigure', figure: 'gr_legend', slot: 'elder#0' }).err).not.toBeNull();
  });

  it('unseat bases the figure in the capital and blocks that seat for 2 turns', () => {
    const state = world();
    give(state, 'eg_general', 'p1', { state: 'seated', slot: 'warleader#0' });
    give(state, 'mo_general');
    state.turn = 10;
    expect(cmd(state, 'p1', { type: 'unseatFigure', figure: 'eg_general' }).err).toBeNull();
    expect(state.figures.eg_general!.location).toEqual({ state: 'based', settlement: 'cap1' });
    expect(state.players.p1!.cabinetCooldown['warleader#0']).toBe(12);
    expect(cmd(state, 'p1', { type: 'seatFigure', figure: 'mo_general', slot: 'warleader#0' }).err).toMatch(/vacated/);
    expect(figureActions(state, 'mo_general', content).seat).toEqual(['elder#0']);
    state.turn = 12;
    expect(cmd(state, 'p1', { type: 'seatFigure', figure: 'mo_general', slot: 'warleader#0' }).err).toBeNull();
    expect(cabinetSeats(state, 'p1', content)).toContainEqual({ key: 'warleader#0', slot: 'warleader', figure: 'mo_general', availableTurn: 12 });
  });

  it('no seating or unseating during anarchy; only based figures can be seated', () => {
    const state = world();
    give(state, 'eg_general', 'p1', { state: 'seated', slot: 'warleader#0' });
    give(state, 'gr_statesman');
    give(state, 'mo_general', 'p1', { state: 'retired' });
    state.players.p1!.anarchyTurns = 2;
    expect(cmd(state, 'p1', { type: 'seatFigure', figure: 'gr_statesman', slot: 'elder#0' }).err).toMatch(/anarchy/);
    expect(cmd(state, 'p1', { type: 'unseatFigure', figure: 'eg_general' }).err).toMatch(/anarchy/);
    state.players.p1!.anarchyTurns = 0;
    expect(cmd(state, 'p1', { type: 'seatFigure', figure: 'mo_general', slot: 'elder#0' }).err).not.toBeNull();
    expect(cmd(state, 'p2', { type: 'seatFigure', figure: 'gr_statesman', slot: 'warleader#0' }).err).not.toBeNull();
  });

  it('seated turns accrue per culture each tick (not during anarchy)', () => {
    const state = world();
    give(state, 'eg_general', 'p1', { state: 'seated', slot: 'warleader#0' });
    give(state, 'gr_statesman', 'p1', { state: 'seated', slot: 'elder#0' });
    emergenceTick(makeCtx(state, content), 'p1');
    emergenceTick(makeCtx(state, content), 'p1');
    expect(state.players.p1!.seatedTurns).toEqual({ egyptian: 2, greek: 2 });
    state.players.p1!.anarchyTurns = 1;
    emergenceTick(makeCtx(state, content), 'p1');
    expect(state.players.p1!.seatedTurns).toEqual({ egyptian: 2, greek: 2 });
  });
});

describe('deploy and recall', () => {
  it('deploys a unit-capable figure as its kind’s unit in an own city, and recalls it', () => {
    const state = world();
    give(state, 'eg_general');
    const { err } = cmd(state, 'p1', { type: 'deployFigure', figure: 'eg_general', settlement: 'city1' });
    expect(err).toBeNull();
    const loc = state.figures.eg_general!.location;
    if (loc.state !== 'unit') throw new Error('not deployed');
    const unit = state.units[loc.unit]!;
    expect(unit).toMatchObject({ owner: 'p1', type: 'figure_general', figure: 'eg_general', at: at(8, 3) });
    expect(figureActions(state, 'eg_general', content)).toMatchObject({ canRecall: true, seat: [], deploy: [] });

    unit.at = at(5, 5); // off a settlement
    expect(cmd(state, 'p1', { type: 'recallFigure', figure: 'eg_general' }).err).toMatch(/settlements/);
    unit.at = at(3, 3);
    expect(cmd(state, 'p1', { type: 'recallFigure', figure: 'eg_general' }).err).toBeNull();
    expect(state.units[loc.unit]).toBeUndefined();
    expect(state.figures.eg_general!.location).toEqual({ state: 'based', settlement: 'cap1' });
  });

  it('rejects towns, foreign cities, non-unit figures and figures with no unit def', () => {
    const state = world();
    give(state, 'eg_general');
    give(state, 'gr_statesman');
    expect(cmd(state, 'p1', { type: 'deployFigure', figure: 'eg_general', settlement: 'town1' }).err).not.toBeNull();
    expect(cmd(state, 'p1', { type: 'deployFigure', figure: 'eg_general', settlement: 'cap2' }).err).not.toBeNull();
    expect(cmd(state, 'p1', { type: 'deployFigure', figure: 'gr_statesman', settlement: 'cap1' }).err).not.toBeNull();
    expect(figureActions(state, 'eg_general', content).deploy).toEqual(['cap1', 'city1']);
  });
});

describe('activate', () => {
  const activate = (state: GameState, id: string) => cmd(state, 'p1', { type: 'activateFigure', figure: id });

  const expectRetired = (state: GameState, id: string): void => {
    expect(state.figures[id]).toMatchObject({ activated: true, location: { state: 'retired' } });
  };

  it('rush_wonder adds amount% of the wonder cost in the figure’s city (or capital)', () => {
    const state = world();
    give(state, 'eg_builder', 'p1', { state: 'based', settlement: 'city1' });
    expect(activate(state, 'eg_builder').err).toMatch(/wonder/);
    state.settlements.cap1!.production = { item: 'step_pyramid', progress: 10 };
    const { err, ctx } = activate(state, 'eg_builder');
    expect(err).toBeNull();
    expect(state.settlements.cap1!.production.progress).toBe(10 + 90); // 50% of 180
    expectRetired(state, 'eg_builder');
    expect(state.players.p1!.stats.figuresActivated).toBe(1);
    expect(ctx.events).toContainEqual({ type: 'figureRetired', figure: 'eg_builder', player: 'p1' });
    expect(state.players.p1!.chronicle).toHaveLength(1);
  });

  it('production_burst adds to the current build', () => {
    const state = world();
    give(state, 'act_production');
    expect(activate(state, 'act_production').err).not.toBeNull();
    state.settlements.cap1!.production = { item: 'walls', progress: 5 };
    expect(activate(state, 'act_production').err).toBeNull();
    expect(state.settlements.cap1!.production.progress).toBe(45);
  });

  it('stockpile bursts (science, culture, gold, faith, influence)', () => {
    const state = world();
    for (const id of ['gr_thinker', 'act_culture', 'act_gold', 'act_faith', 'act_influence']) {
      give(state, id);
      expect(activate(state, id).err).toBeNull();
      expectRetired(state, id);
    }
    expect(state.players.p1!.stock).toMatchObject({ science: 60, culture: 11, gold: 12, faith: 13, influence: 14 });
  });

  it('explore_reveal reveals tiles around settlements and units', () => {
    const state = world();
    give(state, 'gr_legend');
    addUnit(state, content, 'p1', 'scout', at(18, 18));
    expect(activate(state, 'gr_legend').err).toBeNull();
    const p = state.players.p1!;
    const idx = (col: number, row: number) => row * state.map.width + col;
    expect(p.explored[idx(3, 3)]).toBe(1);
    expect(p.explored[idx(3, 5)]).toBe(1);
    expect(p.explored[idx(18, 18)]).toBe(1);
    expect(p.explored[idx(14, 14)]).toBe(0);
  });

  it('free_unit spawns the best available military unit in the capital', () => {
    const state = world();
    give(state, 'act_unit');
    expect(activate(state, 'act_unit').err).toBeNull();
    const units = Object.values(state.units).filter((u) => u.owner === 'p1');
    expect(units.map((u) => u.type)).toEqual(['warrior_band', 'warrior_band']); // no techs: warriors
    state.players.p1!.techs = ['the_wheel'];
    state.map.tiles[0]!.owner = 'p1';
    state.map.tiles[0]!.resource = 'horses';
    state.figures.act_unit!.location = { state: 'based', settlement: 'cap1' };
    state.figures.act_unit!.activated = false;
    expect(activate(state, 'act_unit').err).toBeNull();
    expect(Object.values(state.units).filter((u) => u.type === 'chariot')).toHaveLength(2);
  });

  it('heal_units heals every own unit, capped at full', () => {
    const state = world();
    give(state, 'act_heal');
    const a = addUnit(state, content, 'p1', 'warrior_band', at(3, 3));
    const b = addUnit(state, content, 'p1', 'warrior_band', at(4, 3));
    const c = addUnit(state, content, 'p2', 'warrior_band', at(14, 14));
    state.units[a]!.hp = 50;
    state.units[b]!.hp = 90;
    state.units[c]!.hp = 10;
    expect(activate(state, 'act_heal').err).toBeNull();
    expect([state.units[a]!.hp, state.units[b]!.hp, state.units[c]!.hp]).toEqual([80, 100, 10]);
  });

  it('grow_city grows the figure’s city (default amount)', () => {
    const state = world();
    give(state, 'act_grow', 'p1', { state: 'based', settlement: 'city1' });
    expect(activate(state, 'act_grow').err).toBeNull();
    expect(state.settlements.city1!.population).toBe(1 + K.ACTIVATE_DEFAULT_AMOUNT.grow_city);
  });

  it('a seated activator leaves its seat; non-activators and retired figures cannot activate', () => {
    const state = world();
    give(state, 'gr_thinker', 'p1', { state: 'seated', slot: 'elder#0' });
    give(state, 'gr_statesman');
    expect(activate(state, 'gr_thinker').err).toBeNull();
    expect(state.players.p1!.cabinet['elder#0']).toBeNull();
    expect(activate(state, 'gr_thinker').err).not.toBeNull();
    expect(activate(state, 'gr_statesman').err).not.toBeNull();
  });
});

describe('consume', () => {
  it('for refinement: +consumeValue RP, leaves play', () => {
    const state = world();
    give(state, 'eg_general', 'p1', { state: 'seated', slot: 'warleader#0' });
    expect(cmd(state, 'p1', { type: 'consumeFigure', figure: 'eg_general', as: 'refinement' }).err).toBeNull();
    expect(state.players.p1!.refinementPoints).toBe(3);
    expect(state.figures.eg_general!.location).toEqual({ state: 'consumed' });
    expect(state.players.p1!.cabinet['warleader#0']).toBeNull();
    expect(cmd(state, 'p1', { type: 'consumeFigure', figure: 'eg_general', as: 'refinement' }).err).not.toBeNull();
  });

  it('for yields: a 10-turn burst of the main yield; removes a deployed unit', () => {
    const state = world();
    give(state, 'eg_general');
    cmd(state, 'p1', { type: 'deployFigure', figure: 'eg_general', settlement: 'cap1' });
    state.turn = 5;
    expect(cmd(state, 'p1', { type: 'consumeFigure', figure: 'eg_general', as: 'yields' }).err).toBeNull();
    expect(Object.values(state.units)).toHaveLength(0);
    expect(state.players.p1!.effects).toEqual([
      {
        source: 'consume:eg_general',
        untilTurn: 14,
        modifiers: [{ scope: 'empire', effect: { kind: 'yield', yield: 'production', add: 3 * K.CONSUME_BURST_PER_VALUE } }],
      },
    ]);
  });
});

describe('conquest and defeat', () => {
  it('capturing a settlement takes the figures based there', () => {
    const state = world();
    give(state, 'eg_general', 'p1', { state: 'based', settlement: 'city1' });
    give(state, 'gr_statesman', 'p1', { state: 'based', settlement: 'cap1' });
    const ctx = makeCtx(state, content);
    state.settlements.city1!.owner = 'p2';
    onSettlementCaptured(ctx, 'city1', 'p1', 'p2');
    expect(state.figures.eg_general!.owner).toBe('p2');
    expect(state.figures.gr_statesman!.owner).toBe('p1');
    expect(ctx.events).toEqual([{ type: 'figureCaptured', figure: 'eg_general', from: 'p1', to: 'p2' }]);
  });

  it('eliminating a player takes all their active figures; the Hall stays', () => {
    const state = world();
    give(state, 'eg_general', 'p1', { state: 'seated', slot: 'warleader#0' });
    give(state, 'gr_statesman');
    give(state, 'mo_general', 'p1', { state: 'retired' });
    state.offers.push({ id: 'o1', player: 'p1', source: 'military', candidates: ['gr_general'], reasons: {}, deed: null, createdTurn: 1 });
    onPlayerEliminated(makeCtx(state, content), 'p1', 'p2');
    expect(state.figures.eg_general).toMatchObject({ owner: 'p2', location: { state: 'based', settlement: 'cap2' } });
    expect(state.figures.gr_statesman!.owner).toBe('p2');
    expect(state.figures.mo_general).toMatchObject({ owner: 'p1', location: { state: 'retired' } });
    expect(state.players.p1!.cabinet['warleader#0']).toBeNull();
    expect(state.offers).toHaveLength(0);
  });

  it('elimination with no victor retires the figures', () => {
    const state = world();
    give(state, 'gr_statesman');
    onPlayerEliminated(makeCtx(state, content), 'p1', null);
    expect(state.figures.gr_statesman).toMatchObject({ owner: 'p1', location: { state: 'retired' } });
  });

  it('a defeated figure-unit retreats to the nearest own settlement at 1 HP', () => {
    const state = world();
    give(state, 'eg_general');
    cmd(state, 'p1', { type: 'deployFigure', figure: 'eg_general', settlement: 'cap1' });
    const loc = state.figures.eg_general!.location;
    if (loc.state !== 'unit') throw new Error('not deployed');
    state.units[loc.unit]!.at = at(9, 4);
    onFigureUnitDefeated(makeCtx(state, content), loc.unit, 'p2');
    const now = state.figures.eg_general!.location;
    if (now.state !== 'unit') throw new Error('should still be a unit');
    expect(state.units[loc.unit]).toBeUndefined();
    expect(state.units[now.unit]).toMatchObject({ at: at(8, 3), hp: K.FIGURE_RETREAT_HP, figure: 'eg_general', owner: 'p1' });
  });

  it('with nowhere to retreat the figure is captured by the victor', () => {
    const state = world();
    give(state, 'eg_general');
    cmd(state, 'p1', { type: 'deployFigure', figure: 'eg_general', settlement: 'cap1' });
    const loc = state.figures.eg_general!.location;
    if (loc.state !== 'unit') throw new Error('not deployed');
    for (const s of Object.values(state.settlements)) if (s.owner === 'p1') s.owner = 'p2';
    const ctx = makeCtx(state, content);
    onFigureUnitDefeated(ctx, loc.unit, 'p2');
    expect(state.units[loc.unit]).toBeUndefined();
    expect(state.figures.eg_general!.owner).toBe('p2');
    expect(state.figures.eg_general!.location.state).toBe('based');
    expect(ctx.events).toContainEqual({ type: 'figureCaptured', figure: 'eg_general', from: 'p1', to: 'p2' });
  });
});

describe('ages', () => {
  it('retireFigures sends every active figure to the Hall and empties the cabinet', () => {
    const state = world();
    give(state, 'eg_general', 'p1', { state: 'seated', slot: 'warleader#0' });
    give(state, 'gr_statesman');
    give(state, 'mo_general');
    give(state, 'mo_statesman', 'p1', { state: 'consumed' });
    cmd(state, 'p1', { type: 'deployFigure', figure: 'mo_general', settlement: 'cap1' });
    const ids = retireFigures(makeCtx(state, content), 'p1');
    expect(ids).toEqual(['eg_general', 'gr_statesman', 'mo_general']);
    expect(Object.values(state.units)).toHaveLength(0);
    expect(state.players.p1!.cabinet).toEqual({ 'elder#0': null, 'warleader#0': null });
    expect(state.figures.mo_statesman!.location.state).toBe('consumed');
  });

  it('ancestors yield +1 of their main yield per retired figure', () => {
    const state = world();
    give(state, 'eg_general', 'p1', { state: 'retired' });
    give(state, 'eg_builder', 'p1', { state: 'retired' });
    give(state, 'gr_thinker', 'p1', { state: 'retired' });
    give(state, 'gr_legend', 'p1', { state: 'retired' });
    give(state, 'gr_statesman'); // active: no ancestor yield
    give(state, 'mo_statesman', 'p1', { state: 'consumed' });
    expect(ancestorYields(state, 'p1', content)).toEqual({ production: 2, science: 1, culture: 1 });
  });

  it('onAgeStarted reopens the legend slot and drops stale offers with a refund', () => {
    const state = world();
    const p = state.players.p1!;
    p.legendSlotUsed = true;
    p.gpThreshold.statesman = 84;
    state.offers.push({ id: 'o1', player: 'p1', source: 'statesman', candidates: ['gr_statesman'], reasons: {}, deed: null, createdTurn: 1 });
    state.age = 'classical';
    onAgeStarted(makeCtx(state, content), 'p1');
    expect(p.legendSlotUsed).toBe(false);
    expect(state.offers).toHaveLength(0);
    expect(p.gp.statesman).toBeCloseTo(60, 10);
  });
});

describe('culture weights', () => {
  it('count held figures in any state plus one per ten seated turns', () => {
    const state = world();
    give(state, 'eg_general', 'p1', { state: 'retired' });
    give(state, 'eg_statesman', 'p1', { state: 'consumed' });
    give(state, 'eg_builder', 'p1', { state: 'seated', slot: 'elder#0' });
    give(state, 'gr_statesman', 'p2', { state: 'based', settlement: 'cap2' }); // captured away / rival's
    state.players.p1!.seatedTurns = { egyptian: 19, greek: 10 };
    const w = cultureWeights(state, 'p1', content);
    expect(Object.keys(w)).toEqual(real.cultures.map((c) => c.id));
    expect(w.egyptian).toBe(3 + 1);
    expect(w.greek).toBe(1);
    expect(w.mongol).toBe(0);
    expect(cultureWeights(state, 'p2', content).greek).toBe(1);
  });
});

describe('determinism', () => {
  it('a scripted multi-turn run is byte-identical across repeats', () => {
    const run = (): string => {
      const state = world();
      const p = state.players.p1!;
      p.income.science = 6;
      p.income.culture = 4;
      for (let t = 1; t <= 30; t++) {
        state.turn = t;
        const ctx = makeCtx(state, content);
        emergenceTick(ctx, 'p1');
        emergenceTick(ctx, 'p2');
        for (const o of state.offers.slice()) {
          handleFigureCommand(ctx, o.player, { type: 'chooseOffer', offer: o.id, figure: o.candidates[o.candidates.length - 1] ?? null });
        }
      }
      return JSON.stringify(state);
    };
    const a = run();
    expect(run()).toBe(a);
    expect(JSON.parse(a).figures).not.toEqual({});
  });
});
