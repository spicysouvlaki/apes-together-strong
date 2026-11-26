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
  freshToasts,
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
  toasts,
} from './store';
import { dedupeByScreen, eventFlash, eventToToast, rankToasts, summarizeAttacks, type EventNames, type FlashKindSpec, type ToastSpec } from './shell/event-toasts';
import { tileIndexOf } from './shell/hexutil';
import { isThreat } from './shell/ticker';
import { endTurnSent, enemyConfirmedTurn, idleSheetTurn, lastTap, loading, pushLog, settings, turnLog, skipped, updateReady } from './shell/shell-state';
import { continueStandingOrders, initStandingOrders, runStandingOrders } from './shell/standing-orders';
import { initGuide } from './shell/guide-state';
import { resumeRecap, shouldRecap } from './shell/resume-recap';
import { idleSheetOpen } from './shell/IdleSheet';
import { contactMoments, firstContacts } from './shell/first-contact';
import { namingLine, strongestCulture } from './shell/city-lines';
import { hexDistance } from '@contracts/hex';
import { audio, setAudioPlanOptions } from '../audio';
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
    const s2 = s ?? prev?.settlements[id];
    return s2 ? { name: s2.name, owner: s2.owner, at: s2.at } : null;
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
  settlementAt: (hex) => {
    const at = (s: GameState | null) => (s ? Object.values(s.settlements).find((x) => x.at.q === hex.q && x.at.r === hex.r) : undefined);
    return (at(state) ?? at(prev))?.name ?? null;
  },
  nearestSettlement: (hex, owner) => {
    let best: { name: string; d: number } | null = null;
    for (const s of Object.values(state.settlements)) {
      if (s.owner !== owner) continue;
      const d = hexDistance(s.at, hex);
      if (!best || d < best.d) best = { name: s.name, d };
    }
    return best?.name ?? null;
  },
  producing: (id) => state.settlements[id]?.production.item ?? null,
  namingLine: (id) => {
    const s = state.settlements[id];
    if (!s) return null;
    const weights = q.cultureWeights(state, s.owner, content);
    return namingLine(lookup.cultures[s.namedFor]?.adjective ?? null, s.namedFor, strongestCulture(weights, content.cultures.map((c) => c.id)));
  },
  unitAt: (hex, owner) => {
    const u = prev ? Object.values(prev.units).find((x) => x.owner === owner && x.at.q === hex.q && x.at.r === hex.r) : undefined;
    return u ? ((u.figure ? lookup.figures[u.figure]?.name : undefined) ?? lookup.units[u.type]?.name ?? null) : null;
  },
});

let pendingUpdateApply = false;

const isMyTurnStart = (prev: GameState | null, next: GameState, my: PlayerId | null): boolean =>
  !!my &&
  next.phase === 'playing' &&
  next.currentPlayer === my &&
  (!prev || prev.turn !== next.turn || prev.currentPlayer !== my || prev.phase !== 'playing');

const onState = (state: GameState, events: SimEvent[]): void => {
  const prev = game.value;
  if (!prev || prev.seed !== state.seed) {
    turnLog.value = [];
    firstContacts.value = [];
  }
  // A resumed save gets "the story so far" (playtest 4); a new game starts with the guide.
  if (shouldRecap(prev?.seed ?? null, state.seed, state.turn) && state.phase === 'playing') resumeRecap.value = { seed: state.seed, turn: state.turn };
  else if (resumeRecap.value && resumeRecap.value.seed !== state.seed) resumeRecap.value = null;
  game.value = state;
  lastEvents.value = events;
  // Lets the planner tell whose settlement grew, so your own growth gets its soft tick.
  setAudioPlanOptions({ settlementOwner: (id) => state.settlements[id]?.owner });
  audio.playEvents(events, me.value);
  thinking.value = null;
  loading.value = null;
  endTurnSent.value = false;
  if (route.value !== 'game') route.value = 'game';
  const my = me.value;
  if (!my) return;

  const turnStart = isMyTurnStart(prev, state, my);
  if (turnStart) {
    // Last turn's news has had its moment; it stays in the log (playtest 4: stale lines piled up).
    toasts.value = freshToasts(toasts.value, state.turn);
    skipped.value = new Set();
    lastTap.value = null;
    idleSheetOpen.value = false;
    if (updateReady.value) pendingUpdateApply = true; // applied after the autosave lands
  }

  // Auto-open the between-ages flow and the ending (GDD §5 "Transition", §8 Chronicle).
  if (state.phase === 'transition' && prev?.phase !== 'transition') openModal({ kind: 'transition' });
  if (state.phase === 'ended' && prev?.phase !== 'ended') openModal({ kind: 'chronicle' });

  // One ranked batch per snapshot: most important first, overflow folded into one line.
  const names = eventNames(state, prev);
  const specs: ToastSpec[] = [];
  const { summaries, folded } = summarizeAttacks(events, my, names);
  for (const t of summaries) specs.push({ ...t, threat: true });
  // "Jelling Stones is complete!" already says it: skip the matching "Hàojīng finished Jelling Stones."
  const wonderDone = new Set(events.flatMap((ev) => (ev.type === 'wonderBuilt' ? [`${ev.settlement}:${ev.wonder}`] : [])));
  for (const ev of events) {
    if (folded.has(ev)) continue;
    if (ev.type === 'productionCompleted' && wonderDone.has(`${ev.settlement}:${ev.item}`)) continue;
    const t = eventToToast(ev, my, names);
    if (t) specs.push(isThreat(ev, my) ? { ...t, threat: true } : t);
  }
  pushToasts(rankToasts(specs).map((t) => ({ ...t, turn: state.turn })));
  // Meeting a people is a moment of its own (wave 11), on top of its line in the news.
  const met = contactMoments(events, my, [state, prev], content);
  if (met.length > 0) firstContacts.value = [...firstContacts.value, ...met.filter((m) => !firstContacts.value.some((x) => x.player === m.player))];
  pushLog(state.turn, dedupeByScreen(specs));

  // Standing orders: start this turn's moves, or continue a run waiting on this snapshot.
  if (turnStart) runStandingOrders();
  else continueStandingOrders();

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
      continueStandingOrders();
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

// No save-on-hide here: the worker writes a rolling resume save after every accepted command
// (src/worker/host.ts), so 'auto:0' already holds the moves made this turn when iOS kills the
// tab, and a hide-time save would only race the page teardown.

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
  initStandingOrders();
  initGuide();

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
  // Reset per-turn UI state when leaving a game.
  effect(() => {
    if (route.value !== 'game') {
      modal.value = null;
      idleSheetTurn.value = -1;
      enemyConfirmedTurn.value = -1;
    }
  });
};
