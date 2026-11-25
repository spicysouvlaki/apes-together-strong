import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameSetup, GameState, PlayerState, Sim, SimEvent } from '@contracts/sim-api';
import { NotImplemented, playGame, type Options, type RunAiTurn } from '../scripts/lib/autoplay';

// Fake world: each endTurn by the last player advances the turn; an ancient->classical
// transition happens at turn 3; the game ends at turn 6. Deterministic by construction.
const content = {
  leaders: [{ id: 'builder' }],
  dreams: [{ id: 'pax' }],
  figures: [{ id: 'imhotep', culture: 'egyptian' }],
} as unknown as ContentBundle;

const fakeSim: Sim = {
  createGame: (setup: GameSetup) => {
    const players: Record<string, PlayerState> = {};
    for (const p of setup.players) {
      players[p.id] = { ...p, alive: true, civName: null, score: 0, traditions: [], hybrids: [], affinity: {} } as unknown as PlayerState;
    }
    const order = setup.players.map((p) => p.id);
    const state = {
      version: 2,
      seed: setup.seed,
      turn: 1,
      age: 'ancient',
      phase: 'playing',
      currentPlayer: order[0],
      playerOrder: order,
      players,
      figures: { imhotep: { id: 'imhotep', owner: order[0] } },
      settlements: { s1: { id: 's1', owner: order[1] } },
      transition: null,
      result: null,
    } as unknown as GameState;
    return { state, events: [{ type: 'turnStarted', turn: 1 }] };
  },
  applyCommand: (state, who, command) => {
    const s = structuredClone(state);
    const events: SimEvent[] = [];
    if (command.type === 'endTurn' && s.phase === 'playing' && s.currentPlayer === who) {
      const i = s.playerOrder.indexOf(who);
      if (i < s.playerOrder.length - 1) s.currentPlayer = s.playerOrder[i + 1] ?? who;
      else {
        s.turn += 1;
        s.currentPlayer = s.playerOrder[0] ?? who;
        events.push({ type: 'turnStarted', turn: s.turn }, { type: 'offerCreated', offer: `o${s.turn}`, player: who });
        if (s.turn === 3) {
          s.phase = 'transition';
          s.transition = { fromAge: 'ancient', toAge: 'classical', recap: Object.fromEntries(s.playerOrder.map((p) => [p, { done: false }])) } as unknown as GameState['transition'];
        }
        if (s.turn === 6) {
          s.phase = 'ended';
          s.result = { winner: who, reason: 'test', scores: Object.fromEntries(s.playerOrder.map((p, k) => [p, k * 10])) };
        }
      }
      return { ok: true, state: s, events };
    }
    if (command.type === 'finishTransition' && s.phase === 'transition') {
      const r = s.transition?.recap[who];
      if (!r) return { ok: false, error: 'no recap' };
      r.done = true;
      s.players[who]?.traditions.push('nilometer');
      if (Object.values(s.transition?.recap ?? {}).every((x) => x.done)) {
        s.phase = 'playing';
        s.age = 'classical';
        s.transition = null;
      }
      return { ok: true, state: s, events };
    }
    return { ok: false, error: 'illegal' };
  },
};

const doNothing: RunAiTurn = (state) => ({ state, events: [] });
const opts: Options = { games: 1, seed: 1, turns: 100, size: 'small', speed: 'quick', players: 3, maxSeconds: 60, json: null, verify: false };

describe('autoplay harness', () => {
  it('plays an AI-only game through a transition to the end and reports', () => {
    const r = playGame(7, opts, fakeSim, doNothing, content, true);
    expect(r.status).toBe('ended');
    expect(r.turns).toBe(6);
    expect(r.finalAge).toBe('classical');
    expect(r.turnsPerAge).toEqual({ ancient: 3, classical: 3 });
    expect(r.offersPerAge).toEqual({ ancient: 2, classical: 3 });
    expect(r.players.p1?.figuresByCulture).toEqual({ egyptian: 1 });
    expect(r.players.p2?.settlements).toBe(1);
    expect(r.players.p3?.traditions).toEqual(['nilometer']);
    expect(r.players.p3?.score).toBe(20);
    expect(r.aiTurns).toBeGreaterThan(0);
    // Same seed, same result.
    expect(playGame(7, opts, fakeSim, doNothing, content, true).finalJson).toBe(r.finalJson);
  });

  it('respects the turn cap', () => {
    expect(playGame(1, { ...opts, turns: 2 }, fakeSim, doNothing, content, false).status).toBe('turnCap');
  });

  it('reports a stub sim as NotImplemented', () => {
    const stub: Sim = {
      createGame: () => {
        throw new Error('TODO(sim): createGame not implemented');
      },
      applyCommand: () => ({ ok: false, error: 'TODO(sim)' }),
    };
    expect(() => playGame(1, opts, stub, doNothing, content, false)).toThrow(NotImplemented);
  });
});
