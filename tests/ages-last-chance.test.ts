/**
 * Last chance (end-game tension): in the final age, once the meter reaches LAST_CHANCE_METER,
 * milestone tiers are worth LAST_CHANCE_LEGACY_MULT times their legacy points, and everyone
 * is told once when that stretch begins.
 */
import { describe, expect, it } from 'vitest';
import { LAST_CHANCE_LEGACY_MULT, LAST_CHANCE_METER, LAST_CHANCE_TEXT, LEGACY_POINTS_PER_TIER } from '../src/sim/ages/constants';
import { addAgeProgress } from '../src/sim/ages/meter';
import { isLastChance, updateMilestones } from '../src/sim/ages/milestones';
import { addSettlement, at, ctxOf, fixtureContent, fixtureState } from './helpers/fixture';

const content = {
  ...fixtureContent(),
  legacy: [{ id: 'towns', track: 'military' as const, age: 'classical' as const, measure: 'settlementCount' as const, thresholds: [1, 2, 3] as [number, number, number], description: 'Hold {n}' }],
};

const world = (progress: number) => {
  const state = fixtureState();
  state.age = 'classical';
  state.finalAge = 'classical';
  state.ageProgress = progress;
  addSettlement(state, 'p1', at(2, 2));
  return state;
};

describe('last chance', () => {
  it('multiplies milestone legacy points only in the final age’s closing stretch', () => {
    const early = world(LAST_CHANCE_METER - 5);
    updateMilestones(ctxOf(early, content), 'p1');
    expect(early.players.p1!.legacyPoints).toBe(LEGACY_POINTS_PER_TIER[0]);
    const late = world(LAST_CHANCE_METER);
    expect(isLastChance(late)).toBe(true);
    updateMilestones(ctxOf(late, content), 'p1');
    expect(late.players.p1!.legacyPoints).toBe(Math.round(LEGACY_POINTS_PER_TIER[0] * LAST_CHANCE_LEGACY_MULT));
    const notFinal = world(LAST_CHANCE_METER);
    notFinal.finalAge = 'exploration';
    expect(isLastChance(notFinal)).toBe(false);
  });

  it('announces the closing stretch once, to everyone', () => {
    const state = world(LAST_CHANCE_METER - 1);
    const ctx = ctxOf(state, content);
    addAgeProgress(ctx, 2);
    addAgeProgress(ctx, 2);
    expect(ctx.events.filter((e) => e.type === 'notice')).toEqual([{ type: 'notice', player: null, text: LAST_CHANCE_TEXT }]);
    expect(LAST_CHANCE_TEXT).not.toMatch(/\d/);
  });
});
