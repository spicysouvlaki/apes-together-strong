/**
 * Connects the sim worker to the UI signals in store.ts and sets up the platform bits
 * (settings, service worker, persistent storage, Add to Home Screen nudge).
 * Called once from main.tsx. No game rules here: we only copy snapshots and translate events.
 */
import { effect } from '@preact/signals';
import type { Hex } from '@contracts/hex';
import type { FromWorker, GameState, PlayerId, SimEvent } from '@contracts/sim-api';
import { createSimClient, type SimClient } from '../platform/client';
import { isIOS, isStandalone } from '../platform/device';
import { applyUpdate, registerServiceWorker } from '../platform/pwa';
import { requestPersistentStorage } from '../platform/saves';
import {
  bindClient,
  content,
  game,
  lastError,
  lastEvents,
  lookup,
  me,
  modal,
  openModal,
  ownerName,
  pushToast,
  pushToasts,
  q,
  route,
  saves,
  thinking,
} from './store';
import { eventFlash, eventToToast, rankToasts, type EventNames, type FlashKindSpec, type ToastSpec } from './shell/event-toasts';
import { tileIndexOf } from './shell/hexutil';
import { endTurnSent, idleConfirmedTurn, lastTap, loading, settings, skipped, updateReady } from './shell/shell-state';
import { RESUME_SLOT } from './shell/saves-logic';
import { audio } from '../audio';
import { commandSound, initUiAudio } from './ui-audio';

let flashHandler: ((hex: Hex, kind: FlashKindSpec) => void) | null = null;
/** The map view registers the renderer's flash here. */
export const setMapFlashHandler = (fn: ((hex: Hex, kind: FlashKindSpec) => void) | null): void => {
  flashHandler = fn;
};

const eventNames = (state: GameState, prev: GameState | null): EventNames => ({
  unit: (id) => {
    const u = state.units[id] ?? prev?.units[id];
    if (!u) return null;
    return (u.figure ? lookup.figures[u.figure]?.name : undefined) ?? lookup.units[u.type]?.name ?? null;
  },
  owner: (id) => ownerName(id),
  figure: (id) => lookup.figures[id]?.name ?? 'A figure',
  settlement: (id) => {
    const s = state.settlements[id];
    return s ? { name: s.name, owner: s.owner } : null;
  },
  item: (id) => lookup.units[id]?.name ?? lookup.buildings[id]?.name ?? lookup.wonders[id]?.name ?? id,
  research: (id) => lookup.techs[id]?.name ?? id,
  milestone: (key) => {
    const [id, tier] = key.split(':');
    const m = content.legacy.find((x) => x.id === id);
    if (!m) return key;
    const n = m.thresholds[Math.max(0, Math.min(2, Number(tier) - 1))] ?? '';
    return m.description.replace('{n}', String(n));
  },
  crisis: (id) => lookup.crises[id]?.name ?? 'A crisis',
  deed: (id) => lookup.deeds[id]?.name ?? id,
});

let pendingUpdateApply = false;

const isMyTurnStart = (prev: GameState | null, next: GameState, my: PlayerId | null): boolean =>
  !!my &&
  next.phase === 'playing' &&
  next.currentPlayer === my &&
  (!prev || prev.turn !== next.turn || prev.currentPlayer !== my || prev.phase !== 'playing');

const onState = (state: GameState, events: SimEvent[]): void => {
  const prev = game.value;
  snapshotCount++;
  game.value = state;
  lastEvents.value = events;
  audio.playEvents(events, me.value);
  thinking.value = null;
  loading.value = null;
  endTurnSent.value = false;
  if (route.value !== 'game') route.value = 'game';
  const my = me.value;
  if (!my) return;

  if (isMyTurnStart(prev, state, my)) {
    skipped.value = new Set();
    lastTap.value = null;
    if (updateReady.value) pendingUpdateApply = true; // applied after the autosave lands
  }

  // Auto-open the between-ages flow and the ending (GDD §5 "Transition", §8 Chronicle).
  if (state.phase === 'transition' && prev?.phase !== 'transition') openModal({ kind: 'transition' });
  if (state.phase === 'ended' && prev?.phase !== 'ended') openModal({ kind: 'chronicle' });

  // One ranked batch per snapshot: most important first, overflow folded into one line.
  const names = eventNames(state, prev);
  const specs: ToastSpec[] = [];
  for (const ev of events) {
    const t = eventToToast(ev, my, names);
    if (t) specs.push(t);
  }
  pushToasts(rankToasts(specs));

  // Flashes only where the player can see (never leak hidden positions).
  const visible = new Set(q.visibleTiles(state, my, content));
  const flashes = events.flatMap((ev) => {
    const f = eventFlash(ev, state);
    if (!f) return [];
    const i = tileIndexOf(state.map, f.hex);
    return i !== null && visible.has(i) ? [f] : [];
  });
  if (flashes.length > 0) {
    // After the renderer has drawn the new snapshot.
    requestAnimationFrame(() => {
      for (const f of flashes) flashHandler?.(f.hex, f.kind);
    });
  }
};

const onMessage = (msg: FromWorker): void => {
  switch (msg.type) {
    case 'state':
      onState(msg.state, msg.events);
      return;
    case 'thinking':
      thinking.value = msg.player;
      return;
    case 'saves':
      saves.value = msg.saves;
      if (pendingUpdateApply) {
        pendingUpdateApply = false;
        void applyUpdate();
      }
      return;
    case 'error':
      thinking.value = null;
      loading.value = null;
      endTurnSent.value = false;
      lastError.value = msg.message;
      audio.play('error');
      pushToast(msg.message, 'bad');
      return;
  }
};

const A2HS_KEY = 'apes.a2hs-nudged.v1';

const nudgeAddToHomeScreen = (): void => {
  if (!isIOS() || isStandalone()) return;
  try {
    if (localStorage.getItem(A2HS_KEY)) return;
    localStorage.setItem(A2HS_KEY, '1');
  } catch {
    return; // storage blocked: don't nag every launch
  }
  pushToast('Tip: tap Share, then "Add to Home Screen" to play offline.', 'info');
};

const applySettingsEffect = (): (() => void) =>
  effect(() => {
    const s = settings.value;
    const root = document.documentElement;
    root.style.setProperty('--text-scale', String(s.textScale / 100));
    root.classList.toggle('reduce-motion', s.reduceMotion);
    root.classList.toggle('cb-patterns', s.colorblindPatterns);
  });

/**
 * iOS may kill a backgrounded tab, and autosaves only happen at turn start. When the page is
 * hidden mid-turn, save to the reserved resume slot (an explicit `save`, no protocol change) so
 * Continue picks up the moves made this turn.
 */
let snapshotCount = 0;
let lastHiddenSave = -1;
const watchHiddenSave = (): void => {
  const saveIfPlaying = (): void => {
    const g = game.value;
    if (!client || route.value !== 'game' || !g || g.phase === 'ended') return;
    if (thinking.value !== null) return; // the worker is busy; the turn-start autosave covers it
    // Skip if no new snapshot arrived since the last hidden save.
    if (snapshotCount === lastHiddenSave) return;
    lastHiddenSave = snapshotCount;
    client.save(RESUME_SLOT);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveIfPlaying();
  });
  window.addEventListener('pagehide', saveIfPlaying);
};

let client: SimClient | null = null;

export const initApp = (): void => {
  if (client) return;
  client = createSimClient();
  const c = client;
  bindClient({
    command: (player, command) => {
      commandSound(command);
      c.command(player, command);
    },
    newGame: (setup) => c.newGame(setup),
    save: (slot) => c.save(slot),
    load: (slot) => c.load(slot),
    deleteSave: (slot) => c.deleteSave(slot),
    listSaves: () => c.listSaves(),
  });
  c.onMessage(onMessage);
  c.listSaves();
  applySettingsEffect();
  initUiAudio();

  void registerServiceWorker({
    onUpdateReady: () => {
      updateReady.value = true;
      // Never reload mid-game: on the title screen apply now, in a game at the next turn start.
      if (route.value !== 'game') void applyUpdate();
      else pushToast('Update ready. It installs at the start of your next turn.', 'info');
    },
  });
  void requestPersistentStorage();
  nudgeAddToHomeScreen();
  watchHiddenSave();
  // Reset per-turn UI state when leaving a game.
  effect(() => {
    if (route.value !== 'game') {
      modal.value = null;
      idleConfirmedTurn.value = -1;
    }
  });
};
