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
  openModal,
  ownerName,
  q,
  selection,
  setMapFocusHandler,
} from '../store';
import { homeHex } from './hexutil';
import { highlights, lastTap, settings } from './shell-state';
import { resolveTap } from './tap-intent';

let rendererRef: Renderer | null = null;

/** Select a unit (or clear with null) and push its legal targets to the renderer. */
export const selectUnit = (unitId: string | null, opts: { focus?: boolean } = {}): void => {
  const g = game.value;
  const my = me.value;
  const u = unitId && g ? g.units[unitId] : undefined;
  if (!g || !my || !u || u.owner !== my) {
    selection.value = { unit: null, settlement: null, tile: selection.value.tile };
    highlights.value = { reachable: [], attackable: [] };
    rendererRef?.setSelection({ unit: null, reachable: [], attackable: [], path: [] });
    return;
  }
  const reachable = q.reachable(g, u.id, content).map((r) => r.hex);
  const attackable = q.attackTargets(g, u.id, content);
  selection.value = { unit: u.id, settlement: null, tile: u.at };
  highlights.value = { reachable, attackable };
  rendererRef?.setSelection({ unit: u.id, tile: u.at, reachable, attackable, path: [] });
  if (opts.focus) rendererRef?.focus(u.at);
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
    lastTap: cycleFrom,
    atWar: (a, b) => q.atWar(g, a, b),
  });
  switch (intent.kind) {
    case 'move':
      lastTap.value = null;
      dispatch({ type: 'moveUnit', unit: intent.unit, to: intent.to });
      return;
    case 'attack': {
      lastTap.value = null;
      const attack = (): void => dispatch({ type: 'attack', unit: intent.unit, target: intent.target });
      const enemy = intent.declareWarOn;
      if (enemy) {
        askConfirm({
          title: `Declare war on ${ownerName(enemy)}?`,
          body: 'Attacking means war. Their friends may remember it.',
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
      openModal({ kind: 'city', settlement: intent.settlement });
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
      r = createRenderer(canvas, content, { reduceMotion });
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
      // Keep the selected unit's highlights in step with the new snapshot.
      const sel = selection.peek().unit;
      if (sel) untracked(() => selectUnit(g.units[sel] ? sel : null));
    });

    return () => {
      stop();
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
