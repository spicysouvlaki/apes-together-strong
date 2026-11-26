/**
 * Fun-audit AI rules (src/ai): rivals plan hybrids when choosing figures, only seafaring or
 * expansive AIs with embarking look overseas for sites, and over a few seeded games the AIs
 * field ships, settle across water or take city-states — the naval and conquest game exists.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '@contracts/sim-api';
import { runAiTurn } from '../src/ai';
import type { AiCtx } from '../src/ai/ctx';
import { HYBRID_PLAN_BONUS, offerFigureScore } from '../src/ai/decisions';
import { findSites, settlesOverseas } from '../src/ai/economy';
import { makePersona } from '../src/ai/persona';
import { loadContent } from '../src/content';
import { sim } from '../src/sim';
import { tileAt } from '../src/sim/lookup';
import { setupFor } from '../scripts/lib/autoplay';

const content = loadContent();

const aiCtx = (state: GameState, player: PlayerId): AiCtx => ({
  state,
  player,
  content,
  sim,
  events: [],
  persona: makePersona(state, player, content),
  commands: 0,
  rejected: 0,
  claimedSites: [],
});

const play = (seed: number, turns: number, players = 3, speed: 'quick' | 'standard' = 'standard'): { state: GameState; events: string[] } => {
  let state = sim.createGame(setupFor(seed, { games: 1, seed, turns, size: 'small', speed, players, maxSeconds: 60, json: null, verify: false }, content), content).state;
  const events: string[] = [];
  while (state.phase !== 'ended' && state.turn <= turns) {
    const id = state.phase === 'playing' ? state.currentPlayer : state.playerOrder.find((p) => state.players[p]?.alive && !state.transition?.recap[p]?.done);
    if (!id) break;
    const r = runAiTurn(state, id, content, sim);
    for (const e of r.events) {
      if (e.type === 'productionCompleted' && content.units.find((u) => u.id === e.item)?.unitClass === 'naval') events.push('ship');
      if (e.type === 'settlementCaptured' && e.from.startsWith('cs:')) events.push('cityState');
      if (e.type === 'settlementCaptured' && !e.from.startsWith('cs:')) events.push('conquest');
    }
    state = r.state;
  }
  return { state, events };
};

describe('AI figure choice plans a hybrid', () => {
  it('a figure of a hybrid partner culture outscores a same-kind figure of an unrelated culture', () => {
    const state = sim.createGame(setupFor(3, { games: 1, seed: 3, turns: 1, size: 'small', speed: 'standard', players: 3, maxSeconds: 60, json: null, verify: false }, content), content).state;
    const hybrid = content.hybrids.find((h) => h.age === 'classical')!;
    const [held, partner] = hybrid.cultures;
    const heldFig = content.figures.find((f) => f.culture === held && f.age === 'ancient')!;
    state.figures[heldFig.id] = { id: heldFig.id, owner: 'p1', recruitedTurn: 1, recruitedAge: 'ancient', reason: '', activated: false, location: { state: 'retired' } };
    const unrelated = content.cultures.find((c) => !content.hybrids.some((h) => h.cultures.includes(c.id) && h.cultures.includes(held)) && c.id !== held && c.id !== partner)!;
    const ai = aiCtx(state, 'p1');
    const weights = { [held]: 1 };
    const pairs = content.figures
      .filter((f) => f.age === 'ancient' && !f.deed && f.culture === partner)
      .map((f) => ({ f, g: content.figures.find((x) => x.age === 'ancient' && !x.deed && x.culture === unrelated.id && x.kind === f.kind && x.consumeValue === f.consumeValue) }))
      .filter((x) => x.g !== undefined);
    expect(pairs.length).toBeGreaterThan(0);
    for (const { f, g } of pairs) {
      const diff = offerFigureScore(ai, f, weights, []) - offerFigureScore(ai, g!, weights, []);
      expect(diff).toBeGreaterThan(HYBRID_PLAN_BONUS - 0.31); // minus the seeded tie-break noise
    }
  });
});

describe('AI sites', () => {
  it('without embarking, every site is on a landmass the AI already holds', () => {
    const { state } = play(2, 12);
    for (const id of state.playerOrder) {
      const ai = aiCtx(state, id);
      if (settlesOverseas(ai)) continue;
      const home = new Set(Object.values(state.settlements).filter((s) => s.owner === id).map((s) => tileAt(state.map, s.at)?.continent));
      for (const site of findSites(ai)) expect(home.has(state.map.tiles[site.idx]?.continent)).toBe(true);
    }
  });
});

describe('AI naval and conquest play', () => {
  it('across seeded games the AIs build ships and take cities', () => {
    const all: string[] = [];
    for (const seed of [1, 2, 3, 4]) all.push(...play(seed, 200, 4, 'quick').events);
    expect(all.filter((e) => e === 'ship').length).toBeGreaterThan(0);
    expect(all.filter((e) => e === 'cityState' || e === 'conquest').length).toBeGreaterThan(0);
  }, 120_000);
});
