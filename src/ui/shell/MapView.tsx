/**
 * Full-screen map canvas under the HUD. Owns the renderer lifetime and turns taps into
 * commands via resolveTap (tap-intent.ts). Legal moves/targets always come from SimQueries.
 */
import { useEffect, useRef } from 'preact/hooks';
import { effect, untracked } from '@preact/signals';
import type { Hex } from '@contracts/hex';
import { createRenderer, type Renderer } from '../../render';
import { setMapFlashHandler } from '../app-wiring';
import {
  askConfirm,
  closeModal,
  content,
  dispatch,
  game,
  me,
  modal,
  myTurn,
  lookup,
  openModal,
  ownerName,
  q,
  selection,
  setMapFocusHandler,
} from '../store';
import { homeHex, idleUnits, nextIdleUnit } from './hexutil';
import { highlights, hudBottomPx, lastTap, settings, siteHints } from './shell-state';
import { foundReady, planRoute, plannedRoute, resting, setOrder } from './standing-orders';
import { pushToast } from '../store';
import { resolveTap } from './tap-intent';
import { attackStep } from './combat-view';
import { buildPending, commitAttack, fetchPreview, pendingAttack } from './combat-state';
import { uiPrefs } from './ui-prefs';
import { warTargetsFor } from './war-targets';

let rendererRef: Renderer | null = null;

/**
 * A figure just deployed (figure screen, recruit reveal): once the snapshot shows their unit,
 * select it and bring it into view, so the player sees where they took the field.
 */
let followFigureId: string | null = null;
export const followFigure = (figure: string): void => {
  followFigureId = figure;
};

/** Top bar plus the news ticker under it, kept clear by the camera (CSS px). */
const HUD_TOP_PX = 136;
/** The city sheet's max height (shell.css .city-sheet max-height: 70vh), as a share of the screen. */
const CITY_SHEET_SHARE = 0.7;
/** Bottom controls plus a typical unit sheet, kept clear when focusing a unit. */
const HUD_BOTTOM_PX = 200;

/** Select a unit (or clear with null) and push its legal targets to the renderer. */
export const selectUnit = (unitId: string | null, opts: { focus?: boolean } = {}): void => {
  const g = game.value;
  const my = me.value;
  const u = unitId && g ? g.units[unitId] : undefined;
  if (pendingAttack.peek() && pendingAttack.peek()?.unit !== unitId) pendingAttack.value = null;
  if (!g || !my || !u || u.owner !== my) {
    selection.value = { unit: null, settlement: null, tile: selection.value.tile };
    highlights.value = { reachable: [], attackable: [], warTargets: [] };
    plannedRoute.value = null;
    siteHints.value = null;
    rendererRef?.setSelection({ unit: null, reachable: [], attackable: [], path: [] });
    rendererRef?.setHints({ sites: [] });
    return;
  }
  const reachable = q.reachable(g, u.id, content).map((r) => r.hex);
  const attackable = q.attackTargets(g, u.id, content);
  const warTargets = warTargetsFor(g, my, u.id, (s, id) => q.attackTargets(s, id, content), new Set(q.visibleTiles(g, my, content)));
  if (plannedRoute.value && plannedRoute.value.unit !== u.id) plannedRoute.value = null;
  // A settler shows the best sites nearby (top 3), GDD §7 "Settlements".
  siteHints.value = lookup.units[u.type]?.canFound ? { unit: u.id, sites: q.settleSites(g, u.id, content).slice(0, 3) } : null;
  // Numbered "good place to settle" markers (rank 1 = best), shown alongside any route preview.
  rendererRef?.setHints({ sites: (siteHints.value?.sites ?? []).map((s, i) => ({ hex: s.hex, rank: i + 1 })) });
  selection.value = { unit: u.id, settlement: null, tile: u.at };
  highlights.value = { reachable, attackable, warTargets };
  rendererRef?.setSelection({ unit: u.id, tile: u.at, reachable, attackable, path: overlayPath(), pathTurns: overlayTurns() });
  if (opts.focus) rendererRef?.focus(u.at);
};

/** The route preview channel (`path`): the planned route, if any. Sites use setHints({ sites }). */
const overlayPath = (): Hex[] => plannedRoute.value?.path ?? [];
/** Turn ticks along the route (indices where a new turn starts). */
const overlayTurns = (): number[] => plannedRoute.value?.turnStarts ?? [];

/** Preview a route for the selected unit (or confirm it on a second tap of the same tile). */
export const previewRoute = (unit: string, to: Hex): void => {
  const cur = plannedRoute.value;
  if (cur && cur.unit === unit && cur.tapped.q === to.q && cur.tapped.r === to.r) {
    confirmRoute();
    return;
  }
  const plan = planRoute(unit, to);
  if (!plan) {
    pushToast('No known route there. Explore more of the map first, or pick another tile.', 'info');
    return;
  }
  plannedRoute.value = plan;
  rendererRef?.setSelection({ tile: plan.to, path: plan.path, pathTurns: plan.turnStarts });
};

export const cancelRoute = (): void => {
  plannedRoute.value = null;
  const u = selection.value.unit;
  const at = u ? game.value?.units[u]?.at : null;
  rendererRef?.setSelection({ tile: at ?? null, path: overlayPath(), pathTurns: overlayTurns() });
};

/** Go: move as far as possible now, keep the rest as a standing order. */
export const confirmRoute = (): void => {
  const plan = plannedRoute.value;
  const g = game.value;
  if (!plan || !g) return;
  plannedRoute.value = null;
  const u = g.units[plan.unit];
  if (!u) return;
  setOrder(plan.unit, { kind: 'goto', to: plan.to });
  const reach = highlights.value.reachable;
  const attack = highlights.value.attackable;
  // The furthest step of the route we can take this turn (never an attack).
  let step: Hex | null = null;
  for (const h of plan.path) if (reach.some((r) => r.q === h.q && r.r === h.r) && !attack.some((a) => a.q === h.q && a.r === h.r)) step = h;
  if (step) {
    if (step.q === plan.to.q && step.r === plan.to.r) setOrder(plan.unit, null);
    dispatch({ type: 'moveUnit', unit: plan.unit, to: step });
  }
  rendererRef?.setSelection({ path: [], tile: null });
  const next = nextIdleUnit(g, me.value ?? '', resting.value, plan.unit, foundReady.value);
  selectUnit(next && next.id !== plan.unit ? next.id : null, { focus: !!next && next.id !== plan.unit });
};

/** Show or refresh the dots after a plan/site change without reselecting. */
export const refreshOverlay = (): void => {
  rendererRef?.setSelection({ path: overlayPath(), pathTurns: overlayTurns() });
};

const onTap = (hex: Hex): void => {
  const g = game.value;
  const my = me.value;
  if (!g || !my || !myTurn.value) return;
  // A sheet that covers the map closes on a map tap; full screens block taps anyway.
  const m = modal.value;
  // Cycling continues from the city only while its sheet is still open; units cycle from the
  // current selection. A stale tap from long ago must not skip the city.
  const cycleFrom = m?.kind === 'city' ? lastTap.value : null;
  if (m && (m.kind === 'tileInfo' || m.kind === 'city')) closeModal();

  const intent = resolveTap({
    state: g,
    me: my,
    hex,
    selectedUnit: selection.value.unit,
    reachable: highlights.value.reachable,
    attackable: highlights.value.attackable,
    warTargets: highlights.value.warTargets,
    lastTap: cycleFrom,
    atWar: (a, b) => q.atWar(g, a, b),
  });
  // Any other tap drops an inline attack preview (it was for that one target).
  if (intent.kind !== 'attack' && pendingAttack.value) pendingAttack.value = null;
  switch (intent.kind) {
    case 'plan':
      lastTap.value = null;
      previewRoute(intent.unit, intent.to);
      return;
    case 'move':
      lastTap.value = null;
      plannedRoute.value = null;
      setOrder(intent.unit, null); // a direct order replaces any standing one
      dispatch({ type: 'moveUnit', unit: intent.unit, to: intent.to });
      return;
    case 'attack': {
      lastTap.value = null;
      plannedRoute.value = null;
      setOrder(intent.unit, null);
      const attack = (): void => dispatch({ type: 'attack', unit: intent.unit, target: intent.target });
      const enemy = intent.declareWarOn;
      // Preview first (GDD §7 "Combat"): the sheet, or with "Confirm attacks" off a first tap
      // previews inline and a second tap on the same target attacks.
      const preview = fetchPreview(g, intent.unit, intent.target);
      const cur = pendingAttack.value;
      const step = attackStep({
        hasPreview: !!preview,
        confirmSetting: uiPrefs.value.confirmAttacks,
        armed: cur && cur.mode === 'inline' ? cur : null,
        unit: intent.unit,
        target: intent.target,
      });
      if (preview && step.kind !== 'legacy') {
        if (step.kind === 'attack') {
          commitAttack({ unit: intent.unit, target: intent.target, declareWarOn: enemy });
          return;
        }
        pendingAttack.value = buildPending(g, my, intent.unit, intent.target, enemy, preview, step.kind === 'sheet' ? 'sheet' : 'inline');
        rendererRef?.setSelection({ tile: intent.target });
        return;
      }
      if (enemy) {
        askConfirm({
          title: `Declare war on ${ownerName(enemy)}?`,
          body: `Attacking ${ownerName(enemy)} means war. Peace later costs influence and takes time; any trade routes with them stop.`,
          confirmLabel: 'Declare war',
          danger: true,
          onConfirm: () => {
            dispatch({ type: 'declareWar', target: enemy });
            attack();
          },
        });
      } else attack();
      return;
    }
    case 'selectUnit':
      lastTap.value = { hex, cycleIndex: intent.cycleIndex };
      selectUnit(intent.unit);
      return;
    case 'openCity':
      lastTap.value = { hex, cycleIndex: intent.cycleIndex };
      selectUnit(null);
      selection.value = { unit: null, settlement: intent.settlement, tile: hex };
      rendererRef?.setSelection({ tile: hex });
      openModal({ kind: 'city', settlement: intent.settlement }); // the modal effect below focuses it
      return;
    case 'deselect':
      lastTap.value = null;
      selectUnit(null);
      selection.value = { unit: null, settlement: null, tile: null };
      rendererRef?.setSelection({ tile: null });
      return;
  }
};

const onLongPress = (hex: Hex): void => {
  if (!game.value) return;
  rendererRef?.setSelection({ tile: hex });
  openModal({ kind: 'tileInfo', hex });
};

export function MapView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = settings.value.reduceMotion;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let r: Renderer;
    try {
      r = createRenderer(canvas, content, {
        reduceMotion,
        patterns: untracked(() => settings.value.colorblindPatterns),
        safeArea: { top: HUD_TOP_PX, bottom: HUD_BOTTOM_PX },
      });
    } catch (err) {
      console.error('Renderer failed to start', err);
      return;
    }
    rendererRef = r;
    setMapFocusHandler((h) => r.focus(h));
    setMapFlashHandler((h, kind) => r.flash(h, kind));
    const offTap = r.onTap(onTap);
    const offLong = r.onLongPress(onLongPress);

    let lastKey: string | null = null;
    const stop = effect(() => {
      const g = game.value;
      const my = me.value;
      if (!g || !my) return;
      r.setState(g, my, q.visibleTiles(g, my, content));
      // Focus home on the first snapshot and at the start of each of my turns.
      const key = `${g.seed}:${g.turn}:${g.currentPlayer === my}`;
      if (key !== lastKey && g.currentPlayer === my) {
        const first = lastKey === null;
        lastKey = key;
        const home = homeHex(g, my);
        if (home && (first || selection.peek().unit === null)) r.focus(home, { instant: first });
      }
      if (followFigureId) {
        const loc = g.figures[followFigureId]?.location;
        if (loc?.state === 'unit' && g.units[loc.unit]) {
          followFigureId = null;
          const unit = loc.unit;
          untracked(() => selectUnit(unit, { focus: true }));
          return;
        }
      }
      // Keep the selected unit's highlights in step with the new snapshot.
      const sel = selection.peek().unit;
      if (sel) untracked(() => selectUnit(g.units[sel] ? sel : null));
    });

    // Closing a city or tile sheet clears its tile outline (unless a unit owns the selection).
    // Opening a city sheet (from a tap, a toast or "Next: Production") centres the city in the
    // strip of map the sheet leaves visible, so the sheet never hides the city it is about.
    let prevKind: string | null = null;
    let prevCity: string | null = null;
    const stopOutline = effect(() => {
      const m = modal.value;
      const kind = m?.kind ?? null;
      const was = prevKind;
      prevKind = kind;
      const city = m?.kind === 'city' ? m.settlement : null;
      if (city && city !== prevCity) {
        const s = untracked(() => game.value?.settlements[city]);
        if (s) r.focus(s.at, { safeArea: { top: HUD_TOP_PX, bottom: Math.round(window.innerHeight * CITY_SHEET_SHARE) } });
      }
      // Closing the city sheet: bring the city back down from the top strip the sheet left, or
      // the map sits under the top bar with empty parchment below (playtest, turn 1).
      if (!city && prevCity && kind === null) {
        const s = untracked(() => game.value?.settlements[prevCity ?? '']);
        if (s && selection.peek().unit === null) r.focus(s.at);
      }
      prevCity = city;
      if ((was === 'city' || was === 'tileInfo') && kind !== 'city' && kind !== 'tileInfo' && selection.peek().unit === null) {
        r.setSelection({ tile: null });
        selection.value = { unit: null, settlement: null, tile: null };
      }
    });

    const stopPatterns = effect(() => r.setPatterns(settings.value.colorblindPatterns));
    // Keep the selected unit in the strip of map the bottom HUD leaves visible (the unit sheet
    // of a settler can be tall). Refocus only when the stack grew past the unit.
    // Refocus at most once per selected unit, so a route preview growing the sheet never moves
    // the tile the player is about to tap again.
    let lastBottom = HUD_BOTTOM_PX;
    let refocused: string | null = null;
    const stopSafe = effect(() => {
      const bottom = Math.max(HUD_BOTTOM_PX, hudBottomPx.value);
      r.setSafeArea({ bottom });
      const sel = untracked(() => selection.value.unit);
      const u = sel ? untracked(() => game.value?.units[sel]) : undefined;
      if (u && sel !== refocused && bottom > lastBottom + 40) {
        refocused = sel;
        r.focus(u.at);
      }
      lastBottom = bottom;
    });
    // Chevrons over own units that still want orders this turn (skipped ones drop out).
    const stopHints = effect(() => {
      const g = game.value;
      const my = me.value;
      const ready = g && my && g.currentPlayer === my && g.phase === 'playing' ? idleUnits(g, my, resting.value, foundReady.value).map((u) => u.id) : [];
      r.setHints({ readyUnits: ready });
    });

    return () => {
      stop();
      stopOutline();
      stopPatterns();
      stopSafe();
      stopHints();
      offTap();
      offLong();
      setMapFocusHandler(null);
      setMapFlashHandler(null);
      rendererRef = null;
      r.dispose();
    };
  }, [reduceMotion]);

  return <canvas ref={canvasRef} class="map-canvas" aria-label="Map. Tap to select, long-press for tile details." />;
}
