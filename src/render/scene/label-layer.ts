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
 * A unit standing on or in front of a settlement lifts its cartouche (aShift.w, label heights):
 * the quad has a stretchable leader band, so the banner rises clear of the figurine while the
 * leader's bead stays on the roofline (playtest 3). A name cartouche that still covers a unit
 * (one behind it) is faded (aShift.y = alpha) so the unit stays readable, and `hitTag` maps a
 * tap on a label back to the tile it names.
 */
import {
  BufferGeometry,
  CanvasTexture,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  ShaderMaterial,
  Vector3,
  type Camera,
  type Object3D,
} from 'three';
import { LabelLayout } from '../label-layout';
import { LabelSlotCache, isFixedLabel, labelKey, type LabelSpec } from '../labels';
import { patternKeep, type PatternId } from '../patterns';

// 1536 x 1024 RGBA = 6 MB; 4 x 16 = 64 slots wide enough for long names + pop badge.
const ATLAS_W = 1536;
const ATLAS_H = 1024;
const SLOT_W = 384;
const SLOT_H = 64;
const COLS = ATLAS_W / SLOT_W;
const ROWS = ATLAS_H / SLOT_H;
export const LABEL_CAPACITY = COLS * ROWS;
/** Floats per unit obstacle passed to layout(): x, base y, z, top y, tag. */
export const OBSTACLE_STRIDE = 5;

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
/** Bottom rows holding the leader's bead (never stretched by a lift). */
const BEAD_FRAC = 7 / SLOT_H;

/**
 * Unit quad (x -0.5..0.5, y 0..1, uv = position) with two extra vertex rows: the bead band
 * [0, BEAD_FRAC] and the leader band [BEAD_FRAC, LEADER_FRAC], which stretches when the
 * cartouche is lifted over a unit (only the line in it stretches; the bead and banner don't).
 */
const labelQuadGeometry = (): BufferGeometry => {
  const rows = [0, BEAD_FRAC, LEADER_FRAC, 1];
  const pos: number[] = [];
  const uv: number[] = [];
  for (const y of rows) {
    for (const x of [-0.5, 0.5]) {
      pos.push(x, y, 0);
      uv.push(x + 0.5, y);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows.length - 1; r++) {
    const a = r * 2;
    index.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
};
/** Site seal diameter in slot px (rank 1 is drawn larger). */
const SEAL_D = 46;
const SEAL_D_TOP = 58;

const vertexShader = /* glsl */ `
// Shifted labels move by whole cartouche heights (label-layout.ts works in those units).
// aShift: x = vertical shift, y = alpha, z = sideways nudge in quad widths (edge clamping),
// w = lift over a unit (the banner and leader top rise; the bead stays, the leader stretches).
attribute vec4 aUv;
attribute float aAspect;
attribute vec4 aShift;
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
  float up = aShift.x + (position.y > ${(BEAD_FRAC + 0.001).toFixed(4)} ? aShift.w : 0.0);
  mv.xy += vec2((position.x + aShift.z) * aAspect, position.y + up * ${PILL_FRAC.toFixed(4)}) * s;
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
  /** Per unit (lift): screen x, top y, half width, tag. */
  private unitX = new Float32Array(32);
  private unitTop = new Float32Array(32);
  private unitHw = new Float32Array(32);
  private unitTag = new Int32Array(32);
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
    this.aShift = new InstancedBufferAttribute(new Float32Array(LABEL_CAPACITY * 4), 4);
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
  push(spec: LabelSpec, x: number, y: number, z: number, priority = 0, tag = -1): number {
    if (this.n >= LABEL_CAPACITY) return -1;
    const got = this.cache.acquire(labelKey(spec));
    if (!got) return -1;
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
    this.layoutSolver.tag[i] = tag;
    const isSeal = isFixedLabel(spec);
    this.layoutSolver.solid[i] = isSeal ? 0 : 1;
    this.seal[i] = isSeal ? 1 : 0;
    this.tags[i] = tag;
    const sh = this.aShift.array as Float32Array;
    sh[i * 4] = 0;
    sh[i * 4 + 1] = 1;
    sh[i * 4 + 2] = 0;
    sh[i * 4 + 3] = 0;
    return i;
  }

  /**
   * Animate a fixed label (damage number): rise (label heights, up) and opacity. Overrides the
   * layout's values until the next layout() (the caller re-applies after layouts).
   */
  setFixed(i: number, rise: number, alpha: number): void {
    if (i < 0 || i >= this.n) return;
    const sh = this.aShift.array as Float32Array;
    sh[i * 4] = rise;
    sh[i * 4 + 1] = alpha;
    this.aShift.needsUpdate = true;
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
    /**
     * Units labels should not cover, OBSTACLE_STRIDE floats each: x, base y, z, top y, tag (the
     * tile of the settlement the unit stands on or in front of, else -1). A unit tagged with a
     * label's tile lifts that label; any other unit the label covers fades it.
     */
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
    // Units: project base and top once; they lift their own settlement's label and fade others.
    let k = 0;
    let u = 0;
    if (obstacles && obstacleCount > 0) {
      if (this.obsX.length < obstacleCount * 2) {
        this.obsX = new Float32Array(obstacleCount * 4);
        this.obsY = new Float32Array(obstacleCount * 4);
      }
      if (this.unitX.length < obstacleCount) {
        this.unitX = new Float32Array(obstacleCount * 2);
        this.unitTop = new Float32Array(obstacleCount * 2);
        this.unitHw = new Float32Array(obstacleCount * 2);
        this.unitTag = new Int32Array(obstacleCount * 2);
      }
      for (let j = 0; j < obstacleCount; j++) {
        const o = j * OBSTACLE_STRIDE;
        const wx = obstacles[o] ?? 0;
        const wz = obstacles[o + 2] ?? 0;
        this.v.set(wx, obstacles[o + 1] ?? 0, wz).project(camera);
        if (this.v.z > 1) continue;
        const bx = (this.v.x * 0.5 + 0.5) * viewW;
        const by = (-this.v.y * 0.5 + 0.5) * viewH;
        this.v.set(wx, obstacles[o + 3] ?? 0, wz).project(camera);
        const tx = (this.v.x * 0.5 + 0.5) * viewW;
        const ty = (-this.v.y * 0.5 + 0.5) * viewH;
        // Fade test points: the figure's top and its middle.
        this.obsX[k] = tx;
        this.obsY[k] = ty;
        k++;
        this.obsX[k] = (bx + tx) / 2;
        this.obsY[k] = (by + ty) / 2;
        k++;
        this.unitX[u] = tx;
        this.unitTop[u] = ty;
        this.unitHw[u] = Math.max(4, (by - ty) * 0.32);
        this.unitTag[u] = obstacles[o + 4] ?? -1;
        u++;
      }
    }
    L.liftOver(this.unitX, this.unitTop, this.unitHw, this.unitTag, u);
    L.solve(2, minY, maxY, minX, maxX, this.obsX, this.obsY, k);
    if (k > 0) L.fade(this.obsX, this.obsY, k);
    const sh = this.aShift.array as Float32Array;
    let changed = false;
    for (let i = 0; i < n; i++) {
      const s = L.shift[i] ?? 0;
      const vis = L.alpha[i] ?? 1;
      const w = L.w[i] ?? 0;
      const nudge = w > 0 ? (L.dx[i] ?? 0) / w : 0;
      const lift = L.lift[i] ?? 0;
      if (sh[i * 4] !== s || sh[i * 4 + 1] !== vis || sh[i * 4 + 2] !== nudge || sh[i * 4 + 3] !== lift) changed = true;
      sh[i * 4] = s;
      sh[i * 4 + 1] = vis;
      sh[i * 4 + 2] = nudge;
      sh[i * 4 + 3] = lift;
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
    if (spec.damage !== undefined) {
      // Floating combat number: inked red numerals with a paper halo (reads on any terrain).
      const text = `\u2212${spec.damage}`;
      ctx.font = `800 40px Fraunces, "Fraunces Variable", Georgia, serif`;
      const tw = Math.min(SLOT_W - 20, ctx.measureText(text).width);
      const used = Math.ceil(tw + 20);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round';
      const cx = x0 + used / 2;
      const by = y0 + SLOT_H - 12;
      ctx.lineWidth = 9;
      ctx.strokeStyle = 'rgba(255, 246, 226, 0.92)';
      ctx.strokeText(text, cx, by);
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = '#2a140c';
      ctx.strokeText(text, cx, by);
      ctx.fillStyle = '#e0392a';
      ctx.fillText(text, cx, by);
      ctx.textAlign = 'left';
      ctx.restore();
      this.slotWidth[slot] = used;
      this.slotAspect[slot] = used / SLOT_H;
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
    const walled = spec.wall !== undefined && spec.wall < 1;
    const gaugeW = walled ? 36 : 0;
    const fixed = pad + sw + 6 + starW + (pop ? 6 + popW : 0) + pad + (spec.war ? 22 : 0) + gaugeW;
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
    // Owner-color rule along the bottom of the cartouche (reads as the realm's ribbon); a
    // city-state's is grey and gold in alternating dashes (neutral at a glance).
    ctx.fillStyle = spec.war ? 'rgba(196, 55, 44, 0.85)' : spec.color;
    ctx.fillRect(left + notch + 2, top + h - 5, w - notch * 2 - 4, 2.5);
    if (spec.cityState && !spec.war) {
      ctx.fillStyle = '#c9a23e';
      for (let gx = left + notch + 2; gx < left + w - notch - 2; gx += 12) ctx.fillRect(gx, top + h - 5, Math.min(6, left + w - notch - 2 - gx), 2.5);
    }
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
    // City-states read neutral: a gold-leaf rim on their grey diamond (playtest 3).
    ctx.lineWidth = spec.cityState ? 2.4 : 1.5;
    ctx.strokeStyle = spec.cityState ? '#b8902e' : '#3a2c1f';
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
    if (walled && spec.wall !== undefined) {
      // Wall HP (GDD §7; playtest 3: a besieged city must look besieged): a round gauge — dark
      // track, an arc of the walls left (green -> amber -> red) and a little tower in the middle.
      const gx = cx + 15;
      const gr = 14.5;
      const col = spec.wall > 0.6 ? '#3fa834' : spec.wall > 0.3 ? '#e0a82f' : '#d8301f';
      // Ink disc, pale track ring, the remaining wall as a thick colored arc, a tower in the middle.
      ctx.beginPath();
      ctx.arc(gx, sy, gr, 0, Math.PI * 2);
      ctx.fillStyle = '#3b2c1e';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#d9ccb0';
      ctx.beginPath();
      ctx.arc(gx, sy, gr - 3.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = 5.5;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.arc(gx, sy, gr - 3.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.05, spec.wall));
      ctx.stroke();
      // Tower glyph (crenellated), cracked once half the wall is gone.
      ctx.fillStyle = '#fbf3df';
      ctx.fillRect(gx - 3.5, sy - 2.5, 7, 7.5);
      for (const mx of [-3.5, -0.75, 2]) ctx.fillRect(gx + mx, sy - 5, 1.5, 2.5);
      if (spec.wall <= 0.5) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(gx + 0.8, sy - 2.5);
        ctx.lineTo(gx - 1.2, sy + 0.5);
        ctx.lineTo(gx + 1, sy + 2.2);
        ctx.lineTo(gx - 0.6, sy + 5);
        ctx.stroke();
      }
      cx += gaugeW;
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
