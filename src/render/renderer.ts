/**
 * The renderer implementation: WebGL setup, camera, touch/mouse input, render-on-demand loop.
 * Public API and usage notes live in ./index.ts.
 */
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { ContentBundle } from '@contracts/content-schemas';
import type { Hex } from '@contracts/hex';
import type { GameState, PlayerId } from '@contracts/sim-api';
import {
  REGIONAL_MAX,
  clampDistance,
  clampTarget,
  defaultDistanceFor,
  softHalfExtent,
  viewHalfExtents,
  cameraOffset,
  maxDistanceFor,
  nextZoomBand,
  pickHex,
  pitchFor,
  shortAxisFactor,
  MIN_DISTANCE,
  ROTATION_STEP,
  type Ray,
  type ZoomBand,
} from './camera-math';
import { ART } from './palette';
import type { RenderQuality } from './scatter';
import { vignetteMaterial } from './scene/materials';
import { GestureRecognizer, LONG_PRESS_MS, type GestureAction } from './gestures';
import { ELEVATION_STEP, LAND_TOP, MAX_ELEVATION } from './heights';
import { hexToWorld, mapBounds, type MapBounds } from './layout';
import { World, type FlashKind, type Selection } from './scene/world';
import type { RenderHints, Renderer, RendererOptions, RenderSelection, SafeArea } from './index';

const FOV_Y = 40;
const FOCUS_MS = 380;
const INERTIA_DECAY_MS = 260;
const YAW_RATE = 12; // 1/s, exponential approach to the snapped yaw
/**
 * Starting distance: DEFAULT_HEXES_ACROSS (~7) hexes across the short screen axis at the focus
 * point (GDD §11: start close enough that the diorama reads, with the surroundings in view).
 */
const defaultDistance = (aspect: number): number => defaultDistanceFor(aspect, FOV_Y);
/** Ambient animation (water, flags, pulses) runs at the full ambient rate this long after the last interaction. */
const AMBIENT_MS = 9000;
/** Ambient frames are throttled to ~30 fps (battery). */
const AMBIENT_FRAME_MS = 33;
/**
 * After that the map never freezes: a very cheap perpetual idle (~13 fps) keeps water and
 * banners alive. Off under reduceMotion and quality 'low' (then the map sleeps between inputs).
 */
const IDLE_FRAME_MS = 75;
/** Default HUD padding (CSS px) that focus() keeps targets out of (top bar, bottom sheet). */
export const DEFAULT_SAFE_AREA: SafeArea = { top: 100, right: 0, bottom: 180, left: 0 };

interface Tween {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  start: number;
}

const now = (): number => performance.now();

export function createRendererImpl(
  canvas: HTMLCanvasElement,
  content: ContentBundle,
  options: RendererOptions = {},
): Renderer {
  const reduceMotion = options.reduceMotion ?? false;
  const pixelRatioCap = options.pixelRatioCap ?? 2;
  let safeArea: SafeArea = { ...DEFAULT_SAFE_AREA, ...options.safeArea };

  let quality: RenderQuality = options.quality ?? 'high';
  const gl = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  gl.setClearColor(new Color(ART.bgHorizon));
  canvas.style.touchAction = 'none';
  (canvas.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none';
  canvas.style.userSelect = 'none';

  const scene = new Scene();
  // Lighting lives in the diorama shaders (scene/materials.ts); no three.js lights needed.
  const camera = new PerspectiveCamera(FOV_Y, 1, 1, 900);
  const world = new World(content, { reduceMotion, patterns: options.patterns ?? false, quality });
  scene.add(world.root);
  // One cheap full-screen pass: vignette + cool atmospheric tint at the top of the screen.
  const vigGeo = new BufferGeometry();
  vigGeo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const vigMat = vignetteMaterial(0.42);
  const vignette = new Mesh(vigGeo, vigMat);
  vignette.frustumCulled = false;
  vignette.renderOrder = 1000;
  scene.add(vignette);
  let ambientUntil = 0;
  let ambientTimer: ReturnType<typeof setTimeout> | null = null;
  const animOn = (): boolean => !reduceMotion && quality === 'high';
  world.uniforms.uAnim.value = animOn() ? 1 : 0;
  const wake = (): void => {
    if (animOn()) ambientUntil = now() + AMBIENT_MS;
  };

  // --- Camera state ---------------------------------------------------------------------------
  let bounds: MapBounds = mapBounds(1, 1);
  let tx = 0;
  let tz = 0;
  let distance = defaultDistance(9 / 19.5);
  let maxDistance = REGIONAL_MAX * 2;
  let yaw = 0;
  let yawTarget = 0;
  let band: ZoomBand = 'close';
  let tween: Tween | null = null;
  let vx = 0; // inertia, world units per ms
  let vz = 0;
  let lastFrame = 0;

  // --- Snapshot state -------------------------------------------------------------------------
  let lastState: GameState | null = null;
  let lastViewer: PlayerId | null = null;
  let lastVisible: readonly number[] = [];
  let mapW = 0;
  let mapH = 0;
  let selection: Selection = { unit: null, tile: null, reachable: [], attackable: [], path: [] };
  let unitsMoving = false;

  // --- Loop / stats ---------------------------------------------------------------------------
  let raf = 0;
  let disposed = false;
  let contextLost = false;
  let fpsEma = 0;
  let lastRenderAt = 0;
  let drawCalls = 0;
  let triangles = 0;
  let frameMsEma = 0;
  // Last camera pose used for label layout (re-layout only when it changes).
  let lpX = NaN;
  let lpY = NaN;
  let lpZ = NaN;
  let lpYaw = NaN;
  let lpAspect = NaN;
  let lastSeed: number | null = null;
  let hudChanged = true;

  const tapListeners = new Set<(h: Hex) => void>();
  const longListeners = new Set<(h: Hex) => void>();
  const bandListeners = new Set<(b: ZoomBand) => void>();

  // Scratch (no per-frame allocation).
  const v3 = new Vector3();
  const ray: Ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
  const g0 = { x: 0, z: 0, ok: false };
  const g1 = { x: 0, z: 0, ok: false };

  const requestRender = (): void => {
    if (raf || disposed || contextLost) return;
    raf = requestAnimationFrame(frame);
  };

  const applyCamera = (): void => {
    const k = shortAxisFactor(camera.aspect || 1);
    distance = clampDistance(distance, maxDistance, MIN_DISTANCE / k);
    const norm = distance * k;
    // Haze toward the horizon scales with zoom; the atlas look fades in toward strategic zoom.
    world.uniforms.uFogNear.value = distance * 1.05;
    world.uniforms.uFogFar.value = distance * 2.9;
    const a = (norm - REGIONAL_MAX * 0.85) / (REGIONAL_MAX * 0.35);
    world.uniforms.uAtlas.value = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
    const ext = viewHalfExtents(distance, camera.aspect || 1, FOV_Y);
    const c = clampTarget(tx, tz, bounds, 2, softHalfExtent(ext.w, bounds.maxX - bounds.minX), softHalfExtent(ext.h, bounds.maxZ - bounds.minZ));
    tx = c.x;
    tz = c.z;
    const off = cameraOffset(distance, pitchFor(norm), yaw);
    camera.position.set(tx + off.x, off.y, tz + off.z);
    camera.lookAt(tx, 0, tz);
    camera.updateMatrixWorld();
    // Strategic icons grow with zoom; units/resources grow a little at regional zoom.
    world.setZoomScales(Math.max(1, Math.min(3, norm / 40)), Math.max(1, Math.min(1.8, norm / 15)), now());
    const nb = nextZoomBand(norm, band);
    if (nb !== band) {
      band = nb;
      world.setBand(band);
      for (const cb of bandListeners) cb(band);
    }
  };

  /** Position the camera for the current target without clamping or side effects (focus math). */
  const placeCamera = (): void => {
    const norm = distance * shortAxisFactor(camera.aspect || 1);
    const off = cameraOffset(distance, pitchFor(norm), yaw);
    camera.position.set(tx + off.x, off.y, tz + off.z);
    camera.lookAt(tx, 0, tz);
    camera.updateMatrixWorld();
  };

  /** Screen (CSS px, canvas-relative) -> world ray, written into `ray`. */
  const screenRay = (sx: number, sy: number): void => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    v3.set((sx / w) * 2 - 1, -(sy / h) * 2 + 1, 0.5).unproject(camera);
    ray.ox = camera.position.x;
    ray.oy = camera.position.y;
    ray.oz = camera.position.z;
    const dx = v3.x - ray.ox;
    const dy = v3.y - ray.oy;
    const dz = v3.z - ray.oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    ray.dx = dx / len;
    ray.dy = dy / len;
    ray.dz = dz / len;
  };

  const ground = (sx: number, sy: number, out: { x: number; z: number; ok: boolean }): void => {
    screenRay(sx, sy);
    if (ray.dy > -1e-4) {
      out.ok = false;
      return;
    }
    const t = (LAND_TOP - ray.oy) / ray.dy;
    out.x = ray.ox + ray.dx * t;
    out.z = ray.oz + ray.dz * t;
    out.ok = true;
  };

  const pick = (sx: number, sy: number): Hex | null => {
    screenRay(sx, sy);
    return pickHex(ray, (h) => world.topAt(h), 0, LAND_TOP + ELEVATION_STEP * MAX_ELEVATION + 0.01);
  };

  const zoomAt = (factor: number, sx: number, sy: number): void => {
    ground(sx, sy, g0);
    distance = clampDistance(distance * factor, maxDistance, MIN_DISTANCE / shortAxisFactor(camera.aspect || 1));
    applyCamera();
    ground(sx, sy, g1);
    if (g0.ok && g1.ok) {
      tx += g0.x - g1.x;
      tz += g0.z - g1.z;
      applyCamera();
    }
  };

  const recomputeLimits = (): void => {
    bounds = mapBounds(Math.max(1, mapW), Math.max(1, mapH));
    maxDistance = maxDistanceFor(bounds, camera.aspect || 1, FOV_Y);
  };

  // --- Frame ----------------------------------------------------------------------------------
  function frame(): void {
    raf = 0;
    if (disposed || contextLost) return;
    const t = now();
    const dt = lastFrame ? Math.min(64, t - lastFrame) : 16;
    lastFrame = t;
    let again = false;

    if (tween) {
      const k = Math.min(1, (t - tween.start) / FOCUS_MS);
      const e = k * k * (3 - 2 * k);
      tx = tween.fromX + (tween.toX - tween.fromX) * e;
      tz = tween.fromZ + (tween.toZ - tween.fromZ) * e;
      if (k >= 1) tween = null;
      else again = true;
    } else if (vx !== 0 || vz !== 0) {
      tx -= vx * dt;
      tz -= vz * dt;
      const decay = Math.exp(-dt / INERTIA_DECAY_MS);
      vx *= decay;
      vz *= decay;
      if (Math.hypot(vx, vz) < 0.00005) {
        vx = 0;
        vz = 0;
      } else again = true;
    }
    let yawChanged = false;
    if (yaw !== yawTarget) {
      const d = yawTarget - yaw;
      if (reduceMotion || Math.abs(d) < 0.002) yaw = yawTarget;
      else yaw += d * (1 - Math.exp((-YAW_RATE * dt) / 1000));
      yawChanged = true;
      world.setYaw(yaw);
      again = again || yaw !== yawTarget;
    }
    applyCamera();
    if (unitsMoving || yawChanged) {
      unitsMoving = world.drawUnits(t);
      again = again || unitsMoving;
    }
    if (world.animateFlashes(t)) again = true;
    const ambient = animOn();
    const active = t < ambientUntil;
    world.setAmbient(ambient);
    if (ambient) {
      world.uniforms.uTime.value = t / 1000;
      // Idle bob of the selected unit rides the ambient frames.
      if (!again && world.wantsAmbient()) world.drawUnits(t);
    }

    const camChanged =
      camera.position.x !== lpX ||
      camera.position.y !== lpY ||
      camera.position.z !== lpZ ||
      yaw !== lpYaw ||
      camera.aspect !== lpAspect;
    if (camChanged) {
      lpX = camera.position.x;
      lpY = camera.position.y;
      lpZ = camera.position.z;
      lpYaw = yaw;
      lpAspect = camera.aspect;
    }
    world.layoutLabels(camera, canvas.clientWidth || 1, canvas.clientHeight || 1, camChanged || hudChanged, safeArea);
    hudChanged = false;

    gl.render(scene, camera);
    const spent = now() - t;
    frameMsEma = frameMsEma ? frameMsEma * 0.9 + spent * 0.1 : spent;
    drawCalls = gl.info.render.calls;
    triangles = gl.info.render.triangles;
    if (lastRenderAt && t - lastRenderAt < 100) {
      const inst = 1000 / Math.max(1, t - lastRenderAt);
      fpsEma = fpsEma ? fpsEma * 0.9 + inst * 0.1 : inst;
    }
    lastRenderAt = t;
    if (again) requestRender();
    else {
      lastFrame = 0;
      if (ambient && ambientTimer === null) {
        ambientTimer = setTimeout(
          () => {
            ambientTimer = null;
            requestRender();
          },
          active ? AMBIENT_FRAME_MS : IDLE_FRAME_MS,
        );
      }
    }
  }

  // --- Input ----------------------------------------------------------------------------------
  const gestures = new GestureRecognizer();
  let longTimer: ReturnType<typeof setTimeout> | null = null;

  const local = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const handle = (actions: GestureAction[]): void => {
    for (const a of actions) {
      switch (a.type) {
        case 'interrupt':
          tween = null;
          vx = 0;
          vz = 0;
          break;
        case 'pan':
          ground(a.fromX, a.fromY, g0);
          ground(a.toX, a.toY, g1);
          if (g0.ok && g1.ok) {
            tx -= g1.x - g0.x;
            tz -= g1.z - g0.z;
            applyCamera();
            requestRender();
          }
          break;
        case 'panEnd': {
          if (reduceMotion) break;
          const cx = (canvas.clientWidth || 1) / 2;
          const cy = (canvas.clientHeight || 1) / 2;
          ground(cx, cy, g0);
          ground(cx + a.vx * 16, cy + a.vy * 16, g1);
          if (g0.ok && g1.ok) {
            vx = (g1.x - g0.x) / 16;
            vz = (g1.z - g0.z) / 16;
            requestRender();
          }
          break;
        }
        case 'pinch':
          zoomAt(a.factor, a.cx, a.cy);
          requestRender();
          break;
        case 'rotateStep':
          yawTarget += a.dir * ROTATION_STEP;
          requestRender();
          break;
        case 'tap': {
          const h = pick(a.x, a.y);
          if (h) for (const cb of tapListeners) cb(h);
          break;
        }
        case 'longPress': {
          const h = pick(a.x, a.y);
          if (h) for (const cb of longListeners) cb(h);
          break;
        }
      }
    }
  };

  const clearLong = (): void => {
    if (longTimer !== null) clearTimeout(longTimer);
    longTimer = null;
  };

  const onDown = (e: PointerEvent): void => {
    e.preventDefault();
    wake();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests, automation) may not be capturable; harmless.
    }
    const p = local(e);
    handle(gestures.down(e.pointerId, p.x, p.y, now(), e.pointerType === 'mouse' ? e.button : 0));
    clearLong();
    if (gestures.awaitingLongPress) {
      longTimer = setTimeout(() => {
        longTimer = null;
        handle(gestures.tick(now()));
      }, LONG_PRESS_MS + 5);
    }
  };
  const onMove = (e: PointerEvent): void => {
    const p = local(e);
    handle(gestures.move(e.pointerId, p.x, p.y, now()));
    if (!gestures.awaitingLongPress) clearLong();
  };
  const onUp = (e: PointerEvent): void => {
    const p = local(e);
    clearLong();
    handle(gestures.up(e.pointerId, p.x, p.y, now()));
  };
  const onCancel = (e: PointerEvent): void => {
    clearLong();
    handle(gestures.cancel(e.pointerId));
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = local(e);
    wake();
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dy = Math.max(-200, Math.min(200, e.deltaY * scale));
    tween = null;
    vx = 0;
    vz = 0;
    zoomAt(Math.exp(dy * 0.0016), p.x, p.y);
    requestRender();
  };
  const onContextMenu = (e: Event): void => e.preventDefault();
  const onLost = (e: Event): void => {
    e.preventDefault();
    contextLost = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const onRestored = (): void => {
    contextLost = false;
    world.touchAll();
    if (lastState) world.update(lastState, lastViewer, lastVisible, now());
    world.setSelection(selection, now());
    requestRender();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  let ro: ResizeObserver | null = null;

  const api: Renderer = {
    setState(state, viewer, visible) {
      const first = lastState === null;
      if (lastSeed !== null && state.seed !== lastSeed) world.resetMemory();
      lastSeed = state.seed;
      const sizeChanged = state.map.width !== mapW || state.map.height !== mapH;
      lastState = state;
      lastViewer = viewer;
      lastVisible = visible;
      if (sizeChanged) {
        mapW = state.map.width;
        mapH = state.map.height;
        recomputeLimits();
      }
      const t = now();
      wake();
      world.update(state, viewer, visible, t);
      unitsMoving = world.drawUnits(t);
      if (first || sizeChanged) {
        const start = initialFocus(state, viewer);
        const w = hexToWorld(start);
        tx = w.x;
        tz = w.z;
        tween = null;
        distance = defaultDistance(camera.aspect || 1);
        applyCamera();
        api.focus(start, { instant: true });
      }
      applyCamera();
      requestRender();
    },

    setSelection(sel: Partial<RenderSelection>) {
      selection = {
        unit: sel.unit !== undefined ? sel.unit : selection.unit,
        tile: sel.tile !== undefined ? sel.tile : selection.tile,
        reachable: sel.reachable ?? selection.reachable,
        attackable: sel.attackable ?? selection.attackable,
        path: sel.path ?? selection.path,
      };
      wake();
      if (world.setSelection(selection, now())) unitsMoving = true;
      requestRender();
    },

    focus(hex, opts) {
      const w = hexToWorld(hex);
      // Put the hex at the center of the HUD-free area, not under the top bar or bottom sheet:
      // find where that screen point lands on the ground for a camera aimed at the hex, then
      // shift the aim by the difference (exact for a planar ground at fixed pitch/yaw).
      const cw = canvas.clientWidth || 1;
      const ch = canvas.clientHeight || 1;
      const sa = opts?.safeArea ? { ...safeArea, ...opts.safeArea } : safeArea;
      if (opts?.zoom === 'default') {
        distance = defaultDistance(camera.aspect || 1);
        applyCamera();
      }
      const scx = (sa.left + (cw - sa.right)) / 2;
      const scy = (sa.top + (ch - sa.bottom)) / 2;
      let aimX = w.x;
      let aimZ = w.z;
      const saveX = tx;
      const saveZ = tz;
      if (Math.abs(scx - cw / 2) > 0.5 || Math.abs(scy - ch / 2) > 0.5) {
        tx = w.x;
        tz = w.z;
        placeCamera();
        ground(scx, scy, g0);
        if (g0.ok) {
          aimX = w.x + (w.x - g0.x);
          aimZ = w.z + (w.z - g0.z);
        }
        tx = saveX;
        tz = saveZ;
        placeCamera();
      }
      const ext = viewHalfExtents(distance, camera.aspect || 1, FOV_Y);
      const c = clampTarget(aimX, aimZ, bounds, 2, softHalfExtent(ext.w, bounds.maxX - bounds.minX), softHalfExtent(ext.h, bounds.maxZ - bounds.minZ));
      vx = 0;
      vz = 0;
      if (opts?.instant || reduceMotion) {
        tween = null;
        tx = c.x;
        tz = c.z;
        applyCamera();
      } else {
        tween = { fromX: tx, fromZ: tz, toX: c.x, toZ: c.z, start: now() };
      }
      requestRender();
    },

    onTap(cb) {
      tapListeners.add(cb);
      return () => tapListeners.delete(cb);
    },
    onLongPress(cb) {
      longListeners.add(cb);
      return () => longListeners.delete(cb);
    },
    onZoomBand(cb) {
      bandListeners.add(cb);
      return () => bandListeners.delete(cb);
    },

    flash(hex, kind: FlashKind) {
      wake();
      world.flash(hex, kind, now());
      requestRender();
    },

    resize() {
      const w = Math.max(1, canvas.clientWidth || canvas.width);
      const h = Math.max(1, canvas.clientHeight || canvas.height);
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      gl.setPixelRatio(Math.min(dpr, pixelRatioCap));
      gl.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      recomputeLimits();
      applyCamera();
      requestRender();
    },

    stats() {
      return { drawCalls, triangles, fps: Math.round(fpsEma), frameMs: Math.round(frameMsEma * 100) / 100 };
    },

    setHints(hints: Partial<RenderHints>) {
      if (hints.readyUnits !== undefined) world.setReady(hints.readyUnits, now());
      requestRender();
    },

    setPatterns(on: boolean) {
      world.setPatterns(on);
      requestRender();
    },

    setSafeArea(area: Partial<SafeArea>) {
      safeArea = { ...safeArea, ...area };
      hudChanged = true;
      requestRender();
    },

    setQuality(q: RenderQuality) {
      quality = q;
      world.uniforms.uAnim.value = animOn() ? 1 : 0;
      world.setQuality(q);
      requestRender();
    },

    getQuality() {
      return quality;
    },

    zoomBy(factor: number) {
      const cw = canvas.clientWidth || 1;
      const ch = canvas.clientHeight || 1;
      tween = null;
      vx = 0;
      vz = 0;
      zoomAt(factor, cw / 2, ch / 2);
      requestRender();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clearLong();
      if (ambientTimer !== null) clearTimeout(ambientTimer);
      ambientTimer = null;
      ro?.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      tapListeners.clear();
      longListeners.clear();
      bandListeners.clear();
      scene.remove(world.root, vignette);
      world.dispose();
      vigGeo.dispose();
      vigMat.dispose();
      gl.dispose();
    },
  };

  // Debug-only (not in the Renderer interface): render synchronously and wait for the GPU, so
  // the demo can measure frames even when rAF is throttled (hidden tabs). Returns ms.
  const pixel = new Uint8Array(4);
  Object.defineProperty(api, 'debugFrame', {
    enumerable: false,
    value: (): { ms: number; drawCalls: number; triangles: number } => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      const t0 = now();
      frame();
      // readPixels blocks until the GPU has finished the frame (finish() may not).
      const ctx = gl.getContext();
      ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixel);
      const ms = now() - t0;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      return { ms, drawCalls, triangles };
    },
  });

  // Debug-only: the scene graph, for the demo's inspection helpers.
  Object.defineProperty(api, 'debugScene', { enumerable: false, value: scene });

  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => api.resize());
    ro.observe(canvas);
  }
  world.onInvalidate = requestRender;
  world.setBand(band);
  api.resize();
  return api;
}

/** Start over the viewer's capital, else any own settlement/unit, else the map center. */
const initialFocus = (state: GameState, viewer: PlayerId | null): Hex => {
  if (viewer !== null) {
    const own = Object.values(state.settlements).filter((s) => s.owner === viewer);
    const cap = own.find((s) => s.isCapital) ?? own[0];
    if (cap) return cap.at;
    const unit = Object.values(state.units).find((u) => u.owner === viewer);
    if (unit) return unit.at;
  }
  const col = Math.floor(state.map.width / 2);
  const row = Math.floor(state.map.height / 2);
  return { q: col - (row - (row & 1)) / 2, r: row };
};
