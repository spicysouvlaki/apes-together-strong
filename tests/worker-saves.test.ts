/**
 * Save robustness in the worker host: rolling resume save, reload recovery, two-tab guard and
 * storage failures. A fake sim keeps these about saving, not rules.
 */
import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '@contracts/content-schemas';
import type { Command, FromWorker, GameSetup, GameState, PlayerState, Sim } from '@contracts/sim-api';
import { RESUME_KEY, Saves, createMemoryStore, type SaveRecord, type SaveStore } from '../src/platform/saves';
import { createMemoryTabBus, type TabChannel } from '../src/platform/tab-guard';
import { NOT_SAVING_MESSAGE, OWNERSHIP_LOST_MESSAGE, SimHost, type RunAiTurn } from '../src/worker/host';

const content = {} as ContentBundle;
const setup = { seed: 1, mapSize: 'small', speed: 'quick', players: [] } as unknown as GameSetup;

const makeState = (seed = 1): GameState =>
  ({
    version: 2,
    seed,
    speed: 'quick',
    mapSize: 'small',
    finalAge: 'classical',
    difficulty: 'normal',
    turn: 1,
    age: 'ancient',
    phase: 'playing',
    currentPlayer: 'p1',
    ageProgress: 0,
    rng: [1, 2, 3, 4],
    nextId: 1,
    map: {},
    playerOrder: ['p1', 'p2'],
    players: {
      p1: { id: 'p1', isHuman: true, leader: 'builder', civName: null, alive: true, affinity: { greek: 5 } },
      p2: { id: 'p2', isHuman: false, leader: 'builder', civName: null, alive: true, affinity: {} },
    } as unknown as Record<string, PlayerState>,
    settlements: {},
    units: {},
    figures: {},
    offers: [],
    deedsDone: [],
    wonders: {},
    cityStates: {},
    tradeRoutes: [],
    wars: {},
    crisis: null,
    transition: null,
    result: null,
  }) as unknown as GameState;

/** endTurn passes to the next player; 'fortify' stands for any mid-turn move: it bumps nextId. */
const fakeSim = (seed = 1): Sim => ({
  createGame: () => ({ state: makeState(seed), events: [] }),
  applyCommand: (state, who, command: Command) => {
    const s = structuredClone(state);
    if (command.type === 'fortify') {
      s.nextId += 1;
      return { ok: true, state: s, events: [] };
    }
    if (command.type === 'endTurn' && s.currentPlayer === who) {
      const i = s.playerOrder.indexOf(who);
      if (i === s.playerOrder.length - 1) {
        s.turn += 1;
        s.currentPlayer = s.playerOrder[0] ?? who;
      } else s.currentPlayer = s.playerOrder[i + 1] ?? who;
      return { ok: true, state: s, events: [] };
    }
    return { ok: false, error: 'rejected' };
  },
});

const endTurnAi: RunAiTurn = (state, who, c, sim) => {
  const r = sim.applyCommand(state, who, { type: 'endTurn' }, c);
  return r.ok ? { state: r.state, events: r.events } : { state, events: [] };
};

/** A store whose puts can be held open (to test coalescing) or made to fail. */
const instrumentedStore = (inner: SaveStore = createMemoryStore()) => {
  const puts: { key: string; nextId: number }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let gate: Promise<void> | null = null;
  let release: () => void = () => undefined;
  let failWith: unknown = null;
  const store: SaveStore = {
    ...inner,
    get: (k) => inner.get(k),
    delete: (k) => inner.delete(k),
    list: () => inner.list(),
    claim: (o) => inner.claim(o),
    put: async (key, record: SaveRecord, opts) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (gate) await gate;
        if (failWith) throw failWith;
        await inner.put(key, record, opts);
        puts.push({ key, nextId: record.state.nextId });
      } finally {
        inFlight--;
      }
    },
  };
  return {
    store,
    puts,
    maxInFlight: () => maxInFlight,
    inFlight: () => inFlight,
    hold: () => {
      gate = new Promise((r) => (release = r));
    },
    release: () => {
      gate = null;
      release();
    },
    fail: (err: unknown) => {
      failWith = err;
    },
  };
};

let clock = 1000;
const makeHost = (store: SaveStore, o: { tabs?: TabChannel; seed?: number } = {}) => {
  const posts: FromWorker[] = [];
  const saves = new Saves(store, () => clock++);
  const host = new SimHost({ sim: fakeSim(o.seed), runAiTurn: endTurnAi, content, saves, post: (m) => posts.push(m), tabs: o.tabs });
  const errors = () => posts.flatMap((m) => (m.type === 'error' ? [m.message] : []));
  const lastState = (): GameState => {
    const s = posts.filter((m) => m.type === 'state').at(-1);
    if (!s || s.type !== 'state') throw new Error('no state');
    return s.state;
  };
  const move = () => host.receive({ type: 'command', player: 'p1', command: { type: 'fortify', unit: 'u1' } });
  const endTurn = () => host.receive({ type: 'command', player: 'p1', command: { type: 'endTurn' } });
  return { host, posts, saves, errors, lastState, move, endTurn };
};

describe('rolling resume save', () => {
  it('writes after every accepted command and lists it as auto:0 (newest first)', async () => {
    const st = instrumentedStore();
    const h = makeHost(st.store);
    await h.host.receive({ type: 'newGame', setup });
    await h.move();
    await h.host.flush();
    const list = await h.saves.list();
    expect(list.map((m) => m.slot)).toEqual(['auto:0', 'auto:1']);
    expect((await h.saves.load('auto:0')).nextId).toBe(2); // the move
    expect((await h.saves.load('auto:1')).nextId).toBe(1); // the turn start
    // A rejected command writes nothing.
    const before = st.puts.length;
    await h.host.receive({ type: 'command', player: 'p2', command: { type: 'endTurn' } });
    await h.host.flush();
    expect(st.puts.length).toBe(before);
  });

  it('coalesces rapid commands: one write in flight, latest state wins, final flush lands', async () => {
    const st = instrumentedStore();
    const h = makeHost(st.store);
    await h.host.receive({ type: 'newGame', setup });
    st.hold();
    for (let i = 0; i < 10; i++) await h.move(); // the queue is never blocked by the held write
    expect(h.lastState().nextId).toBe(11);
    st.release();
    await h.host.flush();
    const resumes = st.puts.filter((p) => p.key === RESUME_KEY);
    // The first write started at once (state after move 1); everything after coalesced into one.
    expect(resumes.map((p) => p.nextId)).toEqual([2, 11]);
    expect(st.maxInFlight()).toBe(1);
    expect((await h.saves.load('auto:0')).nextId).toBe(11);
  });

  it('a write starts immediately when the writer is idle', async () => {
    const st = instrumentedStore();
    const h = makeHost(st.store);
    await h.host.receive({ type: 'newGame', setup });
    st.hold();
    await h.move();
    // The write for this exact state has already begun (it is held inside put).
    for (let i = 0; i < 5 && st.inFlight() === 0; i++) await Promise.resolve();
    expect(st.inFlight()).toBe(1);
    st.release();
    await h.host.flush();
    expect(st.puts.at(-1)).toEqual({ key: RESUME_KEY, nextId: 2 });
  });

  it('a turn-start autosave supersedes an older in-flight resume and ranks newest', async () => {
    const st = instrumentedStore();
    const h = makeHost(st.store);
    await h.host.receive({ type: 'newGame', setup });
    st.hold();
    await h.move();
    const ending = h.endTurn(); // waits for the held resume write, then writes the ring
    st.release();
    await ending;
    await h.host.flush();
    const list = await h.saves.list();
    expect(list.map((m) => `${m.slot}=${m.turn}`)).toEqual(['auto:0=2', 'auto:1=1']);
    expect((await h.saves.load('auto:0')).turn).toBe(2);
  });

  it('listSaves waits for the pending resume so the list shows the latest move', async () => {
    const h = makeHost(createMemoryStore());
    await h.host.receive({ type: 'newGame', setup });
    await h.move();
    await h.host.receive({ type: 'listSaves' });
    const last = h.posts.filter((m) => m.type === 'saves').at(-1);
    expect(last?.type === 'saves' && last.saves.length).toBe(2);
  });
});

describe('reload simulation', () => {
  it.each([1, 3, 7])('after %i moves a new host Continues from the latest state, not the turn start', async (n) => {
    const store = createMemoryStore();
    const a = makeHost(store);
    await a.host.receive({ type: 'newGame', setup });
    await a.endTurn();
    for (let i = 0; i < n; i++) await a.move();
    await a.host.flush();
    const expected = JSON.stringify(a.host.current);
    // The page reloads: the old worker is gone, a new one starts with the same IndexedDB.
    const b = makeHost(store);
    await b.host.receive({ type: 'listSaves' });
    await b.host.receive({ type: 'load', slot: 'auto:0' });
    expect(JSON.stringify(b.host.current)).toBe(expected);
    expect(b.lastState().nextId).toBe(1 + n);
    expect(b.errors()).toEqual([]);
  });

  it('a reload right after a move (write still in flight) at worst loses only that move', async () => {
    const st = instrumentedStore();
    const a = makeHost(st.store);
    await a.host.receive({ type: 'newGame', setup });
    await a.move();
    await a.host.flush();
    st.hold();
    await a.move(); // killed before this write lands
    const b = makeHost(st.store);
    await b.host.receive({ type: 'load', slot: 'auto:0' });
    expect(b.host.current?.nextId).toBe(2);
  });

  it('loading a manual slot makes it the Continue game', async () => {
    const store = createMemoryStore();
    const a = makeHost(store);
    await a.host.receive({ type: 'newGame', setup });
    await a.move();
    await a.host.receive({ type: 'save', slot: 'slot:2' });
    await a.move();
    await a.move();
    await a.host.receive({ type: 'load', slot: 'slot:2' });
    await a.host.flush();
    expect((await a.saves.load('auto:0')).nextId).toBe(2);
  });
});

describe('two-tab guard', () => {
  it('the newest tab takes over; the older one stops autosaving and is told once', async () => {
    const store = createMemoryStore();
    const bus = createMemoryTabBus();
    const a = makeHost(store, { tabs: bus.channel() });
    await a.host.receive({ type: 'newGame', setup });
    await a.move();
    await a.host.flush();
    const b = makeHost(store, { tabs: bus.channel() });
    await b.host.receive({ type: 'load', slot: 'auto:0' });
    expect(a.errors()).toEqual([OWNERSHIP_LOST_MESSAGE]);
    expect(b.errors()).toEqual([]);
    await b.move();
    await b.host.flush();
    // A keeps playing in memory but never writes over B.
    for (let i = 0; i < 5; i++) await a.move();
    await a.host.flush();
    expect((await b.saves.load('auto:0')).nextId).toBe(3);
    await a.endTurn();
    expect(a.errors()).toEqual([OWNERSHIP_LOST_MESSAGE, NOT_SAVING_MESSAGE]);
    expect((await b.saves.list())[0]?.turn).toBe(1);
  });

  it('without the channel (frozen tab) the atomic owner check still stops the old tab', async () => {
    const store = createMemoryStore();
    const a = makeHost(store);
    await a.host.receive({ type: 'newGame', setup });
    const b = makeHost(store, { seed: 2 });
    await b.host.receive({ type: 'newGame', setup });
    await b.move();
    await b.host.flush();
    await a.move();
    await a.move();
    await a.host.flush();
    expect(a.errors()).toEqual([OWNERSHIP_LOST_MESSAGE]);
    expect((await b.saves.load('auto:0')).seed).toBe(2);
  });

  it('never blocks a single tab, including after a crash of the previous one', async () => {
    const store = createMemoryStore();
    const a = makeHost(store);
    await a.host.receive({ type: 'newGame', setup });
    // `a` crashes without releasing anything; a fresh tab just works.
    const c = makeHost(store);
    await c.host.receive({ type: 'load', slot: 'auto:0' });
    await c.move();
    await c.host.flush();
    expect(c.errors()).toEqual([]);
    expect((await c.saves.load('auto:0')).nextId).toBe(2);
  });

  it('manual saves from the older tab are still allowed', async () => {
    const store = createMemoryStore();
    const bus = createMemoryTabBus();
    const a = makeHost(store, { tabs: bus.channel() });
    await a.host.receive({ type: 'newGame', setup });
    const b = makeHost(store, { tabs: bus.channel() });
    await b.host.receive({ type: 'load', slot: 'auto:0' });
    await a.host.receive({ type: 'save', slot: 'slot:1' });
    expect(a.posts.at(-1)?.type).toBe('saves');
  });
});

describe('storage failures', () => {
  const quota = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });

  it('reports a failing autosave once, keeps playing in memory, and re-arms after a success', async () => {
    const st = instrumentedStore();
    const h = makeHost(st.store);
    await h.host.receive({ type: 'newGame', setup });
    st.fail(quota);
    await h.move();
    await h.move();
    await h.endTurn();
    await h.host.flush();
    expect(h.errors()).toHaveLength(1);
    expect(h.errors()[0]).toMatch(/no storage space left/);
    expect(h.lastState().turn).toBe(2); // the game went on
    st.fail(null);
    await h.move();
    await h.host.flush();
    st.fail(new Error('disk on fire'));
    await h.move();
    await h.host.flush();
    expect(h.errors()).toHaveLength(2);
    expect(h.errors()[1]).toMatch(/storage is unavailable \(disk on fire\)/);
  });

  it('an explicit save always reports its failure', async () => {
    const st = instrumentedStore();
    const h = makeHost(st.store);
    await h.host.receive({ type: 'newGame', setup });
    st.fail(quota);
    await h.host.receive({ type: 'save', slot: 'slot:0' });
    await h.host.receive({ type: 'save', slot: 'slot:0' });
    expect(h.errors().filter((e) => /no storage space/.test(e))).toHaveLength(2);
  });

  it('a corrupt record never breaks the list or Continue: skipped and reported once', async () => {
    const store = createMemoryStore();
    const a = makeHost(store);
    await a.host.receive({ type: 'newGame', setup });
    await a.endTurn();
    await a.host.flush();
    // Corrupt the newest autosave's state and a manual slot's meta.
    const newest = (await store.list()).sort((x, y) => y.seq - x.seq)[0];
    if (!newest) throw new Error('no save');
    const rec = await store.get(newest.key);
    if (!rec) throw new Error('no record');
    await store.put(newest.key, { ...rec, state: { garbage: true } as unknown as GameState });
    await store.put('slot:3', { meta: { nope: 1 } as never, state: makeState(), seq: 99 });
    await store.put('slot:4', { meta: { slot: 'slot:4', savedAt: 1, turn: 1, age: 'ancient', civName: null, leader: 'x' }, state: { ...makeState(), version: 7 } as never, seq: 100 });

    const b = makeHost(store);
    await b.host.receive({ type: 'listSaves' });
    await b.host.receive({ type: 'listSaves' });
    const list = b.posts.filter((m) => m.type === 'saves').at(-1);
    expect(list?.type === 'saves' && list.saves.map((s) => s.slot)).toEqual(['auto:0', 'auto:1']);
    expect(b.errors()).toEqual(['Skipped 1 damaged save and 1 save from an incompatible version in the save list.']);
    await b.host.receive({ type: 'load', slot: 'auto:0' });
    expect(b.host.current?.turn).toBe(1); // fell back to the older autosave
    expect(b.errors().at(-1)).toMatch(/newest autosave could not be read .*older one was loaded/);
  });
});
