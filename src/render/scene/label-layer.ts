/**
 * Settlement name/population labels in ONE draw call: each distinct label is drawn once into a
 * slot of a shared canvas atlas (cached by `labelKey`, LRU-evicted) and shown by an instanced,
 * screen-space-sized billboard quad whose per-instance UV rect selects the slot.
 */
import {
  CanvasTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  ShaderMaterial,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { LabelSlotCache, labelKey, type LabelSpec } from '../labels';
import { labelQuadGeometry } from './geometry';

const ATLAS = 1024;
const SLOT_W = 256;
const SLOT_H = 64;
const COLS = ATLAS / SLOT_W;
const ROWS = ATLAS / SLOT_H;
export const LABEL_CAPACITY = COLS * ROWS;

/** Label height as a fraction of camera distance (constant on-screen size). */
const LABEL_SIZE = 0.028;

const vertexShader = /* glsl */ `
attribute vec4 aUv;
attribute float aAspect;
uniform float uSize;
varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = uSize * -mv.z;
  mv.xy += vec2(position.x * aAspect, position.y) * s;
  gl_Position = projectionMatrix * mv;
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
  /** Aspect (w/h) of the drawn pill in each slot. */
  private readonly slotAspect = new Float32Array(LABEL_CAPACITY);
  private readonly slotWidth = new Float32Array(LABEL_CAPACITY);
  private n = 0;
  private dirtyTexture = false;

  constructor(private readonly parent: Object3D) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS;
    this.canvas.height = ATLAS;
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
    this.geometry.setAttribute('aUv', this.aUv);
    this.geometry.setAttribute('aAspect', this.aAspect);
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

  /** Place a label whose bottom-center anchors at world (x, y, z). Extra labels are dropped. */
  push(spec: LabelSpec, x: number, y: number, z: number): void {
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
    const col = got.slot % COLS;
    const row = Math.floor(got.slot / COLS);
    const x0 = col * SLOT_W;
    const y0 = row * SLOT_H;
    const w = this.slotWidth[got.slot] ?? SLOT_W;
    const uv = this.aUv.array as Float32Array;
    uv[i * 4] = x0 / ATLAS;
    uv[i * 4 + 1] = 1 - (y0 + SLOT_H) / ATLAS;
    uv[i * 4 + 2] = (x0 + w) / ATLAS;
    uv[i * 4 + 3] = 1 - y0 / ATLAS;
    (this.aAspect.array as Float32Array)[i] = this.slotAspect[got.slot] ?? 4;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aUv.needsUpdate = true;
    this.aAspect.needsUpdate = true;
    if (this.dirtyTexture) {
      this.texture.needsUpdate = true;
      this.dirtyTexture = false;
    }
  }

  touch(): void {
    this.texture.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aUv.needsUpdate = true;
    this.aAspect.needsUpdate = true;
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
    ctx.font = '600 30px -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const text = spec.capital ? `★ ${spec.text}` : spec.text;
    const pad = 12;
    const sw = 12;
    const maxText = SLOT_W - pad * 2 - sw - 8 - 4;
    let t = text;
    while (t.length > 1 && ctx.measureText(t).width > maxText) t = t.slice(0, -2) + '…';
    const tw = Math.min(maxText, ctx.measureText(t).width);
    const w = Math.ceil(pad * 2 + sw + 8 + tw) + 4;
    const h = SLOT_H - 8;
    const top = y0 + 4;
    const left = x0 + 2;
    const rad = h / 2;
    ctx.beginPath();
    ctx.moveTo(left + rad, top);
    ctx.arcTo(left + w - 4, top, left + w - 4, top + h, rad);
    ctx.arcTo(left + w - 4, top + h, left, top + h, rad);
    ctx.arcTo(left, top + h, left, top, rad);
    ctx.arcTo(left, top, left + w - 4, top, rad);
    ctx.closePath();
    ctx.fillStyle = 'rgba(250, 245, 233, 0.92)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = spec.color;
    ctx.stroke();
    ctx.fillStyle = spec.color;
    ctx.beginPath();
    ctx.arc(left + pad + sw / 2, top + h / 2, sw / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f2a24';
    ctx.fillText(t, left + pad + sw + 8, top + h / 2 + 1);
    this.slotWidth[slot] = w;
    this.slotAspect[slot] = w / SLOT_H;
    this.dirtyTexture = true;
  }
}
