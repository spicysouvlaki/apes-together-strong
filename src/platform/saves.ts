/**
 * Save games (GDD §5 "Saves"): autosave at every human turn start, last 5 kept, 10 manual slots,
 * plus a rolling "resume" save of the latest state (written by src/worker/host.ts after every
 * accepted command) so a reload or an iOS tab kill mid-turn loses at most about a second.
 *
 * Layers:
 * - `SaveStore`: dumb key/value persistence. `createIdbStore()` (IndexedDB via `idb`, works in a
 *   Worker and on the main thread) and `createMemoryStore()` (tests, Node scripts).
 * - `Saves`: the slot rules on top (autosave ring, resume save, slot names, migration, ownership).
 *
 * Saves hold the REAL GameState, affinity included; only posted snapshots are stripped.
 * `savedAt` is wall-clock time from this platform layer — never from the sim.
 *
 * Public slot names (the frozen protocol, SaveMeta.slot) are 'auto:0'..'auto:4' and
 * 'slot:0'..'slot:9'. 'auto:0' is ALWAYS the newest state of the game: the resume save when it
 * is newer than every turn-start autosave, else the newest turn-start autosave. So Continue
 * ('auto:0') restores mid-turn moves without any protocol or UI change.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { GameState, SaveMeta } from '@contracts/sim-api';
import { DamagedSaveError, SAVE_VERSION, SaveVersionError, assertSaveVersion, migrateState } from './migrate';

export { SAVE_VERSION, assertSaveVersion, migrateState, DamagedSaveError, SaveVersionError };

/** Budget from CLAUDE.md: saves under 2 MB. Measured as JSON length (≈ bytes for ASCII-heavy state). */
export const SAVE_SIZE_LIMIT = 2 * 1024 * 1024;
export const AUTOSAVE_COUNT = 5;
export const MANUAL_SLOT_COUNT = 10;
/** Physical key of the rolling resume save; listed as 'auto:0' while it is the newest. */
export const RESUME_KEY = 'resume';
/** Meta-store key holding the id of the tab that owns the autosaves (see `Saves.claim`). */
const OWNER_KEY = '#owner';

/** One stored save. `seq` is a monotonic write counter that orders autosaves. */
export interface SaveRecord {
  meta: SaveMeta;
  state: GameState;
  seq: number;
}

export interface SaveIndexEntry {
  key: string;
  /** Unvalidated: a corrupt record can hold anything here. */
  meta: SaveMeta;
  seq: number;
  /** `state.version` at write time; absent in records written before it was tracked. */
  version?: number;
}

export interface PutOptions {
  /**
   * Write only if this id owns the saves (or nobody has claimed them yet), checked atomically in
   * the same transaction as the write; otherwise reject with SaveOwnershipError.
   */
  owner?: string;
}

export interface SaveStore {
  get(key: string): Promise<SaveRecord | null>;
  put(key: string, record: SaveRecord, opts?: PutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  /** Metadata of every save, without loading the (large) states. */
  list(): Promise<SaveIndexEntry[]>;
  /** Makes `owner` the owner of the autosaves (last claimer wins). */
  claim(owner: string): Promise<void>;
}

/** Another tab or window claimed the saves after us; this tab must stop autosaving. */
export class SaveOwnershipError extends Error {
  override name = 'SaveOwnershipError';
  constructor() {
    super('This game is open in another tab or window.');
  }
}

const versionOf = (state: unknown): number | undefined => {
  const v = (state as { version?: unknown } | null)?.version;
  return typeof v === 'number' ? v : undefined;
};

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

/** In-memory store; values are structured-cloned like IndexedDB does. */
export const createMemoryStore = (): SaveStore => {
  const data = new Map<string, SaveRecord>();
  let owner: string | null = null;
  return {
    get: async (key) => {
      const r = data.get(key);
      return r ? structuredClone(r) : null;
    },
    put: async (key, record, opts) => {
      if (opts?.owner && owner !== null && owner !== opts.owner) throw new SaveOwnershipError();
      data.set(key, structuredClone(record));
    },
    delete: async (key) => {
      data.delete(key);
    },
    list: async () =>
      [...data.entries()].map(([key, r]) => ({ key, meta: structuredClone(r.meta), seq: r.seq, version: versionOf(r.state) })),
    claim: async (id) => {
      owner = id;
    },
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
    if (!dbPromise) {
      const opening = openDB(dbName, DB_VERSION, {
        upgrade(database) {
          if (!database.objectStoreNames.contains(META)) database.createObjectStore(META);
          if (!database.objectStoreNames.contains(STATES)) database.createObjectStore(STATES);
        },
        // A newer build in another tab wants to upgrade the schema: get out of its way and
        // reopen (at the new version, which then fails loudly here) on the next save.
        blocking() {
          void opening.then((d) => d.close());
          dbPromise = null;
        },
        // The browser closed the connection (storage cleared, Safari eviction): reopen next time.
        terminated() {
          dbPromise = null;
        },
      });
      dbPromise = opening;
      // A failed open (private mode, blocked upgrade, disk error) must not poison every later
      // attempt: forget it so the next save retries.
      opening.catch(() => {
        if (dbPromise === opening) dbPromise = null;
      });
    }
    return dbPromise;
  };
  return {
    async get(key) {
      const d = await db();
      const tx = d.transaction([META, STATES], 'readonly');
      const [m, s] = await Promise.all([tx.objectStore(META).get(key), tx.objectStore(STATES).get(key), tx.done]);
      if (!m || !s) return null;
      const idx = m as { meta: SaveMeta; seq: number };
      return { meta: idx.meta, seq: idx.seq, state: s as GameState };
    },
    async put(key, record, opts) {
      const d = await db();
      const tx = d.transaction([META, STATES], 'readwrite');
      const meta = tx.objectStore(META);
      if (opts?.owner) {
        const current: unknown = await meta.get(OWNER_KEY);
        if (current !== undefined && current !== opts.owner) {
          tx.abort();
          await tx.done.catch(() => undefined);
          throw new SaveOwnershipError();
        }
      }
      await Promise.all([
        meta.put({ meta: record.meta, seq: record.seq, version: versionOf(record.state) }, key),
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
      const [keys, values] = await Promise.all([store.getAllKeys(), store.getAll(), tx.done]);
      const out: SaveIndexEntry[] = [];
      keys.forEach((k, i) => {
        const key = String(k);
        if (key.startsWith('#')) return; // bookkeeping keys such as OWNER_KEY
        const v = values[i] as { meta?: SaveMeta; seq?: unknown; version?: unknown } | null | undefined;
        out.push({
          key,
          meta: v?.meta as SaveMeta,
          seq: typeof v?.seq === 'number' ? v.seq : -1,
          version: typeof v?.version === 'number' ? v.version : undefined,
        });
      });
      return out;
    },
    async claim(owner) {
      const d = await db();
      const tx = d.transaction(META, 'readwrite');
      await Promise.all([tx.objectStore(META).put(owner, OWNER_KEY), tx.done]);
    },
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** JSON length of a state; compare with SAVE_SIZE_LIMIT. */
export const saveSize = (state: GameState): number => JSON.stringify(state).length;

export const isManualSlot = (slot: string): boolean => /^slot:\d+$/.test(slot) && Number(slot.slice(5)) < MANUAL_SLOT_COUNT;
export const isAutoSlot = (slot: string): boolean => /^auto:\d+$/.test(slot) && Number(slot.slice(5)) < AUTOSAVE_COUNT;
const isRingKey = isAutoSlot;

/** Meta for the save list: describes the first human player (else the first player). */
export const metaFor = (state: GameState, slot: string, savedAt: number): SaveMeta => {
  const human = state.playerOrder.map((id) => state.players[id]).find((p) => p?.isHuman);
  const who = human ?? state.players[state.playerOrder[0] ?? ''];
  return { slot, savedAt, turn: state.turn, age: state.age, civName: who?.civName ?? null, leader: who?.leader ?? '' };
};

/** True for a well-formed SaveMeta (records in IndexedDB can be corrupt or hand-edited). */
export const isValidMeta = (m: unknown): m is SaveMeta => {
  if (typeof m !== 'object' || m === null) return false;
  const r = m as Record<string, unknown>;
  return (
    typeof r.slot === 'string' &&
    typeof r.savedAt === 'number' &&
    typeof r.turn === 'number' &&
    typeof r.age === 'string' &&
    (r.civName === null || typeof r.civName === 'string') &&
    typeof r.leader === 'string'
  );
};

/** Player-facing text for a failed save (quota, private mode, disk errors). */
export const describeStorageError = (err: unknown): string => {
  const name = (err as { name?: unknown } | null)?.name;
  const msg = err instanceof Error ? err.message : String(err);
  if (name === 'QuotaExceededError' || /quota/i.test(msg)) {
    return 'Saving failed: this device has no storage space left for the game. You can keep playing, but progress is not being saved until space is freed.';
  }
  return `Saving failed: storage is unavailable (${msg || String(name)}). Private browsing can cause this. You can keep playing, but progress is not being saved.`;
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

const randomId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  // Wall clock + Math.random is fine here: this is platform code, never the sim.
  return c?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

// ---------------------------------------------------------------------------
// Slot rules
// ---------------------------------------------------------------------------

/** A save that was left out of the list or skipped on load, and why. */
export interface SkippedSave {
  key: string;
  reason: 'damaged' | 'version';
}

export interface SaveListing {
  saves: SaveMeta[];
  skipped: SkippedSave[];
}

export interface LoadResult {
  state: GameState;
  /** Newer autosaves that could not be read, so an older one was loaded instead. */
  skipped: SkippedSave[];
}

const skipReason = (err: unknown): SkippedSave['reason'] => (err instanceof SaveVersionError ? 'version' : 'damaged');

/**
 * Autosaves are written round-robin into physical keys `auto:0..4`; `list()` relabels them by
 * recency so 'auto:0' is always the newest. This avoids copying 2 MB states every turn.
 * The resume save (physical key `resume`) joins that recency order only while it is newer than
 * every turn-start autosave; once a turn-start autosave supersedes it, it is hidden.
 *
 * Ownership: every Saves instance has an `owner` id. Autosaves and resume saves are written
 * only while this owner holds the claim (`claim()`, last claimer wins), checked atomically in
 * the write transaction, so two tabs never interleave autosaves. Manual saves are explicit
 * player actions and are always allowed.
 */
export class Saves {
  private lastSeq = 0;

  constructor(
    private readonly store: SaveStore,
    private readonly now: () => number = () => Date.now(),
    readonly owner: string = randomId(),
  ) {}

  private async validEntries(): Promise<{ entries: SaveIndexEntry[]; skipped: SkippedSave[] }> {
    const entries: SaveIndexEntry[] = [];
    const skipped: SkippedSave[] = [];
    for (const e of await this.store.list()) {
      if (!isRingKey(e.key) && !isManualSlot(e.key) && e.key !== RESUME_KEY) continue;
      if (!isValidMeta(e.meta)) skipped.push({ key: e.key, reason: 'damaged' });
      else if (e.version !== undefined && e.version !== SAVE_VERSION) skipped.push({ key: e.key, reason: 'version' });
      else entries.push(e);
    }
    return { entries, skipped };
  }

  /** Ring autosaves plus the resume save if it is the newest, newest first. */
  private static autosNewestFirst(entries: SaveIndexEntry[]): SaveIndexEntry[] {
    const ring = entries.filter((e) => isRingKey(e.key)).sort((a, b) => b.seq - a.seq);
    const resume = entries.find((e) => e.key === RESUME_KEY);
    if (resume && resume.seq > (ring[0]?.seq ?? -Infinity)) return [resume, ...ring];
    return ring;
  }

  private async nextSeq(): Promise<number> {
    const all = await this.store.list();
    const max = all.reduce((m, e) => Math.max(m, typeof e.seq === 'number' ? e.seq : 0), 0);
    this.lastSeq = Math.max(max, this.lastSeq) + 1;
    return this.lastSeq;
  }

  /** Take over the autosaves for this tab (see class comment). */
  async claim(): Promise<void> {
    await this.store.claim(this.owner);
  }

  async autosave(state: GameState): Promise<void> {
    assertSaveVersion(state);
    const ring = (await this.store.list()).filter((e) => isRingKey(e.key)).sort((a, b) => b.seq - a.seq);
    let key: string | undefined;
    if (ring.length < AUTOSAVE_COUNT) {
      const used = new Set(ring.map((a) => a.key));
      for (let i = 0; i < AUTOSAVE_COUNT && key === undefined; i++) if (!used.has(`auto:${i}`)) key = `auto:${i}`;
    }
    key ??= ring[ring.length - 1]?.key ?? 'auto:0';
    await this.store.put(key, { meta: metaFor(state, key, this.now()), state, seq: await this.nextSeq() }, { owner: this.owner });
  }

  /** The rolling latest-state save; listed as 'auto:0' until the next turn-start autosave. */
  async saveResume(state: GameState): Promise<void> {
    assertSaveVersion(state);
    await this.store.put(RESUME_KEY, { meta: metaFor(state, RESUME_KEY, this.now()), state, seq: await this.nextSeq() }, { owner: this.owner });
  }

  async save(slot: string, state: GameState): Promise<void> {
    if (!isManualSlot(slot)) throw new Error(`Cannot save to "${slot}": use slot:0 to slot:${MANUAL_SLOT_COUNT - 1}.`);
    assertSaveVersion(state);
    await this.store.put(slot, { meta: metaFor(state, slot, this.now()), state, seq: await this.nextSeq() });
  }

  /** Physical keys a public slot name may load from, preferred first. */
  private async candidates(slot: string): Promise<string[]> {
    if (isManualSlot(slot)) return [slot];
    if (isAutoSlot(slot)) {
      const autos = Saves.autosNewestFirst((await this.validEntries()).entries);
      return autos.slice(Number(slot.slice(5))).map((e) => e.key);
    }
    return [];
  }

  /**
   * Loads and migrates a save. For an autosave slot, a damaged or incompatible record is
   * skipped in favor of the next older autosave (reported in `skipped`), so Continue survives
   * one bad write. A manual slot is loaded or fails.
   */
  async loadDetailed(slot: string): Promise<LoadResult> {
    const keys = await this.candidates(slot);
    const skipped: SkippedSave[] = [];
    let firstError: unknown = null;
    for (const key of keys) {
      try {
        const record = await this.store.get(key);
        if (!record) throw new DamagedSaveError(`No save in "${slot}".`);
        return { state: migrateState(record.state), skipped };
      } catch (err) {
        firstError ??= err;
        skipped.push({ key, reason: skipReason(err) });
      }
    }
    if (firstError) throw firstError;
    throw new Error(`No save in "${slot}".`);
  }

  async load(slot: string): Promise<GameState> {
    return (await this.loadDetailed(slot)).state;
  }

  /** The stored meta of a public slot (for export file names); null if empty. */
  async metaOf(slot: string): Promise<SaveMeta | null> {
    return (await this.list()).find((m) => m.slot === slot) ?? null;
  }

  async delete(slot: string): Promise<void> {
    const [key] = await this.candidates(slot);
    if (key) await this.store.delete(key);
  }

  /** Autosaves newest first ('auto:0'..), then manual slots in slot order; bad records skipped. */
  async listDetailed(): Promise<SaveListing> {
    const { entries, skipped } = await this.validEntries();
    const autos = Saves.autosNewestFirst(entries)
      .slice(0, AUTOSAVE_COUNT)
      .map((e, i) => ({ ...e.meta, slot: `auto:${i}` }));
    const manual = entries
      .filter((e) => isManualSlot(e.key))
      .sort((a, b) => Number(a.key.slice(5)) - Number(b.key.slice(5)))
      .map((e) => ({ ...e.meta, slot: e.key }));
    return { saves: [...autos, ...manual], skipped };
  }

  async list(): Promise<SaveMeta[]> {
    return (await this.listDetailed()).saves;
  }
}
