/**
 * Materials that cut an owner pattern (patterns.ts) into border bands and banner flags, driven
 * by a per-instance `aPattern` float. One shared `uPatterns` uniform turns patterns on/off at
 * runtime without recompiling (GDD §11 colorblind option).
 */
import { MeshBasicMaterial, MeshLambertMaterial, type IUniform } from 'three';
import { PATTERN_GLSL } from '../patterns';

export interface PatternUniforms {
  uPatterns: IUniform<number>;
}

export const createPatternUniforms = (on: boolean): PatternUniforms => ({ uPatterns: { value: on ? 1 : 0 } });

const VERT_DECL = 'attribute float aPattern;\nvarying float vPattern;\nvarying vec3 vLocal;\n';
const VERT_BODY = '#include <begin_vertex>\nvLocal = position;\nvPattern = aPattern;';
const FRAG_DECL = `uniform float uPatterns;\nvarying float vPattern;\nvarying vec3 vLocal;\n${PATTERN_GLSL}\n`;

/**
 * Border band: geometry spans x in [innerX, outerX] (edge faces +x) and z along the edge.
 * Pattern-cut pixels are discarded so the dark keyline layer underneath shows through.
 */
export const borderPatternMaterial = (
  uniforms: PatternUniforms,
  outerX: number,
  innerX: number,
  params: ConstructorParameters<typeof MeshBasicMaterial>[0] = {},
): MeshBasicMaterial => {
  const m = new MeshBasicMaterial(params);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPatterns = uniforms.uPatterns;
    shader.vertexShader = VERT_DECL + shader.vertexShader.replace('#include <begin_vertex>', VERT_BODY);
    shader.fragmentShader =
      FRAG_DECL +
      shader.fragmentShader.replace(
        'void main() {',
        `void main() {
  if (uPatterns > 0.5) {
    float u = (${outerX.toFixed(4)} - vLocal.x) / ${(outerX - innerX).toFixed(4)};
    if (!patternKeep(vPattern, vLocal.z + 0.5, clamp(u, 0.0, 1.0))) discard;
  }`,
      );
  };
  m.customProgramCacheKey = () => `border-pattern-${outerX.toFixed(3)}-${innerX.toFixed(3)}`;
  return m;
};

/**
 * Banner flag (box geometry, x across the cloth, y up from 0 to `height`): pattern-cut pixels
 * take a contrasting shade of the owner color instead of being discarded.
 */
export const flagPatternMaterial = (uniforms: PatternUniforms, width: number, height: number): MeshLambertMaterial => {
  const m = new MeshLambertMaterial({ flatShading: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPatterns = uniforms.uPatterns;
    shader.vertexShader = VERT_DECL + shader.vertexShader.replace('#include <begin_vertex>', VERT_BODY);
    shader.fragmentShader =
      FRAG_DECL +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  if (uPatterns > 0.5) {
    float t = (vLocal.x / ${width.toFixed(4)} + 0.5) * 0.9;
    float u = 1.0 - vLocal.y / ${height.toFixed(4)};
    if (!patternKeep(vPattern, t, clamp(u, 0.0, 1.0))) {
      float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      diffuseColor.rgb = l > 0.25 ? diffuseColor.rgb * 0.18 : mix(diffuseColor.rgb, vec3(1.0), 0.85);
    }
  }`,
      );
  };
  m.customProgramCacheKey = () => `flag-pattern-${width.toFixed(3)}-${height.toFixed(3)}`;
  return m;
};
