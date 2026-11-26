/**
 * Emergence changes from the wave 13 playtest: one offer's candidates cite distinct signals
 * (or the very same words), wonders and temples have their own phrasings, offers are spaced,
 * and a culture that pairs into a hybrid with the court's lean is offered alongside.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import * as K from '../src/emergence/constants';
import { hybridPartners, offerReason } from '../src/emergence/offers';
import { REASON_FAMILY, REASON_TEMPLATES } from '../src/emergence/reasons';
import { addSettlement, at, makeState, resetFakes, testContent } from './helpers/emergence';

vi.mock('../src/sim/units', () => import('./helpers/emergence'));
vi.mock('../src/sim/stats', () => import('./helpers/emergence'));
vi.mock('../src/sim/ages', () => import('./helpers/emergence'));

const real = loadContent();
const content = testContent(real);

beforeEach(resetFakes);

const world = (): GameState => {
  const state = makeState(content);
  addSettlement(state, 'p1', at(3, 3), { id: 'cap1' });
  state.players.p1!.affinity.spanish = 60;
  state.players.p1!.affinity.mongol = 40;
  return state;
};

describe('offer reasons (wave 13)', () => {
  it('a second candidate cites another signal when its culture has one', () => {
    const state = world();
    const used = new Map<string, string>();
    const contrib = { spanish: { owned_plains: 8.5, owned_mountain: 3 }, mongol: { owned_plains: 4, owned_steppe: 11.52 } };
    // Mongol's strongest is steppe here; force the clash with plains first for Spanish.
    contrib.mongol.owned_steppe = 2;
    const a = offerReason(state, 'p1', 'spanish', contrib, content, 'f1', used);
    const b = offerReason(state, 'p1', 'mongol', contrib, content, 'f2', used);
    expect(a).toContain('your wide plains');
    expect(b).not.toContain('plains');
    expect(b).toContain('grassland');
  });

  it('with no other signal, the same reason is repeated word for word (not rephrased)', () => {
    const state = world();
    const used = new Map<string, string>();
    const contrib = { spanish: { owned_plains: 8.5 }, mongol: { owned_plains: 4 } };
    const a = offerReason(state, 'p1', 'spanish', contrib, content, 'figure_one', used);
    const b = offerReason(state, 'p1', 'mongol', contrib, content, 'figure_two_other', used);
    expect(b).toBe(a);
  });

  it('wonders and faith no longer read as "eager to learn from your monument"', () => {
    expect(REASON_FAMILY.wondersBuilt).toBe('works');
    expect(REASON_FAMILY.faithIncome).toBe('faith');
    for (const t of [...REASON_TEMPLATES.works, ...REASON_TEMPLATES.faith]) expect(t).not.toMatch(/learn from|^come\b/);
    expect(content.signals.find((s) => s.measure === 'wondersBuilt')?.hint).toBe('your wonders');
  });
});

describe('offer pacing and hybrids (wave 13)', () => {
  it('offers are spaced further apart than before', () => {
    expect(K.OFFER_MIN_GAP_TURNS).toBeGreaterThanOrEqual(6);
    expect(K.OFFER_DROUGHT_TURNS).toBeGreaterThan(K.OFFER_MIN_GAP_TURNS);
  });

  it('a culture held at weight 2 makes its hybrid partners wanted', () => {
    const state = world();
    const hybrid = content.hybrids.find((h) => h.age === 'classical');
    if (!hybrid) return;
    const [a, b] = hybrid.cultures as [string, string];
    expect(hybridPartners(state, 'p1', content)[b]).toBeUndefined();
    // Weight from real figures of culture `a` (culture weight reads the full roster).
    const full = { ...content, figures: real.figures };
    const figs = real.figures.filter((f) => f.culture === a).slice(0, K.HYBRID_NUDGE_MIN_WEIGHT);
    expect(figs).toHaveLength(K.HYBRID_NUDGE_MIN_WEIGHT);
    for (const f of figs) {
      state.figures[f.id] = { id: f.id, owner: 'p1', recruitedTurn: 1, recruitedAge: 'ancient', reason: '', activated: false, location: { state: 'based', settlement: 'cap1' } };
    }
    expect(hybridPartners(state, 'p1', full)[b]).toBe(true);
  });
});
