/**
 * Fun-audit rules of the emergence engine: dormant cultures (hints promise arrival, affinity
 * is banked, the promise is paid off by an age-opening offer), deed timing after transitions,
 * offer pacing (drought / flood), varied offer reasons and unseatable figures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameState } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { emergenceTick } from '../src/emergence';
import { hintText, updateAffinity } from '../src/emergence/affinity';
import * as K from '../src/emergence/constants';
import { onAgeStarted } from '../src/emergence/lifecycle';
import {
  ageStartTurn,
  checkDeeds,
  createPointsOffers,
  figureUsable,
  offerReason,
  promisedCulture,
} from '../src/emergence/offers';
import { REASON_TEMPLATES } from '../src/emergence/reasons';
import { isDormantCulture } from '../src/emergence/util';
import { addSettlement, at, fakeStats, makeCtx, makeState, resetFakes } from './helpers/emergence';

vi.mock('../src/sim/units', () => import('./helpers/emergence'));
vi.mock('../src/sim/stats', () => import('./helpers/emergence'));
vi.mock('../src/sim/ages', () => import('./helpers/emergence'));

const content: ContentBundle = loadContent();
const culture = (id: string) => content.cultures.find((c) => c.id === id)!;
// A culture with no figures before the classical age (per the content guidelines), and one present in both ages.
const dormant = content.cultures.find((c) => isDormantCulture(content, c.id, 'ancient'))!.id;
const present = content.cultures.find((c) => !isDormantCulture(content, c.id, 'ancient') && content.figures.some((f) => f.culture === c.id && f.age === 'ancient'))!.id;

const world = (age: GameState['age'] = 'ancient'): GameState => {
  const state = makeState(content, { age });
  addSettlement(state, 'p1', at(3, 3), { id: 'cap1' });
  addSettlement(state, 'p2', at(12, 12), { id: 'cap2' });
  return state;
};

beforeEach(resetFakes);

describe('dormant cultures (no figures this age, some later)', () => {
  it('are detected from content, by age', () => {
    expect(isDormantCulture(content, dormant, 'ancient')).toBe(true);
    expect(isDormantCulture(content, dormant, 'classical')).toBe(false);
    expect(isDormantCulture(content, present, 'ancient')).toBe(false);
  });

  it('decay at AFFINITY_DECAY_DORMANT instead of AFFINITY_DECAY, so their affinity is banked', () => {
    const state = world();
    const p = state.players.p1!;
    p.affinity[dormant] = 100;
    p.affinity[present] = 100;
    updateAffinity(makeCtx(state, content), 'p1', {});
    expect(p.affinity[dormant]).toBeCloseTo(100 * K.AFFINITY_DECAY_DORMANT, 10);
    expect(p.affinity[present]).toBeCloseTo(100 * K.AFFINITY_DECAY, 10);
    expect(K.AFFINITY_DECAY_DORMANT).toBeGreaterThan(K.AFFINITY_DECAY);
  });

  it('hints for a dormant culture promise arrival, not presence, and carry no numbers', () => {
    const c = culture(dormant);
    const weak = hintText(c, 'your life on the ice', K.HINT_THRESHOLDS[0], true);
    const strong = hintText(c, 'your life on the ice', K.HINT_THRESHOLDS[1], true);
    expect(weak).toBe(`Word of your life on the ice travels far; one day ${c.adjective} peoples will come to find you.`);
    expect(strong).toContain('when a new age dawns, they will come');
    expect(hintText(c, 'your herds', K.HINT_THRESHOLDS[0], false)).toBe(`${c.adjective} peoples speak of your herds.`);
    for (const t of [weak, strong]) expect(t).not.toMatch(/\d/);
  });

  it('the engine fires the arrival hint for a dormant culture crossing a threshold', () => {
    const state = world();
    const ctx = makeCtx(state, content);
    state.players.p1!.affinity[dormant] = K.HINT_THRESHOLDS[0] + 5;
    updateAffinity(ctx, 'p1', {});
    const hint = ctx.events.find((e) => e.type === 'cultureHint' && e.culture === dormant);
    expect(hint && hint.type === 'cultureHint' && hint.text).toContain('one day');
  });
});

describe('age-opening offer (the promise kept)', () => {
  const classical = (): GameState => {
    const state = world('classical');
    state.turn = 50;
    for (const id of ['p1', 'p2']) state.players[id]!.chronicle.push({ turn: 50, age: 'classical', kind: 'age', ref: 'classical', text: 'The Classical age began.' });
    return state;
  };

  it('offers up to three figures of the promised culture, with a reason recalling the hint', () => {
    const state = classical();
    const p = state.players.p1!;
    p.affinity[dormant] = 120;
    p.affinity[present] = 90;
    p.hintsShown[dormant] = 100;
    expect(promisedCulture(state, 'p1', content)).toBe(dormant);
    const ctx = makeCtx(state, content);
    onAgeStarted(ctx, 'p1');
    const offer = state.offers.find((o) => o.player === 'p1');
    expect(offer).toBeDefined();
    expect(offer!.candidates.length).toBeGreaterThan(0);
    expect(offer!.candidates.length).toBeLessThanOrEqual(K.AGE_OPENING_CANDIDATES);
    for (const id of offer!.candidates) {
      const f = content.figures.find((x) => x.id === id)!;
      expect(f.culture).toBe(dormant);
      expect(f.age).toBe('classical');
      expect(offer!.reasons[id]).toMatch(/^arriving at last, drawn by the old tales of /);
      expect(offer!.reasons[id]).not.toMatch(/\d/);
    }
  });

  it('needs a shown hint and a top affinity; cultures present in the previous age never qualify', () => {
    const state = classical();
    const p = state.players.p1!;
    p.affinity[dormant] = 120;
    expect(promisedCulture(state, 'p1', content)).toBeNull(); // no hint was shown
    p.hintsShown[dormant] = 50;
    p.affinity[present] = 300;
    for (const c of content.cultures) if (c.id !== dormant && c.id !== present) p.affinity[c.id] = 200;
    expect(promisedCulture(state, 'p1', content)).toBeNull(); // not in the top two
    p.hintsShown[present] = 100;
    for (const c of content.cultures) if (c.id !== dormant) p.affinity[c.id] = 0;
    expect(promisedCulture(state, 'p1', content)).toBe(dormant);
    expect(promisedCulture(world('ancient'), 'p1', content)).toBeNull(); // the first age has no previous one
  });
});

describe('deeds after a transition', () => {
  it('measures that only change at a transition wait DEED_TRANSITION_MEASURE_DELAY turns into the age', () => {
    const deed = content.deeds.find((d) => K.TRANSITION_ONLY_MEASURES.includes(d.trigger.measure))!;
    const fig = content.figures.find((f) => f.deed === deed.id)!;
    const state = world(fig.age);
    state.turn = 60;
    state.players.p1!.chronicle.push({ turn: 60, age: fig.age, kind: 'age', ref: fig.age, text: 'began' });
    expect(ageStartTurn(state, 'p1')).toBe(60);
    fakeStats[`p1:${deed.trigger.measure}:${deed.trigger.param ?? ''}`] = deed.trigger.count;
    for (let t = 60; t < 60 + K.DEED_TRANSITION_MEASURE_DELAY; t++) {
      state.turn = t;
      checkDeeds(makeCtx(state, content), 'p1');
      expect(state.deedsDone).not.toContain(deed.id);
    }
    state.turn = 60 + K.DEED_TRANSITION_MEASURE_DELAY;
    checkDeeds(makeCtx(state, content), 'p1');
    expect(state.deedsDone).toContain(deed.id);
  });
});

describe('offer pacing', () => {
  it('a drought offer comes from the fullest pool once it is OFFER_DROUGHT_MIN_FILL full', () => {
    const state = world();
    const p = state.players.p1!;
    // Not the first offer (thresholds have grown once), and no recruit for a long time.
    p.gpThreshold.thought = 84;
    p.gp.thought = 84 * (K.OFFER_DROUGHT_MIN_FILL - 0.05);
    state.turn = K.FIRST_OFFER_TURN + K.OFFER_DROUGHT_TURNS + 1;
    createPointsOffers(makeCtx(state, content), 'p1', {});
    expect(state.offers).toHaveLength(0);
    p.gp.thought = 84 * (K.OFFER_DROUGHT_MIN_FILL + 0.05);
    createPointsOffers(makeCtx(state, content), 'p1', {});
    expect(state.offers.map((o) => o.source)).toEqual(['thought']);
  });

  it('no points offer within OFFER_MIN_GAP_TURNS of a recruit, and at most one per turn', () => {
    const state = world();
    const p = state.players.p1!;
    p.gpThreshold.military = 84;
    p.gp.military = 500;
    p.gp.statesman = 500;
    state.turn = 30;
    const recruit = content.figures.find((f) => f.age === 'ancient' && !f.deed && f.kind === 'builder')!;
    state.figures[recruit.id] = { id: recruit.id, owner: 'p1', recruitedTurn: 29, recruitedAge: 'ancient', reason: '', activated: false, location: { state: 'based', settlement: 'cap1' } };
    createPointsOffers(makeCtx(state, content), 'p1', {});
    expect(state.offers).toHaveLength(0);
    state.turn = 29 + K.OFFER_MIN_GAP_TURNS;
    createPointsOffers(makeCtx(state, content), 'p1', {});
    expect(state.offers).toHaveLength(1);
  });

  it('a full emergence tick still produces the scripted first offer on FIRST_OFFER_TURN', () => {
    const state = world();
    state.turn = K.FIRST_OFFER_TURN;
    state.players.p1!.gp.faith = 10;
    emergenceTick(makeCtx(state, content), 'p1');
    expect(state.offers.filter((o) => o.player === 'p1')).toHaveLength(1);
  });
});

describe('offer reasons and usefulness', () => {
  it('reasons vary by template family, stay deterministic, and never contain numbers', () => {
    const state = world();
    state.players.p1!.affinity[present] = 60;
    const signal = content.signals.find((s) => (s.weights[present] ?? 0) > 0 && s.measure === 'ownedTerrain')!;
    const contributions = { [present]: { [signal.id]: 10 } };
    const seen = new Set<string>();
    for (const f of content.figures.filter((x) => x.culture === present)) {
      const r = offerReason(state, 'p1', present, contributions, content, f.id);
      expect(r).toBe(offerReason(state, 'p1', present, contributions, content, f.id));
      expect(r).toContain(signal.hint);
      expect(r).not.toMatch(/\d/);
      seen.add(r);
    }
    expect(seen.size).toBeGreaterThan(1);
    for (const r of seen) expect(REASON_TEMPLATES.land.some((t) => r === t.replace('{h}', signal.hint))).toBe(true);
    // Without a figure id the plain classic form is kept.
    expect(offerReason(state, 'p1', present, contributions, content)).toBe(`drawn by ${signal.hint}`);
  });

  it('a close second signal of the same family is named too', () => {
    const state = world();
    state.players.p1!.affinity[present] = 60;
    const land = content.signals.filter((s) => (s.weights[present] ?? 0) > 0 && s.measure === 'ownedTerrain');
    if (land.length < 2) return;
    const [a, b] = land as [typeof land[0], typeof land[0]];
    const r = offerReason(state, 'p1', present, { [present]: { [a.id]: 10, [b.id]: 9 } }, content, 'x');
    expect(r).toContain(`${a.hint} and ${b.hint}`);
  });

  it('a cabinet-only figure is unusable when no seat of the government accepts its kind', () => {
    const state = world();
    const statesman = content.figures.find((f) => f.kind === 'statesman' && f.uses.length === 1 && f.uses[0] === 'cabinet')!;
    const general = content.figures.find((f) => f.kind === 'general')!;
    state.players.p1!.cabinet = { 'warleader#0': null, 'warleader#1': null };
    expect(figureUsable(state, 'p1', statesman, content)).toBe(false);
    expect(figureUsable(state, 'p1', general, content)).toBe(true);
    state.players.p1!.cabinet = { 'elder#0': null };
    expect(figureUsable(state, 'p1', statesman, content)).toBe(true);
  });
});
