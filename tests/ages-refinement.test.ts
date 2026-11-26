import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState, PlayerId } from '@contracts/sim-api';
import { handleAgesCommand, refinementOptions } from '../src/sim/ages';
import { heaviestCulture } from '../src/sim/ages/refinement';
import { eventsOf, fixtureContent, makeCtx, makeState, player, resetFakes, setWeights } from './helpers/ages';

vi.mock('../src/emergence', async () => await import('./helpers/ages'));
vi.mock('../src/sim/stats', async () => await import('./helpers/ages'));
vi.mock('../src/sim/units', async () => await import('./helpers/ages'));

beforeEach(resetFakes);

/** A state in the ancient → classical transition with `rp` points for p1. */
const inTransition = (rp = 50, ids: PlayerId[] = ['p1', 'p2']): GameState => {
  const state = makeState(ids, { phase: 'transition' });
  const recap: NonNullable<GameState['transition']>['recap'] = {};
  for (const id of ids) {
    recap[id] = {
      legacyPointsEarned: 0,
      rpEarned: 0,
      milestones: [],
      retiredFigures: [],
      nameOptions: ['the Hellenic Pax', 'b', 'c'],
      signaturesBought: 0,
      hybridsBought: 0,
      done: false,
    };
  }
  state.transition = { fromAge: 'ancient', toAge: 'classical', recap };
  player(state, 'p1').refinementPoints = rp;
  return state;
};

const option = (state: GameState, id: string, p: PlayerId = 'p1') =>
  refinementOptions(state, p, fixtureContent()).find((o) => o.id === id);

const adopt = (state: GameState, tradition: string, p: PlayerId = 'p1') =>
  handleAgesCommand(makeCtx(state), p, { type: 'adoptTradition', tradition });

describe('traditions', () => {
  it('adopts a custom with weight 1, pays RP, emits and chronicles the history note', () => {
    const state = inTransition(10);
    setWeights(state, 'p1', { greek: 1, chinese: 2 });
    const ctx = makeCtx(state);
    expect(handleAgesCommand(ctx, 'p1', { type: 'adoptTradition', tradition: 'symposium' })).toBeNull();
    const p = player(state, 'p1');
    expect(p.traditions).toEqual(['symposium']);
    expect(p.refinementPoints).toBe(7);
    expect(eventsOf(ctx, 'traditionAdopted')).toEqual([{ type: 'traditionAdopted', player: 'p1', tradition: 'symposium' }]);
    expect(p.chronicle.at(-1)).toMatchObject({ kind: 'tradition', ref: 'symposium', text: 'symposium: symposium note' });
  });

  it('enforces tier weights 1 / 3 / 5', () => {
    const state = inTransition();
    setWeights(state, 'p1', { greek: 0.9, chinese: 6 });
    expect(option(state, 'symposium')?.blocked).toBe('Needs weight 1 in Greek');
    setWeights(state, 'p1', { greek: 2.9, chinese: 6 });
    player(state, 'p1').traditions = ['symposium'];
    expect(option(state, 'agora')?.blocked).toBe('Needs weight 3 in Greek');
    setWeights(state, 'p1', { greek: 4, chinese: 6 });
    player(state, 'p1').traditions = ['symposium', 'agora'];
    expect(option(state, 'academy')?.blocked).toBe('Needs weight 5 in Greek');
    setWeights(state, 'p1', { greek: 5, chinese: 6 });
    expect(option(state, 'academy')?.blocked).toBeNull();
  });

  it('enforces `requires`', () => {
    const state = inTransition();
    setWeights(state, 'p1', { greek: 5 });
    expect(option(state, 'agora')?.blocked).toBe('Needs symposium');
    expect(adopt(state, 'agora')).toBe('Needs symposium');
    expect(adopt(state, 'symposium')).toBeNull();
    expect(adopt(state, 'agora')).toBeNull();
  });

  it('allows one new signature per transition', () => {
    const state = inTransition(100);
    setWeights(state, 'p1', { greek: 5 });
    player(state, 'p1').traditions = ['symposium', 'agora'];
    expect(adopt(state, 'olympics')).toBeNull();
    expect(state.transition?.recap['p1']?.signaturesBought).toBe(1);
    expect(option(state, 'academy')?.blocked).toBe('One new signature per transition');
    expect(adopt(state, 'academy')).toBe('One new signature per transition');
  });

  it('gates by age: up to the age being entered, listed only when not later', () => {
    const state = inTransition();
    setWeights(state, 'p1', { chinese: 1 });
    expect(option(state, 'tea')?.blocked).toBeNull(); // classical, entering classical
    expect(option(state, 'printing')).toBeUndefined(); // exploration: not listed
    expect(adopt(state, 'printing')).toBe('Available from the Exploration age');
    // Outside a transition the current age bounds the list.
    const playing = makeState();
    expect(refinementOptions(playing, 'p1', fixtureContent()).map((o) => o.id)).toEqual([
      'symposium',
      'agora',
      'olympics',
    ]);
  });

  it('gives the heaviest culture 30% off and applies tradition cost modifiers', () => {
    const state = inTransition();
    setWeights(state, 'p1', { greek: 6, chinese: 2 });
    player(state, 'p1').traditions = ['symposium', 'agora'];
    expect(option(state, 'academy')?.cost).toBe(7); // 10 × 0.7
    expect(option(state, 'tea')?.cost).toBe(3);
    player(state, 'p1').effects.push({
      source: 'test',
      untilTurn: -1,
      modifiers: [{ scope: 'empire', effect: { kind: 'cost', target: 'tradition', percent: -20 } }],
    });
    expect(option(state, 'academy')?.cost).toBe(5); // 10 × (1 − 0.3 − 0.2)
    expect(option(state, 'tea')?.cost).toBe(2); // 3 × 0.8 = 2.4
  });

  it('heaviest culture ties go to content order; none without weight', () => {
    const c = fixtureContent();
    expect(heaviestCulture({ chinese: 3, greek: 3 }, c)).toBe('greek');
    expect(heaviestCulture({}, c)).toBeNull();
  });

  it('blocks without enough points, already owned, outside the transition and after finishing', () => {
    const state = inTransition(2);
    setWeights(state, 'p1', { greek: 1, chinese: 2 }); // greek not heaviest: full cost 3
    expect(adopt(state, 'symposium')).toBe('Needs 3 points (you have 2)');
    player(state, 'p1').refinementPoints = 3;
    expect(adopt(state, 'symposium')).toBeNull();
    expect(adopt(state, 'symposium')).toBe('Already adopted');
    player(state, 'p1').refinementPoints = 30;
    state.transition!.recap['p1']!.done = true;
    expect(option(state, 'olympics')?.blocked).toBe('Needs weight 5 in Greek');
    setWeights(state, 'p1', { greek: 5 });
    player(state, 'p1').traditions.push('agora');
    expect(option(state, 'olympics')?.blocked).toBe('Refinement finished');
    const playing = makeState();
    setWeights(playing, 'p1', { greek: 1 });
    player(playing, 'p1').refinementPoints = 30;
    expect(refinementOptions(playing, 'p1', fixtureContent())[0]).toMatchObject({
      id: 'symposium',
      available: false,
      blocked: 'Refine at the next age transition',
    });
    expect(adopt(playing, 'symposium')).toBe('Refine at the next age transition');
  });

  it('rejects unknown ids', () => {
    expect(adopt(inTransition(), 'nope')).toBe('That tradition does not exist.');
  });
});

describe('hybrids', () => {
  const adoptH = (state: GameState, hybrid: string) =>
    handleAgesCommand(makeCtx(state), 'p1', { type: 'adoptHybrid', hybrid });

  it('needs minWeight in BOTH cultures', () => {
    const state = inTransition();
    setWeights(state, 'p1', { greek: 5, chinese: 2 });
    expect(option(state, 'silk_road')?.blocked).toBe('Needs weight 3 in Chinese');
    setWeights(state, 'p1', { greek: 2, chinese: 5 });
    expect(option(state, 'silk_road')?.blocked).toBe('Needs weight 3 in Greek');
    setWeights(state, 'p1', { greek: 3, chinese: 3 });
    expect(option(state, 'silk_road')?.blocked).toBeNull();
  });

  it('adopts, discounts if either culture is heaviest, max one per transition', () => {
    const state = inTransition(20);
    setWeights(state, 'p1', { greek: 3, chinese: 4, mongol: 3 });
    expect(option(state, 'silk_road')?.cost).toBe(6); // 8 × 0.7 = 5.6
    const ctx = makeCtx(state);
    expect(handleAgesCommand(ctx, 'p1', { type: 'adoptHybrid', hybrid: 'silk_road' })).toBeNull();
    const p = player(state, 'p1');
    expect(p.hybrids).toEqual(['silk_road']);
    expect(p.refinementPoints).toBe(14);
    expect(eventsOf(ctx, 'hybridAdopted')).toHaveLength(1);
    expect(p.chronicle.at(-1)).toMatchObject({ kind: 'hybrid', text: 'Silk Road: silk_road note' });
    expect(adoptH(state, 'steppe_court')).toBe('One new hybrid per transition');
    expect(option(state, 'silk_road')).toBeUndefined();
  });

  it('is age-gated', () => {
    const state = inTransition();
    setWeights(state, 'p1', { greek: 9, mongol: 9 });
    expect(option(state, 'far_future')).toBeUndefined();
    expect(adoptH(state, 'far_future')).toBe('Available from the Exploration age');
  });
});

describe('cost escalation within one transition', () => {
  it('each adoption raises every remaining cost by REFINEMENT_ESCALATION', async () => {
    const { REFINEMENT_ESCALATION } = await import('../src/sim/ages/constants');
    const state = inTransition(50);
    setWeights(state, 'p1', { greek: 1, chinese: 2 });
    const before = refinementOptions(state, 'p1', fixtureContent());
    expect(adopt(state, 'symposium')).toBeNull();
    const after = refinementOptions(state, 'p1', fixtureContent());
    expect(after.length).toBeGreaterThan(0);
    for (const o of after) {
      const was = before.find((b) => b.id === o.id);
      expect(o.cost).toBe((was?.cost ?? 0) + REFINEMENT_ESCALATION);
    }
  });

  it('does not escalate from adoptions made in an earlier transition', () => {
    const state = inTransition(50);
    setWeights(state, 'p1', { greek: 1, chinese: 2 });
    const p = player(state, 'p1');
    const base = option(state, 'symposium')?.cost;
    p.chronicle.push({ turn: state.turn - 30, age: 'ancient', kind: 'tradition', ref: 'old', text: 'x' });
    expect(option(state, 'symposium')?.cost).toBe(base);
  });
});
