/**
 * The renderer implementation: WebGL setup, camera, touch/mouse input, render-on-demand loop.
 * Public API and usage notes live in ./index.ts.
 */
import {
  Color,
  DirectionalLight,
  HemisphereLight,
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
import { PALETTE } from './colors';
import { GestureRecognizer, LONG_PRESS_MS, type GestureAction } from './gestures';
import { ELEVATION_STEP, LAND_TOP, MAX_ELEVATION } from './heights';
import { hexToWorld, mapBounds, type MapBounds } from './layout';
import { World, type FlashKind, type Selection } from './scene/world';
import type { Renderer, RendererOptions, RenderSelection } from './index';

const FOV_Y = 40;
const FOCUS_MS = 380;
const INERTIA_DECAY_MS = 260;
const YAW_RATE = 12; // 1/s, exponential approach to the snapped yaw
/** Normalized (see shortAxisFactor) starting distance: ~7 hexes across the short axis. */
const DEFAULT_DISTANCE = 12;

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

  const gl = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  gl.setClearColor(new Color(PALETTE.background));
  canvas.style.touchAction = 'none';
  (canvas.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none';
  canvas.style.userSelect = 'none';

  const scene = new Scene();
  scene.background = new Color(PALETTE.background);
  const hemi = new HemisphereLight(0xfff3df, 0x8f8068, 1.9);
  const sun = new DirectionalLight(0xffe2b8, 2.1);
  sun.position.set(-0.55, 1, 0.45);
  scene.add(hemi, sun);

  const camera = new PerspectiveCamera(FOV_Y, 1, 0.3, 800);
  const world = new World(content, reduceMotion);
  scene.add(world.root);

  // --- Camera state ---------------------------------------------------------------------------
  let bounds: MapBounds = mapBounds(1, 1);
  let tx = 0;
  let tz = 0;
  let distance = DEFAULT_DISTANCE;
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
    const ext = viewHalfExtents(distance, camera.aspect || 1, FOV_Y);
    const c = clampTarget(tx, tz, bounds, 2, ext.w, ext.h);
    tx = c.x;
    tz = c.z;
    const off = cameraOffset(distance, pitchFor(norm), yaw);
    camera.position.set(tx + off.x, off.y, tz + off.z);
    camera.lookAt(tx, 0, tz);
    camera.updateMatrixWorld();
    world.setIconScale(Math.max(1, Math.min(3, norm / 40)), now());
    const nb = nextZoomBand(norm, band);
    if (nb !== band) {
      band = nb;
      world.setBand(band);
      for (const cb of bandListeners) cb(band);
    }
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

    gl.render(scene, camera);
    drawCalls = gl.info.render.calls;
    triangles = gl.info.render.triangles;
    if (lastRenderAt && t - lastRenderAt < 100) {
      const inst = 1000 / Math.max(1, t - lastRenderAt);
      fpsEma = fpsEma ? fpsEma * 0.9 + inst * 0.1 : inst;
    }
    lastRenderAt = t;
    if (again) requestRender();
    else lastFrame = 0;
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
      world.update(state, viewer, visible, t);
      unitsMoving = world.drawUnits(t);
      if (first || sizeChanged) {
        const start = initialFocus(state, viewer);
        const w = hexToWorld(start);
        tx = w.x;
        tz = w.z;
        tween = null;
        distance = DEFAULT_DISTANCE / shortAxisFactor(camera.aspect || 1);
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
      world.setSelection(selection, now());
      requestRender();
    },

    focus(hex, opts) {
      const w = hexToWorld(hex);
      const ext = viewHalfExtents(distance, camera.aspect || 1, FOV_Y);
      const c = clampTarget(w.x, w.z, bounds, 2, ext.w, ext.h);
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
      return { drawCalls, triangles, fps: Math.round(fpsEma) };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clearLong();
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
      scene.remove(world.root);
      world.dispose();
      gl.dispose();
    },
  };

  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => api.resize());
    ro.observe(canvas);
  }
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
