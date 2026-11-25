/**
 * Shell-only UI signals (not shared with the screens). No game rules here.
 */
import { signal } from '@preact/signals';
import type { Hex } from '@contracts/hex';
import { loadSettings, updateSettings, type Settings } from '../../platform/settings';

export const settings = signal<Settings>(loadSettings());

export const patchSettings = (patch: Partial<Settings>): void => {
  settings.value = updateSettings(patch);
};

/** Units the player told to "skip" this turn (UI-side only; cleared at each new turn). */
export const skipped = signal<ReadonlySet<string>>(new Set());
export const skipUnit = (id: string): void => {
  skipped.value = new Set([...skipped.value, id]);
};

/** Legal targets for the selected unit, from SimQueries, kept for tap resolution. */
export const highlights = signal<{ reachable: Hex[]; attackable: Hex[]; warTargets: { hex: Hex; owner: string }[] }>({
  reachable: [],
  attackable: [],
  warTargets: [],
});

/** Last map tap, for cycling through a stack (settlement, then units). */
export const lastTap = signal<{ hex: Hex; cycleIndex: number } | null>(null);

/** Set while a new game / load is in flight, so the title can show progress. */
export const loading = signal<string | null>(null);

/** A new app version is waiting (service worker 'prompt' strategy). */
export const updateReady = signal(false);

/** Turn number for which the "a city is idle" confirm was already shown. */
export const idleConfirmedTurn = signal<number>(-1);

/** Set when End Turn was sent and no new snapshot has arrived yet (guards rapid double taps). */
export const endTurnSent = signal(false);

/** Turn on which the player already looked at the "found your first city" nudge. */
export const foundNudgeTurn = signal<number>(-1);

/** The yield legend under the top bar is open. */
export const legendOpen = signal(false);
