/**
 * Save-list helpers for the shell (pure, Node-testable). The last manual slot is reserved, not
 * offered as a player slot: imported files land there before loading (src/platform/transfer.ts
 * IMPORT_SLOT), and older builds wrote a save-on-hide "resume" there. Mid-turn progress itself
 * now lives in 'auto:0', which the worker keeps equal to the latest state after every move
 * (src/worker/host.ts), so Continue picking the newest of the two covers both.
 */
import type { SaveMeta } from '@contracts/sim-api';
import { MANUAL_SLOT_COUNT } from '../../platform/saves';

export const RESUME_SLOT = `slot:${MANUAL_SLOT_COUNT - 1}`;

/** Manual slots the player may write to (the resume slot is excluded). */
export const PLAYER_SLOT_COUNT = MANUAL_SLOT_COUNT - 1;

/** What Continue should load: the newest of the latest autosave and the resume save. */
export const continueSave = (list: readonly SaveMeta[]): SaveMeta | null => {
  const candidates = list.filter((s) => s.slot === 'auto:0' || s.slot === RESUME_SLOT);
  const pool = candidates.length > 0 ? candidates : list;
  return [...pool].sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
};
