/**
 * Emergence fixes from the third hands-on playtest: passed-over figures stop repeating,
 * number-aware reasons that cite only what the player has, pool feeds that follow play,
 * fair contests for a figure invited by two courts, and faith's devotion sink.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState, Offer } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { handleFigureCommand } from '../src/emergence';
import * as K from '../src/emergence/constants';
import { drawCandidates, offerPool, offerReason, passedOver } from '../src/emergence/offers';
import { devoteFaith, gpGain } from '../src/emergence/points';
import { citable, numberedHint, singularHint } from '../src/emergence/reasons';
import { citedSignals, measurePlayer, signalContributions } from '../src/emergence/signals';
import { addSettlement, addUnit, at, makeCtx, makeState, resetFakes, testContent } from './helpers/emergence';

vi.mock('../src/sim/units', () => import('./helpers/emergence'));
vi.mock('../src/sim/stats', () => import('./helpers/emergence'));
vi.mock('../src/sim/ages', () => import('./helpers/emergence'));

const real = loadContent();
const content = testContent(real);

const world = (seed = 1): GameState => {
  const state = makeState(content, { seed });
  addSettlement(state, 'p1', at(3, 3), { id: 'cap1' });
  addSettlement(state, 'p2', at(12, 12), { id: 'cap2' });
  return state;
};

const offer = (state: GameState, player: string, candidates: string[], id = `o${state.nextId++}`): Offer => {
  const o: Offer = { id, player, source: 'statesman', candidates, reasons: {}, deed: null, createdTurn: state.turn };
  state.offers.push(o);
  return o;
};

beforeEach(resetFakes);

describe('passed-over figures (playtest 3: the same two figures at turn 8 and turn 33)', () => {
  it('skipping an offer remembers its candidates for the rest of the age, with no modifiers', () => {
    const state = world();
    const o = offer(state, 'p1', ['gr_statesman', 'eg_statesman']);
    expect(handleFigureCommand(makeCtx(state, content), 'p1', { type: 'chooseOffer', offer: o.id, figure: null })).toBeNull();
    expect(passedOver(state, 'p1')).toEqual({ gr_statesman: true, eg_statesman: true });
    const marks = state.players.p1!.effects.filter((e) => e.source.startsWith(K.PASSED_OVER_SOURCE));
    expect(marks.every((e) => e.untilTurn === -1 && e.modifiers.length === 0)).toBe(true);
    expect(passedOver(state, 'p2')).toEqual({});
  });

  it('recruiting one remembers the others, not the recruit', () => {
    const state = world();
    const o = offer(state, 'p1', ['gr_statesman', 'eg_statesman', 'mo_statesman']);
    expect(handleFigureCommand(makeCtx(state, content), 'p1', { type: 'chooseOffer', offer: o.id, figure: 'eg_statesman' })).toBeNull();
    expect(passedOver(state, 'p1')).toEqual({ gr_statesman: true, mo_statesman: true });
  });

  it('a passed-over figure is drawn far less often', () => {
    const counts = { passed: 0, fresh: 0 };
    for (let seed = 1; seed <= 300; seed++) {
      const state = world(seed);
      state.players.p1!.effects.push({ source: `${K.PASSED_OVER_SOURCE}gr_statesman`, untilTurn: -1, modifiers: [] });
      const pool = offerPool(state, 'p1', ['statesman'], content).filter((f) => f.id === 'gr_statesman' || f.id === 'eg_statesman');
      const [first] = drawCandidates(state, 'p1', pool, content);
      if (first?.id === 'gr_statesman') counts.passed++;
      else counts.fresh++;
    }
    expect(counts.passed).toBeLessThan(counts.fresh / 5);
    expect(counts.passed).toBeGreaterThan(0);
  });
});

describe('reasons (playtest 3: "hill towns" for one town; never cite what the player lacks)', () => {
  it('singular forms', () => {
    expect(singularHint('your hill towns')).toBe('your hill town');
    expect(singularHint('your river towns')).toBe('your river town');
    expect(singularHint('your victories')).toBe('your victory');
    expect(singularHint('your reed marshes')).toBe('your reed marsh');
    expect(singularHint('your oases')).toBe('your oasis');
    expect(singularHint('your harbors')).toBe('your harbor');
    expect(singularHint('your disciplined infantry')).toBe('your disciplined infantry');
    expect(singularHint('your cattle')).toBe('your cattle');
  });

  it('number-aware: a count of one, or towns of a one-town player, reads singular', () => {
    expect(numberedHint('your river towns', 'riverSettlements', 1, 1)).toBe('your river town');
    expect(numberedHint('your river towns', 'riverSettlements', 2, 3)).toBe('your river towns');
    expect(numberedHint('your hill towns', 'ownedFeature', 4, 1)).toBe('your hill town');
    expect(numberedHint('your hill towns', 'ownedFeature', 4, 2)).toBe('your hill towns');
    expect(numberedHint('your riders', 'unitsOfClass', 1, 3)).toBe('your rider');
    expect(numberedHint('your learning', 'scienceIncome', 1, 1)).toBe('your learning');
  });

  it('citable: something real, two towns for "many towns", a real share of the map for "explorers"', () => {
    expect(citable('ownedResource', 0)).toBe(false);
    expect(citable('settlementCount', 1)).toBe(false);
    expect(citable('settlementCount', 2)).toBe(true);
    expect(citable('exploredPercent', 5)).toBe(false);
    expect(citable('exploredPercent', 20)).toBe(true);
  });

  it('a one-town river player hears of "your river town", and never of "your many towns"', () => {
    const state = makeState(content);
    addSettlement(state, 'p1', at(3, 3), { id: 'cap1' });
    const t = state.map.tiles.find((x) => x.settlement === 'cap1');
    if (t) t.river = true;
    state.players.p1!.affinity.egyptian = 50;
    const contrib = signalContributions(state, 'p1', content);
    const cited = citedSignals(state, 'p1', contrib, 'egyptian', content);
    expect(cited[0]?.signal.id).toBe('river_settlements');
    expect(cited[0]?.hint).toBe('your river town');
    expect(offerReason(state, 'p1', 'egyptian', contrib, content)).toBe('drawn by your river town');
    for (const c of ['greek', 'spanish', 'mongol']) {
      expect(citedSignals(state, 'p1', contrib, c, content).some((x) => x.signal.measure === 'settlementCount')).toBe(false);
    }
  });
});

describe('pool feeds follow play (playtest 3: a conqueror was offered explorers and statesmen)', () => {
  it('an army at war fills military fastest; caravans and a suzerainty fill the statesman pool', () => {
    const war = world();
    for (let i = 0; i < 6; i++) addUnit(war, content, 'p1', 'warrior_band', at(4 + (i % 3), 4 + Math.floor(i / 3)));
    war.wars['p1|p2'] = 1;
    war.players.p1!.income.influence = 2;
    war.players.p1!.income.science = 3;
    const g = gpGain(war, 'p1', content, measurePlayer(war, 'p1', content));
    const top = Object.entries(g).sort((a, b) => b[1] - a[1])[0]?.[0];
    expect(top).toBe('military');
    expect(g.military).toBeCloseTo(K.GP_BASE_PER_POOL + K.GP_SCALE * (6 * K.GP_MILITARY_PER_UNIT + K.GP_MILITARY_PER_WAR), 10);

    const trade = world();
    addSettlement(trade, 'p2', at(9, 3), { id: 'p2b' });
    trade.tradeRoutes.push({ id: 't1', owner: 'p1', from: 'cap1', to: 'cap2' }, { id: 't2', owner: 'p1', from: 'cap1', to: 'p2b' });
    trade.cityStates.x = { id: 'x', settlement: 'cap2', envoys: { p1: 3 }, suzerain: 'p1', alive: true };
    trade.players.p1!.income.gold = 8;
    const h = gpGain(trade, 'p1', content, measurePlayer(trade, 'p1', content));
    expect(Object.entries(h).sort((a, b) => b[1] - a[1])[0]?.[0]).toBe('statesman');
    expect(h.statesman).toBeGreaterThan(h.exploration);
  });

  it('a scout keeping watch as a fortified lookout no longer feeds the exploration pool', () => {
    const state = world();
    const id = addUnit(state, content, 'p1', 'scout', at(4, 4));
    expect(measurePlayer(state, 'p1', content).scouts).toBe(1);
    state.units[id]!.fortified = true;
    expect(measurePlayer(state, 'p1', content).scouts).toBe(0);
  });

  it('buildings raised feed the building pool', () => {
    const state = world();
    const before = gpGain(state, 'p1', content, measurePlayer(state, 'p1', content)).building;
    state.settlements.cap1!.buildings.push('granary', 'barracks');
    const after = gpGain(state, 'p1', content, measurePlayer(state, 'p1', content)).building;
    expect(after).toBeGreaterThanOrEqual(before + 2 * K.GP_SCALE * K.GP_BUILDING_PER_BUILDING - 1e-9);
  });
});

describe('contested figures are fair (playtest 3: seat 1 won every contest)', () => {
  it('a figure in two open offers answers the earlier invitation; the later offer stays open', () => {
    const state = world();
    const earlier = offer(state, 'p2', ['gr_statesman', 'eg_statesman']);
    const later = offer(state, 'p1', ['gr_statesman', 'mo_statesman']);
    const ctx = makeCtx(state, content);
    expect(handleFigureCommand(ctx, 'p1', { type: 'chooseOffer', offer: later.id, figure: 'gr_statesman' })).toBeNull();
    expect(state.figures.gr_statesman?.owner).toBe('p2');
    expect(state.offers.some((o) => o.id === earlier.id)).toBe(false);
    const mine = state.offers.find((o) => o.id === later.id);
    expect(mine?.candidates).toEqual(['mo_statesman']);
    expect(ctx.events).toContainEqual({ type: 'figureJoinedRival', figure: 'gr_statesman', player: 'p1', rival: 'p2' });
    // The other candidate is still the player's to choose.
    expect(handleFigureCommand(ctx, 'p1', { type: 'chooseOffer', offer: later.id, figure: 'mo_statesman' })).toBeNull();
    expect(state.figures.mo_statesman?.owner).toBe('p1');
  });

  it('the earlier offer wins directly, and the later one loses the figure', () => {
    const state = world();
    const earlier = offer(state, 'p1', ['gr_statesman']);
    const later = offer(state, 'p2', ['gr_statesman', 'eg_statesman']);
    const ctx = makeCtx(state, content);
    expect(handleFigureCommand(ctx, 'p1', { type: 'chooseOffer', offer: earlier.id, figure: 'gr_statesman' })).toBeNull();
    expect(state.figures.gr_statesman?.owner).toBe('p1');
    expect(state.offers.find((o) => o.id === later.id)?.candidates).toEqual(['eg_statesman']);
  });
});

describe('faith devotion (playtest 3: faith had no use)', () => {
  it('a share of stored faith becomes faith great-people points each turn', () => {
    const state = world();
    const p = state.players.p1!;
    p.stock.faith = 50;
    devoteFaith(state, 'p1');
    expect(p.stock.faith).toBeCloseTo(50 * (1 - K.FAITH_STOCK_DRAIN_SHARE), 6);
    expect(p.gp.faith).toBeCloseTo(50 * K.FAITH_STOCK_DRAIN_SHARE * K.FAITH_STOCK_TO_GP * K.GP_SCALE, 6);
  });

  it('nothing is spent while the faith pool is banked full', () => {
    const state = world();
    const p = state.players.p1!;
    p.stock.faith = 50;
    p.gp.faith = K.GP_BANK_MAX_THRESHOLDS * p.gpThreshold.faith;
    devoteFaith(state, 'p1');
    expect(p.stock.faith).toBe(50);
  });
});
