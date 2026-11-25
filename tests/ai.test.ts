/**
 * Rival AI (src/ai, GDD §9): a seeded 3-AI game on a small map plays to the end through the
 * public Sim API, every rival expands, recruits and refines, `runAiTurn` never throws and
 * always advances the turn, two runs are byte-identical, and the AI never reads `affinity`.
 */
import { describe, expect, it } from 'vitest';
import type { GameSetup, GameState, PlayerId, SimEvent } from '@contracts/sim-api';
import { aiDiagnostics, runAiTurn } from '../src/ai';
import { makePersona } from '../src/ai/persona';
import { loadContent } from '../src/content';
import { sim } from '../src/sim';

const content = loadContent();
const TURN_CAP = 160;

const setup = (seed: number, players = 3): GameSetup => ({
  seed,
  mapSize: 'small',
  speed: 'standard',
  players: Array.from({ length: players }, (_, i) => ({
    id: `p${i + 1}`,
    isHuman: false,
    leader: content.leaders[(seed + i) % content.leaders.length]?.id ?? '',
    dream: content.dreams[(seed * 7 + i) % content.dreams.length]?.id ?? '',
    colors: { primary: '#c0392b', secondary: '#f3ede1' },
    skinTone: i,
  })),
});

const turnKey = (s: GameState): string => `${s.phase}|${s.turn}|${s.currentPlayer}`;

interface Played {
  state: GameState;
  events: SimEvent[];
  calls: number;
}

/** Drive a whole game with `runAiTurn` only, asserting progress after every call. */
const playToEnd = (seed: number): Played => {
  let state = sim.createGame(setup(seed), content).state;
  const events: SimEvent[] = [];
  let calls = 0;
  while (state.phase !== 'ended') {
    if (state.turn > TURN_CAP) throw new Error(`seed ${seed}: no end by turn ${TURN_CAP}`);
    if (state.phase === 'playing') {
      const before = turnKey(state);
      const r = runAiTurn(state, state.currentPlayer, content, sim);
      calls++;
      if (turnKey(r.state) === before) throw new Error(`seed ${seed}: runAiTurn did not end the turn (${before})`);
      state = r.state;
      events.push(...r.events);
    } else {
      const pending = state.playerOrder.find((id) => state.players[id]?.alive && !state.transition?.recap[id]?.done);
      if (!pending) throw new Error(`seed ${seed}: transition with nobody pending`);
      const r = runAiTurn(state, pending, content, sim);
      calls++;
      if (r.state.phase === 'transition' && !r.state.transition?.recap[pending]?.done) {
        throw new Error(`seed ${seed}: runAiTurn did not finish the transition for ${pending}`);
      }
      state = r.state;
      events.push(...r.events);
    }
  }
  return { state, events, calls };
};

const countBy = (events: SimEvent[], type: SimEvent['type'], player: (e: SimEvent) => PlayerId | null): Record<PlayerId, number> => {
  const out: Record<PlayerId, number> = {};
  for (const e of events) {
    if (e.type !== type) continue;
    const p = player(e);
    if (p) out[p] = (out[p] ?? 0) + 1;
  }
  return out;
};

describe('rival AI smoke game', () => {
  it('plays a seeded 3-AI small game to the end; every rival expands, recruits and refines; deterministic', () => {
    const errorsBefore = aiDiagnostics.stepErrors;
    const a = playToEnd(7);
    expect(a.state.phase).toBe('ended');
    expect(a.state.result).not.toBeNull();
    expect(aiDiagnostics.stepErrors - errorsBefore).toBe(0);

    const founded = countBy(a.events, 'settlementFounded', (e) => (e.type === 'settlementFounded' ? e.player : null));
    const recruited = countBy(a.events, 'figureRecruited', (e) => (e.type === 'figureRecruited' ? e.player : null));
    for (const id of a.state.playerOrder) {
      const p = a.state.players[id];
      expect(p?.alive, `${id} alive`).toBe(true);
      expect(founded[id] ?? 0, `${id} settlements founded`).toBeGreaterThanOrEqual(2);
      expect(recruited[id] ?? 0, `${id} figures recruited`).toBeGreaterThanOrEqual(3);
      expect(p?.traditions.length ?? 0, `${id} traditions`).toBeGreaterThanOrEqual(1);
      expect(p?.civName, `${id} named`).not.toBeNull();
    }
    // The ancient age ends in a transition and the game ends in the classical age by score.
    expect(a.events.some((e) => e.type === 'transitionStarted')).toBe(true);
    expect(a.state.age).toBe('classical');

    const b = playToEnd(7);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    expect(b.calls).toBe(a.calls);
  }, 60_000);
});

describe('runAiTurn contract', () => {
  const start = (): GameState => sim.createGame(setup(3), content).state;

  it('founds the capital on turn 1 and ends the turn', () => {
    const s0 = start();
    const r = runAiTurn(s0, 'p1', content, sim);
    expect(Object.values(r.state.settlements).filter((s) => s.owner === 'p1')).toHaveLength(1);
    expect(r.state.currentPlayer).toBe('p2');
    // The capital got something to build and research is running in both trees.
    const cap = Object.values(r.state.settlements).find((s) => s.owner === 'p1');
    expect(cap?.production.item).not.toBeNull();
    expect(r.state.players.p1?.research.tech.current).not.toBeNull();
    expect(r.state.players.p1?.research.civic.current).not.toBeNull();
  });

  it('returns the state untouched when it is not the player\'s turn or the game is over', () => {
    const s0 = start();
    expect(runAiTurn(s0, 'p2', content, sim).state).toBe(s0);
    const ended = { ...s0, phase: 'ended' as const };
    expect(runAiTurn(ended, 'p1', content, sim)).toEqual({ state: ended, events: [] });
  });

  it('never reads affinity: scrambled hidden affinity gives the same turn', () => {
    // Play a few rounds so there is something to decide (offers, production, units).
    let s = start();
    for (let i = 0; i < 3 * 12; i++) s = runAiTurn(s, s.currentPlayer, content, sim).state;
    expect(s.currentPlayer).toBe('p1');
    const scrambled = structuredClone(s);
    for (const p of Object.values(scrambled.players)) {
      let k = 1;
      for (const c of Object.keys(p.affinity)) p.affinity[c] = (k++ * 37) % 101;
    }
    const strip = (g: GameState): string =>
      JSON.stringify({ ...g, players: Object.fromEntries(Object.entries(g.players).map(([id, p]) => [id, { ...p, affinity: {} }])) });
    const a = runAiTurn(s, 'p1', content, sim);
    const b = runAiTurn(scrambled, 'p1', content, sim);
    expect(strip(b.state)).toBe(strip(a.state));
  });

  it('finishes a transition: refines, names the civ, picks a new-age government', () => {
    let s = start();
    let guard = 0;
    while (s.phase === 'playing' && guard++ < 2000) s = runAiTurn(s, s.currentPlayer, content, sim).state;
    expect(s.phase).toBe('transition');
    const r = runAiTurn(s, 'p1', content, sim);
    const p = r.state.players.p1;
    expect(r.state.transition?.recap.p1?.done ?? r.state.phase === 'playing').toBe(true);
    expect(p?.civName).not.toBeNull();
    expect(content.governments.find((g) => g.id === p?.government)?.age).toBe('classical');
    expect(r.events.some((e) => e.type === 'traditionAdopted' || e.type === 'hybridAdopted')).toBe(true);
  }, 30_000);

  it('personality: leader bias plus two seeded agendas, stable for a seed', () => {
    const s = start();
    const a = makePersona(s, 'p1', content);
    const leader = content.leaders.find((l) => l.id === s.players.p1?.leader);
    for (const bias of leader?.aiAgendaBias ?? []) expect(a.agendas).toContain(bias);
    expect(a.agendas.length).toBe((leader?.aiAgendaBias.length ?? 0) + 2);
    expect(makePersona(s, 'p1', content)).toEqual(a);
  });
});
