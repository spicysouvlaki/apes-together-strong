/**
 * AI changes from the wave 13 playtest: a threat the AI can no longer back (the human
 * garrisoned the named city) is withdrawn rather than carried out, and the AI commits to one
 * target hybrid when choosing figures.
 */
import { describe, expect, it } from 'vitest';
import type { GameSetup, GameState } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import type { AiCtx } from '../src/ai/ctx';
import { targetHybrid } from '../src/ai/decisions';
import { makePersona } from '../src/ai/persona';
import { followThroughThreats } from '../src/ai/war';
import { sim } from '../src/sim';
import { WAR_INTENT_SOURCE } from '../src/sim/constants';
import { stoodDownFrom, warIntentOf } from '../src/sim/war-intent';

const content = loadContent();

const setup: GameSetup = {
  seed: 5,
  mapSize: 'small',
  speed: 'standard',
  players: ['p1', 'p2'].map((id, i) => ({
    id,
    isHuman: id === 'p1',
    leader: content.leaders[i]?.id ?? '',
    dream: content.dreams[0]?.id ?? '',
    colors: { primary: '#123456', secondary: '#654321' },
    skinTone: 0,
  })),
};

const aiCtx = (state: GameState, player: string): AiCtx => ({
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

const founded = (): GameState => {
  let s = sim.createGame(setup, content).state;
  for (const pid of ['p1', 'p2']) {
    const settler = Object.values(s.units).find((u) => u.owner === pid && u.type === 'settler');
    if (!settler) throw new Error('no settler');
    s = { ...s, currentPlayer: pid };
    const r = sim.applyCommand(s, pid, { type: 'foundSettlement', unit: settler.id }, content);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return s;
};

describe('AI war threats (wave 13)', () => {
  it('an AI without the force to back its threat stands down', () => {
    const state = founded();
    state.currentPlayer = 'p2';
    const target = Object.values(state.settlements).find((s) => s.owner === 'p1');
    if (!target) throw new Error('no p1 settlement');
    state.players.p2!.effects.push({ source: `${WAR_INTENT_SOURCE}p1:${target.id}:${state.turn + 3}`, untilTurn: state.turn + 7, modifiers: [] });
    // No army near the named city: the threat no longer holds.
    for (const id of Object.keys(state.units)) if (state.units[id]?.owner === 'p2' && state.units[id]?.unitClass !== 'civilian') delete state.units[id];
    const ai = aiCtx(state, 'p2');
    expect(followThroughThreats(ai)).toBe(false);
    expect(warIntentOf(ai.state, 'p2', 'p1')).toBeNull();
    expect(stoodDownFrom(ai.state, 'p2', 'p1')).toBe(true);
  });
});

describe('AI hybrid plan (wave 13)', () => {
  it('targets the hybrid whose two cultures it is closest to', () => {
    const state = founded();
    const ai = aiCtx(state, 'p2');
    expect(targetHybrid(ai, {})).toBeNull();
    const h = content.hybrids.find((x) => x.age === 'classical');
    if (!h) return;
    const [a, b] = h.cultures as [string, string];
    expect(targetHybrid(ai, { [a]: 2, [b]: 1 })?.cultures).toEqual(h.cultures);
  });
});
