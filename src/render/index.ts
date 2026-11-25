/**
 * Renderer public API (workstream 4). The UI (src/ui) consumes ONLY this module.
 *
 * WHAT IT DOES
 *   Draws `GameState` snapshots with stand-in art in one three.js scene on the main thread:
 *   instanced beveled hex prisms colored from content/terrain.json, features, resources,
 *   territory, settlements (+ name labels), unit figurines, selection highlights, fog of war,
 *   and a flat-icon strategic zoom. It never mutates state and never imports the sim.
 *
 * USAGE
 *   const r = createRenderer(canvas, loadContent(), { reduceMotion, pixelRatioCap: 2 });
 *   // every snapshot from the worker:
 *   r.setState(state, myPlayerId, queries.visibleTiles(state, myPlayerId, content));
 *   r.onTap((hex) => …);  r.onLongPress((hex) => …);  r.onZoomBand((band) => …);
 *   r.setSelection({ unit, tile, reachable, attackable, path });   // partial updates merge
 *   r.flash(event.at, 'combat');  r.focus(hex);
 *   r.dispose();  // on unmount
 *
 * CANVAS, SIZING, SAFE AREA
 *   - Give the canvas a CSS size (e.g. `position:fixed; inset:0; width:100%; height:100%`).
 *     The renderer reads clientWidth/clientHeight, caps devicePixelRatio (default 2) and sets
 *     the drawing buffer itself. A ResizeObserver calls `resize()` automatically; calling it
 *     yourself (e.g. on orientationchange) is harmless.
 *   - Let the canvas fill the whole screen, under the notch/home indicator; put the HUD in
 *     `env(safe-area-inset-*)`-padded overlays above it. The map simply shows through.
 *   - The renderer sets `touch-action: none` on the canvas and handles all pointer events on
 *     it (pan, pinch, twist, tap, long-press, wheel, right-drag rotate). HUD elements layered
 *     above the canvas receive their own events normally; don't forward anything.
 *
 * INPUT SEMANTICS
 *   tap        < 250 ms and < 8 px of movement, single finger -> onTap(hex)
 *   long-press >= 450 ms with no movement                     -> onLongPress(hex) (no tap follows)
 *   drag pans with inertia; pinch zooms about the fingers; two-finger twist (or right-drag on
 *   desktop) rotates the view in 60° steps; mouse wheel zooms about the cursor.
 *   Taps outside the map produce no callback. Picking is O(1) (ray -> plane -> axial round,
 *   corrected for tile height).
 *
 * FOG OF WAR
 *   `visible` = tile indices currently in sight (pass `queries.visibleTiles`); explored comes
 *   from `state.players[viewer].explored`. Unexplored = parchment, no features/relief.
 *   Explored-not-visible = dimmed. Other players' units and settlements show only on visible
 *   tiles; the viewer's own always show. `viewer = null` reveals everything (debug/spectate).
 *
 * ZOOM BANDS
 *   'close' | 'regional' show the diorama (labels included); 'strategic' swaps props/units for
 *   flat discs (settlements) and dots (units) so the whole map reads at a glance. Bands have
 *   hysteresis; `onZoomBand` fires only on change (not on subscribe).
 *
 * READABILITY (stand-in art, GDD §11)
 *   Terrain colors come from content but are graded render-side (terrain-style.ts) so close
 *   pairs stay distinguishable; water is a flat seamless sheet; hills get mounds; rivers are
 *   ribbons between river tiles (rivers.ts); resources show a class-coded marker on a light
 *   badge (bonus = gold ball, luxury = magenta diamond, strategic = dark block). Territory has
 *   crisp outer-edge borders only (borders.ts): dark keyline + owner primary + thin secondary.
 *   Units stand on an owner-colored base with a rim: white = yours, dark = rival, red = at war.
 *   Rival settlements at war with the viewer get a red tile ring and a red ⚔ label.
 *   Labels are de-overlapped on camera moves (label-layout.ts); lower priority labels shift
 *   up/down or hide. Labels and props are hidden at strategic zoom where flat icons take over
 *   (round = city/town, gold rim = capital, hexagon with white rim = city-state).
 *
 * FOG MEMORY
 *   Rival settlements seen once stay on explored-but-not-visible tiles as faded "ghosts" with a
 *   dashed label, as last seen (ghosts.ts). Memory is keyed by game seed + viewer + map size and
 *   resets on a new game; it lives only in the renderer.
 *
 * OPTIONAL EXTRAS (all additive)
 *   createRenderer(canvas, content, { patterns: true, safeArea: { top: 100, bottom: 180 } })
 *   r.setPatterns(on)            colorblind patterns on borders, flags and label swatches (GDD §11)
 *   r.setHints({ readyUnits })   small chevron over own units that still have moves
 *   r.setSafeArea({ top, bottom, left, right })  HUD padding in CSS px; focus() centers targets in
 *                                the remaining area (default top 100, bottom 180)
 *   r.focus(hex, { safeArea })   one-off override
 *   r.zoomBy(factor)             >1 zooms out about the screen center (buttons, bench)
 *   r.stats().frameMs            CPU ms per rendered frame (EMA)
 *   Trade routes owned by the viewer draw as a dotted line between their settlements.
 *
 * PERFORMANCE
 *   ~40-55 draw calls at close/regional zoom regardless of map size (everything is instanced;
 *   empty layers cost nothing; labels are one atlas-backed instanced draw), ~15 at strategic.
 *   Renders on demand only (camera motion, new state, animations), so `stats().fps` is the rate
 *   while something moves, not idle. Selecting a unit pulses its ring for ~2 s, then rests.
 *   Handles webglcontextlost/restored by re-uploading everything from the last snapshot.
 *   Demo: /render-demo.html?bench=1 runs a scripted pan/zoom and reports frame times.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { Hex } from '@contracts/hex';
import type { GameState, PlayerId, UnitId } from '@contracts/sim-api';
import type { ZoomBand } from './camera-math';
import { createRendererImpl } from './renderer';

export type { ZoomBand } from './camera-math';

export interface RenderSelection {
  /** Highlighted unit (yellow base ring). */
  unit: UnitId | null;
  /** Selected tile outline. */
  tile: Hex | null;
  /** Move targets (soft highlight). */
  reachable: Hex[];
  /** Attack targets (red highlight). */
  attackable: Hex[];
  /** Optional path preview (dots). */
  path: Hex[];
}

export interface RendererOptions {
  /** No unit move lerp, camera tweens, inertia, selection pulse or flash expansion. */
  reduceMotion?: boolean;
  /** devicePixelRatio cap (default 2). */
  pixelRatioCap?: number;
  /** Colorblind ownership patterns (settings.colorblindPatterns). Default false. */
  patterns?: boolean;
  /** HUD padding in CSS px kept clear by focus(). Default { top: 100, bottom: 180 }. */
  safeArea?: Partial<SafeArea>;
}

/** Screen padding (CSS px) covered by HUD; focus() centers targets in what's left. */
export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Turn hints the UI already knows (no sim import in the renderer). */
export interface RenderHints {
  /** Own units that still have moves this turn (small chevron marker). */
  readyUnits: UnitId[];
}

export type FlashKind = 'combat' | 'found' | 'capture' | 'recruit';

export interface Renderer {
  /**
   * Draw this snapshot from `viewer`'s point of view. `visible` = tile indices currently visible
   * (from sim queries); explored comes from state.players[viewer].explored. Pass viewer null to
   * reveal everything (debug). Units that changed tile animate over ~200 ms.
   */
  setState(state: GameState, viewer: PlayerId | null, visible: readonly number[]): void;
  /** Partial update: omitted fields keep their previous value. Pass `null`/`[]` to clear. */
  setSelection(sel: Partial<RenderSelection>): void;
  /** Smoothly center the camera on a hex (in the HUD-free area, see setSafeArea). */
  focus(hex: Hex, opts?: { instant?: boolean; safeArea?: Partial<SafeArea> }): void;
  /** Returns an unsubscribe function. */
  onTap(cb: (hex: Hex) => void): () => void;
  onLongPress(cb: (hex: Hex) => void): () => void;
  /** 'close' | 'regional' | 'strategic' — fires when the zoom band changes. */
  onZoomBand(cb: (band: ZoomBand) => void): () => void;
  /** Brief visual feedback for sim events the UI forwards (combat flash at hex, settlement founded pulse). */
  flash(hex: Hex, kind: FlashKind): void;
  resize(): void;
  stats(): { drawCalls: number; triangles: number; fps: number; frameMs: number };
  /** Partial update of turn hints (e.g. units with moves left). */
  setHints(hints: Partial<RenderHints>): void;
  /** Toggle colorblind ownership patterns (GDD §11). */
  setPatterns(on: boolean): void;
  /** Update HUD padding used by focus(). */
  setSafeArea(area: Partial<SafeArea>): void;
  /** Zoom about the screen center; factor > 1 zooms out. */
  zoomBy(factor: number): void;
  dispose(): void;
}

export function createRenderer(canvas: HTMLCanvasElement, content: ContentBundle, options?: RendererOptions): Renderer {
  return createRendererImpl(canvas, content, options);
}
