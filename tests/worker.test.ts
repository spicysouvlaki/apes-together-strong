import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '@contracts/content-schemas';
import type { Command, FromWorker, GameSetup, GameState, PlayerId, PlayerState, Sim, SimEvent } from '@contracts/sim-api';
import { Saves, createMemoryStore } from '../src/platform/saves';
import { SimHost, stripHidden, type RunAiTurn } from '../src/worker/host';

// A tiny fake sim: players take turns in order; after the last, the turn number goes up.
// 'stall' commands are accepted but change nothing (to test the loop guard).
const content = {} as ContentBundle;

const player = (id: string, isHuman: boolean): PlayerState =>
  ({
    id,
    isHuman,
    leader: 'builder',
    dream: 'pax',
    civName: null,
    alive: true,
    affinity: { greek: 42, egyptian: 7 },
  }) as unknown as PlayerState;

const makeState = (humans: boolean[]): GameState => {
  const players: Record<string, PlayerState> = {};
  const order = humans.map((h, i) => {
    const id = `p${i + 1}`;
    players[id] = player(id, h);
    return id;
  });
  return {
    version: 2,
    seed: 1,
    turn: 1,
    age: 'ancient',
    phase: 'playing',
    currentPlayer: order[0],
    playerOrder: order,
    players,
    transition: null,
  } as unknown as GameState;
};

const fakeSim = (opts: { humans: boolean[]; transitionAtTurn?: number }): Sim => ({
  createGame: (_setup: GameSetup) => ({ state: makeState(opts.humans), events: [{ type: 'turnStarted', turn: 1 }] }),
  applyCommand: (state, who, command: Command) => {
    const s = structuredClone(state);
    if (command.type === 'endTurn') {
      if (s.phase !== 'playing' || s.currentPlayer !== who) return { ok: false, error: 'not your turn' };
      const i = s.playerOrder.indexOf(who);
      const events: SimEvent[] = [];
      if (i === s.playerOrder.length - 1) {
        s.turn += 1;
        s.currentPlayer = s.playerOrder[0] ?? who;
        events.push({ type: 'turnStarted', turn: s.turn });
        if (opts.transitionAtTurn === s.turn) {
          s.phase = 'transition';
          s.transition = {
            fromAge: 'ancient',
            toAge: 'classical',
            recap: Object.fromEntries(s.playerOrder.map((id) => [id, { done: false }])),
          } as unknown as GameState['transition'];
        }
      } else {
        s.currentPlayer = s.playerOrder[i + 1] ?? who;
      }
      return { ok: true, state: s, events };
    }
    if (command.type === 'finishTransition') {
      const r = s.transition?.recap[who];
      if (s.phase !== 'transition' || !r) return { ok: false, error: 'no transition' };
      r.done = true;
      if (Object.values(s.transition?.recap ?? {}).every((x) => x.done)) {
        s.phase = 'playing';
        s.age = 'classical';
        s.transition = null;
      }
      return { ok: true, state: s, events: [] };
    }
    if (command.type === 'fortify') return { ok: true, state: s, events: [] };
    return { ok: false, error: 'unsupported' };
  },
});

const endTurnAi: RunAiTurn = (state, who, c, sim) => {
  const cmd: Command = state.phase === 'transition' ? { type: 'finishTransition' } : { type: 'endTurn' };
  const r = sim.applyCommand(state, who, cmd, c);
  return r.ok ? { state: r.state, events: r.events } : { state, events: [] };
};
const doNothingAi: RunAiTurn = (state) => ({ state, events: [] });
const throwingAi: RunAiTurn = () => {
  throw new Error('boom');
};

const setup = { seed: 1, mapSize: 'small', speed: 'quick', players: [] } as GameSetup;

const makeHost = (o: { humans: boolean[]; ai?: RunAiTurn; transitionAtTurn?: number; maxAiSteps?: number }) => {
  const posts: FromWorker[] = [];
  const saves = new Saves(createMemoryStore(), (() => {
    let t = 1000;
    return () => t++;
  })());
  const sim = fakeSim(o);
  const host = new SimHost({ sim, runAiTurn: o.ai ?? endTurnAi, content, saves, post: (m) => posts.push(m), maxAiSteps: o.maxAiSteps });
  const states = () => posts.filter((m): m is Extract<FromWorker, { type: 'state' }> => m.type === 'state');
  const errors = () => posts.filter((m) => m.type === 'error');
  const lastState = (): GameState => {
    const s = states().at(-1);
    if (!s) throw new Error('no state posted');
    return s.state;
  };
  const endTurn = (p: PlayerId = 'p1') => host.receive({ type: 'command', player: p, command: { type: 'endTurn' } });
  return { host, posts, saves, states, errors, lastState, endTurn };
};

describe('worker host', () => {
  it('strips affinity from posted snapshots but keeps it in the host and in saves', async () => {
    const h = makeHost({ humans: [true, false] });
    await h.host.receive({ type: 'newGame', setup });
    for (const p of Object.values(h.lastState().players)) expect(p.affinity).toEqual({});
    expect(h.host.current?.players.p1?.affinity).toEqual({ greek: 42, egyptian: 7 });

    await h.host.receive({ type: 'save', slot: 'slot:3' });
    const loaded = await h.saves.load('slot:3');
    expect(loaded.players.p1?.affinity).toEqual({ greek: 42, egyptian: 7 });
    await h.host.receive({ type: 'load', slot: 'slot:3' });
    expect(h.lastState().players.p2?.affinity).toEqual({});
  });

  it('stripHidden does not mutate its input', () => {
    const s = makeState([true]);
    const before = JSON.stringify(s);
    stripHidden(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('runs AI players until a human must act, posting thinking then one state', async () => {
    const h = makeHost({ humans: [true, false, false] });
    await h.host.receive({ type: 'newGame', setup });
    h.posts.length = 0;
    await h.endTurn();
    const types = h.posts.map((m) => m.type);
    expect(types.slice(0, 3)).toEqual(['thinking', 'thinking', 'state']);
    expect(h.posts.slice(0, 2)).toEqual([
      { type: 'thinking', player: 'p2' },
      { type: 'thinking', player: 'p3' },
    ]);
    expect(h.lastState().turn).toBe(2);
    expect(h.lastState().currentPlayer).toBe('p1');
    expect(h.states().at(-1)?.events).toContainEqual({ type: 'turnStarted', turn: 2 });
  });

  it('terminates with a do-nothing AI by forcing endTurn', async () => {
    const h = makeHost({ humans: [true, false], ai: doNothingAi });
    await h.host.receive({ type: 'newGame', setup });
    await h.endTurn();
    expect(h.lastState().turn).toBe(2);
    expect(h.lastState().currentPlayer).toBe('p1');
  });

  it('survives a throwing AI and reports it', async () => {
    const h = makeHost({ humans: [true, false], ai: throwingAi });
    await h.host.receive({ type: 'newGame', setup });
    await h.endTurn();
    expect(h.lastState().turn).toBe(2);
    expect(h.errors().some((e) => e.type === 'error' && e.message.includes('boom'))).toBe(true);
  });

  it('stops all-AI games at the step cap instead of looping forever', async () => {
    const h = makeHost({ humans: [false, false], maxAiSteps: 50 });
    await h.host.receive({ type: 'newGame', setup });
    expect(h.errors().some((e) => e.type === 'error' && e.message.includes('loop guard'))).toBe(true);
    expect(h.states()).toHaveLength(1);
  });

  it('finishes the transition for AI players and waits for the human', async () => {
    const h = makeHost({ humans: [true, false, false], ai: doNothingAi, transitionAtTurn: 2 });
    await h.host.receive({ type: 'newGame', setup });
    await h.endTurn();
    const s = h.lastState();
    expect(s.phase).toBe('transition');
    expect(s.transition?.recap.p2?.done).toBe(true);
    expect(s.transition?.recap.p3?.done).toBe(true);
    expect(s.transition?.recap.p1?.done).toBe(false);
    await h.host.receive({ type: 'command', player: 'p1', command: { type: 'finishTransition' } });
    expect(h.lastState().phase).toBe('playing');
    expect(h.lastState().age).toBe('classical');
  });

  it('a failed command posts an error and leaves state unchanged', async () => {
    const h = makeHost({ humans: [true, false] });
    await h.host.receive({ type: 'newGame', setup });
    const before = JSON.stringify(h.host.current);
    const statesBefore = h.states().length;
    await h.host.receive({ type: 'command', player: 'p2', command: { type: 'endTurn' } });
    expect(h.posts.at(-1)).toEqual({ type: 'error', message: 'not your turn' });
    expect(JSON.stringify(h.host.current)).toBe(before);
    expect(h.states()).toHaveLength(statesBefore);
  });

  it('commands before newGame are errors', async () => {
    const h = makeHost({ humans: [true] });
    await h.endTurn();
    expect(h.posts).toEqual([{ type: 'error', message: 'No game in progress.' }]);
  });

  it('autosaves at each human turn start and keeps a ring of 5, newest first', async () => {
    const h = makeHost({ humans: [true, false] });
    await h.host.receive({ type: 'newGame', setup });
    for (let i = 0; i < 7; i++) await h.endTurn();
    // A command that does not start a new turn must not autosave.
    await h.host.receive({ type: 'command', player: 'p1', command: { type: 'fortify', unit: 'u1' } });
    const list = await h.saves.list();
    expect(list.map((m) => m.slot)).toEqual(['auto:0', 'auto:1', 'auto:2', 'auto:3', 'auto:4']);
    expect(list.map((m) => m.turn)).toEqual([8, 7, 6, 5, 4]);
    const lastSaves = h.posts.filter((m) => m.type === 'saves').at(-1);
    expect(lastSaves).toEqual({ type: 'saves', saves: list });
    expect((await h.saves.load('auto:2')).turn).toBe(6);
  });

  it('save/load round-trips byte-identical JSON', async () => {
    const h = makeHost({ humans: [true, false] });
    await h.host.receive({ type: 'newGame', setup });
    await h.endTurn();
    const original = JSON.stringify(h.host.current);
    await h.host.receive({ type: 'save', slot: 'slot:0' });
    await h.endTurn();
    expect(JSON.stringify(h.host.current)).not.toBe(original);
    await h.host.receive({ type: 'load', slot: 'slot:0' });
    expect(JSON.stringify(h.host.current)).toBe(original);
    expect(JSON.stringify(h.lastState())).toBe(JSON.stringify(stripHidden(JSON.parse(original) as GameState)));
  });

  it('save list, delete and bad slots', async () => {
    const h = makeHost({ humans: [true] });
    await h.host.receive({ type: 'newGame', setup });
    await h.host.receive({ type: 'save', slot: 'slot:9' });
    await h.host.receive({ type: 'save', slot: 'slot:10' });
    expect(h.posts.at(-1)?.type).toBe('error');
    await h.host.receive({ type: 'save', slot: 'auto:0' });
    expect(h.posts.at(-1)?.type).toBe('error');
    await h.host.receive({ type: 'deleteSave', slot: 'slot:9' });
    await h.host.receive({ type: 'listSaves' });
    const last = h.posts.at(-1);
    expect(last?.type === 'saves' && last.saves.map((s) => s.slot)).toEqual(['auto:0']);
    await h.host.receive({ type: 'load', slot: 'slot:4' });
    expect(h.posts.at(-1)).toEqual({ type: 'error', message: 'No save in "slot:4".' });
  });

  it('refuses saves from another schema version', async () => {
    const store = createMemoryStore();
    const saves = new Saves(store);
    const old = { ...makeState([true]), version: 1 } as unknown as GameState;
    await store.put('slot:1', { meta: { slot: 'slot:1', savedAt: 0, turn: 1, age: 'ancient', civName: null, leader: 'x' }, state: old, seq: 1 });
    const posts: FromWorker[] = [];
    const host = new SimHost({ sim: fakeSim({ humans: [true] }), runAiTurn: endTurnAi, content, saves, post: (m) => posts.push(m) });
    await host.receive({ type: 'load', slot: 'slot:1' });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.type === 'error' && posts[0].message).toMatch(/incompatible version/);
    expect(host.current).toBeNull();
  });

  it('reports content errors instead of crashing', async () => {
    const posts: FromWorker[] = [];
    const host = new SimHost({
      sim: fakeSim({ humans: [true] }),
      runAiTurn: endTurnAi,
      content: () => {
        throw new Error('bad content');
      },
      saves: new Saves(createMemoryStore()),
      post: (m) => posts.push(m),
    });
    await host.receive({ type: 'newGame', setup });
    expect(posts).toEqual([{ type: 'error', message: 'bad content' }]);
  });
});
