/**
 * Save games (GDD §5 "Saves"): autosave at every human turn start, last 5 kept, 10 manual slots.
 *
 * Layers:
 * - `SaveStore`: dumb key/value persistence. `createIdbStore()` (IndexedDB via `idb`, works in a
 *   Worker) and `createMemoryStore()` (tests, Node scripts).
 * - `Saves`: the slot rules on top (autosave ring, slot names, version guard, size check).
 *
 * Saves hold the REAL GameState, affinity included; only posted snapshots are stripped.
 * `savedAt` is wall-clock time from this platform layer — never from the sim.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { GameState, SaveMeta } from '@contracts/sim-api';

export const SAVE_VERSION = 2;
/** Budget from CLAUDE.md: saves under 2 MB. Measured as JSON length (≈ bytes for ASCII-heavy state). */
export const SAVE_SIZE_LIMIT = 2 * 1024 * 1024;
export const AUTOSAVE_COUNT = 5;
export const MANUAL_SLOT_COUNT = 10;

/** One stored save. `seq` is a monotonic write counter that orders autosaves. */
export interface SaveRecord {
  meta: SaveMeta;
  state: GameState;
  seq: number;
}

export interface SaveIndexEntry {
  key: string;
  meta: SaveMeta;
  seq: number;
}

export interface SaveStore {
  get(key: string): Promise<SaveRecord | null>;
  put(key: string, record: SaveRecord): Promise<void>;
  delete(key: string): Promise<void>;
  /** Metadata of every save, without loading the (large) states. */
  list(): Promise<SaveIndexEntry[]>;
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

/** In-memory store; values are structured-cloned like IndexedDB does. */
export const createMemoryStore = (): SaveStore => {
  const data = new Map<string, SaveRecord>();
  return {
    get: async (key) => {
      const r = data.get(key);
      return r ? structuredClone(r) : null;
    },
    put: async (key, record) => {
      data.set(key, structuredClone(record));
    },
    delete: async (key) => {
      data.delete(key);
    },
    list: async () => [...data.entries()].map(([key, r]) => ({ key, meta: structuredClone(r.meta), seq: r.seq })),
  };
};

const DB_NAME = 'apes-together-strong';
const DB_VERSION = 1;
/**
 * Two object stores written in one transaction: `meta` (small, read by the save list) and
 * `states` (large). Splitting them means listing saves never deserializes 15 full games.
 */
const META = 'meta';
const STATES = 'states';

export const createIdbStore = (dbName: string = DB_NAME): SaveStore => {
  let dbPromise: Promise<IDBPDatabase> | null = null;
  const db = (): Promise<IDBPDatabase> => {
    dbPromise ??= openDB(dbName, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(META)) database.createObjectStore(META);
        if (!database.objectStoreNames.contains(STATES)) database.createObjectStore(STATES);
      },
    });
    return dbPromise;
  };
  return {
    async get(key) {
      const d = await db();
      const tx = d.transaction([META, STATES], 'readonly');
      const [m, s] = await Promise.all([tx.objectStore(META).get(key), tx.objectStore(STATES).get(key)]);
      await tx.done;
      if (!m || !s) return null;
      const idx = m as { meta: SaveMeta; seq: number };
      return { meta: idx.meta, seq: idx.seq, state: s as GameState };
    },
    async put(key, record) {
      const d = await db();
      const tx = d.transaction([META, STATES], 'readwrite');
      await Promise.all([
        tx.objectStore(META).put({ meta: record.meta, seq: record.seq }, key),
        tx.objectStore(STATES).put(record.state, key),
        tx.done,
      ]);
    },
    async delete(key) {
      const d = await db();
      const tx = d.transaction([META, STATES], 'readwrite');
      await Promise.all([tx.objectStore(META).delete(key), tx.objectStore(STATES).delete(key), tx.done]);
    },
    async list() {
      const d = await db();
      const tx = d.transaction(META, 'readonly');
      const store = tx.objectStore(META);
      const [keys, values] = await Promise.all([store.getAllKeys(), store.getAll()]);
      await tx.done;
      return keys.map((k, i) => {
        const v = values[i] as { meta: SaveMeta; seq: number };
        return { key: String(k), meta: v.meta, seq: v.seq };
      });
    },
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** JSON length of a state; compare with SAVE_SIZE_LIMIT. */
export const saveSize = (state: GameState): number => JSON.stringify(state).length;

/** Throws a player-readable error if this save was written by an incompatible version. */
export const assertSaveVersion = (state: { version?: unknown } | null | undefined): void => {
  const v = state?.version;
  if (v !== SAVE_VERSION) {
    throw new Error(`This save is from an incompatible version of the game (save version ${String(v)}, expected ${SAVE_VERSION}) and cannot be loaded.`);
  }
};

export const isManualSlot = (slot: string): boolean => /^slot:\d+$/.test(slot) && Number(slot.slice(5)) < MANUAL_SLOT_COUNT;
export const isAutoSlot = (slot: string): boolean => /^auto:\d+$/.test(slot) && Number(slot.slice(5)) < AUTOSAVE_COUNT;

/** Meta for the save list: describes the first human player (else the first player). */
export const metaFor = (state: GameState, slot: string, savedAt: number): SaveMeta => {
  const human = state.playerOrder.map((id) => state.players[id]).find((p) => p?.isHuman);
  const who = human ?? state.players[state.playerOrder[0] ?? ''];
  return { slot, savedAt, turn: state.turn, age: state.age, civName: who?.civName ?? null, leader: who?.leader ?? '' };
};

/**
 * Asks the browser not to evict our storage (Safari evicts script-writable storage of sites
 * not used for 7 days unless the app is installed to the Home Screen). Main thread only.
 */
export const requestPersistentStorage = async (): Promise<boolean> => {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Slot rules
// ---------------------------------------------------------------------------

/**
 * Autosaves are written round-robin into physical keys `auto:0..4`; `list()` relabels them by
 * recency so 'auto:0' is always the newest. This avoids copying 2 MB states every turn.
 */
export class Saves {
  constructor(
    private readonly store: SaveStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async autoEntriesNewestFirst(): Promise<SaveIndexEntry[]> {
    const all = await this.store.list();
    return all.filter((e) => e.key.startsWith('auto:')).sort((a, b) => b.seq - a.seq);
  }

  private async nextSeq(): Promise<number> {
    const all = await this.store.list();
    return all.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
  }

  async autosave(state: GameState): Promise<void> {
    assertSaveVersion(state);
    const autos = await this.autoEntriesNewestFirst();
    let key: string | undefined;
    if (autos.length < AUTOSAVE_COUNT) {
      const used = new Set(autos.map((a) => a.key));
      for (let i = 0; i < AUTOSAVE_COUNT && key === undefined; i++) if (!used.has(`auto:${i}`)) key = `auto:${i}`;
    }
    key ??= autos[autos.length - 1]?.key ?? 'auto:0';
    // Extra physical keys (should never exist) are trimmed so the ring stays at 5.
    for (const extra of autos.slice(AUTOSAVE_COUNT)) await this.store.delete(extra.key);
    await this.store.put(key, { meta: metaFor(state, key, this.now()), state, seq: await this.nextSeq() });
  }

  async save(slot: string, state: GameState): Promise<void> {
    if (!isManualSlot(slot)) throw new Error(`Cannot save to "${slot}": use slot:0 to slot:${MANUAL_SLOT_COUNT - 1}.`);
    assertSaveVersion(state);
    await this.store.put(slot, { meta: metaFor(state, slot, this.now()), state, seq: await this.nextSeq() });
  }

  /** Resolves a public slot name ('auto:k' = k-th newest autosave) to a physical key. */
  private async resolve(slot: string): Promise<string | null> {
    if (isManualSlot(slot)) return slot;
    if (isAutoSlot(slot)) {
      const autos = await this.autoEntriesNewestFirst();
      return autos[Number(slot.slice(5))]?.key ?? null;
    }
    return null;
  }

  async load(slot: string): Promise<GameState> {
    const key = await this.resolve(slot);
    const record = key ? await this.store.get(key) : null;
    if (!record) throw new Error(`No save in "${slot}".`);
    assertSaveVersion(record.state);
    return record.state;
  }

  async delete(slot: string): Promise<void> {
    const key = await this.resolve(slot);
    if (key) await this.store.delete(key);
  }

  /** Autosaves newest first ('auto:0'..), then manual slots in slot order. */
  async list(): Promise<SaveMeta[]> {
    const autos = (await this.autoEntriesNewestFirst()).slice(0, AUTOSAVE_COUNT).map((e, i) => ({ ...e.meta, slot: `auto:${i}` }));
    const manual = (await this.store.list())
      .filter((e) => isManualSlot(e.key))
      .sort((a, b) => Number(a.key.slice(5)) - Number(b.key.slice(5)))
      .map((e) => ({ ...e.meta, slot: e.key }));
    return [...autos, ...manual];
  }
}
