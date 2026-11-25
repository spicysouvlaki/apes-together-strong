/**
 * Golden replay (CLAUDE.md rule 2): the same setup and the same scripted commands must give
 * byte-identical states, and applyCommand must never mutate its input. Runs the real sim,
 * map generator, emergence engine and ages module on the real content.
 */
import { describe, expect, it } from 'vitest';
import type { Command, GameSetup, GameState, PlayerId } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { applyCommand, createGame, queries } from '../src/sim';
import { MAP_DIMENSIONS } from '../src/sim/mapgen';

const content = loadContent();

const setup = (seed: number): GameSetup => ({
  seed,
  mapSize: 'small',
  speed: 'standard',
  players: ['p1', 'p2', 'p3'].map((id, i) => ({
    id,
    isHuman: i === 0,
    leader: content.leaders[i % content.leaders.length]?.id ?? '',
    dream: content.dreams[i % content.dreams.length]?.id ?? '',
    colors: { primary: '#aa0000', secondary: '#ffffff' },
    skinTone: i,
  })),
});

/** A dumb but deterministic scripted player: settle, wander, answer every decision with the first option. */
const scriptedTurn = (start: GameState, pid: PlayerId, log: string[]): GameState => {
  let state = start;
  const apply = (cmd: Command): void => {
    const before = JSON.stringify(state);
    const r = applyCommand(state, pid, cmd, content);
    expect(JSON.stringify(state)).toBe(before); // input never mutated
    if (r.ok) state = r.state;
    else log.push(`${state.turn} ${pid} ${cmd.type}: ${r.error}`);
  };
  if (state.phase === 'transition') {
    apply({ type: 'finishTransition' });
    return state;
  }
  for (const uid of Object.keys(state.units)) {
    const u = state.units[uid];
    if (!u || u.owner !== pid) continue;
    if (queries.canFound(state, uid, content)) {
      apply({ type: 'foundSettlement', unit: uid });
      continue;
    }
    const targets = queries.attackTargets(state, uid, content);
    if (targets[0]) {
      apply({ type: 'attack', unit: uid, target: targets[0] });
      continue;
    }
    const reach = queries.reachable(state, uid, content);
    const pick = reach[(state.turn * 7 + uid.length) % Math.max(1, reach.length)];
    if (pick) apply({ type: 'moveUnit', unit: uid, to: pick.hex });
  }
  for (const d of queries.pendingDecisions(state, pid, content)) {
    if (d.type === 'production') {
      const o = queries.productionOptions(state, d.settlement, content);
      const item = o[state.turn % Math.max(1, o.length)]?.item;
      if (item) apply({ type: 'setProduction', settlement: d.settlement, item });
    } else if (d.type === 'research') {
      const o = queries.researchOptions(state, pid, d.tree, content)[0];
      if (o) apply({ type: 'setResearch', tree: d.tree, id: o.id });
    } else if (d.type === 'government') {
      const g = queries.governmentOptions(state, pid, content)[0];
      if (g) apply({ type: 'setGovernment', government: g });
    } else if (d.type === 'offer') {
      const offer = state.offers.find((o) => o.id === d.offer);
      apply({ type: 'chooseOffer', offer: d.offer, figure: offer?.candidates[0] ?? null });
    } else if (d.type === 'crisis') {
      const c = content.crises.find((x) => x.id === d.crisis);
      const opt = c?.stages[d.stage - 1]?.options[0]?.id;
      if (opt) apply({ type: 'chooseCrisisResponse', option: opt });
    }
  }
  if (state.turn === 12 && pid === 'p1') apply({ type: 'declareWar', target: 'p2' });
  apply({ type: 'endTurn' });
  return state;
};

const play = (seed: number, maxSteps: number): { state: GameState; log: string[] } => {
  let { state } = createGame(setup(seed), content);
  const log: string[] = [];
  for (let i = 0; i < maxSteps && state.phase !== 'ended'; i++) {
    const pid = state.phase === 'transition'
      ? state.playerOrder.find((p) => state.transition && !state.transition.recap[p]?.done) ?? state.currentPlayer
      : state.currentPlayer;
    state = scriptedTurn(state, pid, log);
  }
  return { state, log };
};

describe('createGame', () => {
  it('sets up players, starting units and city-states deterministically', () => {
    const { state, events } = createGame(setup(7), content);
    expect(state.turn).toBe(1);
    expect(state.currentPlayer).toBe('p1');
    expect(state.phase).toBe('playing');
    expect(state.finalAge).toBe('classical');
    expect(events).toContainEqual({ type: 'turnStarted', turn: 1 });
    for (const pid of state.playerOrder) {
      const mine = Object.values(state.units).filter((u) => u.owner === pid);
      expect(mine.some((u) => content.units.find((d) => d.id === u.type)?.canFound)).toBe(true);
      expect(mine.some((u) => u.unitClass === 'infantry')).toBe(true);
      expect(state.players[pid]?.explored.length).toBe(state.map.tiles.length);
      expect(state.players[pid]?.explored.some((v) => v === 1)).toBe(true);
    }
    const expectedCs = Math.min(MAP_DIMENSIONS.small.cityStates, content.cityStates.length);
    expect(Object.keys(state.cityStates)).toHaveLength(expectedCs);
    for (const cs of Object.values(state.cityStates)) {
      const s = state.settlements[cs.settlement];
      expect(s?.owner).toBe(`cs:${cs.id}`);
      expect(s?.population).toBe(3);
    }
    expect(JSON.stringify(createGame(setup(7), content).state)).toBe(JSON.stringify(state));
  });
});

describe('golden replay', () => {
  it('same seed + same commands => byte-identical state', () => {
    const a = play(1234, 3 * 40);
    const b = play(1234, 3 * 40);
    expect(a.state.turn).toBeGreaterThan(30);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.log).toEqual(b.log);
  });

  it('a whole game runs to the end without throwing', () => {
    const { state } = play(99, 3 * 400);
    expect(state.phase).toBe('ended');
    expect(state.result).not.toBeNull();
  }, 60_000);
});
