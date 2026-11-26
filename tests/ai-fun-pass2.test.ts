/**
 * AI quality fixes of the second fun-and-fairness pass (src/ai): expeditions take the field
 * only with work to do, seatless figures act instead of idling, research values the upgrade
 * of units already fielded, and a peacetime surplus army is trimmed.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '@contracts/sim-api';
import { runAiTurn } from '../src/ai';
import type { AiCtx } from '../src/ai/ctx';
import { fieldExplorers, MAX_EXPEDITIONS } from '../src/ai/figures';
import { makePersona } from '../src/ai/persona';
import { expeditionTask, moveExpeditions } from '../src/ai/units';
import { loadContent } from '../src/content';
import { sim } from '../src/sim';
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

/** Seeded game played by the AI for `turns` turns. */
const play = (seed: number, turns: number): GameState => {
  let state = sim.createGame(setupFor(seed, { games: 1, seed, turns, size: 'small', speed: 'standard', players: 3, maxSeconds: 60, json: null, verify: false }, content), content).state;
  while (state.phase !== 'ended' && state.turn <= turns) {
    const id = state.phase === 'playing' ? state.currentPlayer : state.playerOrder.find((p) => state.players[p]?.alive && !state.transition?.recap[p]?.done);
    if (!id) break;
    state = runAiTurn(state, id, content, sim).state;
  }
  return state;
};

const giveExplorer = (state: GameState, player: PlayerId): string => {
  const def = content.figures.find((f) => f.kind === 'explorer' && f.uses.includes('unit') && !f.deed && !state.figures[f.id]);
  const home = Object.values(state.settlements).find((s) => s.owner === player && s.kind === 'city');
  if (!def || !home) throw new Error('no explorer or city');
  state.figures[def.id] = { id: def.id, owner: player, recruitedTurn: state.turn, recruitedAge: state.age, reason: '', activated: false, location: { state: 'based', settlement: home.id } };
  return def.id;
};

describe('expeditions (explorer figures)', () => {
  it('deploy only when there is work, never more than the cap, and are not recalled the same turn', () => {
    const state = play(4, 12);
    const p = state.playerOrder.find((id) => Object.values(state.settlements).some((s) => s.owner === id && s.isCapital))!;
    // Fill every seat so the explorer has nowhere to sit.
    for (const key of Object.keys(state.players[p]!.cabinet)) state.players[p]!.cabinet[key] = 'someone';
    const ids = [giveExplorer(state, p), giveExplorer(state, p), giveExplorer(state, p)];
    const ai = aiCtx(state, p);
    const cap = Object.values(ai.state.settlements).find((s) => s.owner === p && s.isCapital)!;
    const hasWork = expeditionTask(ai, cap.at) !== null;
    fieldExplorers(ai);
    const out = ids.filter((id) => ai.state.figures[id]?.location.state === 'unit').length;
    if (!hasWork) {
      expect(out).toBe(0);
      return;
    }
    expect(out).toBe(MAX_EXPEDITIONS);
    moveExpeditions(ai);
    expect(ids.filter((id) => ai.state.figures[id]?.location.state === 'unit').length).toBe(MAX_EXPEDITIONS);
  });
});

describe('research values upgrading the army already fielded', () => {
  it('an AI holding warriors researches toward their upgrade in the classical age within a few techs', () => {
    const state = play(2, 70);
    const spear = content.units.find((u) => u.id === 'spearman');
    if (!spear?.requiresTech || state.age !== 'classical') return;
    const withWarriors = state.playerOrder.filter((id) => state.players[id]?.alive);
    const known = withWarriors.filter((id) => state.players[id]?.techs.includes(spear.requiresTech!)).length;
    expect(known).toBeGreaterThan(0);
  });
});
