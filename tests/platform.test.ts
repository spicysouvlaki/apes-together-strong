import { describe, expect, it } from 'vitest';
import type { GameState } from '@contracts/sim-api';
import {
  SAVE_SIZE_LIMIT,
  Saves,
  assertSaveVersion,
  createMemoryStore,
  isAutoSlot,
  isManualSlot,
  metaFor,
  requestPersistentStorage,
  saveSize,
} from '../src/platform/saves';
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN, defaultSettings, loadSettings, sanitizeSettings, saveSettings, updateSettings, type KeyValueStorage } from '../src/platform/settings';
import { deviceReport, hasWebGL2, isStandalone } from '../src/platform/device';
import { SimClient, type WorkerLike } from '../src/platform/client';

/** Fields a loadable save must have (src/platform/migrate.ts) and the defaults it fills in. */
const FILLER = {
  seed: 1,
  speed: 'quick',
  mapSize: 'small',
  finalAge: 'classical',
  difficulty: 'normal',
  ageProgress: 0,
  rng: [1, 2, 3, 4],
  nextId: 1,
  map: {},
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
};

const state = (turn: number, civName: string | null = null): GameState =>
  ({
    version: 2,
    turn,
    age: 'ancient',
    phase: 'playing',
    currentPlayer: 'ai',
    playerOrder: ['ai', 'me'],
    players: {
      ai: { id: 'ai', isHuman: false, leader: 'warrior', civName: 'Rivals', affinity: {} },
      me: { id: 'me', isHuman: true, leader: 'builder', civName, affinity: { greek: 3 } },
    },
    ...FILLER,
  }) as unknown as GameState;

describe('memory save store', () => {
  it('stores clones, lists meta and deletes', async () => {
    const store = createMemoryStore();
    const s = state(3);
    await store.put('slot:0', { meta: metaFor(s, 'slot:0', 5), state: s, seq: 1 });
    s.turn = 99; // mutating the original must not affect the stored copy
    const got = await store.get('slot:0');
    expect(got?.state.turn).toBe(3);
    expect(await store.list()).toEqual([{ key: 'slot:0', meta: { slot: 'slot:0', savedAt: 5, turn: 3, age: 'ancient', civName: null, leader: 'builder' }, seq: 1, version: 2 }]);
    await store.delete('slot:0');
    expect(await store.get('slot:0')).toBeNull();
  });

  it('meta describes the human player and uses the platform clock', async () => {
    const saves = new Saves(createMemoryStore(), () => 12345);
    await saves.save('slot:2', state(7, 'the Andalusian Pax'));
    expect(await saves.list()).toEqual([{ slot: 'slot:2', savedAt: 12345, turn: 7, age: 'ancient', civName: 'the Andalusian Pax', leader: 'builder' }]);
  });

  it('autosave ring keeps 5 with auto:0 newest, manual slots after', async () => {
    const saves = new Saves(createMemoryStore());
    await saves.save('slot:5', state(1));
    await saves.save('slot:1', state(2));
    for (let t = 1; t <= 9; t++) await saves.autosave(state(t));
    const list = await saves.list();
    expect(list.map((m) => `${m.slot}=${m.turn}`)).toEqual(['auto:0=9', 'auto:1=8', 'auto:2=7', 'auto:3=6', 'auto:4=5', 'slot:1=2', 'slot:5=1']);
    expect((await saves.load('auto:4')).turn).toBe(5);
    await saves.delete('auto:0');
    expect((await saves.load('auto:0')).turn).toBe(8);
  });

  it('slot names and guards', async () => {
    expect(isManualSlot('slot:0')).toBe(true);
    expect(isManualSlot('slot:10')).toBe(false);
    expect(isAutoSlot('auto:4')).toBe(true);
    expect(isAutoSlot('auto:5')).toBe(false);
    expect(() => assertSaveVersion({ version: 1 })).toThrow(/incompatible version/);
    expect(() => assertSaveVersion(null)).toThrow(/incompatible version/);
    expect(() => assertSaveVersion({ version: 2 })).not.toThrow();
    await expect(new Saves(createMemoryStore()).save('slot:1', { ...state(1), version: 3 } as unknown as GameState)).rejects.toThrow(/incompatible/);
  });

  it('measures save size', () => {
    const s = state(1);
    expect(saveSize(s)).toBe(JSON.stringify(s).length);
    expect(saveSize(s)).toBeLessThan(SAVE_SIZE_LIMIT);
  });

  it('persistent storage request is a no-op without navigator.storage', async () => {
    expect(await requestPersistentStorage()).toBe(false);
  });
});

const memoryStorage = (): KeyValueStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('settings', () => {
  it('falls back to defaults with no storage, corrupt JSON or throwing storage', () => {
    expect(loadSettings(null)).toEqual(defaultSettings());
    const bad = memoryStorage();
    bad.data.set('apes.settings.v1', '{not json');
    expect(loadSettings(bad)).toEqual(defaultSettings());
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadSettings(throwing)).toEqual(defaultSettings());
    expect(() => saveSettings(defaultSettings(), throwing)).not.toThrow();
  });

  it('clamps text scale and drops invalid fields', () => {
    expect(sanitizeSettings({ textScale: 400 }).textScale).toBe(TEXT_SCALE_MAX);
    expect(sanitizeSettings({ textScale: 10 }).textScale).toBe(TEXT_SCALE_MIN);
    expect(sanitizeSettings({ textScale: 'big' }).textScale).toBe(100);
    expect(sanitizeSettings({ reduceMotion: 'yes', lastSetup: { nope: 1 } })).toEqual(defaultSettings());
  });

  it('round-trips through storage and merges updates', () => {
    const st = memoryStorage();
    const setup = { seed: 7, mapSize: 'small', speed: 'quick', players: [] };
    updateSettings({ textScale: 120, lastSetup: setup as never }, st);
    updateSettings({ colorblindPatterns: true }, st);
    expect(loadSettings(st)).toEqual({ sfxVolume: 80, musicVolume: 50, muted: false, textScale: 120, reduceMotion: false, colorblindPatterns: true, lastSetup: setup });
  });
});

describe('device checks in Node', () => {
  it('return safe answers', async () => {
    expect(hasWebGL2()).toBe(false);
    expect(isStandalone()).toBe(false);
    const r = await deviceReport();
    expect(r.webgl2).toBe(false);
  });
});

describe('SimClient', () => {
  it('sends typed messages, fans out replies and disposes', () => {
    const sent: unknown[] = [];
    let terminated = false;
    const fake: WorkerLike = { postMessage: (m) => void sent.push(m), terminate: () => void (terminated = true), onmessage: null, onerror: null };
    const client = new SimClient(fake);
    const got: unknown[] = [];
    const off = client.onMessage((m) => got.push(m));
    client.command('me', { type: 'endTurn' });
    client.save('slot:1');
    client.listSaves();
    expect(sent).toEqual([{ type: 'command', player: 'me', command: { type: 'endTurn' } }, { type: 'save', slot: 'slot:1' }, { type: 'listSaves' }]);
    fake.onmessage?.({ data: { type: 'thinking', player: 'ai' } } as MessageEvent);
    fake.onerror?.({ message: 'x' } as ErrorEvent);
    expect(got).toEqual([{ type: 'thinking', player: 'ai' }, { type: 'error', message: 'Sim worker crashed: x' }]);
    off();
    client.dispose();
    expect(terminated).toBe(true);
    expect(() => client.listSaves()).toThrow(/disposed/);
  });
});
