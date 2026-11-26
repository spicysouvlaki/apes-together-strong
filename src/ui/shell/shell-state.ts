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

/** Set when End Turn was sent and no new snapshot has arrived yet (guards rapid double taps). */
export const endTurnSent = signal(false);

/** Turn on which the player already looked at the "found your first city" nudge. */
export const foundNudgeTurn = signal<number>(-1);

/** The yield legend under the top bar is open. */
export const legendOpen = signal(false);

/** Best founding sites near the selected settler (q.settleSites, best first; top 3 kept). */
export const siteHints = signal<{ unit: string; sites: { hex: Hex; score: number }[] } | null>(null);

/** Turn on which the "enemy next to a unit with moves" confirm was already shown. */
export const enemyConfirmedTurn = signal<number>(-1);

/** Turn on which the "units still idle" sheet was already shown at End Turn. */
export const idleSheetTurn = signal<number>(-1);

/** Recent player-facing events as plain sentences (newest last), for the turn log sheet. */
export interface LogEntry {
  turn: number;
  text: string;
  tone: 'info' | 'good' | 'bad' | 'culture';
  /** A culture whisper ("Hellenic peoples speak of…"), as opposed to other culture-toned news. */
  whisper?: boolean;
}
export const LOG_MAX = 50;
export const turnLog = signal<LogEntry[]>([]);
/**
 * One line per sentence: three raiders pillaging the same town in one turn read as one entry
 * with a count, not the same sentence three times (playtest 4). Pure; keeps first-seen order.
 */
export const foldRepeats = <T extends { text: string }>(entries: readonly T[]): T[] => {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.text, (counts.get(e.text) ?? 0) + 1);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of entries) {
    if (seen.has(e.text)) continue;
    seen.add(e.text);
    const n = counts.get(e.text) ?? 1;
    out.push(n > 1 ? { ...e, text: `${e.text} (${n} times)` } : e);
  }
  return out;
};

export const pushLog = (turn: number, entries: readonly { text: string; tone: LogEntry['tone']; whisper?: boolean }[]): void => {
  if (entries.length === 0) return;
  turnLog.value = [...turnLog.value, ...foldRepeats(entries).map((e) => ({ turn, text: e.text, tone: e.tone, ...(e.whisper ? { whisper: true } : {}) }))].slice(-LOG_MAX);
};

/** Height (CSS px) of the bottom HUD stack (advice, controls, unit sheet), for the camera's safe area. */
export const hudBottomPx = signal(0);
