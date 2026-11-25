/**
 * Thin wrapper over an InstancedMesh that is refilled each update: `begin`, `push`..., `end`.
 * Writes matrices and colors straight into the typed arrays (no Matrix4/Color allocation), grows
 * by doubling when needed (rare: only when the map or entity counts jump), and hides itself when
 * empty so an empty layer costs no draw call.
 */
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { Rgb } from '../colors';

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export class Instances {
  mesh: InstancedMesh;
  private n = 0;
  private capacity: number;
  private aux: InstancedBufferAttribute | null = null;

  constructor(
    readonly geometry: BufferGeometry,
    readonly material: Material,
    capacity: number,
    private readonly parent: Object3D,
    readonly name: string,
    readonly renderOrder = 0,
    /** Optional per-instance float attribute name (e.g. 'aPattern') for custom shaders. */
    private readonly auxName: string | null = null,
  ) {
    this.capacity = Math.max(1, capacity);
    this.mesh = this.makeMesh(this.capacity);
    parent.add(this.mesh);
  }

  get count(): number {
    return this.n;
  }

  begin(): void {
    this.n = 0;
  }

  /** Add an instance: translate (x,y,z), rotate about Y, scale (sx,sy,sz), sRGB color. */
  push(x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY: number, color: Rgb, aux = 0): void {
    if (this.n >= this.capacity) this.grow(this.capacity * 2);
    const i = this.n++;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const o = i * 16;
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    m[o] = c * sx;
    m[o + 1] = 0;
    m[o + 2] = -s * sx;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = sy;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = s * sz;
    m[o + 9] = 0;
    m[o + 10] = c * sz;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    m[o + 15] = 1;
    const col = this.mesh.instanceColor;
    if (col) {
      const a = col.array as Float32Array;
      a[i * 3] = toLinear(color[0]);
      a[i * 3 + 1] = toLinear(color[1]);
      a[i * 3 + 2] = toLinear(color[2]);
    }
    if (this.aux) (this.aux.array as Float32Array)[i] = aux;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.aux) this.aux.needsUpdate = true;
  }

  /** Force re-upload (after a WebGL context restore). */
  touch(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.aux) this.aux.needsUpdate = true;
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }

  private makeMesh(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, capacity);
    mesh.name = this.name;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(DynamicDrawUsage);
    // Instances span the whole map and change every update; a stale bounding sphere would cull them.
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    mesh.renderOrder = this.renderOrder;
    mesh.matrixAutoUpdate = false;
    if (this.auxName) {
      // The attribute lives on the shared geometry; one layer owns its geometry, so that's safe.
      const prev = this.aux;
      const aux = new InstancedBufferAttribute(new Float32Array(capacity), 1);
      aux.setUsage(DynamicDrawUsage);
      if (prev) aux.array.set((prev.array as Float32Array).subarray(0, Math.min(prev.count, capacity)));
      this.geometry.setAttribute(this.auxName, aux);
      this.aux = aux;
    }
    return mesh;
  }

  private grow(capacity: number): void {
    const old = this.mesh;
    const next = this.makeMesh(capacity);
    (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    if (old.instanceColor && next.instanceColor) {
      (next.instanceColor.array as Float32Array).set(old.instanceColor.array as Float32Array);
    }
    next.visible = old.visible;
    this.parent.remove(old);
    old.dispose();
    this.parent.add(next);
    this.mesh = next;
    this.capacity = capacity;
  }
}
