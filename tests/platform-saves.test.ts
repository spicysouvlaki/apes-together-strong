/** Save migration, resume-slot ordering, ownership and export/import validation (src/platform). */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@contracts/sim-api';
import { DamagedSaveError, SaveVersionError, migrateState } from '../src/platform/migrate';
import { RESUME_KEY, SaveOwnershipError, Saves, createMemoryStore, describeStorageError, isValidMeta } from '../src/platform/saves';
import { EXPORT_FORMAT, IMPORT_MAX_BYTES, IMPORT_SLOT, buildExport, exportFileName, exportSlot, importToSlot, parseImport } from '../src/platform/transfer';
import { createMemoryTabBus } from '../src/platform/tab-guard';

const full = (turn = 1, extra: Record<string, unknown> = {}): GameState =>
  ({
    version: 2,
    seed: 3,
    speed: 'quick',
    mapSize: 'small',
    finalAge: 'classical',
    difficulty: 'hard',
    turn,
    age: 'ancient',
    phase: 'playing',
    currentPlayer: 'me',
    ageProgress: 12,
    rng: [1, 2, 3, 4],
    nextId: 9,
    map: { width: 1, height: 1, tiles: [] },
    playerOrder: ['me'],
    players: { me: { id: 'me', isHuman: true, leader: 'builder', civName: null, affinity: { greek: 3 } } },
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
    ...extra,
  }) as unknown as GameState;

describe('migrateState', () => {
  it('passes a current save through unchanged', () => {
    const s = full();
    expect(JSON.stringify(migrateState(s))).toBe(JSON.stringify(s));
  });

  it('fills fields added since the first deploy (difficulty) with safe defaults, without mutating', () => {
    const old = full() as unknown as Record<string, unknown>;
    delete old.difficulty;
    delete old.wars;
    delete old.crisis;
    const before = JSON.stringify(old);
    const m = migrateState(old);
    expect(m.difficulty).toBe('normal');
    expect(m.wars).toEqual({});
    expect(m.crisis).toBeNull();
    expect(JSON.stringify(old)).toBe(before);
  });

  it('repairs an unknown difficulty', () => {
    expect(migrateState(full(1, { difficulty: 'nightmare' })).difficulty).toBe('normal');
  });

  it('refuses other versions and damaged states with player-readable errors', () => {
    expect(() => migrateState(full(1, { version: 3 }))).toThrow(SaveVersionError);
    expect(() => migrateState(full(1, { version: 1 }))).toThrow(/incompatible version/);
    expect(() => migrateState(null)).toThrow(DamagedSaveError);
    expect(() => migrateState([1, 2])).toThrow(DamagedSaveError);
    expect(() => migrateState(full(1, { map: undefined, units: 'x' }))).toThrow(/missing map, units/);
  });
});

describe('Saves: resume slot and ownership', () => {
  it('auto:0 is the resume save while it is newest, hidden once a turn-start autosave supersedes it', async () => {
    const saves = new Saves(createMemoryStore());
    await saves.save('slot:0', full(1));
    for (let t = 1; t <= 6; t++) await saves.autosave(full(t));
    await saves.saveResume(full(6, { nextId: 50 }));
    let list = await saves.list();
    expect(list.map((m) => `${m.slot}=${m.turn}`)).toEqual(['auto:0=6', 'auto:1=6', 'auto:2=5', 'auto:3=4', 'auto:4=3', 'slot:0=1']);
    expect((await saves.load('auto:0')).nextId).toBe(50);
    expect((await saves.load('auto:1')).nextId).toBe(9);
    await saves.autosave(full(7));
    list = await saves.list();
    expect(list.map((m) => `${m.slot}=${m.turn}`)).toEqual(['auto:0=7', 'auto:1=6', 'auto:2=5', 'auto:3=4', 'auto:4=3', 'slot:0=1']);
    expect((await saves.load('auto:1')).nextId).toBe(9); // the ring entry, not the stale resume
  });

  it('deleting auto:0 while it is the resume removes the resume', async () => {
    const store = createMemoryStore();
    const saves = new Saves(store);
    await saves.autosave(full(1));
    await saves.saveResume(full(1, { nextId: 20 }));
    await saves.delete('auto:0');
    expect((await store.list()).map((e) => e.key)).toEqual(['auto:0']);
    expect((await saves.load('auto:0')).nextId).toBe(9);
  });

  it('only the last claimer may autosave; manual saves are always allowed', async () => {
    const store = createMemoryStore();
    const a = new Saves(store, () => 1, 'tab-a');
    const b = new Saves(store, () => 2, 'tab-b');
    await a.autosave(full(1)); // nobody claimed yet: allowed
    await a.claim();
    await b.claim();
    await expect(a.autosave(full(2))).rejects.toBeInstanceOf(SaveOwnershipError);
    await expect(a.saveResume(full(2))).rejects.toBeInstanceOf(SaveOwnershipError);
    await b.saveResume(full(3));
    await a.save('slot:1', full(4));
    expect((await b.list()).map((m) => `${m.slot}=${m.turn}`)).toEqual(['auto:0=3', 'auto:1=1', 'slot:1=4']);
    expect((await store.list()).some((e) => e.key === RESUME_KEY)).toBe(true);
  });

  it('memory tab bus delivers claims to other tabs only', () => {
    const bus = createMemoryTabBus();
    const a = bus.channel();
    const b = bus.channel();
    const heardA: string[] = [];
    const heardB: string[] = [];
    a.onClaim((o) => heardA.push(o));
    b.onClaim((o) => heardB.push(o));
    a.announce('A');
    b.close();
    a.announce('A2');
    expect(heardA).toEqual([]);
    expect(heardB).toEqual(['A']);
  });

  it('validates meta and words storage errors for players', () => {
    expect(isValidMeta({ slot: 'auto:0', savedAt: 1, turn: 1, age: 'ancient', civName: null, leader: 'x' })).toBe(true);
    expect(isValidMeta({ slot: 'auto:0' })).toBe(false);
    expect(isValidMeta(undefined)).toBe(false);
    expect(describeStorageError(Object.assign(new Error('x'), { name: 'QuotaExceededError' }))).toMatch(/no storage space/);
    expect(describeStorageError(new Error('InvalidStateError'))).toMatch(/Private browsing/);
  });
});

describe('export / import', () => {
  it('round-trips a save through an export file into the import slot', async () => {
    const saves = new Saves(createMemoryStore(), () => Date.UTC(2026, 10, 25));
    await saves.saveResume(full(42));
    const { fileName, text } = await exportSlot(saves, 'auto:0', 5);
    expect(fileName).toBe('apes-turn-42-2026-11-25.json');
    const file = JSON.parse(text) as { format: string; saveVersion: number; state: GameState };
    expect(file.format).toBe(EXPORT_FORMAT);
    expect(file.saveVersion).toBe(2);
    expect(file.state.players.me?.affinity).toEqual({ greek: 3 }); // the real state, not a stripped snapshot

    const other = new Saves(createMemoryStore());
    await importToSlot(other, text);
    expect(IMPORT_SLOT).toBe('slot:9');
    expect(JSON.stringify(await other.load(IMPORT_SLOT))).toBe(JSON.stringify(full(42)));
  });

  it('accepts a bare GameState and migrates it', () => {
    const old = full(3) as unknown as Record<string, unknown>;
    delete old.difficulty;
    expect(parseImport(JSON.stringify(old)).difficulty).toBe('normal');
  });

  it('rejects bad files with readable errors', () => {
    expect(() => parseImport('not json')).toThrow(/not valid JSON/);
    expect(() => parseImport(JSON.stringify({ hello: 1 }))).toThrow(/not a save of this game/);
    expect(() => parseImport(buildExport(full(1, { version: 9 }) as GameState, { slot: 'auto:0', savedAt: 0, turn: 1, age: 'ancient', civName: null, leader: '' }, 0))).toThrow(
      /incompatible version/,
    );
    expect(() => parseImport('{"__proto__": {"x": 1}, "version": 2}')).toThrow(/not a valid save/);
    expect(() => parseImport(' '.repeat(IMPORT_MAX_BYTES + 1))).toThrow(/too large/);
    let deep = '1';
    for (let i = 0; i < 100; i++) deep = `[${deep}]`;
    expect(() => parseImport(deep)).toThrow(/nested too deeply/);
  });

  it('a rejected import never touches the slot', async () => {
    const saves = new Saves(createMemoryStore());
    await expect(importToSlot(saves, '{}')).rejects.toThrow();
    expect(await saves.list()).toEqual([]);
  });

  it('file names survive a bad clock', () => {
    expect(exportFileName({ slot: 'auto:0', savedAt: Number.NaN, turn: 2, age: 'ancient', civName: null, leader: '' })).toBe('apes-turn-2-save.json');
  });
});
