/**
 * Save-list helpers for the shell (pure, Node-testable). The last manual slot is reserved as the
 * "resume" slot written when the app is hidden mid-turn (app-wiring.ts), because the worker only
 * autosaves at turn start and the save protocol has no other slot kind.
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
