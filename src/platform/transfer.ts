/**
 * Export / import of a save as a .json file (main thread): the safety net against Safari
 * evicting site storage, and the way to move a game between devices.
 *
 * Uses the existing protocol only. The worker keeps 'auto:0' equal to the latest state (rolling
 * resume save, src/worker/host.ts) in this origin's IndexedDB, which the main thread can open
 * too. So export = read a slot straight from IndexedDB; import = validate, write the reserved
 * import slot (IMPORT_SLOT, 'slot:9', not offered to the player as a manual slot) from the main
 * thread, then send the ordinary `load` for it — the worker migrates it and claims the saves.
 */
import type { GameState, SaveMeta } from '@contracts/sim-api';
import { MANUAL_SLOT_COUNT, Saves, createIdbStore, metaFor } from './saves';
import { DamagedSaveError, SAVE_VERSION, migrateState } from './migrate';

export const EXPORT_FORMAT = 'apes-together-strong/save';
/** Imports larger than this are refused before parsing (the save budget is 2 MB). */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
/** Where imports land before loading; the last manual slot, reserved by the UI (saves-logic.ts). */
export const IMPORT_SLOT = `slot:${MANUAL_SLOT_COUNT - 1}`;
const MAX_DEPTH = 64;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  saveVersion: number;
  exportedAt: number;
  meta: SaveMeta;
  state: GameState;
}

/** The file text for a save. */
export const buildExport = (state: GameState, meta: SaveMeta, exportedAt: number): string =>
  JSON.stringify({ format: EXPORT_FORMAT, saveVersion: SAVE_VERSION, exportedAt, meta, state } satisfies ExportFile);

/** e.g. "apes-turn-42-2026-11-25.json". */
export const exportFileName = (meta: SaveMeta): string => {
  const d = new Date(meta.savedAt);
  const day = Number.isNaN(d.getTime()) ? 'save' : d.toISOString().slice(0, 10);
  return `apes-turn-${meta.turn}-${day}.json`;
};

/**
 * Refuses anything JSON.parse would not round-trip as plain data: prototype-polluting keys and
 * absurd nesting (a GameState is shallow). JSON.parse output is otherwise plain by construction.
 */
const assertPlain = (v: unknown, depth = 0): void => {
  if (depth > MAX_DEPTH) throw new DamagedSaveError('This file is not a valid save (nested too deeply).');
  if (typeof v !== 'object' || v === null) return;
  if (Array.isArray(v)) {
    for (const x of v) assertPlain(x, depth + 1);
    return;
  }
  for (const k of Object.keys(v)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new DamagedSaveError('This file is not a valid save.');
    assertPlain((v as Record<string, unknown>)[k], depth + 1);
  }
};

/**
 * Parses and validates an imported file (our export envelope, or a bare GameState) and returns
 * a migrated GameState. Throws a player-readable error.
 */
export const parseImport = (text: string): GameState => {
  // String length counts UTF-16 units; for this ASCII-heavy JSON that is ~bytes.
  if (text.length > IMPORT_MAX_BYTES) throw new DamagedSaveError(`This file is too large to be a save (over ${IMPORT_MAX_BYTES / 1024 / 1024} MB).`);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new DamagedSaveError('This file is not a save (it is not valid JSON).');
  }
  assertPlain(data);
  const env = data as Partial<ExportFile> | null;
  const raw = env && typeof env === 'object' && env.format === EXPORT_FORMAT ? env.state : data;
  return migrateState(raw);
};

/** The file for a stored slot ('auto:0' is the latest state of the current game). */
export const exportSlot = async (saves: Saves, slot: string, now: number): Promise<{ fileName: string; text: string }> => {
  const state = await saves.load(slot);
  const meta = (await saves.metaOf(slot)) ?? metaFor(state, slot, now);
  return { fileName: exportFileName(meta), text: buildExport(state, meta, now) };
};

/** Validates `text` and writes it to IMPORT_SLOT; the caller then loads IMPORT_SLOT. */
export const importToSlot = async (saves: Saves, text: string): Promise<GameState> => {
  const state = parseImport(text);
  await saves.save(IMPORT_SLOT, state);
  return state;
};

// ---------------------------------------------------------------------------
// Browser glue (main thread only)
// ---------------------------------------------------------------------------

let mainSaves: Saves | null = null;
/** The main thread's own view of the save database (same origin, same IndexedDB as the worker). */
const savesOnMain = (): Saves => (mainSaves ??= new Saves(createIdbStore()));

/** Offers `text` as a download. iOS Safari shows its download sheet ("Save to Files"). */
export const downloadText = (fileName: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari needs the URL alive until the download sheet has read it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/** Opens the file picker; resolves with the chosen file's text, or null if cancelled. */
export const pickTextFile = (): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.onchange = () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      if (file.size > IMPORT_MAX_BYTES) return reject(new DamagedSaveError('This file is too large to be a save.'));
      file.text().then(resolve, reject);
    };
    input.oncancel = () => {
      input.remove();
      resolve(null);
    };
    document.body.appendChild(input);
    input.click();
  });

/** Downloads `slot` as a .json file. Returns the file name. */
export const exportGame = async (slot: string): Promise<string> => {
  const { fileName, text } = await exportSlot(savesOnMain(), slot, Date.now());
  downloadText(fileName, text);
  return fileName;
};

/**
 * Lets the player pick a .json save and stores it in IMPORT_SLOT. Resolves with the slot to
 * `load`, or null if the player cancelled. Throws a player-readable error for a bad file.
 */
export const importGame = async (): Promise<string | null> => {
  const text = await pickTextFile();
  if (text === null) return null;
  await importToSlot(savesOnMain(), text);
  return IMPORT_SLOT;
};
