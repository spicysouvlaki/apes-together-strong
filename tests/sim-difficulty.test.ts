/**
 * Difficulty (GDD §9: "yield bonuses and depth, never hidden information"): synthetic
 * modifiers in `playerModifiers`, so the one modifier engine applies them. 'normal' adds none.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { createGame } from '../src/sim';
import {
  DIFFICULTY_HUMAN_SETTLEMENT_HAPPINESS,
  DIFFICULTY_RIVAL_COST_PERCENT,
  DIFFICULTY_RIVAL_YIELD_PERCENT,
} from '../src/sim/constants';
import { difficultyModifiers, playerModifiers } from '../src/sim/modifiers';
import { itemCost } from '../src/sim/settlements';
import { computeEmpire, settlementYields } from '../src/sim/yields';
import { addSettlement, at, fixtureContent, fixtureState, setTile } from './helpers/fixture';

const content = fixtureContent();

/** p1 human, p2 AI, each with a city on varied land. */
const world = (difficulty: GameState['difficulty']): GameState => {
  const state = fixtureState({ width: 20, height: 10 });
  state.difficulty = difficulty;
  for (const [col, row] of [[3, 3], [13, 3]] as const) {
    setTile(state, at(col + 1, row), { terrain: 'plains' });
    setTile(state, at(col, row + 1), { feature: 'forest' });
  }
  addSettlement(state, 'p1', at(3, 3), { population: 3 });
  addSettlement(state, 'p2', at(13, 3), { population: 3 });
  return state;
};
const cityOf = (state: GameState, owner: string) => Object.values(state.settlements).find((s) => s.owner === owner)!;

describe('difficulty', () => {
  it("'normal' adds no modifiers at all (today's game, unchanged)", () => {
    expect(difficultyModifiers('normal', false)).toEqual([]);
    expect(difficultyModifiers('normal', true)).toEqual([]);
    const normal = world('normal');
    expect(playerModifiers(normal, 'p2', content)).toEqual(playerModifiers({ ...normal, difficulty: 'normal' }, 'p2', content));
    expect(DIFFICULTY_RIVAL_YIELD_PERCENT.normal).toBe(0);
    expect(DIFFICULTY_RIVAL_COST_PERCENT.normal).toBe(0);
    expect(DIFFICULTY_HUMAN_SETTLEMENT_HAPPINESS.normal).toBe(0);
  });

  it("'easy': rivals lose a share of food, production, gold, science, culture; human settlements +1 happiness", () => {
    const k = 1 + DIFFICULTY_RIVAL_YIELD_PERCENT.easy / 100;
    expect(k).toBeLessThan(1);
    const normal = world('normal');
    const easy = world('easy');
    const rN = settlementYields(normal, cityOf(normal, 'p2'), content);
    const rE = settlementYields(easy, cityOf(easy, 'p2'), content);
    expect(rE.food).toBeCloseTo(rN.food * k, 1);
    expect(rE.production).toBeCloseTo(rN.production * k, 1);
    const iN = computeEmpire(normal, 'p2', content).income;
    const iE = computeEmpire(easy, 'p2', content).income;
    for (const y of ['science', 'culture'] as const) expect(iE[y]).toBeCloseTo(iN[y] * k, 1);
    // The human is untouched except for the happiness help.
    const hN = settlementYields(normal, cityOf(normal, 'p1'), content);
    const hE = settlementYields(easy, cityOf(easy, 'p1'), content);
    expect(hE.food).toBe(hN.food);
    expect(hE.happiness).toBe(hN.happiness + 1);
    expect(settlementYields(easy, cityOf(easy, 'p2'), content).happiness).toBe(rN.happiness);
  });

  it("'hard': rivals gain a share of those yields and pay less for units and buildings; the human pays full price", () => {
    const k = 1 + DIFFICULTY_RIVAL_YIELD_PERCENT.hard / 100;
    const c = 1 + DIFFICULTY_RIVAL_COST_PERCENT.hard / 100;
    expect(k).toBeGreaterThan(1);
    expect(c).toBeLessThan(1);
    const normal = world('normal');
    const hard = world('hard');
    const iN = computeEmpire(normal, 'p2', content).income;
    const iH = computeEmpire(hard, 'p2', content).income;
    for (const y of ['science', 'culture'] as const) expect(iH[y]).toBeCloseTo(iN[y] * k, 1);
    // Gold compounds: idle production (itself boosted) is banked as gold, then gold is boosted.
    expect(iH.gold).toBeGreaterThanOrEqual(iN.gold * k - 0.01);
    const rN = settlementYields(normal, cityOf(normal, 'p2'), content);
    const rH = settlementYields(hard, cityOf(hard, 'p2'), content);
    expect(rH.production).toBeCloseTo(rN.production * k, 1);
    expect(itemCost(hard, cityOf(hard, 'p2'), 'warrior', content)).toBe(Math.round(30 * c));
    expect(itemCost(hard, cityOf(hard, 'p2'), 'walls', content)).toBe(Math.round(50 * c));
    expect(itemCost(hard, cityOf(hard, 'p2'), 'pyramid', content)).toBe(100);
    expect(itemCost(hard, cityOf(hard, 'p1'), 'warrior', content)).toBe(30);
    expect(computeEmpire(hard, 'p1', content).income).toEqual(computeEmpire(normal, 'p1', content).income);
  });

  it('createGame takes the setup difficulty, default normal', () => {
    const real = loadContent();
    const setup = {
      seed: 4,
      mapSize: 'small' as const,
      speed: 'quick' as const,
      players: ['p1', 'p2'].map((id, i) => ({
        id,
        isHuman: i === 0,
        leader: real.leaders[i]?.id ?? '',
        dream: real.dreams[i]?.id ?? '',
        colors: { primary: '#000', secondary: '#fff' },
        skinTone: 0,
      })),
    };
    expect(createGame(setup, real).state.difficulty).toBe('normal');
    expect(createGame({ ...setup, difficulty: 'hard' }, real).state.difficulty).toBe('hard');
  });
});
