/**
 * UI state shared by the shell (HUD, map, panels) and the screens (src/ui/screens).
 * Signals only; no game rules here. The UI never mutates GameState: it reads the latest
 * snapshot in `game` and sends Commands with `dispatch` (CLAUDE.md rule 1).
 *
 * Seam between the two UI tasks: the SHELL owns this file's wiring (src/ui/app-wiring.ts
 * calls `bindClient`), the SCREENS only import from here. Keep exported names stable.
 */
import { computed, signal } from '@preact/signals';
import type { ContentBundle } from '@contracts/content-schemas';
import type { Hex } from '@contracts/hex';
import type {
  Command,
  FigureId,
  GameSetup,
  GameState,
  OfferId,
  PlayerId,
  PlayerState,
  SaveMeta,
  SettlementId,
  SimEvent,
  UnitId,
} from '@contracts/sim-api';
import { byId, loadContent } from '../content';
import { queries } from '../sim/queries';

/** Full-screen or sheet overlays. One at a time; `null` = the map. */
export type Modal =
  // Owned by the SCREENS task (src/ui/screens):
  | { kind: 'offer'; offer: OfferId }
  | { kind: 'roster' }
  | { kind: 'figure'; figure: FigureId }
  | { kind: 'cabinet' }
  | { kind: 'government' }
  | { kind: 'tree'; tree: 'tech' | 'civic' }
  | { kind: 'diplomacy' }
  | { kind: 'crisis' }
  | { kind: 'transition' }
  | { kind: 'legacy' }
  | { kind: 'chronicle' }
  /** "Your people": who the player is becoming (from the HUD banner). */
  | { kind: 'people' }
  // Owned by the SHELL task (src/ui/shell):
  | { kind: 'city'; settlement: SettlementId }
  | { kind: 'tileInfo'; hex: Hex }
  | { kind: 'menu' }
  | { kind: 'saves' }
  | { kind: 'settings' }
  | { kind: 'codex' }
  /** Recent events as sentences, newest turn first (the "+N more updates" toast opens it). */
  | { kind: 'log' };

export type ModalKind = Modal['kind'];

export interface Toast {
  id: number;
  text: string;
  /** Tapping the toast opens this. */
  action: Modal | null;
  tone: 'info' | 'good' | 'bad' | 'culture';
  /** Where it happened; tapping the toast centers the map there. */
  at?: Hex;
  /** A threat to answer now (shell/ticker.ts): shown as a slip; everything else runs in the ticker. */
  threat?: boolean;
  /** A rival leader speaking (wave 13): shown as a small slip with their banner, never folded. */
  voice?: PlayerId;
  /**
   * Game turn the news belongs to. At the start of the player's next turn older news leaves the
   * ticker (it stays in the turn log): playtest 4 found T29 lines still queued at T31 and
   * Ancient-age raider warnings showing in the Classical age.
   */
  turn?: number;
}

export interface Selection {
  unit: UnitId | null;
  settlement: SettlementId | null;
  tile: Hex | null;
}

// --- Static ---------------------------------------------------------------

export const content: ContentBundle = loadContent();
/** Read-only rule queries (legal moves, costs, options). Never mutate through these. */
export const q = queries;

/** id -> entry lookups, built once. */
export const lookup = {
  cultures: byId(content.cultures),
  figures: byId(content.figures),
  traditions: byId(content.traditions),
  hybrids: byId(content.hybrids),
  terrain: byId(content.terrain),
  resources: byId(content.resources),
  leaders: byId(content.leaders),
  dreams: byId(content.dreams),
  governments: byId(content.governments),
  cabinetSlots: byId(content.cabinetSlots),
  units: byId(content.units),
  buildings: byId(content.buildings),
  wonders: byId(content.wonders),
  techs: byId(content.techs),
  deeds: byId(content.deeds),
  cityStates: byId(content.cityStates),
  crises: byId(content.crises),
};

// --- Signals --------------------------------------------------------------

export const route = signal<'title' | 'setup' | 'game'>('title');
/** Latest snapshot from the worker (affinity is always empty here by design). */
export const game = signal<GameState | null>(null);
/** Events that arrived with the latest snapshot. */
export const lastEvents = signal<SimEvent[]>([]);
/** Set while rival turns are being computed. */
export const thinking = signal<PlayerId | null>(null);
export const saves = signal<SaveMeta[]>([]);
export const modal = signal<Modal | null>(null);
export const selection = signal<Selection>({ unit: null, settlement: null, tile: null });
export const toasts = signal<Toast[]>([]);
export const lastError = signal<string | null>(null);

/** The human player's id (first human in playerOrder). */
export const me = computed<PlayerId | null>(() => {
  const g = game.value;
  if (!g) return null;
  return g.playerOrder.find((id) => g.players[id]?.isHuman) ?? null;
});

export const myPlayer = computed<PlayerState | null>(() => {
  const g = game.value;
  const id = me.value;
  return g && id ? (g.players[id] ?? null) : null;
});

/** True when the human may issue turn commands right now. */
export const myTurn = computed<boolean>(() => {
  const g = game.value;
  return !!g && g.phase === 'playing' && g.currentPlayer === me.value && thinking.value === null;
});

// --- Actions (wired to the worker client by the shell via bindClient) ------

interface ClientBinding {
  command(player: PlayerId, command: Command): void;
  newGame(setup: GameSetup): void;
  save(slot: string): void;
  load(slot: string): void;
  deleteSave(slot: string): void;
  listSaves(): void;
}

let client: ClientBinding | null = null;
export const bindClient = (c: ClientBinding): void => {
  client = c;
};

/** Send a command as the human player. Errors come back through `lastError` and a toast. */
export const dispatch = (command: Command): void => {
  const id = me.value;
  if (!client || !id) return;
  lastError.value = null;
  client.command(id, command);
};

export const startNewGame = (setup: GameSetup): void => client?.newGame(setup);
export const saveGame = (slot: string): void => client?.save(slot);
export const loadGame = (slot: string): void => client?.load(slot);
export const deleteSave = (slot: string): void => client?.deleteSave(slot);
export const refreshSaves = (): void => client?.listSaves();

export const openModal = (m: Modal): void => {
  modal.value = m;
  // A toast that points here has been answered.
  const key = JSON.stringify(m);
  if (toasts.value.some((t) => t.action && JSON.stringify(t.action) === key)) {
    toasts.value = toasts.value.filter((t) => !t.action || JSON.stringify(t.action) !== key);
  }
};
export const closeModal = (): void => {
  modal.value = null;
};

let toastId = 1;
/** Most important toast first; the queue is capped (newest batch wins over old ones). */
export const pushToast = (text: string, tone: Toast['tone'] = 'info', action: Modal | null = null): void => {
  pushToasts([{ text, tone, action }]);
};
/** Adds an already-ranked batch above whatever is still waiting (the ticker shows one at a time). */
export const pushToasts = (batch: readonly Omit<Toast, 'id'>[]): void => {
  if (batch.length === 0) return;
  // The same sentence twice says nothing new (two raiders pillaging the same town in one turn).
  const texts = new Set<string>();
  const fresh = batch.filter((t) => !texts.has(t.text) && !!texts.add(t.text)).map((t) => ({ ...t, id: toastId++ }));
  // An older "+N more updates this turn" footnote is stale once newer news arrives (playtest 3:
  // two of them queued up, one counting last turn's news). The log still has everything.
  const kept = toasts.value.filter((t) => t.action?.kind !== 'log' && !texts.has(t.text));
  toasts.value = [...fresh, ...kept].slice(0, TOAST_QUEUE_MAX);
};
export const TOAST_QUEUE_MAX = 6;
/** Drops news stamped before `turn` (pure; unstamped toasts, e.g. UI tips, are kept). */
export const freshToasts = <T extends { turn?: number }>(list: readonly T[], turn: number): T[] =>
  list.filter((t) => t.turn === undefined || t.turn >= turn);
export const dismissToast = (id: number): void => {
  toasts.value = toasts.value.filter((t) => t.id !== id);
};

// --- Added by the shell (stable; screens may use these) ---------------------

/** A yes/no question shown over everything (rendered by the shell). */
export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button for destructive or war actions. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}
export const confirmRequest = signal<ConfirmRequest | null>(null);
export const askConfirm = (req: ConfirmRequest): void => {
  confirmRequest.value = req;
};

let mapFocusHandler: ((hex: Hex) => void) | null = null;
/** Called by the map view when its renderer is ready (null on unmount). */
export const setMapFocusHandler = (fn: ((hex: Hex) => void) | null): void => {
  mapFocusHandler = fn;
};
/** Center the map camera on a hex (no-op before the map exists). */
export const focusMap = (hex: Hex): void => {
  mapFocusHandler?.(hex);
};

/** Display name for any owner id (player civ name / leader, city-state, raiders). */
export const ownerName = (owner: string): string => {
  const g = game.value;
  if (owner === 'raiders') return 'Raiders';
  if (owner.startsWith('cs:')) return lookup.cityStates[owner.slice(3)]?.name ?? 'City-state';
  const p = g?.players[owner];
  if (!p) return owner;
  // Lower-case like civ names ("the Norse Thing"): this reads inside sentences ("war with the
  // Builder's people"); titles capitalise it themselves.
  return p.civName ?? `${(lookup.leaders[p.leader]?.name ?? 'A leader').replace(/^(The|A) /, (m) => m.toLowerCase())}'s people`;
};
