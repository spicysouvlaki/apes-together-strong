/**
 * Play matters, not only land (GDD §1 pillar 2 "Play is the recruiter"; §4): on the same
 * temperate land, a warring, a trading, a building and a thinking player drift toward
 * different cultures. Scripted with the M2 scenario helpers (tests/helpers/emergence.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import { loadContent } from '../src/content';
import { emergenceTick, handleFigureCommand } from '../src/emergence';
import { makeCtx, scenarioState, scenarioStep, type CultureProfile } from './helpers/emergence';

vi.mock('../src/sim/units', () => import('./helpers/emergence'));
vi.mock('../src/sim/stats', () => import('./helpers/emergence'));
vi.mock('../src/sim/ages', () => import('./helpers/emergence'));

const content = loadContent();
const land: CultureProfile = {
  culture: 'none',
  age: 'ancient',
  climate: 'temperate',
  terrain: { grassland: 3, plains: 3, mountain: 0.5, desert: 0.5 },
  features: { hills: 0.25, forest: 0.15 },
  resources: { wheat: 0.03, horses: 0.02, wine: 0.02, iron: 0.02 },
  coastal: 2,
  river: true,
};
/** Each play style and the culture its play signals point to. */
const STYLES: Record<string, { culture: string; play: Partial<CultureProfile> }> = {
  war: { culture: 'mongol', play: { units: [['chariot', 4], ['warrior_band', 3]], battleEvery: 3 } },
  trade: { culture: 'arab', play: { tradeRoutesBy: 6, focus: { gold: 1.6 }, units: [['warrior_band', 1], ['merchant', 2]] } },
  building: { culture: 'egyptian', play: { wonderTurn: 10, focus: { production: 1.6, faith: 1.6 } } },
  thinking: { culture: 'greek', play: { focus: { science: 1.8, culture: 1.8 }, techsPer10: 5, envoysPer10: 1 } },
};
const SEEDS = [1, 2, 3, 4];

const affinityAfter = (play: Partial<CultureProfile>, seed: number): Record<string, number> => {
  const profile = { ...land, ...play } as CultureProfile;
  const state = scenarioState(content, profile, seed);
  for (let turn = 1; turn <= 30; turn++) {
    scenarioStep(state, content, profile, turn);
    const ctx = makeCtx(state, content);
    emergenceTick(ctx, 'p1');
    for (const o of state.offers.filter((x) => x.player === 'p1')) handleFigureCommand(ctx, 'p1', { type: 'chooseOffer', offer: o.id, figure: o.candidates[0] ?? null });
    state.players.p1!.stats.battlesWonThisTurn = 0;
  }
  return state.players.p1!.affinity;
};

describe('same land, different play', () => {
  const results: Record<string, Record<string, number>[]> = {};
  for (const [name, { play }] of Object.entries(STYLES)) results[name] = SEEDS.map((seed) => affinityAfter(play, seed));
  const mean = (style: string, culture: string): number => results[style]!.reduce((s, a) => s + (a[culture] ?? 0), 0) / SEEDS.length;
  const top = (a: Record<string, number>): string => Object.entries(a).sort((x, y) => y[1] - x[1])[0]![0];

  for (const [name, { culture }] of Object.entries(STYLES)) {
    it(`${name} play draws ${culture} more than any other play style on the same land`, () => {
      for (const other of Object.keys(STYLES)) if (other !== name) expect(mean(name, culture)).toBeGreaterThan(mean(other, culture) * 1.08);
      // ...and that culture is among this player's top three in every seed.
      for (const a of results[name]!) {
        const ranked = Object.entries(a).sort((x, y) => y[1] - x[1]).map(([c]) => c);
        expect(ranked.slice(0, 3)).toContain(culture);
      }
    });
  }

  it('the top cultures diverge across play styles', () => {
    const tops = new Set(Object.values(results).flatMap((rs) => rs.map(top)));
    expect(tops.size).toBeGreaterThanOrEqual(4);
  });
});
