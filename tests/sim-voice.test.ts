/**
 * Rivals as characters (src/sim/voice.ts): posture from the leader archetype, short messages
 * in the rival's own voice on war, peace, contact and borders — only AI → human, never in
 * AI-only games, never with numbers or ids.
 */
import { describe, expect, it, vi } from 'vitest';
import { type GameState } from '@contracts/sim-api';

vi.mock('../src/emergence', () => ({
  initEmergence: () => ({ affinity: {}, hintsShown: {}, gp: {}, gpThreshold: {}, legendSlotUsed: false, seatedTurns: {} }),
  emergenceTick: vi.fn(),
  addAffinity: vi.fn(),
  handleFigureCommand: vi.fn(() => null),
  syncCabinet: vi.fn(),
  onSettlementCaptured: vi.fn(),
  onPlayerEliminated: vi.fn(),
  onFigureUnitDefeated: vi.fn(),
  retireFigures: vi.fn(() => []),
  onAgeStarted: vi.fn(),
  ancestorYields: vi.fn(() => ({})),
  cabinetSeats: vi.fn(() => []),
  figureActions: vi.fn(),
  cultureWeights: vi.fn(() => ({})),
}));
vi.mock('../src/sim/ages', () => ({
  addAgeProgress: vi.fn(),
  endGame: vi.fn((ctx: { state: GameState }) => {
    ctx.state.phase = 'ended';
  }),
  agesWorldPhase: vi.fn(),
  handleAgesCommand: vi.fn(() => null),
  refinementOptions: vi.fn(() => []),
  milestones: vi.fn(() => []),
  score: vi.fn(() => 0),
}));

import { applyCommand } from '../src/sim';
import { MIN_WAR_TURNS, PEACE_INFLUENCE_COST } from '../src/sim/constants';
import { VOICE, postureOfBias, speakerName, voiceText } from '../src/sim/voice';
import { addSettlement, addUnit, at, fixtureContent, fixtureState } from './helpers/fixture';
import { loadContent } from '../src/content';

const base = fixtureContent();
const content = {
  ...base,
  leaders: [
    ...base.leaders,
    { id: 'conq', name: 'The Conqueror', ability: 'x', modifiers: base.leaders[0]!.modifiers, aiAgendaBias: ['warmonger', 'expansionist'] },
  ],
};

const world = (human: boolean): GameState => {
  const state = fixtureState({ width: 16, height: 10 });
  state.players.p1!.isHuman = human;
  state.players.p2!.leader = 'conq';
  addSettlement(state, 'p1', at(2, 2), { name: 'Home' });
  addSettlement(state, 'p2', at(12, 7), { name: 'Avarga' });
  return state;
};

describe('postures', () => {
  it('follow the leader archetype of the real content', () => {
    const real = loadContent();
    const byLeader = Object.fromEntries(real.leaders.map((l) => [l.id, postureOfBias(l.aiAgendaBias)]));
    expect(byLeader.conqueror).toBe('aggressor');
    expect(byLeader.merchant).toBe('trader');
    expect(byLeader.diplomat).toBe('rival');
    expect(byLeader.sage).toBe('wary');
    // Every posture is used by some leader, so rivals feel different.
    expect(new Set(Object.values(byLeader)).size).toBe(4);
  });

  it('every line is a plain sentence without digits or ids', () => {
    for (const occ of Object.values(VOICE)) for (const line of Object.values(occ)) {
      expect(line).not.toMatch(/\d|_/);
      expect(line).toMatch(/[.!?]$/);
    }
  });
});

describe('messages', () => {
  it('a rival names itself by leader and capital, then by its chosen civ name', () => {
    const state = world(true);
    expect(speakerName(state, 'p2', content)).toBe('The Conqueror of Avarga');
    state.players.p2!.civName = 'the Steppe Pax';
    expect(speakerName(state, 'p2', content)).toBe('The Conqueror of the Steppe Pax');
    state.players.p2!.civName = 'Steppe Pax';
    expect(voiceText(state, 'p2', 'peace', content)).toMatch(/^The Conqueror of the Steppe Pax: “/);
  });

  it('war and peace with a human produce one message from the rival, in its voice', () => {
    let state = world(true);
    state.currentPlayer = 'p2';
    let r = applyCommand(state, 'p2', { type: 'declareWar', target: 'p1' }, content);
    if (!r.ok) throw new Error(r.error);
    const notices = r.events.filter((e) => e.type === 'notice');
    expect(notices).toEqual([{ type: 'notice', player: 'p1', text: `The Conqueror of Avarga: “${VOICE.warOnYou.aggressor}”` }]);
    state = r.state;
    state.currentPlayer = 'p1';
    state.turn += MIN_WAR_TURNS;
    state.players.p1!.stock.influence = PEACE_INFLUENCE_COST;
    r = applyCommand(state, 'p1', { type: 'makePeace', target: 'p2' }, content);
    if (!r.ok) throw new Error(r.error);
    expect(r.events.filter((e) => e.type === 'notice')).toEqual([{ type: 'notice', player: 'p1', text: `The Conqueror of Avarga: “${VOICE.peace.aggressor}”` }]);
  });

  it('AI-only games stay silent', () => {
    const quiet = world(false);
    quiet.currentPlayer = 'p2';
    const r = applyCommand(quiet, 'p2', { type: 'declareWar', target: 'p1' }, content);
    expect(r.ok).toBe(true);
    expect(r.ok && r.events.some((e) => e.type === 'notice')).toBe(false);
  });

  it('first contact greets once, when exploring reveals the rival’s land', () => {
    const state = world(true);
    const scout = addUnit(state, 'p1', 'scout', at(8, 6), content);
    const r = applyCommand(state, 'p1', { type: 'moveUnit', unit: scout.id, to: at(10, 6) }, content);
    if (!r.ok) throw new Error(r.error);
    expect(r.events.filter((e) => e.type === 'notice')).toEqual([{ type: 'notice', player: 'p1', text: `The Conqueror of Avarga: “${VOICE.contact.aggressor}”` }]);
    const s2 = r.state.units[scout.id]!;
    s2.movesLeft = 3;
    const again = applyCommand(r.state, 'p1', { type: 'moveUnit', unit: scout.id, to: at(9, 7) }, content);
    expect(again.ok && again.events.some((e) => e.type === 'notice')).toBe(false);
  });
});
