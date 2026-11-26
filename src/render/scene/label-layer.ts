/**
 * Settlement name/population labels in ONE draw call: each distinct label is drawn once into a
 * slot of a shared canvas atlas (cached by `labelKey`, LRU-evicted) and shown by an instanced,
 * screen-space-sized billboard quad whose per-instance UV rect selects the slot.
 *
 * De-overlap: on camera changes `layout()` projects the anchors and runs LabelLayout (pure,
 * label-layout.ts); the result is a per-instance vertical shift (in label heights) and a
 * visibility flag, uploaded as one small attribute. No per-frame allocation.
 *
 * Settler site seals (round gold seals with a rank numeral, LabelSpec.seal) share the atlas
 * and the draw call; they sit on their survey stake, never move and never push names around.
 * A name cartouche that covers a unit is faded (aShift.y = alpha) so the unit stays readable,
 * and `hitTag` maps a tap on a label back to the tile it names.
 */
import {
  CanvasTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Object3D,
} from 'three';
import { LabelLayout } from '../label-layout';
import { LabelSlotCache, labelKey, type LabelSpec } from '../labels';
import { patternKeep, type PatternId } from '../patterns';
import { labelQuadGeometry } from './geometry';

// 1536 x 1024 RGBA = 6 MB; 4 x 16 = 64 slots wide enough for long names + pop badge.
const ATLAS_W = 1536;
const ATLAS_H = 1024;
const SLOT_W = 384;
const SLOT_H = 64;
const COLS = ATLAS_W / SLOT_W;
const ROWS = ATLAS_H / SLOT_H;
export const LABEL_CAPACITY = COLS * ROWS;

/** Label (slot) height as a fraction of camera distance (constant on-screen size). */
const LABEL_SIZE = 0.03;
/**
 * Slot rows: the cartouche sits in the top PILL_H px; below it hangs an inked leader down to
 * the anchor (the settlement's roofline), so the name floats above the buildings instead of
 * on them (GDD §11 readability).
 */
const PILL_TOP = 2;
const PILL_H = 36;
const PILL_FRAC = PILL_H / SLOT_H;
const LEADER_FRAC = (SLOT_H - PILL_TOP - PILL_H) / SLOT_H;
/** Site seal diameter in slot px (rank 1 is drawn larger). */
const SEAL_D = 46;
const SEAL_D_TOP = 58;

const vertexShader = /* glsl */ `
// Shifted labels move by whole cartouche heights (label-layout.ts works in those units).
// aShift: x = vertical shift, y = alpha, z = sideways nudge in quad widths (edge clamping).
attribute vec4 aUv;
attribute float aAspect;
attribute vec3 aShift;
uniform float uSize;
varying vec2 vLocal;
varying vec4 vRect;
varying float vAlpha;
varying float vNudge;
void main() {
  vAlpha = aShift.y;
  vNudge = aShift.z;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = uSize * -mv.z;
  mv.xy += vec2((position.x + aShift.z) * aAspect, position.y + aShift.x * ${PILL_FRAC.toFixed(4)}) * s;
  gl_Position = projectionMatrix * mv;
  // Hidden labels collapse to a degenerate point (no fragments).
  if (aShift.y < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vLocal = uv;
  vRect = aUv;
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vLocal;
varying vec4 vRect;
varying float vAlpha;
varying float vNudge;
void main() {
  vec2 l = vLocal;
  // A nudged cartouche keeps its leader on the settlement: the leader rows sample the slot
  // shifted back by the nudge, so the stem stays put while the banner slides inward.
  if (l.y < ${LEADER_FRAC.toFixed(4)}) {
    l.x += vNudge;
    if (l.x < 0.0 || l.x > 1.0) discard;
  }
  vec4 c = texture2D(uMap, vec2(mix(vRect.x, vRect.z, l.x), mix(vRect.y, vRect.w, l.y)));
  c.a *= vAlpha;
  if (c.a < 0.03) discard;
  gl_FragColor = c;
}`;

export class LabelLayer {
  readonly mesh: InstancedMesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly texture: CanvasTexture;
  private readonly material: ShaderMaterial;
  private readonly geometry: BufferGeometry;
  private readonly cache = new LabelSlotCache(LABEL_CAPACITY);
  private readonly aUv: InstancedBufferAttribute;
  private readonly aAspect: InstancedBufferAttribute;
  private readonly aShift: InstancedBufferAttribute;
  /** Aspect (w/h) of the drawn pill in each slot. */
  private readonly slotAspect = new Float32Array(LABEL_CAPACITY);
  private readonly slotWidth = new Float32Array(LABEL_CAPACITY);
  private readonly anchors = new Float32Array(LABEL_CAPACITY * 3);
  /** Caller tag per label (the tile index it names), for tap resolution. */
  private readonly tags = new Int32Array(LABEL_CAPACITY);
  /** 1 = site seal (no leader, fixed). */
  private readonly seal = new Uint8Array(LABEL_CAPACITY);
  /** Obstacle screen points (units) for fading; grown only when the unit count grows. */
  private obsX = new Float32Array(64);
  private obsY = new Float32Array(64);
  private readonly layoutSolver = new LabelLayout(LABEL_CAPACITY);
  private readonly v = new Vector3();
  private n = 0;
  private dirtyTexture = false;

  constructor(
    private readonly parent: Object3D,
    /** Called after the display font loads and the cache was cleared (caller re-pushes labels). */
    onFontsReady?: () => void,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_W;
    this.canvas.height = ATLAS_H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new CanvasTexture(this.canvas);
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uMap: { value: this.texture }, uSize: { value: LABEL_SIZE } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.geometry = labelQuadGeometry();
    this.aUv = new InstancedBufferAttribute(new Float32Array(LABEL_CAPACITY * 4), 4);
    this.aUv.setUsage(DynamicDrawUsage);
    this.aAspect = new InstancedBufferAttribute(new Float32Array(LABEL_CAPACITY), 1);
    this.aAspect.setUsage(DynamicDrawUsage);
    this.aShift = new InstancedBufferAttribute(new Float32Array(LABEL_CAPACITY * 3), 3);
    this.aShift.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('aUv', this.aUv);
    this.geometry.setAttribute('aAspect', this.aAspect);
    this.geometry.setAttribute('aShift', this.aShift);
    this.mesh = new InstancedMesh(this.geometry, this.material, LABEL_CAPACITY);
    this.mesh.name = 'labels';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
    this.mesh.count = 0;
    this.mesh.matrixAutoUpdate = false;
    parent.add(this.mesh);
    // Labels use the bundled display serif; redraw the atlas once it is available.
    const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
    if (fonts && onFontsReady) {
      const redraw = (): void => {
        this.cache.clear();
        onFontsReady();
      };
      void fonts.ready.then(redraw);
      fonts.addEventListener?.('loadingdone', redraw);
      // Canvas text does not reliably trigger a webfont download, and the face is split by
      // unicode-range (latin / latin-ext): ask for both subsets explicitly (ā, ð, ḥ…) so names
      // like "Dūmat al-Jandal" or "Niðarós" are typeset in Fraunces, then redraw.
      if (typeof fonts.load === 'function') {
        void Promise.all([fonts.load(`600 23px Fraunces`, 'Aa ā ð ḥ ī'), fonts.load(`700 17px Fraunces`, '0123456789')])
          .then((faces) => {
            if (faces.some((f) => f.length > 0)) redraw();
          })
          .catch(() => undefined);
      }
    }
  }

  begin(): void {
    this.n = 0;
    this.cache.beginPass();
  }

  /**
   * Place a label whose bottom-center anchors at world (x, y, z). Higher `priority` wins
   * de-overlap. Extra labels are dropped.
   */
  push(spec: LabelSpec, x: number, y: number, z: number, priority = 0, tag = -1): void {
    if (this.n >= LABEL_CAPACITY) return;
    const got = this.cache.acquire(labelKey(spec));
    if (!got) return;
    if (got.fresh) this.draw(got.slot, spec);
    const i = this.n++;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    m.fill(0, i * 16, i * 16 + 16);
    m[i * 16] = 1;
    m[i * 16 + 5] = 1;
    m[i * 16 + 10] = 1;
    m[i * 16 + 12] = x;
    m[i * 16 + 13] = y;
    m[i * 16 + 14] = z;
    m[i * 16 + 15] = 1;
    this.anchors[i * 3] = x;
    this.anchors[i * 3 + 1] = y;
    this.anchors[i * 3 + 2] = z;
    const col = got.slot % COLS;
    const row = Math.floor(got.slot / COLS);
    const x0 = col * SLOT_W;
    const y0 = row * SLOT_H;
    const w = this.slotWidth[got.slot] ?? SLOT_W;
    const uv = this.aUv.array as Float32Array;
    uv[i * 4] = x0 / ATLAS_W;
    uv[i * 4 + 1] = 1 - (y0 + SLOT_H) / ATLAS_H;
    uv[i * 4 + 2] = (x0 + w) / ATLAS_W;
    uv[i * 4 + 3] = 1 - y0 / ATLAS_H;
    (this.aAspect.array as Float32Array)[i] = this.slotAspect[got.slot] ?? 4;
    this.layoutSolver.priority[i] = priority;
    const isSeal = spec.seal !== undefined;
    this.layoutSolver.solid[i] = isSeal ? 0 : 1;
    this.seal[i] = isSeal ? 1 : 0;
    this.tags[i] = tag;
    const sh = this.aShift.array as Float32Array;
    sh[i * 3] = 0;
    sh[i * 3 + 1] = 1;
    sh[i * 3 + 2] = 0;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aUv.needsUpdate = true;
    this.aAspect.needsUpdate = true;
    this.aShift.needsUpdate = true;
    if (this.dirtyTexture) {
      this.texture.needsUpdate = true;
      this.dirtyTexture = false;
    }
  }

  /**
   * Re-run de-overlap for the current camera. `viewH` = viewport height in px. Cheap (≤ 64
   * labels); call after camera changes.
   */
  layout(
    camera: Camera & { projectionMatrix: { elements: ArrayLike<number> } },
    viewW: number,
    viewH: number,
    /** HUD-free band (px from the top) labels must stay inside. */
    minY = 0,
    maxY = Infinity,
    /** World points (x, y, z triples) that labels should not cover (units); faded if they do. */
    obstacles: Float32Array | null = null,
    obstacleCount = 0,
    /** Screen columns (px) cartouches are nudged inside (left/right safe area). */
    minX = 6,
    maxX = viewW - 6,
  ): void {
    const L = this.layoutSolver;
    const n = this.n;
    L.count = n;
    // Screen height of a label quad (1 label unit): uSize * P[1][1] * viewH / 2.
    const p11 = camera.projectionMatrix.elements[5] ?? 1;
    const hPx = LABEL_SIZE * p11 * viewH * 0.5;
    const asp = this.aAspect.array as Float32Array;
    for (let i = 0; i < n; i++) {
      this.v.set(this.anchors[i * 3] ?? 0, this.anchors[i * 3 + 1] ?? 0, this.anchors[i * 3 + 2] ?? 0).project(camera);
      const sx = (this.v.x * 0.5 + 0.5) * viewW;
      L.x[i] = sx;
      if (this.seal[i]) {
        // Seals: the whole (square) slot, standing on the stake top.
        L.y[i] = (-this.v.y * 0.5 + 0.5) * viewH;
        L.h[i] = hPx;
        L.w[i] = hPx * (asp[i] ?? 1);
      } else {
        // Collision box = the cartouche only (the leader below it may cross other labels' land).
        L.y[i] = (-this.v.y * 0.5 + 0.5) * viewH - hPx * LEADER_FRAC;
        L.h[i] = hPx * PILL_FRAC;
        L.w[i] = hPx * (asp[i] ?? 4);
      }
      // Labels behind the camera or far off screen never block others.
      if (this.v.z > 1 || sx < -viewW || sx > viewW * 2) L.w[i] = 0;
    }
    L.solve(2, minY, maxY, minX, maxX);
    if (obstacles && obstacleCount > 0) {
      if (this.obsX.length < obstacleCount) {
        this.obsX = new Float32Array(obstacleCount * 2);
        this.obsY = new Float32Array(obstacleCount * 2);
      }
      let k = 0;
      for (let j = 0; j < obstacleCount; j++) {
        this.v.set(obstacles[j * 3] ?? 0, obstacles[j * 3 + 1] ?? 0, obstacles[j * 3 + 2] ?? 0).project(camera);
        if (this.v.z > 1) continue;
        this.obsX[k] = (this.v.x * 0.5 + 0.5) * viewW;
        this.obsY[k] = (-this.v.y * 0.5 + 0.5) * viewH;
        k++;
      }
      L.fade(this.obsX, this.obsY, k);
    }
    const sh = this.aShift.array as Float32Array;
    let changed = false;
    for (let i = 0; i < n; i++) {
      const s = L.shift[i] ?? 0;
      const vis = L.alpha[i] ?? 1;
      const w = L.w[i] ?? 0;
      const nudge = w > 0 ? (L.dx[i] ?? 0) / w : 0;
      if (sh[i * 3] !== s || sh[i * 3 + 1] !== vis || sh[i * 3 + 2] !== nudge) changed = true;
      sh[i * 3] = s;
      sh[i * 3 + 1] = vis;
      sh[i * 3 + 2] = nudge;
    }
    if (changed) this.aShift.needsUpdate = true;
  }

  /**
   * Tag (tile index) of the label at screen point (x, y) in CSS px, from the last layout(), or
   * -1. Faded labels are skipped (the tap belongs to the unit they cover).
   */
  hitTag(x: number, y: number): number {
    if (!this.mesh.visible) return -1;
    const i = this.layoutSolver.hit(x, y, 4);
    return i >= 0 ? (this.tags[i] ?? -1) : -1;
  }

  touch(): void {
    this.texture.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aUv.needsUpdate = true;
    this.aAspect.needsUpdate = true;
    this.aShift.needsUpdate = true;
  }

  /** Forget cached slots (e.g. colorblind patterns toggled). */
  clearCache(): void {
    this.cache.clear();
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  private draw(slot: number, spec: LabelSpec): void {
    const ctx = this.ctx;
    const col = slot % COLS;
    const row = Math.floor(slot / COLS);
    const x0 = col * SLOT_W;
    const y0 = row * SLOT_H;
    if (!ctx) {
      this.slotWidth[slot] = SLOT_W;
      this.slotAspect[slot] = SLOT_W / SLOT_H;
      return;
    }
    ctx.clearRect(x0, y0, SLOT_W, SLOT_H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, SLOT_W, SLOT_H);
    ctx.clip();
    if (spec.seal !== undefined) {
      this.drawSeal(ctx, x0, y0, spec.seal);
      ctx.restore();
      this.slotWidth[slot] = SLOT_H;
      this.slotAspect[slot] = 1;
      this.dirtyTexture = true;
      return;
    }
    ctx.globalAlpha = spec.ghost ? 0.7 : 1;
    // Typeset to the UI's display serif (bundled as 'Fraunces'); Georgia until it loads.
    const nameFont = `600 23px Fraunces, "Fraunces Variable", Georgia, serif`;
    const popFont = `700 17px Fraunces, "Fraunces Variable", Georgia, serif`;
    const name = spec.name ?? spec.text;
    const pop = spec.population !== undefined ? String(spec.population) : '';
    const pad = 8;
    const sw = 13; // crest
    const h = PILL_H;
    const top = y0 + PILL_TOP;
    const left = x0 + 3;
    const ink = spec.war ? '#9e2b22' : '#3b2c1e';
    ctx.font = popFont;
    const popW = pop ? Math.max(h - 12, ctx.measureText(pop).width + 11) : 0;
    ctx.font = nameFont;
    const starW = spec.capital ? 15 : 0;
    const fixed = pad + sw + 6 + starW + (pop ? 6 + popW : 0) + pad + (spec.war ? 22 : 0);
    // Long names truncate at ~220 px so a label never dominates the screen.
    const maxText = Math.min(220, SLOT_W - 8 - fixed);
    let t = name;
    while (t.length > 1 && ctx.measureText(t).width > maxText) t = t.slice(0, -2) + '…';
    const tw = Math.min(maxText, ctx.measureText(t).width);
    const w = Math.ceil(fixed + tw);
    const cxm = left + w / 2;
    // Leader: a fine ink stem from the cartouche down to the roofline, ending in a small bead.
    ctx.strokeStyle = 'rgba(59, 44, 30, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cxm, top + h);
    ctx.lineTo(cxm, y0 + SLOT_H - 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cxm, y0 + SLOT_H - 3.5, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = spec.war ? '#9e2b22' : '#3b2c1e';
    ctx.fill();
    // Vellum cartouche: a banner with notched ends, a hairline ink border, owner-color rule.
    const notch = 6;
    const banner = (inset: number): void => {
      ctx.beginPath();
      ctx.moveTo(left + inset, top + inset);
      ctx.lineTo(left + w - inset, top + inset);
      ctx.lineTo(left + w - notch - inset * 0.4, top + h / 2);
      ctx.lineTo(left + w - inset, top + h - inset);
      ctx.lineTo(left + inset, top + h - inset);
      ctx.lineTo(left + notch + inset * 0.4, top + h / 2);
      ctx.closePath();
    };
    banner(0);
    const grad = ctx.createLinearGradient(0, top, 0, top + h);
    grad.addColorStop(0, spec.ghost ? 'rgba(236, 228, 210, 0.9)' : 'rgba(250, 244, 226, 0.94)');
    grad.addColorStop(1, spec.ghost ? 'rgba(222, 211, 190, 0.9)' : 'rgba(236, 223, 194, 0.94)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = ink;
    if (spec.ghost) ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Owner-color rule along the bottom of the cartouche (reads as the realm's ribbon).
    ctx.fillStyle = spec.war ? 'rgba(196, 55, 44, 0.85)' : spec.color;
    ctx.fillRect(left + notch + 2, top + h - 5, w - notch * 2 - 4, 2.5);
    // Crest: owner color + pattern; city-states get a diamond.
    const sx = left + pad + notch * 0.5 + sw / 2;
    const sy = top + h / 2 - 1;
    ctx.beginPath();
    if (spec.cityState) {
      ctx.moveTo(sx, sy - sw / 2 - 2);
      ctx.lineTo(sx + sw / 2 + 1, sy);
      ctx.lineTo(sx, sy + sw / 2 + 2);
      ctx.lineTo(sx - sw / 2 - 1, sy);
      ctx.closePath();
    } else {
      // Heater shield.
      const hw = sw / 2;
      ctx.moveTo(sx - hw, sy - hw);
      ctx.lineTo(sx + hw, sy - hw);
      ctx.lineTo(sx + hw, sy + 1);
      ctx.quadraticCurveTo(sx + hw, sy + hw, sx, sy + hw + 2);
      ctx.quadraticCurveTo(sx - hw, sy + hw, sx - hw, sy + 1);
      ctx.closePath();
    }
    ctx.fillStyle = spec.color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#3a2c1f';
    ctx.stroke();
    if (spec.pattern) {
      ctx.save();
      ctx.clip();
      this.drawPattern(ctx, spec.pattern as PatternId, sx - sw / 2 - 2, sy - sw / 2 - 2, sw + 4);
      ctx.restore();
    }
    let cx = left + pad + notch * 0.5 + sw + 6;
    if (spec.capital) {
      // Capital: a small gold-leaf star before the name.
      this.star(ctx, cx + 6, sy, 6.5, 2.8);
      cx += starW;
    }
    // Name.
    ctx.fillStyle = '#2a1f15';
    ctx.textBaseline = 'middle';
    ctx.font = nameFont;
    ctx.fillText(t, cx, sy + 1);
    cx += tw + 6;
    if (pop) {
      // Population seal: ink roundel with paper digits (legible at any size).
      const bh = h - 13;
      const bx = cx;
      const by = sy - bh / 2;
      ctx.beginPath();
      ctx.roundRect(bx, by, popW, bh, bh / 2);
      ctx.fillStyle = ink;
      ctx.fill();
      ctx.fillStyle = '#fbf3df';
      ctx.font = popFont;
      ctx.textAlign = 'center';
      ctx.fillText(pop, bx + popW / 2, sy + 1);
      ctx.textAlign = 'left';
      cx += popW + 6;
    }
    if (spec.wall !== undefined && spec.wall < 1) {
      // Wall HP (GDD §7): a bar under the cartouche, green -> red.
      const bw = w - notch * 2 - 6;
      const bx = left + notch + 3;
      const by = top + h - 6;
      ctx.fillStyle = '#3b3b3b';
      ctx.fillRect(bx, by, bw, 5);
      ctx.fillStyle = spec.wall > 0.6 ? '#5cbf4a' : spec.wall > 0.3 ? '#e3c13b' : '#d9493b';
      ctx.fillRect(bx + 1, by + 1, Math.max(2, (bw - 2) * spec.wall), 3);
    }
    if (spec.war) {
      // Crossed swords, drawn as two strokes.
      ctx.strokeStyle = '#b8322a';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, sy - 8);
      ctx.lineTo(cx + 14, sy + 7);
      ctx.moveTo(cx + 14, sy - 8);
      ctx.lineTo(cx, sy + 7);
      // Crossguards near the hilts make it read as swords, not a close button.
      ctx.moveTo(cx + 8, sy + 7);
      ctx.lineTo(cx + 13, sy + 2);
      ctx.moveTo(cx + 6, sy + 7);
      ctx.lineTo(cx + 1, sy + 2);
      ctx.stroke();
    }
    ctx.restore();
    const used = w + 8;
    this.slotWidth[slot] = used;
    this.slotAspect[slot] = used / SLOT_H;
    this.dirtyTexture = true;
  }

  /**
   * Settler site seal: a gold wax-and-leaf seal with an ink rim and the rank numeral, standing
   * on its bottom edge (the stake top). Dark rim + light halo keep it legible on any terrain.
   */
  private drawSeal(ctx: CanvasRenderingContext2D, x0: number, y0: number, rank: number): void {
    const d = rank === 1 ? SEAL_D_TOP : SEAL_D;
    const r = d / 2;
    const cx = x0 + SLOT_H / 2;
    const cy = y0 + SLOT_H - r - 2;
    // Soft paper halo (separates the seal from busy terrain).
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 248, 228, 0.85)';
    ctx.fill();
    // Scalloped wax edge.
    ctx.beginPath();
    const lobes = 14;
    for (let k = 0; k <= lobes * 2; k++) {
      const a = (k / (lobes * 2)) * Math.PI * 2;
      const rr = k % 2 === 0 ? r - 0.5 : r - 3;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#fbe39a');
    g.addColorStop(0.55, '#e2b448');
    g.addColorStop(1, '#a9781f');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#3b2c1e';
    ctx.stroke();
    // Inner ring.
    ctx.beginPath();
    ctx.arc(cx, cy, r - 7, 0, Math.PI * 2);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(92, 62, 18, 0.75)';
    ctx.stroke();
    // Numeral.
    ctx.fillStyle = '#2a1f15';
    ctx.font = `700 ${rank === 1 ? 30 : 25}px Fraunces, "Fraunces Variable", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(rank), cx, cy + 1.5);
    ctx.textAlign = 'left';
  }

  private star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ri: number): void {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 === 0 ? r : ri;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = '#c9a03a';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#6b4f1c';
    ctx.stroke();
  }

  /** Paint the pattern's "cut" pixels in white over the swatch (same rule as the borders). */
  private drawPattern(ctx: CanvasRenderingContext2D, p: PatternId, x: number, y: number, size: number): void {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    const cells = 9;
    const c = size / cells;
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < cells; j++) {
        const t = ((i + 0.5) / cells) * 0.9;
        const u = (j + 0.5) / cells;
        if (!patternKeep(p, t, u)) ctx.fillRect(x + i * c, y + j * c, c + 0.3, c + 0.3);
      }
    }
  }
}
