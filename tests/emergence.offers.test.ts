/** Great-people points, offers, legends, deeds (GDD §4). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameState } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { emergenceTick, handleFigureCommand } from '../src/emergence';
import * as K from '../src/emergence/constants';
import { drawCandidates, offerPool, offerReason, offerWeight, partnerCultures } from '../src/emergence/offers';
import { gpGain } from '../src/emergence/points';
import { measurePlayer, signalContributions } from '../src/emergence/signals';
import {
  addSettlement,
  addUnit,
  ageProgressCalls,
  at,
  claim,
  fakeStats,
  makeCtx,
  makeState,
  resetFakes,
  testContent,
} from './helpers/emergence';

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

const figureCulture = (id: string): string | undefined => content.figures.find((f) => f.id === id)?.culture;

beforeEach(resetFakes);

describe('great-people points', () => {
  it('accrue from play, buildings and wonders, with gpPoints modifiers', () => {
    const state = world();
    const p = state.players.p1!;
    const m0 = measurePlayer(state, 'p1', content);
    const base = gpGain(state, 'p1', content, m0);
    expect(base.thought).toBeCloseTo(K.GP_BASE_PER_POOL, 10);

    p.income.science = 10;
    p.income.faith = 5;
    p.stats.battlesWonThisTurn = 1;
    addUnit(state, content, 'p1', 'warrior_band', at(3, 3));
    state.settlements.cap1!.buildings.push('monument'); // gp: building 1
    p.effects.push({ source: 't', untilTurn: -1, modifiers: [{ scope: 'empire', effect: { kind: 'gpPoints', gp: 'thought', percent: 100 } }] });
    const g = gpGain(state, 'p1', content, measurePlayer(state, 'p1', content));
    // Play-derived points are scaled by GP_SCALE (and GP_AGE_SCALE, 1 in the ancient age).
    expect(g.thought).toBeCloseTo(2 * (K.GP_BASE_PER_POOL + K.GP_SCALE * K.GP_THOUGHT_PER_SCIENCE * 10), 10);
    expect(g.faith).toBeCloseTo(K.GP_BASE_PER_POOL + K.GP_SCALE * K.GP_FAITH_PER_FAITH * 5, 10);
    expect(g.military).toBeCloseTo(K.GP_BASE_PER_POOL + K.GP_SCALE * (K.GP_MILITARY_PER_UNIT + K.GP_MILITARY_PER_BATTLE_WON), 10);
    expect(g.building).toBeCloseTo(K.GP_BASE_PER_POOL + 1, 10);
  });

  it('a pool at threshold creates an offer, spends the threshold and grows it ×1.4', () => {
    const state = world();
    const p = state.players.p1!;
    p.gp.statesman = 70;
    const ctx = makeCtx(state, content);
    emergenceTick(ctx, 'p1');
    const offers = state.offers.filter((o) => o.player === 'p1');
    expect(offers).toHaveLength(1);
    expect(offers[0]?.source).toBe('statesman');
    expect(offers[0]?.candidates).toHaveLength(3);
    expect(p.gpThreshold.statesman).toBeCloseTo(60 * 1.4, 10);
    expect(p.gp.statesman).toBeCloseTo(70 + K.GP_BASE_PER_POOL + K.GP_SCALE * K.GP_STATESMAN_PER_SETTLEMENT - 60, 10);
    expect(ctx.events.some((e) => e.type === 'offerCreated' && e.player === 'p1')).toBe(true);
  });

  it('keeps the points when the pool has no eligible figure', () => {
    const state = world();
    const p = state.players.p1!;
    p.gp.faith = 100; // no spiritual figures in the test roster
    emergenceTick(makeCtx(state, content), 'p1');
    expect(state.offers).toHaveLength(0);
    expect(p.gp.faith).toBeGreaterThan(100);
    expect(p.gpThreshold.faith).toBe(60);
  });

  it('caps open offers so points bank', () => {
    const state = world();
    const p = state.players.p1!;
    p.gp.statesman = 500;
    p.gp.military = 500;
    p.gp.thought = 500;
    emergenceTick(makeCtx(state, content), 'p1');
    expect(state.offers.filter((o) => o.player === 'p1')).toHaveLength(K.MAX_OPEN_OFFERS);
    expect(p.gp.thought).toBe(500); // banked (already above the bank ceiling, so no growth)
  });

  it('pools bank at most GP_BANK_MAX_THRESHOLDS thresholds', () => {
    const state = world();
    const p = state.players.p1!;
    p.gp.faith = 119; // no spiritual figures: points bank
    p.income.faith = 50;
    emergenceTick(makeCtx(state, content), 'p1');
    expect(p.gp.faith).toBe(K.GP_BANK_MAX_THRESHOLDS * 60);
  });

  it('onboarding: the first offer arrives on FIRST_OFFER_TURN from the fullest pool', () => {
    const state = world();
    const p = state.players.p1!;
    state.turn = K.FIRST_OFFER_TURN - 1;
    p.gp.military = 20;
    emergenceTick(makeCtx(state, content), 'p1');
    expect(state.offers).toHaveLength(0);
    state.turn = K.FIRST_OFFER_TURN;
    emergenceTick(makeCtx(state, content), 'p1');
    expect(state.offers.map((o) => o.source)).toEqual(['military']);
    expect(p.gp.military).toBe(0);
    expect(p.gpThreshold.military).toBeCloseTo(84, 10);
    // Only once.
    state.offers = [];
    state.turn++;
    emergenceTick(makeCtx(state, content), 'p1');
    expect(state.offers).toHaveLength(0);
  });
});

describe('offer draw', () => {
  it('is deterministic for a seed', () => {
    const run = (seed: number) => {
      const state = world(seed);
      state.players.p1!.gp.statesman = 60;
      emergenceTick(makeCtx(state, content), 'p1');
      return JSON.stringify(state);
    };
    expect(run(7)).toBe(run(7));
    const seeds = new Set([1, 2, 3, 4, 5, 6].map((s) => JSON.parse(run(s)).offers[0].candidates.join()));
    expect(seeds.size).toBeGreaterThan(1);
  });

  it('never offers recruited, deed, wrong-age or wrong-kind figures', () => {
    const state = world();
    state.figures.gr_general = {
      id: 'gr_general',
      owner: 'p2',
      recruitedTurn: 1,
      recruitedAge: 'ancient',
      reason: '',
      activated: false,
      location: { state: 'based', settlement: 'cap2' },
    };
    const pool = offerPool(state, 'p1', ['general'], content).map((f) => f.id);
    expect(pool).toEqual(['eg_general', 'mo_general']);
    const statesmen = offerPool(state, 'p1', ['statesman'], content).map((f) => f.id);
    expect(statesmen).not.toContain('in_statesman'); // classical
    for (let seed = 1; seed <= 20; seed++) {
      const s = world(seed);
      s.figures.gr_general = state.figures.gr_general!;
      s.players.p1!.gp.military = 60;
      emergenceTick(makeCtx(s, content), 'p1');
      const cands = s.offers[0]?.candidates ?? [];
      expect(cands.length).toBe(2);
      expect(cands).not.toContain('gr_general');
      expect(cands).not.toContain('eg_deed_general');
    }
  });

  it('weights (A+5)^1.5, ×2 for a trade or city-state partner', () => {
    expect(offerWeight(0, false)).toBeCloseTo(Math.pow(5, 1.5), 10);
    expect(offerWeight(95, false)).toBeCloseTo(1000, 6);
    expect(offerWeight(95, true)).toBeCloseTo(2000, 6);
    const state = world();
    state.settlements.cap2!.namedFor = 'mongol';
    state.tradeRoutes.push({ id: 'r', owner: 'p1', from: 'cap1', to: 'cap2' });
    expect(partnerCultures(state, 'p1', content)).toEqual({ mongol: true });
  });

  it('the ×2 partner weight shows in the draw frequencies', () => {
    const count = (partner: boolean): number => {
      let hits = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const s = world(seed);
        if (partner) {
          s.settlements.cap2!.namedFor = 'mongol';
          s.tradeRoutes.push({ id: 'r', owner: 'p1', from: 'cap1', to: 'cap2' });
        }
        const pool = offerPool(s, 'p1', ['general'], content);
        const drawn = drawCandidates(s, 'p1', pool, content);
        // Single-slot view: is mongol the first pick?
        if (drawn[0]?.culture === 'mongol') hits++;
      }
      return hits;
    };
    // Pool: eg, gr, mo generals, all A=0. P(first=mongol) = 1/3 without, 2/4 with partner.
    const without = count(false);
    const withPartner = count(true);
    expect(without / 400).toBeGreaterThan(0.25);
    expect(without / 400).toBeLessThan(0.42);
    expect(withPartner / 400).toBeGreaterThan(0.42);
    expect(withPartner / 400).toBeLessThan(0.58);
  });

  it('guarantees one candidate from the top-3 affinity cultures when the pool has one', () => {
    // Top-3 = egyptian, greek, mongol with tiny affinity; the statesman pool has 8 cultures.
    let guaranteed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = world(seed);
      const p = s.players.p1!;
      for (const c of Object.keys(p.affinity)) p.affinity[c] = 0;
      p.affinity.inuit = 1; // classical-only roster here, so not in the pool
      p.affinity.spanish = 0.5;
      p.affinity.norse = 0.25;
      const pool = offerPool(s, 'p1', ['statesman'], content);
      const drawn = drawCandidates(s, 'p1', pool, content);
      expect(drawn).toHaveLength(3);
      if (drawn.some((f) => f.culture === 'spanish' || f.culture === 'norse')) guaranteed++;
    }
    expect(guaranteed).toBe(60);
  });

  it('reasons name the culture’s strongest signal, or fall back to a wanderer', () => {
    const c2: ContentBundle = {
      ...content,
      signals: [
        { id: 'steppe', description: '', measure: 'ownedTerrain', param: 'steppe', hint: 'your open grasslands', weights: { mongol: 1 } },
        { id: 'horses', description: '', measure: 'ownedResource', param: 'horses', hint: 'your herds', weights: { mongol: 3 } },
      ],
    };
    const state = makeState(c2, { terrain: (col) => ({ terrain: 'steppe', resource: col === 3 ? 'horses' : null }) });
    addSettlement(state, 'p1', at(3, 3));
    claim(state, 'p1', at(3, 3), 1);
    state.players.p1!.affinity.mongol = 40;
    state.players.p1!.affinity.greek = 40;
    const contrib = signalContributions(state, 'p1', c2);
    expect(offerReason(state, 'p1', 'mongol', contrib, c2)).toBe('drawn by your herds');
    expect(offerReason(state, 'p1', 'egyptian', contrib, c2)).toBe('a wanderer who heard of your people');
    expect(offerReason(state, 'p1', 'greek', contrib, c2)).toBe('drawn by the tales of your people');
  });
});

describe('choosing offers', () => {
  const offerFor = (state: GameState, player: string, gp: 'statesman' | 'military' = 'statesman') => {
    state.players[player]!.gp[gp] = 60;
    emergenceTick(makeCtx(state, content), player);
    const o = state.offers.find((x) => x.player === player && x.source === gp);
    if (!o) throw new Error('no offer');
    return o;
  };

  it('accepting recruits the figure in the capital with reason, stats, chronicle and age progress', () => {
    const state = world();
    const o = offerFor(state, 'p1');
    const fig = o.candidates[0] as string;
    const ctx = makeCtx(state, content);
    expect(handleFigureCommand(ctx, 'p1', { type: 'chooseOffer', offer: o.id, figure: fig })).toBeNull();
    const fs = state.figures[fig]!;
    expect(fs.owner).toBe('p1');
    expect(fs.location).toEqual({ state: 'based', settlement: 'cap1' });
    expect(fs.reason).toBe(o.reasons[fig]);
    expect(state.players.p1!.stats.figuresRecruited).toBe(1);
    expect(state.players.p1!.chronicle.at(-1)?.ref).toBe(fig);
    expect(ageProgressCalls).toEqual([K.RECRUIT_AGE_PROGRESS]);
    expect(state.offers).toHaveLength(0);
    expect(ctx.events).toContainEqual({ type: 'figureRecruited', figure: fig, player: 'p1' });
  });

  it('rejects offers of other players and figures not offered', () => {
    const state = world();
    const o = offerFor(state, 'p1');
    const ctx = makeCtx(state, content);
    expect(handleFigureCommand(ctx, 'p2', { type: 'chooseOffer', offer: o.id, figure: o.candidates[0] ?? null })).not.toBeNull();
    expect(handleFigureCommand(ctx, 'p1', { type: 'chooseOffer', offer: o.id, figure: 'eg_general' })).not.toBeNull();
  });

  it('skipping adds 25% of the pool threshold', () => {
    const state = world();
    const o = offerFor(state, 'p1');
    const p = state.players.p1!;
    const before = p.gp.statesman;
    expect(handleFigureCommand(makeCtx(state, content), 'p1', { type: 'chooseOffer', offer: o.id, figure: null })).toBeNull();
    expect(p.gp.statesman).toBeCloseTo(before + K.SKIP_REFUND_SHARE * p.gpThreshold.statesman, 10);
    expect(state.offers).toHaveLength(0);
  });

  it('a figure recruited by one player leaves rivals’ offers ("joined a rival"); empty offers refund', () => {
    const state = world();
    const o1 = offerFor(state, 'p1', 'military');
    const o2 = offerFor(state, 'p2', 'military');
    // Force both offers to share figures (pool of 3 generals, 3 candidates each).
    expect(o1.candidates.slice().sort()).toEqual(o2.candidates.slice().sort());
    o2.candidates = [o1.candidates[0] as string];
    const fig = o2.candidates[0] as string;
    const p2 = state.players.p2!;
    const before = p2.gp.military;
    const ctx = makeCtx(state, content);
    expect(handleFigureCommand(ctx, 'p1', { type: 'chooseOffer', offer: o1.id, figure: fig })).toBeNull();
    expect(ctx.events).toContainEqual({ type: 'figureJoinedRival', figure: fig, player: 'p2', rival: 'p1' });
    expect(state.offers.find((o) => o.id === o2.id)).toBeUndefined();
    expect(p2.gp.military).toBeCloseTo(before + p2.gpThreshold.military / K.GP_THRESHOLD_GROWTH, 10);
  });

  it('a rival’s figure still left in an offer cannot be accepted', () => {
    const state = world();
    const o = offerFor(state, 'p1', 'military');
    const fig = o.candidates[0] as string;
    state.figures[fig] = { id: fig, owner: 'p2', recruitedTurn: 1, recruitedAge: 'ancient', reason: '', activated: false, location: { state: 'based', settlement: 'cap2' } };
    expect(handleFigureCommand(makeCtx(state, content), 'p1', { type: 'chooseOffer', offer: o.id, figure: fig })).toMatch(/joined a rival/);
    // If it was the only candidate, the offer is dropped and refunded instead.
    o.candidates = [fig];
    const ctx = makeCtx(state, content);
    expect(handleFigureCommand(ctx, 'p1', { type: 'chooseOffer', offer: o.id, figure: fig })).toBeNull();
    expect(ctx.events).toContainEqual({ type: 'figureJoinedRival', figure: fig, player: 'p1', rival: 'p2' });
    expect(state.offers).toHaveLength(0);
  });

  it('a player never sees the same figure in two open offers', () => {
    const state = world();
    const p = state.players.p1!;
    p.gp.statesman = 60;
    emergenceTick(makeCtx(state, content), 'p1');
    p.gp.statesman = 200;
    emergenceTick(makeCtx(state, content), 'p1');
    const all = state.offers.flatMap((o) => o.candidates);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('legends and deeds', () => {
  it('offers one legend per age once renown is high enough', () => {
    const state = world();
    const p = state.players.p1!;
    p.affinity.greek = K.LEGEND_TOTAL_AFFINITY / K.AFFINITY_DECAY + 1;
    const ctx = makeCtx(state, content);
    emergenceTick(ctx, 'p1');
    const legend = state.offers.find((o) => o.source === 'legend');
    expect(legend?.candidates).toEqual(['gr_legend']);
    expect(p.legendSlotUsed).toBe(true);
    state.offers = [];
    emergenceTick(makeCtx(state, content), 'p1');
    expect(state.offers.find((o) => o.source === 'legend')).toBeUndefined();
  });

  it('figure count also opens the legend slot', () => {
    const state = world();
    for (const id of ['eg_general', 'eg_statesman', 'gr_statesman', 'mo_statesman']) {
      state.figures[id] = { id, owner: 'p1', recruitedTurn: 1, recruitedAge: 'ancient', reason: '', activated: false, location: { state: 'based', settlement: 'cap1' } };
    }
    emergenceTick(makeCtx(state, content), 'p1');
    expect(state.offers.some((o) => o.source === 'legend')).toBe(true);
  });

  it('a deed fires once per world: single-candidate offer, deedCompleted, cannot be taken twice', () => {
    const state = world();
    fakeStats['p1:siegeTurnsHeld:'] = 5;
    fakeStats['p2:siegeTurnsHeld:'] = 9;
    const ctx = makeCtx(state, content);
    emergenceTick(ctx, 'p1');
    emergenceTick(ctx, 'p2');
    const deedOffers = state.offers.filter((o) => o.source === 'deed');
    expect(deedOffers).toHaveLength(1);
    expect(deedOffers[0]).toMatchObject({ player: 'p1', deed: 'test_siege', candidates: ['eg_deed_general'] });
    expect(deedOffers[0]?.reasons.eg_deed_general).toBe('You held a city through a long siege.');
    expect(state.deedsDone).toEqual(['test_siege']);
    expect(ctx.events).toContainEqual({ type: 'deedCompleted', deed: 'test_siege', figure: 'eg_deed_general', player: 'p1' });
    // Declining loses the figure; the deed never fires again.
    expect(handleFigureCommand(ctx, 'p1', { type: 'chooseOffer', offer: deedOffers[0]!.id, figure: null })).toBeNull();
    emergenceTick(ctx, 'p2');
    expect(state.offers.filter((o) => o.source === 'deed')).toHaveLength(0);
  });

  it('a deed below its trigger does nothing; deed offers do not count toward the cap', () => {
    const state = world();
    fakeStats['p1:siegeTurnsHeld:'] = 4;
    emergenceTick(makeCtx(state, content), 'p1');
    expect(state.offers).toHaveLength(0);
    fakeStats['p1:siegeTurnsHeld:'] = 5;
    state.players.p1!.gp.statesman = 500;
    state.players.p1!.gp.military = 500;
    emergenceTick(makeCtx(state, content), 'p1');
    expect(state.offers.filter((o) => o.deed === null)).toHaveLength(K.MAX_OPEN_OFFERS);
    expect(state.offers.filter((o) => o.deed !== null)).toHaveLength(1);
  });
});

describe('offers carry no numbers', () => {
  it('reasons on generated offers contain no digits', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const state = world(seed);
      state.players.p1!.affinity.mongol = 80;
      state.players.p1!.gp.statesman = 60;
      emergenceTick(makeCtx(state, content), 'p1');
      for (const o of state.offers) for (const r of Object.values(o.reasons)) expect(r).not.toMatch(/\d/);
      expect(state.offers[0]?.candidates.map(figureCulture)).toContain('mongol');
    }
  });
});

describe('deed spacing', () => {
  it('holds a met deed back until DEED_SPACING_TURNS after the player’s last deed', () => {
    const state = world();
    fakeStats['p1:siegeTurnsHeld:'] = 5;
    state.turn = 20;
    state.players.p1!.chronicle.push({ turn: 20 - K.DEED_SPACING_TURNS + 1, age: 'ancient', kind: 'deed', ref: 'earlier', text: 'x' });
    emergenceTick(makeCtx(state, content), 'p1');
    expect(state.offers.filter((o) => o.source === 'deed')).toHaveLength(0);
    expect(state.deedsDone).toEqual([]);
    state.turn = 21;
    emergenceTick(makeCtx(state, content), 'p1');
    expect(state.offers.filter((o) => o.source === 'deed')).toHaveLength(1);
  });
});
