/**
 * AI changes from the third hands-on playtest: a scout with nothing left to explore keeps
 * watch as a lookout at home (rather than idling, or being disbanded and rebuilt), and the
 * AI never picks a crisis response it cannot pay while another is affordable.
 */
import { describe, expect, it } from 'vitest';
import type { GameSetup, GameState } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import type { AiCtx } from '../src/ai/ctx';
import { answerCrisis } from '../src/ai/decisions';
import { makePersona } from '../src/ai/persona';
import { moveScouts } from '../src/ai/units';
import { sim } from '../src/sim';
import { tileAt } from '../src/sim/lookup';

const content = loadContent();

const setup: GameSetup = {
  seed: 5,
  mapSize: 'small',
  speed: 'standard',
  players: ['p1', 'p2'].map((id, i) => ({
    id,
    isHuman: false,
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
  const settler = Object.values(s.units).find((u) => u.owner === 'p1' && u.type === 'settler');
  if (!settler) throw new Error('no settler');
  const r = sim.applyCommand(s, 'p1', { type: 'foundSettlement', unit: settler.id }, content);
  if (!r.ok) throw new Error(r.error);
  s = r.state;
  return s;
};

describe('AI scouts after the map is charted (playtest 3)', () => {
  it('a scout at home with nothing reachable left to explore fortifies as a lookout', () => {
    const state = founded();
    const p = state.players.p1!;
    p.explored = p.explored.map(() => 1);
    const scout = Object.values(state.units).find((u) => u.owner === 'p1' && u.type === 'scout');
    if (!scout) throw new Error('no scout');
    const cap = Object.values(state.settlements).find((s) => s.owner === 'p1');
    if (!cap) throw new Error('no capital');
    scout.at = { ...cap.at };
    expect(tileAt(state.map, scout.at)?.owner).toBe('p1');
    const ai = aiCtx(state, 'p1');
    moveScouts(ai);
    const after = ai.state.units[scout.id];
    expect(after?.fortified).toBe(true);
  });
});

describe('AI crisis answers respect the purse (playtest 3)', () => {
  it('with 18 gold the AI never pays the 40-gold tribute', () => {
    const state = founded();
    state.crisis = { id: 'collapse', stage: 3, awaiting: ['p1', 'p2'] };
    state.players.p1!.stock.gold = 18;
    const ai = aiCtx(state, 'p1');
    answerCrisis(ai);
    expect(ai.state.players.p1!.crisisChoices).toEqual(['collapse_rally']);
    expect(ai.state.players.p1!.stock.gold).toBe(18);
  });
});
