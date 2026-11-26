/**
 * Load-time migration of saved GameStates (GDD §5 "Saves").
 *
 * A save from an older build of the same schema version may lack fields that were added later;
 * those get safe defaults here so the sim never crashes on `undefined`. Anything that cannot be
 * repaired safely (wrong version, missing core structure) throws a player-readable error.
 *
 * Fields added since the first public deploy, from `git log -p --follow src/contracts/sim-api.ts`:
 * - c1ba8eb `GameState.difficulty` (default 'normal', as in sim createGame).
 * The collection defaults below predate the first deploy (50204d2) and are cheap insurance
 * against hand-edited or truncated imports.
 */
import type { Difficulty, GameState } from '@contracts/sim-api';

export const SAVE_VERSION = 2;

/** Thrown for saves that are not a GameState at all (corrupt record, wrong file). */
export class DamagedSaveError extends Error {
  override name = 'DamagedSaveError';
}

/** Thrown for saves written by an incompatible schema version. */
export class SaveVersionError extends Error {
  override name = 'SaveVersionError';
}

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Throws a player-readable error if this save was written by an incompatible version. */
export const assertSaveVersion = (state: { version?: unknown } | null | undefined): void => {
  const v = state?.version;
  if (v !== SAVE_VERSION) {
    throw new SaveVersionError(
      `This save is from an incompatible version of the game (save version ${String(v)}, expected ${SAVE_VERSION}) and cannot be loaded.`,
    );
  }
};

/** Top-level fields with no safe default: without them the save is not a game. */
const REQUIRED: readonly [string, (v: unknown) => boolean][] = [
  ['seed', (v) => typeof v === 'number'],
  ['turn', (v) => typeof v === 'number'],
  ['phase', (v) => v === 'playing' || v === 'transition' || v === 'ended'],
  ['currentPlayer', (v) => typeof v === 'string'],
  ['nextId', (v) => typeof v === 'number'],
  ['rng', (v) => v !== undefined && v !== null],
  ['map', isRecord],
  ['playerOrder', Array.isArray],
  ['players', isRecord],
  ['settlements', isRecord],
  ['units', isRecord],
];

/** Missing-only defaults; every one matches what sim createGame starts a game with. */
const DEFAULTS: Record<string, () => unknown> = {
  speed: () => 'standard',
  finalAge: () => 'classical',
  ageProgress: () => 0,
  figures: () => ({}),
  offers: () => [],
  deedsDone: () => [],
  wonders: () => ({}),
  cityStates: () => ({}),
  tradeRoutes: () => [],
  wars: () => ({}),
  crisis: () => null,
  transition: () => null,
  result: () => null,
};

/**
 * Returns a GameState safe to hand to the sim. Never mutates `raw` (a shallow copy is returned
 * when defaults are filled in). Throws SaveVersionError or DamagedSaveError.
 */
export const migrateState = (raw: unknown): GameState => {
  if (!isRecord(raw) || raw.version === undefined) throw new DamagedSaveError('This is not a save of this game, or it is damaged, and cannot be loaded.');
  assertSaveVersion(raw);
  const missing = REQUIRED.filter(([k, ok]) => !ok(raw[k])).map(([k]) => k);
  if (missing.length > 0) throw new DamagedSaveError(`This save is damaged (missing ${missing.join(', ')}) and cannot be loaded.`);
  const out: Record<string, unknown> = { ...raw };
  if (!DIFFICULTIES.includes(out.difficulty as Difficulty)) out.difficulty = 'normal';
  for (const [k, make] of Object.entries(DEFAULTS)) if (out[k] === undefined) out[k] = make();
  if (typeof out.age !== 'string') out.age = 'ancient';
  if (typeof out.mapSize !== 'string') out.mapSize = 'standard';
  return out as unknown as GameState;
};
