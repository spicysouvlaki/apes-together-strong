/**
 * Is the save behind "Continue" a finished game? (Playtest: "Continue · Turn 92" opened the
 * Chronicle of an ended game unexpectedly.) SaveMeta carries no phase, so the title peeks at
 * the stored state once, read-only, through the platform's own save reader, and remembers the
 * answer per save (slot + savedAt) so later visits are instant.
 */
import { signal } from '@preact/signals';
import type { SaveMeta } from '@contracts/sim-api';
import { Saves, createIdbStore } from '../../platform/saves';

export interface TitleActions {
  /** What the hero button does. */
  primary: 'continue' | 'chronicle' | 'new';
  /** Label of the save button ("Continue · Turn 12", "View chronicle · Turn 92"), or null. */
  saveLabel: string | null;
  /** New game is listed before the save button. */
  newFirst: boolean;
}

/** Title buttons for the newest save; `ended` null = not known yet (treated as playing). */
export const titleActions = (save: SaveMeta | null, ended: boolean | null): TitleActions => {
  if (!save) return { primary: 'new', saveLabel: null, newFirst: true };
  if (ended) return { primary: 'new', saveLabel: `View chronicle · Turn ${save.turn}`, newFirst: true };
  return { primary: 'continue', saveLabel: `Continue · Turn ${save.turn}`, newFirst: false };
};

export const saveKey = (m: SaveMeta): string => `${m.slot}@${m.savedAt}`;

const KEY = 'apes.ended-saves.v1';
const MAX_REMEMBERED = 20;

const readCache = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
};

const writeCache = (key: string, ended: boolean): void => {
  try {
    const c = readCache();
    c[key] = ended;
    const keys = Object.keys(c);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete c[k];
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // Storage blocked: we peek again next time.
  }
};

/** key -> ended, filled in as peeks resolve (the title re-renders). */
export const endedSaves = signal<Record<string, boolean>>(readCache());

let reader: Saves | null = null;
const pending = new Set<string>();

/** Known answer for this save, or null while unknown (starts a peek once). */
export const endedOf = (m: SaveMeta | null): boolean | null => {
  if (!m) return null;
  const key = saveKey(m);
  const known = endedSaves.value[key];
  if (known !== undefined) return known;
  if (!pending.has(key) && typeof indexedDB !== 'undefined') {
    pending.add(key);
    reader ??= new Saves(createIdbStore());
    reader.load(m.slot).then(
      (state) => {
        const ended = state.phase === 'ended';
        writeCache(key, ended);
        endedSaves.value = { ...endedSaves.value, [key]: ended };
      },
      () => {
        endedSaves.value = { ...endedSaves.value, [key]: false };
      },
    );
  }
  return null;
};
