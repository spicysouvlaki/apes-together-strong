/**
 * Territory outline as ONE merged mesh (one draw call): the vertex data comes from the pure
 * builder in borders.ts (mitred strips, outer edges only); this module owns the GPU buffers and
 * the material. The owner's colorblind pattern (GDD §11) cuts the primary strip only while
 * `uPatterns` is on: cut pixels take the ink color instead of vanishing, so the outline stays
 * continuous either way.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from 'three';
import type { BorderMeshData } from '../borders';
import { PATTERN_GLSL } from '../patterns';
import type { PatternUniforms } from './pattern-material';

export class BorderMesh {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly material: MeshBasicMaterial;
  private capacity = 0;
  private pos!: BufferAttribute;
  private col!: BufferAttribute;
  private pat!: BufferAttribute;

  constructor(
    private readonly parent: Object3D,
    patterns: PatternUniforms,
    renderOrder: number,
  ) {
    const m = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uPatterns = patterns.uPatterns;
      shader.vertexShader =
        'attribute vec3 aPat;\nvarying vec3 vPat;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = aPat;');
      shader.fragmentShader =
        `uniform float uPatterns;\nvarying vec3 vPat;\n${PATTERN_GLSL}\n` +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
  if (uPatterns > 0.5 && vPat.z > -0.5 && !patternKeep(vPat.z, vPat.x, clamp(vPat.y, 0.0, 1.0))) {
    diffuseColor.rgb = vec3(0.025, 0.018, 0.012);
  }`,
        );
    };
    m.customProgramCacheKey = () => 'border-mesh-v1';
    this.material = m;
    this.allocate(1024);
    this.mesh = new Mesh(this.geometry, m);
    this.mesh.name = 'borders';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  private allocate(vertices: number): void {
    this.capacity = vertices;
    this.pos = new BufferAttribute(new Float32Array(vertices * 3), 3);
    this.col = new BufferAttribute(new Float32Array(vertices * 4), 4);
    this.pat = new BufferAttribute(new Float32Array(vertices * 3), 3);
    for (const a of [this.pos, this.col, this.pat]) a.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('color', this.col);
    this.geometry.setAttribute('aPat', this.pat);
  }

  /** Upload a freshly built band mesh. */
  set(data: BorderMeshData): void {
    const n = data.vertexCount;
    if (n > this.capacity) {
      let cap = this.capacity;
      while (cap < n) cap *= 2;
      this.geometry.dispose();
      this.allocate(cap);
    }
    (this.pos.array as Float32Array).set(data.pos.subarray(0, n * 3));
    (this.col.array as Float32Array).set(data.col.subarray(0, n * 4));
    (this.pat.array as Float32Array).set(data.pat.subarray(0, n * 3));
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.pat.needsUpdate = true;
    this.geometry.setDrawRange(0, n);
    this.mesh.visible = n > 0;
  }

  touch(): void {
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.pat.needsUpdate = true;
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
