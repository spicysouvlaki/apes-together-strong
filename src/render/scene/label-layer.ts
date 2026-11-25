/**
 * Settlement name/population labels in ONE draw call: each distinct label is drawn once into a
 * slot of a shared canvas atlas (cached by `labelKey`, LRU-evicted) and shown by an instanced,
 * screen-space-sized billboard quad whose per-instance UV rect selects the slot.
 *
 * De-overlap: on camera changes `layout()` projects the anchors and runs LabelLayout (pure,
 * label-layout.ts); the result is a per-instance vertical shift (in label heights) and a
 * visibility flag, uploaded as one small attribute. No per-frame allocation.
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

/** Label height as a fraction of camera distance (constant on-screen size). */
const LABEL_SIZE = 0.028;

const vertexShader = /* glsl */ `
attribute vec4 aUv;
attribute float aAspect;
attribute vec2 aShift;
uniform float uSize;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = uSize * -mv.z;
  mv.xy += vec2(position.x * aAspect, position.y + aShift.x) * s;
  gl_Position = projectionMatrix * mv;
  // Hidden labels collapse to a degenerate point (no fragments).
  if (aShift.y < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vUv = vec2(mix(aUv.x, aUv.z, uv.x), mix(aUv.y, aUv.w, uv.y));
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
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
  private readonly layoutSolver = new LabelLayout(LABEL_CAPACITY);
  private readonly v = new Vector3();
  private n = 0;
  private dirtyTexture = false;

  constructor(private readonly parent: Object3D) {
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
    this.aShift = new InstancedBufferAttribute(new Float32Array(LABEL_CAPACITY * 2), 2);
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
  }

  begin(): void {
    this.n = 0;
    this.cache.beginPass();
  }

  /**
   * Place a label whose bottom-center anchors at world (x, y, z). Higher `priority` wins
   * de-overlap. Extra labels are dropped.
   */
  push(spec: LabelSpec, x: number, y: number, z: number, priority = 0): void {
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
    const sh = this.aShift.array as Float32Array;
    sh[i * 2] = 0;
    sh[i * 2 + 1] = 1;
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
  layout(camera: Camera & { projectionMatrix: { elements: ArrayLike<number> } }, viewW: number, viewH: number): void {
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
      L.y[i] = (-this.v.y * 0.5 + 0.5) * viewH;
      // The drawn pill fills ~80% of the slot height.
      L.h[i] = hPx * 0.84;
      L.w[i] = hPx * (asp[i] ?? 4);
      // Labels behind the camera or far off screen never block others.
      if (this.v.z > 1 || sx < -viewW || sx > viewW * 2) L.w[i] = 0;
    }
    L.solve(2);
    const sh = this.aShift.array as Float32Array;
    let changed = false;
    for (let i = 0; i < n; i++) {
      const s = L.shift[i] ?? 0;
      const vis = L.visible[i] ?? 1;
      if (sh[i * 2] !== s || sh[i * 2 + 1] !== vis) changed = true;
      sh[i * 2] = s;
      sh[i * 2 + 1] = vis;
    }
    if (changed) this.aShift.needsUpdate = true;
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
    ctx.globalAlpha = spec.ghost ? 0.72 : 1;
    const nameFont = '700 28px -apple-system, system-ui, sans-serif';
    const popFont = '800 24px -apple-system, system-ui, sans-serif';
    const name = (spec.capital ? '★ ' : '') + (spec.name ?? spec.text);
    const pop = spec.population !== undefined ? String(spec.population) : '';
    const pad = 10;
    const sw = 18; // swatch
    const h = SLOT_H - 10;
    const top = y0 + 5;
    const left = x0 + 3;
    ctx.font = popFont;
    const popW = pop ? Math.max(h - 12, ctx.measureText(pop).width + 14) : 0;
    ctx.font = nameFont;
    const fixed = pad + sw + 8 + (pop ? 8 + popW : 0) + pad + (spec.war ? 26 : 0);
    // Long names truncate at ~220 px so a label never dominates the screen.
    const maxText = Math.min(220, SLOT_W - 8 - fixed);
    let t = name;
    while (t.length > 1 && ctx.measureText(t).width > maxText) t = t.slice(0, -2) + '…';
    const tw = Math.min(maxText, ctx.measureText(t).width);
    const w = Math.ceil(fixed + tw);
    const rad = h / 2;
    const pill = (): void => {
      ctx.beginPath();
      ctx.moveTo(left + rad, top);
      ctx.arcTo(left + w, top, left + w, top + h, rad);
      ctx.arcTo(left + w, top + h, left, top + h, rad);
      ctx.arcTo(left, top + h, left, top, rad);
      ctx.arcTo(left, top, left + w, top, rad);
      ctx.closePath();
    };
    pill();
    // Opaque light pill: readable over any terrain; ghost labels are greyer.
    ctx.fillStyle = spec.ghost ? 'rgba(226, 221, 210, 0.95)' : 'rgba(252, 248, 238, 0.97)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = spec.war ? '#d23a2f' : spec.color;
    if (spec.ghost) ctx.setLineDash([7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Swatch: owner color + pattern; city-states get a diamond.
    const sx = left + pad + sw / 2;
    const sy = top + h / 2;
    ctx.beginPath();
    if (spec.cityState) {
      ctx.moveTo(sx, sy - sw / 2 - 2);
      ctx.lineTo(sx + sw / 2 + 2, sy);
      ctx.lineTo(sx, sy + sw / 2 + 2);
      ctx.lineTo(sx - sw / 2 - 2, sy);
      ctx.closePath();
    } else {
      ctx.arc(sx, sy, sw / 2, 0, Math.PI * 2);
    }
    ctx.fillStyle = spec.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2f2a24';
    ctx.stroke();
    if (spec.pattern) {
      ctx.save();
      ctx.clip();
      this.drawPattern(ctx, spec.pattern as PatternId, sx - sw / 2 - 2, sy - sw / 2 - 2, sw + 4);
      ctx.restore();
    }
    // Name.
    ctx.fillStyle = '#231f1a';
    ctx.textBaseline = 'middle';
    ctx.font = nameFont;
    let cx = left + pad + sw + 8;
    ctx.fillText(t, cx, sy + 1);
    cx += tw + 8;
    if (pop) {
      // Population badge: dark rounded rect with white digits (legible at any size).
      const bh = h - 12;
      const bx = cx;
      const by = sy - bh / 2;
      ctx.beginPath();
      ctx.roundRect(bx, by, popW, bh, bh / 2);
      ctx.fillStyle = '#2f2a24';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = popFont;
      ctx.textAlign = 'center';
      ctx.fillText(pop, bx + popW / 2, sy + 1);
      ctx.textAlign = 'left';
      cx += popW + 8;
    }
    if (spec.wall !== undefined && spec.wall < 1) {
      // Wall HP (GDD §7): a bar along the bottom of the pill, green -> red.
      const bw = w - rad * 1.2;
      const bx = left + rad * 0.6;
      const by = top + h - 9;
      ctx.fillStyle = '#3b3b3b';
      ctx.fillRect(bx, by, bw, 7);
      ctx.fillStyle = spec.wall > 0.6 ? '#5cbf4a' : spec.wall > 0.3 ? '#e3c13b' : '#d9493b';
      ctx.fillRect(bx + 1, by + 1, Math.max(2, (bw - 2) * spec.wall), 5);
    }
    if (spec.war) {
      // Crossed swords, drawn as two strokes.
      ctx.strokeStyle = '#d23a2f';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, sy - 10);
      ctx.lineTo(cx + 18, sy + 9);
      ctx.moveTo(cx + 18, sy - 10);
      ctx.lineTo(cx, sy + 9);
      // Crossguards near the hilts make it read as swords, not a close button.
      ctx.moveTo(cx + 10, sy + 9);
      ctx.lineTo(cx + 17, sy + 2);
      ctx.moveTo(cx + 8, sy + 9);
      ctx.lineTo(cx + 1, sy + 2);
      ctx.stroke();
    }
    ctx.restore();
    const used = w + 8;
    this.slotWidth[slot] = used;
    this.slotAspect[slot] = used / SLOT_H;
    this.dirtyTexture = true;
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
