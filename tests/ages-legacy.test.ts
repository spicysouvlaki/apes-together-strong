import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agesWorldPhase, handleAgesCommand, milestones, refinementOptions, score, updateMilestones } from '../src/sim/ages';
import { loadContent } from '../src/content';
import { nameOptions } from '../src/sim/ages/naming';
import {
  addFigure,
  eventsOf,
  fakeStats,
  fixtureContent,
  makeCtx,
  makeState,
  player,
  resetFakes,
  setWeights,
} from './helpers/ages';

vi.mock('../src/emergence', async () => await import('./helpers/ages'));
vi.mock('../src/sim/stats', async () => await import('./helpers/ages'));
vi.mock('../src/sim/units', async () => await import('./helpers/ages'));

beforeEach(resetFakes);

describe('milestones', () => {
  it('awards each tier once, adds legacy points and +3 meter, refreshes score', () => {
    const state = makeState(['p1']);
    const ctx = makeCtx(state);
    fakeStats['p1'] = { figuresRecruited: 4, culturesRefined: 9 };
    updateMilestones(ctx, 'p1');
    const p = player(state, 'p1');
    expect(p.milestones).toEqual(['anc_legacy:1', 'anc_legacy:2']); // classical row ignored
    expect(p.legacyPoints).toBe(15);
    expect(state.ageProgress).toBe(6);
    expect(eventsOf(ctx, 'milestoneReached')).toEqual([
      { type: 'milestoneReached', player: 'p1', milestone: 'anc_legacy:1', track: 'legacy' },
      { type: 'milestoneReached', player: 'p1', milestone: 'anc_legacy:2', track: 'legacy' },
    ]);
    expect(p.score).toBe(15);

    updateMilestones(ctx, 'p1');
    expect(p.milestones).toHaveLength(2);
    expect(state.ageProgress).toBe(6);

    fakeStats['p1'] = { figuresRecruited: 6, settlementCount: 3 };
    updateMilestones(ctx, 'p1');
    expect(p.milestones).toEqual(['anc_legacy:1', 'anc_legacy:2', 'anc_legacy:3', 'anc_military:1']);
    expect(p.legacyPoints).toBe(15 + 15 + 5);
    expect(state.ageProgress).toBe(12);
  });

  it('progress rows for the current age show the next threshold', () => {
    const state = makeState(['p1']);
    fakeStats['p1'] = { figuresRecruited: 3 };
    player(state, 'p1').milestones = ['anc_legacy:1'];
    const rows = milestones(state, 'p1', fixtureContent());
    expect(rows.map((r) => r.id)).toEqual(['anc_legacy', 'anc_military']);
    expect(rows[0]).toEqual({
      id: 'anc_legacy',
      track: 'legacy',
      description: 'Do 4 things',
      value: 3,
      thresholds: [2, 4, 6],
      achieved: 1,
    });
    player(state, 'p1').milestones.push('anc_legacy:2', 'anc_legacy:3');
    expect(milestones(state, 'p1', fixtureContent())[0]?.description).toBe('Do 6 things');
  });
});

describe('score', () => {
  it('follows GDD §8: figures, seated, traditions, signatures, hybrids, legacy points', () => {
    const state = makeState(['p1', 'p2']);
    addFigure(state, 'a', 'p1', { state: 'based', settlement: 's1' });
    addFigure(state, 'b', 'p1', { state: 'seated', slot: 'elder#0' });
    addFigure(state, 'c', 'p1', { state: 'retired' });
    addFigure(state, 'd', 'p1', { state: 'consumed' });
    addFigure(state, 'e', 'p2', { state: 'based', settlement: 's2' });
    const p = player(state, 'p1');
    p.traditions = ['symposium', 'olympics'];
    p.hybrids = ['silk_road'];
    p.legacyPoints = 7;
    expect(score(state, 'p1', fixtureContent())).toBe(10 + 15 + 10 + 15 + (15 + 25) + 40 + 7);
    expect(score(state, 'p2', fixtureContent())).toBe(10);
  });
});

describe('determinism', () => {
  it('a full ancient age from the same state gives identical output', () => {
    const run = () => {
      const state = makeState();
      const ctx = makeCtx(state);
      for (let i = 0; i < 120 && state.phase === 'playing'; i++) {
        state.turn++;
        agesWorldPhase(ctx);
        for (const id of state.crisis?.awaiting ?? []) {
          const stage = fixtureContent().crises[0]?.stages[(state.crisis?.stage ?? 1) - 1];
          handleAgesCommand(ctx, id, { type: 'chooseCrisisResponse', option: stage?.options[0]?.id ?? '' });
        }
      }
      return JSON.stringify({ state, events: ctx.events });
    };
    const a = run();
    expect(a).toBe(run());
    expect(a).toContain('"phase":"transition"');
  });
});

describe('smoke: real content', () => {
  it('runs an ancient age to the transition and lists refinements', () => {
    const content = loadContent();
    const state = makeState();
    const ctx = makeCtx(state, content);
    for (let i = 0; i < 200 && state.phase === 'playing'; i++) {
      state.turn++;
      agesWorldPhase(ctx);
      if (state.crisis) state.crisis.awaiting = [];
    }
    expect(state.phase).toBe('transition');
    const culture = content.cultures[0]?.id ?? 'greek';
    setWeights(state, 'p1', { [culture]: 5 });
    const opts = refinementOptions(state, 'p1', content);
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) expect(o.available || typeof o.blocked === 'string').toBe(true);
    expect(nameOptions(state, 'p1', content)).toHaveLength(3);
    for (const id of state.playerOrder) expect(handleAgesCommand(ctx, id, { type: 'finishTransition' })).toBeNull();
    expect(state.age).toBe('classical');
    expect(content.governments.find((g) => g.id === player(state, 'p1').government)?.age).toBe('classical');
  });
});
