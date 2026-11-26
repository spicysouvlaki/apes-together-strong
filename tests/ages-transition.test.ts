import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '@contracts/sim-api';
import { agesWorldPhase, handleAgesCommand } from '../src/sim/ages';
import { CATCH_UP_RP, RP_MILESTONE_CAP } from '../src/sim/ages/constants';
import { nameOptions } from '../src/sim/ages/naming';
import { transitionRp } from '../src/sim/ages/transition';
import {
  addFigure,
  eventsOf,
  fixtureContent,
  makeCtx,
  makeState,
  onAgeStarted,
  player,
  resetFakes,
  setWeights,
  syncCabinet,
} from './helpers/ages';

vi.mock('../src/emergence', async () => await import('./helpers/ages'));
vi.mock('../src/sim/stats', async () => await import('./helpers/ages'));
vi.mock('../src/sim/units', async () => await import('./helpers/ages'));

beforeEach(resetFakes);

/** Three players about to end the ancient age (scores before retiring: p1 45, p2 0, p3 50). */
const endOfAncient = (): GameState => {
  const state = makeState(['p1', 'p2', 'p3'], {
    ageProgress: 99.5,
    crisis: { id: 'collapse', stage: 3, awaiting: [] },
  });
  const p1 = player(state, 'p1');
  p1.milestones = ['anc_legacy:1', 'anc_legacy:2', 'anc_military:1', 'cls_legacy:1'];
  p1.legacyPoints = 20;
  p1.refinementPoints = 6;
  p1.crisisChoices = ['collapse_a1'];
  p1.effects = [
    { source: 'crisis:collapse_b1', untilTurn: -1, modifiers: [] },
    { source: 'burst', untilTurn: 30, modifiers: [] },
  ];
  p1.cabinet = { 'elder#0': 'fig_greek_1' };
  addFigure(state, 'fig_greek_1', 'p1', { state: 'seated', slot: 'elder#0' });
  addFigure(state, 'fig_greek_2', 'p1', { state: 'based', settlement: 's1' });
  addFigure(state, 'fig_chinese_1', 'p1', { state: 'consumed' });
  const p3 = player(state, 'p3');
  p3.traditions = ['symposium', 'agora'];
  p3.legacyPoints = 20;
  return state;
};

describe('RP formula', () => {
  it('2 per milestone (capped at 24) + 1 per retiring figure + catch-up', () => {
    expect(transitionRp(3, 2, false)).toBe(8);
    expect(transitionRp(20, 0, false)).toBe(RP_MILESTONE_CAP);
    expect(transitionRp(20, 3, true)).toBe(RP_MILESTONE_CAP + 3 + CATCH_UP_RP);
  });
});

describe('age end → transition', () => {
  it('builds each recap, retires figures and opens the transition', () => {
    const state = endOfAncient();
    const ctx = makeCtx(state);
    agesWorldPhase(ctx);
    expect(state.phase).toBe('transition');
    expect(state.crisis).toBeNull();
    expect(state.transition?.fromAge).toBe('ancient');
    expect(state.transition?.toAge).toBe('classical');
    expect(eventsOf(ctx, 'ageEnded')).toEqual([{ type: 'ageEnded', age: 'ancient' }]);
    expect(eventsOf(ctx, 'transitionStarted')).toEqual([{ type: 'transitionStarted', from: 'ancient', to: 'classical' }]);

    const r1 = state.transition?.recap['p1'];
    expect(r1).toMatchObject({
      milestones: ['anc_legacy:1', 'anc_legacy:2', 'anc_military:1'],
      legacyPointsEarned: 5 + 10 + 5,
      retiredFigures: ['fig_greek_1', 'fig_greek_2'],
      rpEarned: 3 * 2 + 2, // not below the median (45): no catch-up
      signaturesBought: 0,
      hybridsBought: 0,
      done: false,
    });
    const p1 = player(state, 'p1');
    expect(p1.refinementPoints).toBe(6 + 8);
    expect(p1.crisisChoices).toEqual([]);
    expect(p1.effects.map((e) => e.source)).toEqual(['burst']);
    expect(p1.chronicle.at(-1)?.text).toBe('The Ancient age ended.');

    expect(state.transition?.recap['p2']?.rpEarned).toBe(CATCH_UP_RP); // score 0 < median 45
    expect(state.transition?.recap['p3']?.rpEarned).toBe(0);
  });

  it('proposes names from the top cultures and the dream, with a fallback', () => {
    const state = endOfAncient();
    agesWorldPhase(makeCtx(state));
    // p1 weights: greek 2 (two figures), chinese 1 (consumed figure still counts as recruited).
    expect(state.transition?.recap['p1']?.nameOptions).toEqual([
      'the Hellenic Pax',
      'the Hellenic-Sinic Pax',
      // "Hellenic Pax" is the first name without its article: a near-duplicate, skipped (wave 11).
      'the Sinic Pax',
    ]);
    expect(state.transition?.recap['p2']?.nameOptions).toEqual(['the Pax', 'the Pax of Leader A', 'the First Pax']);
  });

  it('uses the latest hybrid in a name', () => {
    const state = makeState(['p1']);
    setWeights(state, 'p1', { chinese: 4 });
    player(state, 'p1').hybrids = ['silk_road'];
    expect(nameOptions(state, 'p1', fixtureContent())).toEqual([
      'the Sinic Pax',
      'the Pax of Silk Road',
      'the Pax',
    ]);
  });

  it('skips eliminated players', () => {
    const state = endOfAncient();
    player(state, 'p2').alive = false;
    agesWorldPhase(makeCtx(state));
    expect(Object.keys(state.transition?.recap ?? {})).toEqual(['p1', 'p3']);
  });
});

describe('naming', () => {
  it('validates and trims, only during the transition', () => {
    const state = endOfAncient();
    const ctx = makeCtx(state);
    expect(handleAgesCommand(ctx, 'p1', { type: 'nameCiv', name: 'Rome' })).toMatch(/transition/);
    agesWorldPhase(ctx);
    expect(handleAgesCommand(ctx, 'p1', { type: 'nameCiv', name: '   ' })).toMatch(/1–40/);
    expect(handleAgesCommand(ctx, 'p1', { type: 'nameCiv', name: 'x'.repeat(41) })).toMatch(/1–40/);
    expect(handleAgesCommand(ctx, 'p1', { type: 'nameCiv', name: `  ${'y'.repeat(40)}  ` })).toBeNull();
    expect(handleAgesCommand(ctx, 'p1', { type: 'nameCiv', name: '  The Middle Sea  ' })).toBeNull();
    expect(player(state, 'p1').civName).toBe('The Middle Sea');
    expect(eventsOf(ctx, 'civNamed').at(-1)).toEqual({ type: 'civNamed', player: 'p1', name: 'The Middle Sea' });
    expect(player(state, 'p1').chronicle.at(-1)?.kind).toBe('name');
  });
});

describe('finishTransition', () => {
  it('auto-names, auto-picks a government of the new age, and waits for everyone', () => {
    const state = endOfAncient();
    const ctx = makeCtx(state);
    agesWorldPhase(ctx);
    expect(handleAgesCommand(ctx, 'p1', { type: 'finishTransition' })).toBeNull();
    const p1 = player(state, 'p1');
    expect(p1.civName).toBe('the Hellenic Pax');
    expect(p1.government).toBe('monarchy');
    expect(syncCabinet).toHaveBeenCalledWith(ctx, 'p1');
    expect(state.phase).toBe('transition');
    expect(handleAgesCommand(ctx, 'p1', { type: 'finishTransition' })).toBe('You have already finished this transition.');
    expect(handleAgesCommand(ctx, 'p1', { type: 'nameCiv', name: 'Late' })).toBe('You have already finished this transition.');
  });

  it('keeps a chosen name and a government of the new age', () => {
    const state = endOfAncient();
    const ctx = makeCtx(state);
    agesWorldPhase(ctx);
    player(state, 'p2').government = 'republic';
    handleAgesCommand(ctx, 'p2', { type: 'nameCiv', name: 'Mine' });
    handleAgesCommand(ctx, 'p2', { type: 'finishTransition' });
    expect(player(state, 'p2').civName).toBe('Mine');
    expect(player(state, 'p2').government).toBe('republic');
    expect(syncCabinet).not.toHaveBeenCalled();
  });

  it('starts the next age when the last living player finishes', () => {
    const state = endOfAncient();
    state.currentPlayer = 'p3';
    player(state, 'p1').alive = false;
    const ctx = makeCtx(state);
    agesWorldPhase(ctx);
    player(state, 'p3').refinementPoints = 7; // unspent at the end of refinement
    handleAgesCommand(ctx, 'p3', { type: 'finishTransition' });
    expect(state.age).toBe('ancient');
    expect(handleAgesCommand(ctx, 'p2', { type: 'finishTransition' })).toBeNull();
    expect(state.phase).toBe('playing');
    expect(state.age).toBe('classical');
    expect(state.ageProgress).toBe(0);
    expect(state.transition).toBeNull();
    expect(state.currentPlayer).toBe('p2');
    const p3 = player(state, 'p3');
    expect(p3.research).toEqual({ tech: { current: null, progress: 0 }, civic: { current: null, progress: 0 } });
    expect(p3.stats.battlesWonThisAge).toBe(0);
    expect(p3.refinementPoints).toBe(3); // 50% of unspent carries
    expect(onAgeStarted).toHaveBeenCalledTimes(2);
    expect(eventsOf(ctx, 'ageStarted')).toEqual([{ type: 'ageStarted', age: 'classical' }]);
    expect(p3.chronicle.at(-1)?.text).toBe('The Classical age began.');
    expect(handleAgesCommand(ctx, 'p1', { type: 'finishTransition' })).toMatch(/eliminated/);
  });

  it('rejects outside a transition', () => {
    expect(handleAgesCommand(makeCtx(makeState()), 'p1', { type: 'finishTransition' })).toBe('There is no age transition under way.');
  });
});

describe('game end', () => {
  it('in the final age, the highest score wins; ties go to the earlier player', () => {
    const state = makeState(['p1', 'p2', 'p3', 'p4'], { age: 'classical', ageProgress: 99.5 });
    player(state, 'p1').legacyPoints = 30;
    player(state, 'p2').legacyPoints = 50;
    player(state, 'p3').legacyPoints = 50;
    player(state, 'p4').legacyPoints = 999;
    player(state, 'p4').alive = false;
    player(state, 'p2').civName = 'the Sinic Pax';
    const ctx = makeCtx(state);
    agesWorldPhase(ctx);
    expect(state.phase).toBe('ended');
    expect(state.transition).toBeNull();
    expect(state.result).toEqual({
      winner: 'p2',
      scores: { p1: 30, p2: 50, p3: 50, p4: 999 },
      reason: 'Highest legacy score when the Classical age ended',
    });
    expect(eventsOf(ctx, 'ageEnded')).toEqual([{ type: 'ageEnded', age: 'classical' }]);
    expect(eventsOf(ctx, 'gameEnded')).toEqual([{ type: 'gameEnded', winner: 'p2' }]);
    expect(player(state, 'p2').chronicle.at(-1)?.text).toContain('The Sinic Pax finished with a legacy score of 50');
    for (const id of ['p1', 'p2', 'p3', 'p4']) expect(player(state, id).chronicle).toHaveLength(1);
    agesWorldPhase(ctx);
    expect(eventsOf(ctx, 'gameEnded')).toHaveLength(1);
  });
});
