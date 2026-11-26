/**
 * Renderer public API (workstream 4). The UI (src/ui) consumes ONLY this module.
 *
 * WHAT IT DOES
 *   Draws `GameState` snapshots as a crafted diorama (GDD §11) in one three.js scene on the main
 *   thread: beveled hex prisms with soil-strata sides on a board plinth, a stylized water sheet,
 *   parchment fog, relief, vegetation and micro-detail, culture-kit settlements, figurine units,
 *   name labels, highlights and a parchment-atlas strategic zoom. It never mutates state and
 *   never imports the sim. Everything is procedural (no image or model files).
 *
 * ART PIPELINE (all render-side, see each module)
 *   palette.ts        art-directed colors: light rig, haze, paper/ink, strata, water, biome pastels
 *   scene/materials   hand-written shaders: warm key + cool fill + hemisphere, vertex AO, depth
 *                     haze, filmic shoulder, memory (explored) tint, atlas blend at strategic zoom
 *   textures.ts       procedural detail texels (mottle, cracks, ripples, grain) + per-tile map field
 *   scatter.ts        deterministic prop placement; architecture.ts culture motif kits + blending
 *   scene/geometry    tiles, trees, mountains, micro-detail, resource props, building pieces
 *   scene/figurines   painted-figurine units
 *
 * USAGE
 *   const r = createRenderer(canvas, loadContent(), { reduceMotion, pixelRatioCap: 2, quality: 'high' });
 *   // every snapshot from the worker:
 *   r.setState(state, myPlayerId, queries.visibleTiles(state, myPlayerId, content));
 *   r.onTap((hex) => …);  r.onLongPress((hex) => …);  r.onZoomBand((band) => …);
 *   r.setSelection({ unit, tile, reachable, attackable, path, pathTurns });   // partial updates merge
 *   r.setHints({ readyUnits, sites: [{ hex, rank: 1 }, …] });       // settler site markers
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
 *   corrected for tile height). Taps and long-presses on a settlement label (or a site seal)
 *   resolve to the labelled hex first, not the tile under the label's screen position.
 *   focus() always wins: it cancels inertia, and drags/flings of a gesture that began before
 *   the call are ignored until the next touch-down (camera-motion.ts).
 *
 * FIRST FRAME / FRAMING
 *   On the first snapshot (and on a map-size change) the camera centers the viewer's capital,
 *   else their first unit, in the HUD-free area at the default framing: ~7 hexes across the
 *   short screen axis (camera-math defaultDistanceFor), which is in the 'close' band. Zoomed
 *   in, an edge tile may sit at the screen center (the start is often near the map edge);
 *   zoomed out, the board centers. focus(hex) keeps the player's zoom unless
 *   `{ zoom: 'default' }` is passed.
 *
 * FOG OF WAR
 *   `visible` = tile indices currently in sight (pass `queries.visibleTiles`); explored comes
 *   from `state.players[viewer].explored`. Unexplored = an illustrated old chart: paper grain
 *   and stains, rhumb lines, exactly ONE compass rose per game placed once just beyond the
 *   viewer's start (inside the opening frame), sparse inked wave glyphs and the odd sea serpent, and at the edge of what
 *   is known a sepia wash with ripple rules; no terrain hint. The vellum sheet runs well past
 *   the map edge. Explored-not-visible = a warm sepia memory that keeps terrain readable. Other players' units and
 *   settlements show only on visible tiles; the viewer's own always show. `viewer = null`
 *   reveals everything (debug/spectate).
 *
 * ZOOM BANDS
 *   'close' | 'regional' show the diorama (labels included; micro-detail full at close, sparse at
 *   regional); 'strategic' morphs the board into a flat parchment atlas (paper biomes, inked
 *   coasts and relief glyphs, stronger territory washes) with stamped city icons and unit dots.
 *   Bands have hysteresis; `onZoomBand` fires only on change (not on subscribe).
 *
 * READABILITY (GDD §11)
 *   Terrain colors come from content, graded for distinguishability (terrain-style.ts) and then
 *   into one pastel family (palette.ts). Resources are small props (sheaves, orchards, animals,
 *   ore, fish rings, bales) over a soft halo in their class color (bonus gold, luxury magenta,
 *   strategic steel); unknown ids keep the class marker. Territory: ONE continuous inked band per
 *   territory, only on its outer boundary, mitred at every corner and hugging tile heights
 *   (borders.ts buildBorderMesh, one draw call): ink keyline, owner primary, thin secondary
 *   rule, soft inner wash; patterns cut the primary strip only when enabled. Units are
 *   figurines (owner skin tone from PlayerState.skinTone) on a round base with a team band and
 *   a rim: white = yours, dark = rival, red = at war; figure-units/commanders add a gold ring;
 *   trees clear around visible units. Rival settlements at war with the viewer get a red ring
 *   and a red ⚔ label. Labels are vellum banner cartouches ('Fraunces', both unicode-range
 *   subsets requested explicitly and redrawn once loaded, so ā ð ḥ render in the face) that
 *   hang on a short ink leader ABOVE the settlement; de-overlap only moves labels up, and never
 *   into the HUD bands (safe area). A cartouche at the screen edge slides inward (inside the
 *   left/right safe area) while its leader stays on the settlement (label-layout edgeNudge).
 *   Labels also show on the strategic atlas (capitals and own cities win when crowded). A label that covers a unit (e.g. one standing on the tile
 *   north of the city) fades to 30% and lets taps through; a new settlement's label appears
 *   once its founding pop-in has landed. Trees on the two tiles in front of a visible unit are
 *   thinned and cleared toward it. Desert carries crescent dunes (lit crest, shaded slip face).
 *
 * UNITS (art pass 4; pure rules in unit-look.ts, geometry in scene/figurines.ts)
 *   Chunky toy-soldier figurines, one look per class and age so upgrades show: warband (two
 *   warriors, clubs, hide shields) -> spearman (crested bronze helm, big aspis, long spear);
 *   slinger (whirling sling loop) -> archer (tall bow, quiver); chariot (horse, spoked wheels,
 *   driver) -> horse archer; ram (hide-roofed shed, bronze head) -> catapult (cocked arm, stone);
 *   war canoe (paddlers, carved prow) -> galley (oar banks, banded square sail); settler (ox cart,
 *   parent and child); scout (hooded cloak, staff); merchant (camel with striped bales); general
 *   (taller, gilded plume, square standard) vs explorer (wide hat, swallowtail pennant). Looks are
 *   chosen from content data (class + age, canFound / canTrade / vision, figureKind), never ids.
 *   Owner primary AND secondary are painted on figures and bases (materials SECOND). Base: team
 *   band, secondary rule, rim white = yours, dark = rival, red = at war, grey = city-state, dark
 *   red + a fluttering pennon = raiders; famous people add a gold ring. Idle: a gentle per-figure
 *   sway and cloth flutter in the vertex shader (IDLE; ships BOB broadside-on). Figures face the
 *   viewer at rest (folded travel heading), face an adjacent hostile across the edge, march in
 *   their travel direction with a dust trail. Fortified = stake palisade with shields (not in
 *   towns: the walls say it). Damaged = five billboarded HP pips; lost pips flash and drop.
 *   Embarked land units ride a raft. Stacks: soldier in front full size, civilian behind smaller;
 *   in a settlement units step onto a paved forecourt at the front edge (smaller), offsets follow
 *   the view rotation. COMBAT: flash(hex, 'combat') infers the attacker (selected unit in range,
 *   else the latest mover; unit-look pickAttacker): melee lunges in and back, ranged recoils and
 *   lobs a shot; defenders shake as the blow lands; a unit gone from that hex (the snapshot comes
 *   first) topples backward away from the blow, then sinks into the ground with a dust puff.
 *
 * SETTLEMENTS AND DISTRICTS
 *   Growth spills onto the settlement's own neighbor tiles (districts.ts, by population
 *   milestone): fields (pop 2, 4, 8), a harbor quay on water (3), an orchard (5, 12), workshop
 *   quarters with smoking kilns (6, 10), a monument plinth for capitals (city pop ≥ 6); cities
 *   count 2 pop higher. Orchards/workshops may cut a clearing in woods; fields need open land.
 *   New districts pop in. Inked dashed tracks run from the center to land districts and along
 *   the viewer's trade routes (vellum dots across water).
 *   Built from per-culture motif kits keyed by the culture `architecture` of `namedFor`, blended
 *   with the owner's adopted traditions' and hybrids' cultures (architecture.ts), so hybrids look
 *   hybrid. Size grows with population; cities/city-states get walls (by age material), cities a
 *   centerpiece, capitals a gold finial; built wonders add a landmark silhouette. Owner banners
 *   sway and carry the colorblind pattern.
 *
 * FOG MEMORY
 *   Rival settlements seen once stay on explored-but-not-visible tiles as faded "ghosts" with a
 *   dashed label, as last seen (ghosts.ts). Memory is keyed by game seed + viewer + map size and
 *   resets on a new game; it lives only in the renderer.
 *
 * MAP FINISH (art pass 4): bridges where roads cross rivers (rivers.ts roadRiverCrossings);
 *   pasture animals graze (materials GRAZE); dark cliff seams on hill knolls; parchment stains
 *   from two unrelated scales (no visible tiling at strategic zoom); the strategic atlas gets an
 *   inked double-rule frame with hatching, corner lozenges and a scale-bar cartouche under the
 *   map; jungle = emergent giants over a lower canopy with vines and blossoms, understory ferns,
 *   low mist patches, a darker floor and bright parrots; tropical seas turquoise over a sandy
 *   shore lip, with palms leaning out over tropical beaches; crisis = wind-blown dust (wisps).
 *   scatter.ts unit01 now re-mixes its input: shifted hashes were stuck near 0, so jungles drew
 *   only palms and temperate woods only broadleaf.
 *
 * LIVING WORLD AND MOOD (art pass 3; quality 'low' drops all of these)
 *   Hearth-smoke columns over visible settlements (more chimneys with population) and workshop
 *   kilns; birds wheeling over towns (pop ≥ 3) and a few coasts; fishing boats bobbing beside
 *   coastal settlements. All motion is in vertex shaders (uTime): one instanced draw per layer,
 *   no per-frame CPU; frozen under reduceMotion. Slow cloud shadows drift over land and water;
 *   a very subtle paper fibre lies over the whole frame (vignette pass); lit tile edges carry a
 *   warm rim. Mood grade per age (ancient warm ochre dawn, classical clearer golden noon,
 *   later ages cooler) and a crisis grade (cooler, flatter, hazier) — mood.ts.
 *   AUTOMATIC (no UI call needed): on each setState the renderer compares with the previous
 *   snapshot and fires: a new wonder in sight -> flash 'wonder' (gold motes + banner flourish);
 *   the viewer recruited a figure -> flash 'recruit' at their capital (standard flourish +
 *   sparkle); age change -> the new grade wipes diagonally across the board (~2.6 s) with a
 *   paper "page settle" vignette pulse; crisis start/end -> grade sweep.
 *
 * OPTIONAL EXTRAS (all additive)
 *   createRenderer(canvas, content, { patterns: true, safeArea: { top: 100, bottom: 180 } })
 *   r.setPatterns(on)            colorblind patterns on borders, flags and label swatches (GDD §11)
 *   r.setHints({ readyUnits })   small chevron over own units that still have moves
 *   r.setHints({ sites })        settler site markers (stake, pennant, numbered seal, gold ring)
 *   r.setSafeArea({ top, bottom, left, right })  HUD padding in CSS px; focus() centers targets in
 *                                the remaining area (default top 100, bottom 180)
 *   r.focus(hex, { safeArea })   one-off override
 *   r.zoomBy(factor)             >1 zooms out about the screen center (buttons, bench)
 *   createRenderer(…, { quality: 'low' }) / r.setQuality('low' | 'high') / r.getQuality()
 *                                'low' drops micro-detail, blob shadows and ambient animation
 *   r.flash(hex, kind)           combat: shock ring + unit hit-shake + dust; found: settlement
 *                                pop-in + dust; capture: banner swap (swells, spins in) + town
 *                                bounce + confetti in the new owner's colors; recruit: golden
 *                                sparkle + banner flourish; wonder: waves of gold motes over the
 *                                landmark + flourish; age: soft gold sparkle. Under reduceMotion
 *                                only the ring shows.
 *   r.setMood({ age?, crisis? } | null)  override the mood grade (fields left out follow the
 *                                snapshot; null = automatic). Changes sweep in.
 *   r.focus(hex, { zoom: 'default' })  also reset to the default framing (e.g. "go to capital")
 *   r.stats().frameMs            CPU ms per rendered frame (EMA)
 *   Trade routes owned by the viewer draw as a dotted line between their settlements.
 *
 * PERFORMANCE
 *   Art pass 4, ?game=1&turns=40 (turn 41, crisis, raiders), 375x812 @2x: default framing
 *   59 draws / 191k tris high, 48 / 112k low; regional 59 / 170k; strategic 15 / 31k.
 *   ~50-60 draw calls at close/regional zoom regardless of map size (everything is instanced;
 *   empty layers cost nothing; labels are one atlas-backed instanced draw; the territory band
 *   is one merged mesh), ~15 at strategic. Measured turn 41, AI-played (375x812 @2x,
 *   ?game=1&turns=40): small map default framing 54 draws / 131k tris high, 44 / 75k low;
 *   regional 53 / 114k; strategic 15 / 28k. Standard map (16 settlements): 51 / 124k high,
 *   42 / 73k low, strategic 15 / 30k. Renders on demand (camera
 *   motion, new state, animations); ambient animation (water ripples/foam, banner sway, attack
 *   pulse, selected-unit bob) runs at ~30 fps for ~9 s after the last interaction, then drops to
 *   a cheap perpetual idle at ~13 fps so the world never freezes; neither runs under
 *   reduceMotion or quality 'low' (the map then sleeps between inputs). `stats().fps` is the
 *   rate while something moves, not idle.
 *   Handles webglcontextlost/restored by re-uploading everything from the last snapshot.
 *   Demo: /render-demo.html?real=1 (&bench=1, &quality=low, &age=classical, &reveal=1);
 *   ?game=1 is a real sim game at turn 1 (window.demo.found(), .endTurns(n), .move(id, q, r));
 *   ?game=1&turns=N lets the sim AI play every seat for N turns (also demo.autoplay(n));
 *   ?units=1 is a figurine gallery (every look, relations, stack, fortify, damage, embark);
 *   demo.strike(attackerId, targetId, damage) plays a combat exactly as the UI does;
 *   window.film(start, [ms…], [x, y, w, h]) freezes the clock and composites canvas crops at
 *   those times into a film strip (inspects motion even when the tab is hidden).
 */
import type { Age, ContentBundle } from '@contracts/content-schemas';
import type { Hex } from '@contracts/hex';
import type { GameState, PlayerId, UnitId } from '@contracts/sim-api';
import type { ZoomBand } from './camera-math';
import { createRendererImpl } from './renderer';
import type { RenderQuality } from './scatter';

export type { ZoomBand } from './camera-math';
export type { RenderQuality } from './scatter';

export interface RenderSelection {
  /** Highlighted unit (yellow base ring). */
  unit: UnitId | null;
  /** Selected tile outline. */
  tile: Hex | null;
  /** Move targets (soft highlight). */
  reachable: Hex[];
  /** Attack targets (red highlight). */
  attackable: Hex[];
  /**
   * Optional route preview: a dashed ribbon over the tiles (from the selected unit when the
   * path starts next to it), a waypoint dot per tile and a bullseye on the last hex. Any length.
   */
  path: Hex[];
  /**
   * Optional: indices i into `path` where a new turn starts; a tick is drawn across the edge
   * path[i-1] -> path[i] (i = 0: the edge leaving the unit's tile). Setting `path` without
   * `pathTurns` clears the ticks.
   */
  pathTurns: number[];
}

/** A recommended founding site for a selected settler (rank 1 = best). */
export interface SiteMarker {
  hex: Hex;
  rank: number;
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
  /**
   * 'high' (default): micro-detail, blob shadows, animated water/flags/pulses.
   * 'low': drops those for weaker GPUs (fewer draw calls and fragments).
   */
  quality?: RenderQuality;
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
  /**
   * "Good place to settle" markers (e.g. a selected settler's top sites): a planted survey
   * stake with a fluttering vermilion pennant, a numbered gold seal on top (rank 1 larger) and a
   * soft round gold ground ring. Distinct from move/attack hex highlights. `[]` clears.
   */
  sites: SiteMarker[];
}

export type FlashKind = 'combat' | 'found' | 'capture' | 'recruit' | 'wonder' | 'age';

/** Optional mood override (setMood). Omitted fields follow the snapshot (state.age, state.crisis). */
export interface RenderMood {
  age?: Age;
  crisis?: boolean;
}

export interface Renderer {
  /**
   * Draw this snapshot from `viewer`'s point of view. `visible` = tile indices currently visible
   * (from sim queries); explored comes from state.players[viewer].explored. Pass viewer null to
   * reveal everything (debug). Units that changed tile animate over ~200 ms.
   */
  setState(state: GameState, viewer: PlayerId | null, visible: readonly number[]): void;
  /** Partial update: omitted fields keep their previous value. Pass `null`/`[]` to clear. */
  setSelection(sel: Partial<RenderSelection>): void;
  /**
   * Smoothly center the camera on a hex (in the HUD-free area, see setSafeArea).
   * `zoom: 'default'` also resets the zoom to the default framing (~7 hexes across the short
   * screen axis), e.g. for "go to capital"; without it the player's zoom is kept.
   */
  focus(hex: Hex, opts?: { instant?: boolean; safeArea?: Partial<SafeArea>; zoom?: 'default' }): void;
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
  /** Switch render quality at runtime (see RendererOptions.quality). */
  setQuality(q: RenderQuality): void;
  getQuality(): RenderQuality;
  /**
   * Optional: override the board's mood grade (per-age light, crisis air). Fields left out follow
   * the snapshot; `null` returns to fully automatic. A change wipes across the board (~2.6 s).
   */
  setMood(mood: RenderMood | null): void;
  dispose(): void;
}

export function createRenderer(canvas: HTMLCanvasElement, content: ContentBundle, options?: RendererOptions): Renderer {
  return createRendererImpl(canvas, content, options);
}
