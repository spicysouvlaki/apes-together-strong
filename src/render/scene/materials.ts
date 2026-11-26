/**
 * Diorama shaders (GDD §11): one hand-written light rig shared by every lit layer instead of
 * three.js lights, so each fragment does a handful of dot products and at most two texture
 * fetches (iPhone budget). All colors are linear inside the shaders.
 *
 * Light rig: warm key (wrapped Lambert) + cool fill + hemisphere sky/ground. Atmosphere: depth
 * haze toward a warm horizon color and a gentle filmic shoulder. Fog of war memory (explored but
 * not visible) desaturates toward paper instead of darkening. `uAtlas` (0..1) morphs terrain,
 * water and territory into the flat parchment atlas used at strategic zoom.
 *
 * Per-instance data rides on `aInst` (vec4, see each material) next to instanceColor.
 */
import {
  AdditiveBlending,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
  ClampToEdgeWrapping,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
} from 'three';
import { ART } from '../palette';
import { REACH_STYLE, glslVec3 } from '../highlight-style';
import { PATTERN_GLSL } from '../patterns';
import { DETAIL_SIZE, generateDetailTexels } from '../textures';

export interface SceneUniforms {
  [k: string]: IUniform;
  uTime: IUniform<number>;
  /** 1 while ambient animation (water, flags, pulses) runs; 0 freezes it (reduceMotion, low quality). */
  uAnim: IUniform<number>;
  uSunDir: IUniform<Vector3>;
  uSunColor: IUniform<Color>;
  uFillDir: IUniform<Vector3>;
  uFillColor: IUniform<Color>;
  uSky: IUniform<Color>;
  uGround: IUniform<Color>;
  uFogColor: IUniform<Color>;
  uFogNear: IUniform<number>;
  uFogFar: IUniform<number>;
  uPaper: IUniform<Color>;
  uPaperShade: IUniform<Color>;
  uInk: IUniform<Color>;
  uShallow: IUniform<Color>;
  uDeep: IUniform<Color>;
  uFoam: IUniform<Color>;
  uBank: IUniform<Color>;
  uShadow: IUniform<Color>;
  uStrata0: IUniform<Color>;
  uStrata1: IUniform<Color>;
  uStrata2: IUniform<Color>;
  uAtlas: IUniform<number>;
  uDetail: IUniform<DataTexture>;
  uMapField: IUniform<DataTexture>;
  /** (width, height) of the map in tiles. */
  uMapSize: IUniform<Vector2>;
  /** Two compass-rose centers on the parchment (x1, z1, x2, z2). */
  uCompass: IUniform<Vector4>;
  /** Map bounds (minX, minZ, maxX, maxZ) for the atlas frame and cartouche. */
  uFrame: IUniform<Vector4>;
  uPatterns: IUniform<number>;
  /**
   * Mood grade (mood.ts): rgb = channel multiply, w = saturation. The new grade wipes in over
   * the old one across the screen as uSweep goes 0 -> 1 (age transition "page turn").
   */
  uGradeFrom: IUniform<Vector4>;
  uGradeTo: IUniform<Vector4>;
  uSweep: IUniform<number>;
  /** Drawing-buffer size in px (for the screen-space sweep). */
  uRes: IUniform<Vector2>;
  /** Drifting cloud shadows on land and water (0 off: quality 'low', reduceMotion keeps still clouds). */
  uCloud: IUniform<number>;
  /** Haze strength multiplier (crisis air is dustier). */
  uHaze: IUniform<number>;
}

const col = (hex: string, k = 1): Color => new Color(hex).multiplyScalar(k);

export const createSceneUniforms = (patterns: boolean): SceneUniforms => {
  const detail = new DataTexture(generateDetailTexels(), DETAIL_SIZE, DETAIL_SIZE, RGBAFormat, UnsignedByteType);
  detail.wrapS = RepeatWrapping;
  detail.wrapT = RepeatWrapping;
  detail.magFilter = LinearFilter;
  detail.minFilter = LinearMipmapLinearFilter;
  detail.generateMipmaps = true;
  detail.needsUpdate = true;
  const field = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType);
  field.wrapS = ClampToEdgeWrapping;
  field.wrapT = ClampToEdgeWrapping;
  field.magFilter = LinearFilter;
  field.minFilter = LinearFilter;
  field.needsUpdate = true;
  return {
    uTime: { value: 0 },
    uAnim: { value: 1 },
    uSunDir: { value: new Vector3(-0.55, 0.95, 0.35).normalize() },
    uSunColor: { value: col(ART.sun, ART.sunIntensity) },
    uFillDir: { value: new Vector3(0.6, 0.45, -0.65).normalize() },
    uFillColor: { value: col(ART.fill, ART.fillIntensity) },
    uSky: { value: col(ART.sky, ART.hemiIntensity) },
    uGround: { value: col(ART.ground, ART.hemiIntensity * 0.75) },
    uFogColor: { value: col(ART.haze) },
    uFogNear: { value: 30 },
    uFogFar: { value: 90 },
    uPaper: { value: col(ART.paper) },
    uPaperShade: { value: col(ART.paperShade) },
    uInk: { value: col(ART.ink) },
    uShallow: { value: col(ART.waterShallow) },
    uDeep: { value: col(ART.waterDeep) },
    uFoam: { value: col(ART.foam) },
    uBank: { value: col(ART.riverBank) },
    uShadow: { value: col(ART.shadow) },
    uStrata0: { value: col(ART.strata0) },
    uStrata1: { value: col(ART.strata1) },
    uStrata2: { value: col(ART.strata2) },
    uAtlas: { value: 0 },
    uDetail: { value: detail },
    uMapField: { value: field },
    uMapSize: { value: new Vector2(1, 1) },
    uCompass: { value: new Vector4(0, 0, 0, 0) },
    uFrame: { value: new Vector4(0, 0, 0, 0) },
    uPatterns: { value: patterns ? 1 : 0 },
    uGradeFrom: { value: new Vector4(1, 1, 1, 1) },
    uGradeTo: { value: new Vector4(1, 1, 1, 1) },
    uSweep: { value: 1 },
    uRes: { value: new Vector2(1, 1) },
    uCloud: { value: 1 },
    uHaze: { value: 1 },
  };
};

// --- GLSL chunks ------------------------------------------------------------------------------

const COMMON = /* glsl */ `
uniform float uTime;
uniform float uAnim;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFillDir;
uniform vec3 uFillColor;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uPaper;
uniform vec3 uPaperShade;
uniform vec3 uInk;
uniform float uAtlas;
uniform vec4 uGradeFrom;
uniform vec4 uGradeTo;
uniform float uSweep;
uniform vec2 uRes;
uniform float uCloud;
uniform float uHaze;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

const FRAG_COMMON = /* glsl */ `
vec3 lightRig(vec3 n) {
  // Wrapped key light: soft terminator, painterly rather than harsh.
  float k = clamp((dot(n, uSunDir) + 0.3) / 1.3, 0.0, 1.0);
  vec3 hemi = mix(uGround, uSky, n.y * 0.5 + 0.5);
  return hemi + uSunColor * k * k * 0.95 + uFillColor * max(dot(n, uFillDir), 0.0);
}
// Explored-but-not-visible: a warm sepia memory, like a hand-tinted engraving. Enough of the
// original hue survives that grass, desert and forest stay tellable; never muddy dark.
// Remembered (explored, not in sight) ground also carries fine diagonal pen hatching (playtest 3:
// at default zoom the sepia alone did not say "this is memory, not sight", especially around
// rivals' remembered ghost cities). World-space lines, ~6 per hex, fading on the atlas.
vec3 memoryHatch(vec3 c, float m, vec2 xz) {
  if (m < 0.01) return c;
  float l = abs(fract((xz.x - xz.y * 0.7) * 3.1) - 0.5);
  float ink = (1.0 - smoothstep(0.055, 0.11, l)) * m * (1.0 - uAtlas * 0.6);
  return mix(c, vec3(0.36, 0.26, 0.16), ink * 0.26);
}
vec3 memoryTint(vec3 c, float m) {
  float l = luma(c);
  vec3 sepia = vec3(1.26, 0.94, 0.54) * (0.08 + l * 1.04);
  vec3 g = mix(c, sepia, 0.7);
  g = mix(g, uPaper * (0.45 + l * 0.6), 0.14);
  return mix(c, g, clamp(m, 0.0, 1.0));
}
vec3 finish(vec3 c, float depth) {
  // Distance haze (a touch of tilt-shift: the far board softens into warm air).
  float f = smoothstep(uFogNear, uFogFar, depth);
  c = mix(c, uFogColor, clamp(f * 0.8 * uHaze, 0.0, 0.92));
  // Mood grade per age / crisis, wiped in diagonally across the screen on a change.
  vec2 sp = gl_FragCoord.xy / uRes;
  float edge = sp.x * 0.75 + (1.0 - sp.y) * 0.25;
  float k = smoothstep(edge - 0.12, edge + 0.02, uSweep * 1.16 - 0.04);
  vec4 g = mix(uGradeFrom, uGradeTo, k);
  c = mix(vec3(luma(c)), c, g.w) * g.rgb;
  // Gentle filmic shoulder (keeps highlights from clipping to white).
  c = c * 1.08 / (1.0 + c * 0.1);
  return c;
}
// Slow drifting cloud shadows (one detail fetch; the mottle channel at a very low frequency).
float cloudShade(sampler2D tex, vec2 xz) {
  vec2 drift = vec2(0.011, 0.005) * uTime * uAnim;
  float n = texture2D(tex, xz * 0.031 + drift).r * 0.65 + texture2D(tex, xz * 0.013 - drift * 0.6 + 0.37).r * 0.35;
  return 1.0 - smoothstep(0.5, 0.68, n) * 0.13 * uCloud * (1.0 - uAtlas);
}
`;

const VERT_COMMON = /* glsl */ `
attribute vec4 aInst;
varying vec3 vN;
varying vec3 vW;
varying float vDepth;
varying vec4 vInst;
mat4 instMat() {
#ifdef USE_INSTANCING
  return instanceMatrix;
#else
  return mat4(1.0);
#endif
}
vec3 instColor() {
#ifdef USE_INSTANCING_COLOR
  return instanceColor;
#else
  return vec3(1.0);
#endif
}
// Inverse-transpose for R*S instance matrices, so slopes of non-uniformly scaled roofs light right.
vec3 instNormal(mat4 im, vec3 n) {
  vec3 s = vec3(length(im[0].xyz), length(im[1].xyz), length(im[2].xyz));
  s = max(s, vec3(1e-4));
  return normalize(mat3(modelMatrix) * (mat3(im) * (n / (s * s))));
}
vec3 vertColor() {
#ifdef USE_COLOR
  return color;
#else
  return vec3(1.0);
#endif
}
`;

const OUT = 'gl_FragColor = linearToOutputTexel(vec4(c, 1.0));';

interface MatOpts {
  defines?: Record<string, string | number | boolean>;
  transparent?: boolean;
  depthWrite?: boolean;
  polygonOffset?: number;
  side?: typeof DoubleSide;
  additive?: boolean;
}

const make = (name: string, u: SceneUniforms, vertexShader: string, fragmentShader: string, o: MatOpts = {}): ShaderMaterial => {
  const m = new ShaderMaterial({
    name,
    uniforms: u,
    vertexShader,
    fragmentShader,
    vertexColors: true,
    transparent: o.transparent ?? false,
    depthWrite: o.depthWrite ?? !o.transparent,
    defines: o.defines ?? {},
  });
  if (o.side) m.side = o.side;
  if (o.additive) m.blending = AdditiveBlending;
  if (o.polygonOffset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = o.polygonOffset;
    m.polygonOffsetUnits = o.polygonOffset;
  }
  // Layers without an aInst attribute read zeros (no stale generic attribute values).
  (m as ShaderMaterial & { defaultAttributeValues: Record<string, number[]> }).defaultAttributeValues = {
    color: [1, 1, 1],
    uv: [0, 0],
    uv1: [0, 0],
    aInst: [0, 0, 0, 0],
  };
  return m;
};

// --- Props: trees, rocks, buildings, figurines --------------------------------------------------

/**
 * Lit prop material. Vertex colors carry baked tones and AO; a vertex whose red channel is
 * negative is "team colored": instanceColor × −r (owner colors on figurines, flags, tents).
 * TINT also multiplies the fixed vertex colors by instanceColor (tree/rock variation).
 * aInst: x = fog memory, y = pattern id (FLAG) or alpha (ALPHA), z = sway phase, w = unused.
 */
export const propMaterial = (
  u: SceneUniforms,
  opts: { tint?: boolean; sway?: boolean; flag?: boolean; alpha?: boolean; bob?: boolean; orbit?: boolean; second?: boolean; idle?: boolean; graze?: boolean } = {},
): ShaderMaterial => {
  const defines: Record<string, number> = {};
  if (opts.second) defines.SECOND = 1;
  if (opts.idle) defines.IDLE = 1;
  if (opts.graze) defines.GRAZE = 1;
  if (opts.bob) defines.BOB = 1;
  if (opts.orbit) defines.ORBIT = 1;
  if (opts.tint) defines.TINT = 1;
  if (opts.sway) defines.SWAY = 1;
  if (opts.flag) defines.FLAG = 1;
  if (opts.alpha) defines.ALPHA = 1;
  const vert = /* glsl */ `
${COMMON}
${VERT_COMMON}
varying vec3 vCol;
varying vec3 vLocal;
void main() {
  mat4 im = instMat();
  vec3 p = position;
#ifdef SWAY
  // Cloth sways more toward its free end (x = 0 at the pole).
  float ph = aInst.z + im[3].x * 1.7 + im[3].z * 1.3;
  float t = uTime * uAnim;
  p.z += sin(t * 3.1 + p.x * 4.5 + ph) * 0.22 * p.x * uAnim;
  p.y += sin(t * 2.3 + p.x * 3.0 + ph) * 0.05 * p.x * uAnim;
#endif
#ifdef BOB
  // Moored/fishing boats ride the swell: a slow heave plus pitch and roll (aInst.z = phase).
  float tb = uTime * uAnim;
  p.y += sin(tb * 1.7 + aInst.z) * 0.012 + p.z * sin(tb * 1.3 + aInst.z * 1.7) * 0.16 + p.x * sin(tb * 1.1 + aInst.z) * 0.06;
#endif
#ifdef IDLE
  // Figurines (art pass 4): cloth marked with a flutter weight in -g (0.06..0.46, figurines.ts)
  // ripples from the pole outward; the whole toy breathes with a slow lean, stronger toward the
  // head (p.y), phase per instance. Frozen when uAnim = 0 (reduceMotion, low, idle off).
  float tI = uTime * uAnim;
  float phI = aInst.z + im[3].x * 2.3 + im[3].z * 1.7;
  vec3 vcI = vertColor();
  if (vcI.g < -0.03 && vcI.g > -0.5) {
    float wf = (-vcI.g - 0.06) / 0.4;
    p.z += sin(tI * 3.4 - p.x * 16.0 + phI) * 0.02 * wf * uAnim;
    p.y += sin(tI * 2.6 - p.x * 11.0 + phI) * 0.006 * wf * uAnim;
  }
  p.x += sin(tI * 1.5 + phI) * 0.035 * p.y * uAnim;
  p.z += sin(tI * 1.1 + phI * 1.3) * 0.022 * p.y * uAnim;
#endif
#ifdef GRAZE
  // Pasture animals (resource props): head and neck (graze weight in -g) dip to the grass now
  // and then, each beast on its own beat (phase from its local x and the instance position).
  vec3 vcG = vertColor();
  if (vcG.g < -0.1 && vcG.g > -0.5) {
    float wg = (-vcG.g - 0.1) / 0.35;
    float tg = uTime * uAnim * 0.55 + position.x * 23.0 + im[3].x * 1.9 + im[3].z * 2.7;
    float dip = smoothstep(0.2, 0.75, sin(tg)) * uAnim;
    p.y -= dip * wg * 0.075;
    p.z -= dip * wg * 0.02;
  }
#endif
#ifdef ORBIT
  // Birds: wingtips flap (|x| = distance from the body), and the whole bird circles the
  // instance origin at radius aInst.y (aInst.z = phase, aInst.w = angular speed, sign = turn).
  float tt = uTime * uAnim;
  p.y += abs(p.x) * sin(tt * 10.0 + aInst.z * 37.0) * 0.55;
  float ang = tt * aInst.w + aInst.z * 6.2832;
  float hd = -ang - sign(aInst.w) * 1.5708;
  p.xz = vec2(cos(hd) * p.x + sin(hd) * p.z, -sin(hd) * p.x + cos(hd) * p.z);
  p += vec3(cos(ang), 0.0, sin(ang) * 0.8) * aInst.y / max(length(im[0].xyz), 1e-4);
  p.y += sin(ang * 2.0 + aInst.z * 3.0) * 0.06 / max(length(im[0].xyz), 1e-4);
#endif
  vLocal = position;
  vec4 w = modelMatrix * im * vec4(p, 1.0);
  vec3 ic = instColor();
  vec3 vc = vertColor();
#ifdef TINT
  vCol = vc.r < 0.0 ? ic * -vc.r : vc * ic;
#else
  vCol = vc.r < 0.0 ? ic * -vc.r : vc;
#endif
  // Skin-marked vertices (g < 0) take the owner's skin tone, packed as 0xRRGGBB in aInst.w
  // (0 = default tone); r carries the shade.
  if (vc.g < -0.5) {
    float pk = aInst.w;
    vec3 sk = vec3(0.67, 0.37, 0.2);
    if (pk > 0.5) {
      float r = floor(pk / 65536.0);
      float g = floor((pk - r * 65536.0) / 256.0);
      float b = pk - r * 65536.0 - g * 256.0;
      sk = pow(vec3(r, g, b) / 255.0, vec3(2.2));
    }
    vCol = sk * vc.r;
  }
#ifdef SECOND
  // Owner secondary color (figurine trims, base rule): b < -0.5, packed 0xRRGGBB in aInst.y.
  if (vc.b < -0.5 && vc.r >= 0.0) {
    float pk2 = aInst.y;
    float r2 = floor(pk2 / 65536.0);
    float g2 = floor((pk2 - r2 * 65536.0) / 256.0);
    float b2 = pk2 - r2 * 65536.0 - g2 * 256.0;
    vCol = pow(vec3(r2, g2, b2) / 255.0, vec3(2.2)) * vc.r;
  }
#endif
  vN = instNormal(im, normal);
  vW = w.xyz;
  vInst = aInst;
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
  const frag = /* glsl */ `
${COMMON}
${FRAG_COMMON}
varying vec3 vN;
varying vec3 vW;
varying float vDepth;
varying vec4 vInst;
varying vec3 vCol;
varying vec3 vLocal;
#ifdef FLAG
uniform float uPatterns;
${PATTERN_GLSL}
#endif
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 base = vCol;
#ifdef FLAG
  if (uPatterns > 0.5) {
    float t = vLocal.x * 0.9;
    float uu = 1.0 - vLocal.y;
    if (!patternKeep(vInst.y, t, clamp(uu, 0.0, 1.0))) {
      float l = luma(base);
      base = l > 0.06 ? base * 0.16 : mix(base, vec3(1.0), 0.85);
    }
  }
#endif
  vec3 c = base * lightRig(n);
  c = memoryTint(c, vInst.x);
  c = finish(c, vDepth);
#ifdef ALPHA
  gl_FragColor = linearToOutputTexel(vec4(c, vInst.y));
#else
  ${OUT}
#endif
}`;
  return make('diorama-prop', u, vert, frag, {
    defines,
    transparent: !!opts.alpha,
    side: opts.flag ? DoubleSide : undefined,
  });
};

// --- Land tiles: beveled top + strata sides -------------------------------------------------------

/**
 * Land prism (geometry.landTileGeometry): top + chamfer + side; side vertices with y = −1 are
 * dropped to the column depth. aInst: x = memory, y = column height, z = surface kind + 8·glyph
 * (glyph: 1 mountain, 2 forest, 3 hills), w = per-tile random. Vertex color = painted gradient.
 */
export const landMaterial = (u: SceneUniforms): ShaderMaterial => {
  const vert = /* glsl */ `
${COMMON}
${VERT_COMMON}
varying vec3 vCol;
varying vec3 vBake;
varying vec3 vLocal;
void main() {
  mat4 im = instMat();
  vec3 p = position;
  if (p.y < -0.5) p.y = -aInst.y;
  vLocal = p;
  vec4 w = modelMatrix * im * vec4(p, 1.0);
  vCol = instColor();
  vBake = vertColor();
  vN = instNormal(im, normal);
  vW = w.xyz;
  vInst = aInst;
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
  const frag = /* glsl */ `
${COMMON}
${FRAG_COMMON}
uniform sampler2D uDetail;
uniform vec3 uStrata0;
uniform vec3 uStrata1;
uniform vec3 uStrata2;
varying vec3 vN;
varying vec3 vW;
varying float vDepth;
varying vec4 vInst;
varying vec3 vCol;
varying vec3 vBake;
varying vec3 vLocal;
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  vec3 n = normalize(vN);
  float glyph = floor(vInst.z / 8.0 + 0.01);
  float kind = vInst.z - glyph * 8.0;
  vec4 d = texture2D(uDetail, vW.xz * 0.21 + vInst.w);
  vec4 d2 = texture2D(uDetail, vW.xz * 0.83 + 0.37);
  vec3 c;
  bool side = n.y < 0.5;
  if (side) {
    float depth = -vLocal.y;
    float wav = (d.r - 0.5) * 0.06 + (d2.r - 0.5) * 0.02;
    vec3 top = vCol;
    if (depth < 0.055 + wav * 0.4) c = top * 0.8;
    else if (depth < 0.17 + wav) c = uStrata0;
    else if (depth < 0.31 + wav) c = uStrata1;
    else c = uStrata2;
    if (kind > 1.5 && kind < 3.5) c = mix(c, top * 0.82, 0.38);
    if (kind > 4.5) c = mix(c, top * 0.7, 0.35);
    c *= 0.88 + 0.24 * d2.a * d2.r;
    // Baked occlusion: darker toward the base and in the seams.
    c *= mix(1.0, 0.5, smoothstep(0.05, 0.7, depth));
    // Warm rim: the turf lip of edges facing the light catches it (diorama edge glow), so a
    // raised tile reads as a lit ledge rather than a dark crevasse.
    float facing = clamp(dot(n, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0, 1.0);
    c += vec3(0.26, 0.17, 0.07) * facing * (1.0 - smoothstep(0.0, 0.12, depth));
  } else {
    c = vCol * vBake;
    float m = d.r - 0.5;
    if (kind < 0.5) {
      c *= 1.0 + m * 0.26;
      c = mix(c, c * vec3(1.1, 1.07, 0.82), smoothstep(0.6, 0.78, d2.r) * 0.55);
    } else if (kind < 1.5) {
      c *= 1.0 + m * 0.2 - d.g * 0.1;
    } else if (kind < 2.5) {
      c *= 1.0 + (d.b - 0.5) * 0.1 + (d2.a - 0.5) * 0.05 + m * 0.08;
    } else if (kind < 3.5) {
      c = mix(c, vec3(0.86, 0.93, 1.0) * (luma(c) * 1.02), 0.25) * (1.0 + (d.b - 0.5) * 0.07);
    } else if (kind < 4.5) {
      c *= 1.0 + m * 0.22 + (d2.a - 0.5) * 0.08;
    } else {
      c *= 1.0 + m * 0.25 - d.g * 0.14;
    }
  }
  vec3 lit = c * lightRig(n);
  if (uAtlas > 0.001) {
    // Strategic atlas: flat paper-tinted biomes, inked relief glyphs.
    vec3 a = side ? uPaperShade * 0.78 : mix(uPaper, vCol, 0.5) * (0.92 + 0.12 * d.r);
    if (!side && glyph > 0.5) {
      vec2 p = vLocal.xz;
      float ink = 0.0;
      if (glyph < 1.5) {
        float dd = min(seg(p, vec2(-0.45, 0.25), vec2(-0.08, -0.32)), seg(p, vec2(-0.08, -0.32), vec2(0.18, 0.06)));
        dd = min(dd, min(seg(p, vec2(0.05, -0.08), vec2(0.28, -0.3)), seg(p, vec2(0.28, -0.3), vec2(0.5, 0.25))));
        ink = 1.0 - smoothstep(0.025, 0.06, dd);
      } else if (glyph < 2.5) {
        float dd = min(length(p - vec2(-0.25, 0.05)), min(length(p - vec2(0.2, -0.15)), length(p - vec2(0.15, 0.3))));
        ink = 1.0 - smoothstep(0.02, 0.05, abs(dd - 0.13));
      } else {
        float r = length(p - vec2(0.0, 0.25));
        ink = (1.0 - smoothstep(0.02, 0.05, abs(r - 0.38))) * step(p.y, 0.15);
      }
      a = mix(a, uInk, ink * 0.75);
    }
    lit = mix(lit, a, uAtlas);
  }
  lit *= cloudShade(uDetail, vW.xz);
  vec3 c2 = memoryTint(lit, vInst.x);
  if (!side) c2 = memoryHatch(c2, vInst.x, vW.xz);
  c = finish(c2, vDepth);
  ${OUT}
}`;
  return make('diorama-land', u, vert, frag);
};

// --- Hex-edge helper (water foam, parchment ink) -------------------------------------------------

const EDGE_GLSL = /* glsl */ `
// Distance (hex units) from local point p to the nearest edge whose bit is set in mask.
// Bit k = the neighbor at world angle k·60° (edge normal (cos, sin) in x/z).
float edgeDist(vec2 p, int mask) {
  float d = 9.0;
  for (int k = 0; k < 6; k++) {
    if (((mask >> k) & 1) == 1) {
      float a = float(k) * 1.04719755;
      d = min(d, 0.8660254 - dot(p, vec2(cos(a), sin(a))));
    }
  }
  return d;
}
vec2 mapUv(vec2 xz, vec2 size) {
  // Odd-r storage: col ≈ x/√3 − 0.25 (half the odd-row shift), row = z/1.5.
  return vec2((xz.x / 1.7320508 - 0.25 + 0.5) / size.x, (xz.y / 1.5 + 0.5) / size.y);
}
`;

const FLAT_VERT = /* glsl */ `
${COMMON}
${VERT_COMMON}
varying vec3 vCol;
varying vec3 vLocal;
void main() {
  mat4 im = instMat();
  vLocal = position;
  vec4 w = modelMatrix * im * vec4(position, 1.0);
  vCol = instColor();
  vN = vec3(0.0, 1.0, 0.0);
  vW = w.xyz;
  vInst = aInst;
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

// --- Water ----------------------------------------------------------------------------------------

/**
 * Water hexes (seamless sheet). aInst: x = memory, y = shore mask (6 bits, land neighbors),
 * z = deep (0 coast, 1 ocean), w = unused. Depth gradient from the map field (soft, ignores hex
 * edges); foam hugs the exact hex edges that touch land.
 */
export const waterMaterial = (u: SceneUniforms): ShaderMaterial => {
  const frag = /* glsl */ `
${COMMON}
${FRAG_COMMON}
${EDGE_GLSL}
uniform sampler2D uDetail;
uniform sampler2D uMapField;
uniform vec2 uMapSize;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
varying vec3 vN;
varying vec3 vW;
varying float vDepth;
varying vec4 vInst;
varying vec3 vCol;
varying vec3 vLocal;
void main() {
  float t = uTime * uAnim;
  // Grain-scale noise breaks the bilinear tile-field steps (no banding in the depth ramp).
  vec4 g0 = texture2D(uDetail, vW.xz * 0.9 + 0.13);
  float depth = texture2D(uMapField, mapUv(vW.xz, uMapSize)).r + (g0.r - 0.5) * 0.09 + (g0.a - 0.5) * 0.05;
  float deep = smoothstep(0.08, 1.0, depth);
  deep = deep * deep * (3.0 - 2.0 * deep);
  // Open sea stops short of the darkest blue so it never reads as murky blotches.
  // Tropical seas (aInst.z = 1, art pass 4): turquoise shallows over pale sand, a sandy beach
  // lip at the shore instead of grey-green, deeper water still blue.
  float trop = vInst.z;
  vec3 shallow = mix(uShallow, vec3(0.06, 0.52, 0.47), trop * 0.6);
  vec3 c = mix(shallow, uDeep, deep * (0.82 + trop * 0.05));
  c = mix(c, vCol, 0.15 * (1.0 - trop));
  // Open-sea ripples: fine wind streaks (stretched noise, two drifting layers), not blotches.
  vec2 q = vW.xz;
  float r1 = texture2D(uDetail, q * vec2(0.55, 1.9) + vec2(t * 0.012, t * 0.004)).r;
  float r2 = texture2D(uDetail, q * vec2(0.9, 2.6) + vec2(-t * 0.009, t * 0.007) + 0.41).r;
  float rip = r1 * 0.55 + r2 * 0.45 - 0.5;
  c *= 1.0 + rip * 0.07;
  c += uFoam * smoothstep(0.17, 0.26, rip) * 0.07 * (0.3 + deep);
  int mask = int(vInst.y + 0.5);
  float sd = mask > 0 ? edgeDist(vLocal.xz, mask) : 9.0;
  float wob = 0.03 * sin(t * 1.4 + (vW.x * 2.3 + vW.z * 3.1)) + (r1 - 0.5) * 0.05;
  float lip = 1.0 - smoothstep(0.0, 0.42, sd);
  c = mix(c, shallow * 1.1, lip * 0.55);
  c = mix(c, vec3(0.86, 0.76, 0.55), (1.0 - smoothstep(0.0, 0.09 + wob, sd)) * trop * 0.85);
  float foam = 1.0 - smoothstep(0.05 + wob, 0.11 + wob, sd);
  float line2 = 1.0 - smoothstep(0.0, 0.035, abs(sd - 0.2 - wob * 1.6));
  c = mix(c, uFoam, max(foam, line2 * 0.4) * 0.92);
  vec3 lit = c * (mix(uGround, uSky, 0.9) * 1.1 + uSunColor * 0.5);
  if (uAtlas > 0.001) {
    vec3 a = mix(uPaper, uShallow, 0.42) * (0.95 + 0.06 * r1);
    // Inked coastline with hatching that fades seaward.
    float coast = 1.0 - smoothstep(0.02, 0.05, sd);
    float hatch = (1.0 - smoothstep(0.0, 0.03, abs(fract(sd * 8.0) - 0.5) - 0.42)) * (1.0 - smoothstep(0.1, 0.45, sd));
    a = mix(a, uInk, max(coast * 0.8, hatch * 0.25));
    lit = mix(lit, a, uAtlas);
  }
  lit *= cloudShade(uDetail, vW.xz);
  c = finish(memoryHatch(memoryTint(lit, vInst.x * 0.45), vInst.x * 0.8, vW.xz), vDepth);
  ${OUT}
}`;
  return make('diorama-water', u, FLAT_VERT, frag);
};

// --- Parchment (unexplored) -------------------------------------------------------------------------

/**
 * Unexplored tiles: aged parchment with paper grain, stains, faint rhumb lines from two compass
 * roses, and an ink wash along edges that touch known tiles. aInst: y = known-neighbor mask.
 */
export const parchmentMaterial = (u: SceneUniforms): ShaderMaterial => {
  const frag = /* glsl */ `
${COMMON}
${FRAG_COMMON}
${EDGE_GLSL}
uniform sampler2D uDetail;
uniform vec4 uCompass;
uniform vec4 uFrame;
varying vec3 vN;
varying vec3 vW;
varying float vDepth;
varying vec4 vInst;
varying vec3 vCol;
varying vec3 vLocal;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float stroke(float d, float w) { return 1.0 - smoothstep(w * 0.5, w, d); }
// Rhumb lines only (both roses): 16 faint rays.
float rays(vec2 p, vec2 c) {
  vec2 v = p - c;
  float r = length(v);
  float a = atan(v.y, v.x) * 2.5464791; // 16 rays
  float off = abs(fract(a + 0.5) - 0.5) * 0.3926991 * r;
  return (1.0 - smoothstep(0.012, 0.035, off)) * smoothstep(1.7, 2.2, r) * (1.0 - smoothstep(5.0, 26.0, r));
}
// Compass rose: an eight-point star (cardinal points long, half of each point inked), two
// rings with ticks, and a north fleur (a small diamond). Returns (ink amount, fill amount).
vec2 rose(vec2 p, vec2 c) {
  vec2 v = p - c;
  float r = length(v);
  if (r > 2.0) return vec2(0.0);
  float a = atan(v.y, v.x);
  float card = pow(abs(cos(2.0 * a)), 14.0);
  float diag = pow(abs(sin(2.0 * a)), 14.0);
  float R = 0.12 + max(card * 1.15, diag * 0.62);
  float inside = 1.0 - smoothstep(R - 0.02, R, r);
  // Each point split down its spine: one half inked, one half paper.
  float half_ = step(0.0, sin(8.0 * a));
  float edge = stroke(abs(r - R) * (0.4 + r), 0.03);
  float ring = stroke(abs(r - 1.42), 0.03) + stroke(abs(r - 1.58), 0.025) * 0.8;
  float ticks = stroke(abs(fract(a * 5.0929582) - 0.5) * r * 0.196, 0.025) * step(1.42, r) * step(r, 1.58);
  vec2 n = v - vec2(0.0, -1.85);
  float fleur = 1.0 - smoothstep(0.1, 0.13, abs(n.x) * 1.6 + abs(n.y));
  float ink = max(max(edge, ring), max(ticks, fleur));
  return vec2(ink, inside * half_);
}
// Wave glyph "~~" for open parchment sea, one per jittered cell (sparse).
float waves(vec2 p) {
  vec2 cell = floor(p / 1.7);
  float h = hash21(cell);
  if (h > 0.32) return 0.0;
  vec2 q = p - (cell + 0.5) * 1.7 - (vec2(hash21(cell + 3.1), hash21(cell + 7.7)) - 0.5) * 0.7;
  float ink = 0.0;
  for (int k = 0; k < 2; k++) {
    vec2 o = q - vec2(float(k) * 0.12, float(k) * 0.13);
    float len = 0.32 - float(k) * 0.1;
    float y = 0.045 * sin(o.x * 10.0 + 1.2);
    ink = max(ink, stroke(abs(o.y - y), 0.022) * (1.0 - smoothstep(len - 0.04, len, abs(o.x))));
  }
  return ink;
}
// A sea serpent, very rarely: three humps breaking the water, a head, waterline dashes.
float serpent(vec2 p) {
  vec2 cell = floor(p / 7.0);
  float h = hash21(cell + 19.3);
  if (h > 0.2) return 0.0;
  vec2 q = (p - (cell + 0.5) * 7.0 - (vec2(hash21(cell + 2.3), hash21(cell + 5.9)) - 0.5) * 3.0) * vec2(1.0, -1.0);
  if (hash21(cell + 11.0) > 0.5) q.x = -q.x;
  float s = sin(q.x * 6.0);
  float y = 0.16 * max(s, 0.0);
  float body = stroke(abs(q.y - y), 0.035) * step(0.02, y) * (1.0 - smoothstep(0.85, 0.9, abs(q.x + 0.15)));
  float water = stroke(abs(q.y + 0.01), 0.018) * step(0.5, fract(q.x * 4.0)) * (1.0 - smoothstep(1.0, 1.1, abs(q.x)));
  vec2 hd = q - vec2(0.88, 0.2);
  float head = stroke(abs(length(hd * vec2(0.8, 1.2)) - 0.07), 0.025) + stroke(length(hd - vec2(0.02, 0.01)), 0.03);
  float neck = stroke(abs(q.y - 0.2 * smoothstep(0.55, 0.85, q.x)), 0.03) * step(0.52, q.x) * step(q.x, 0.84);
  return max(max(body, water), max(head, neck));
}
// Strategic atlas frame (art pass 4): a double ink rule with a hatched band between, a corner
// lozenge at each corner, and a scrolled cartouche (bottom left) holding a scale bar. Faded in
// with uAtlas only. Returns the ink amount; fill = the cartouche's lighter paper.
vec2 atlasFrame(vec2 p) {
  if (uFrame.z <= uFrame.x) return vec2(0.0);
  vec2 lo = uFrame.xy - vec2(2.6);
  vec2 hi = uFrame.zw + vec2(2.6);
  vec2 dlo = p - lo;
  vec2 dhi = hi - p;
  float d = min(min(dlo.x, dlo.y), min(dhi.x, dhi.y));
  // Outer heavy rule, inner fine rule, and a band of hatching between (only outside the map).
  float ink = stroke(abs(d + 1.6), 0.3) + stroke(abs(d), 0.14);
  float band = step(-1.6, d) * step(d, 0.0);
  float horiz = step(min(dlo.y, dhi.y), min(dlo.x, dhi.x));
  float along = horiz > 0.5 ? p.x : p.y;
  ink = max(ink, band * stroke(abs(fract(along * 0.55) - 0.5), 0.12) * 0.7);
  // Corner lozenges sitting on the band.
  vec2 cn = vec2(min(dlo.x, dhi.x), min(dlo.y, dhi.y)) + vec2(0.8);
  float loz = abs(cn.x) + abs(cn.y);
  ink = max(ink, stroke(abs(loz - 1.4), 0.2) + stroke(loz, 0.45));
  float fill = step(loz, 1.4) * 0.6;
  // Cartouche centred in the bottom margin (in view on a portrait phone): a rounded box with
  // scrolled ends and a scale bar, drawn at 1.5x.
  vec2 cc = vec2((lo.x + hi.x) * 0.5, hi.y + 5.0);
  vec2 q = (p - cc) / 1.5;
  p = cc + q;
  vec2 bs = vec2(6.5, 1.8);
  vec2 dq = abs(q) - bs;
  float box = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0) - 0.4;
  float inside = 1.0 - smoothstep(-0.05, 0.05, box);
  ink = max(ink, stroke(abs(box), 0.22) + stroke(abs(box + 0.45), 0.1) * 0.8);
  for (int k = 0; k < 2; k++) {
    vec2 sc = cc + vec2(k == 0 ? -bs.x - 0.9 : bs.x + 0.9, 0.0);
    float r = length(p - sc);
    ink = max(ink, stroke(abs(r - 0.75), 0.18) + stroke(abs(r - 0.32), 0.14));
  }
  // Scale bar: alternating filled / open blocks, outlined.
  vec2 sb = q - vec2(0.0, -0.3);
  float onBar = step(abs(sb.x), 4.8) * step(abs(sb.y), 0.32);
  float blk = step(0.5, fract((sb.x + 4.8) / 1.6 * 0.5));
  ink = max(ink, onBar * max(blk, stroke(abs(abs(sb.y) - 0.32), 0.08)));
  ink = max(ink, step(abs(sb.x), 4.85) * step(abs(sb.y), 0.5) * stroke(abs(fract((sb.x + 4.8) / 1.6 + 0.5) - 0.5) * 1.6, 0.08));
  // Flourish rules above and below.
  ink = max(ink, step(abs(q.x), 5.2) * (stroke(abs(q.y - 0.85), 0.08) + stroke(abs(q.y + 1.2), 0.08)) * 0.8);
  return vec2(clamp(ink, 0.0, 1.0), max(fill, inside * 0.7));
}
void main() {
  vec4 d = texture2D(uDetail, vW.xz * 0.19);
  vec4 d2 = texture2D(uDetail, vW.xz * 1.1 + 0.5);
  // Stains from two scales at unrelated angles (art pass 4: one scale tiled visibly into a grid
  // of blotches at strategic zoom); the product only peaks where both agree, so blots are rarer
  // and irregular, and the repeat period is effectively gone.
  vec2 sp = mat2(0.83, -0.56, 0.56, 0.83) * vW.xz;
  float st1 = texture2D(uDetail, sp * 0.031 + 0.2).r;
  float st2 = texture2D(uDetail, vW.xz * 0.0117 + vec2(0.37, 0.71)).r;
  float stain = st1 * 0.6 + st2 * 0.55 - 0.08;
  vec3 c = uPaper * (0.94 + 0.09 * d.r) * (0.97 + 0.05 * d2.a);
  c = mix(c, uPaperShade, smoothstep(0.5, 0.8, stain) * 0.42);
  // Ink is applied with a little paper grain so strokes look drawn, not vector-perfect.
  float grain = 0.75 + 0.25 * d2.r;
  float lines = max(rays(vW.xz, uCompass.xy), rays(vW.xz, uCompass.zw));
  c = mix(c, uInk, lines * 0.14);
  // Exactly one rose per game (playtest: two roses overlapping read as a glitch); the second
  // center only seeds rhumb lines.
  vec2 rr = rose(vW.xz, uCompass.xy);
  c = mix(c, mix(uInk, vec3(0.42, 0.11, 0.08), 0.35), rr.y * 0.42 * grain);
  c = mix(c, uInk, rr.x * 0.55 * grain);
  c = mix(c, uInk, waves(vW.xz) * 0.3 * grain);
  c = mix(c, uInk, serpent(vW.xz) * 0.38 * grain);
  int mask = int(vInst.y + 0.5);
  if (mask > 0) {
    // Edge of the known world: a soft sepia wash, the inked shoreline, and old-map ripple
    // rules running parallel to it, fading seaward.
    float sd = edgeDist(vLocal.xz, mask) + (d.r - 0.5) * 0.1;
    float wash = 1.0 - smoothstep(0.0, 0.42, sd);
    c = mix(c, mix(uPaperShade, uInk, 0.3), wash * 0.5);
    float rule = stroke(abs(fract(sd * 6.5 - 0.15) - 0.5) / 6.5, 0.012) * (1.0 - smoothstep(0.08, 0.5, sd)) * step(0.06, sd);
    c = mix(c, uInk, rule * 0.3 * grain);
    c = mix(c, uInk, (1.0 - smoothstep(0.0, 0.035, sd)) * 0.65);
  }
  if (uAtlas > 0.01) {
    vec2 fr = atlasFrame(vW.xz);
    c = mix(c, uPaper * 1.04, fr.y * uAtlas);
    c = mix(c, uInk, fr.x * 0.7 * grain * uAtlas);
  }
  c = finish(c * 0.98, vDepth);
  ${OUT}
}`;
  return make('diorama-parchment', u, FLAT_VERT, frag);
};

// --- Rivers ---------------------------------------------------------------------------------------

/**
 * River ribbons and junction discs, matched to the water shader. Ribbon local x runs downstream
 * (aInst.y = flow sign); NODE uses the radial distance instead of the ribbon cross-section.
 */
export const riverMaterial = (u: SceneUniforms, node: boolean, halfWidth: number): ShaderMaterial => {
  const vert = /* glsl */ `
${COMMON}
${VERT_COMMON}
varying vec3 vLocal;
varying vec2 vFlow;
void main() {
  mat4 im = instMat();
  vLocal = position;
  vec4 w = modelMatrix * im * vec4(position, 1.0);
  vFlow = normalize(vec2(im[0].x, im[0].z) + 1e-5) * (aInst.y < 0.0 ? -1.0 : 1.0);
  vN = vec3(0.0, 1.0, 0.0);
  vW = w.xyz;
  vInst = aInst;
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
  const frag = /* glsl */ `
${COMMON}
${FRAG_COMMON}
uniform sampler2D uDetail;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uBank;
varying vec3 vN;
varying vec3 vW;
varying float vDepth;
varying vec4 vInst;
varying vec3 vLocal;
varying vec2 vFlow;
void main() {
#ifdef NODE
  float across = length(vLocal.xz) / ${halfWidth.toFixed(4)};
#else
  float across = abs(vLocal.z) / ${halfWidth.toFixed(4)};
#endif
  float t = uTime * uAnim;
  vec2 perp = vec2(-vFlow.y, vFlow.x);
  vec2 q = vec2(dot(vW.xz, vFlow), dot(vW.xz, perp));
  float s = texture2D(uDetail, q * vec2(0.6, 2.4) - vec2(t * 0.22, 0.0)).r;
  vec3 c = mix(uShallow, uDeep, 0.55 - across * 0.25) * vec3(0.85, 1.0, 1.15);
  c *= 0.9 + s * 0.25;
  c += uFoam * smoothstep(0.62, 0.75, s) * 0.18;
  c = mix(c, uBank, smoothstep(0.8, 0.98, across) * 0.8);
  vec3 lit = c * (mix(uGround, uSky, 0.9) * 1.1 + uSunColor * 0.5);
  if (uAtlas > 0.001) lit = mix(lit, mix(uInk, uShallow, 0.4), uAtlas);
  c = finish(memoryTint(lit, vInst.x), vDepth);
  ${OUT}
}`;
  return make(node ? 'diorama-river-node' : 'diorama-river', u, vert, frag, {
    defines: node ? { NODE: 1 } : {},
    polygonOffset: -1,
  });
};

// --- Soft overlays: territory, highlights, glows, blob shadows -------------------------------------

export const SOFT = { wash: 0, reach: 1, attack: 2, ring: 3, territory: 4, glow: 5, shadow: 6, ink: 7, mist: 8 } as const;
/** Radius of the highlight fill hex (world.ts hlFill); the reach mode draws its outline from it. */
export const HL_FILL_R = '0.93';

/**
 * Soft-edged translucent overlays on flat hex/disc geometry (radius 1 at scale 1).
 * aInst: x = memory, y = mode (SOFT), z = opacity, w = pulse (0/1).
 */
export const softMaterial = (u: SceneUniforms, polygonOffset: number): ShaderMaterial => {
  const frag = /* glsl */ `
${COMMON}
uniform vec3 uShadow;
varying vec3 vN;
varying vec3 vW;
varying float vDepth;
varying vec4 vInst;
varying vec3 vCol;
varying vec3 vLocal;
void main() {
  vec2 p = vLocal.xz;
  float hx = max(abs(p.x), abs(p.x) * 0.5 + abs(p.y) * 0.8660254) / 0.8660254;
  float rc = length(p);
  float mode = vInst.y;
  float a = vInst.z;
  vec3 c = vCol;
  float pulse = vInst.w > 0.5 ? 0.72 + 0.28 * sin(uTime * 5.0) * uAnim : 1.0;
  if (mode < 0.5) {
    a *= 0.55 + 0.45 * smoothstep(0.4, 1.0, hx);
  } else if (mode < 1.5) {
    // Reachable (highlight-style.ts REACH_STYLE): an ink keyline just inside the hex edge, a
    // bright glint line inside it and a violet wash with a slow sheen drifting across the board.
    // Dark + light outline: reads on pale desert, snow and parchment edges as well as on grass
    // and water. vLocal is in instance units (fill geometry radius ${HL_FILL_R}).
    float e = hx / ${HL_FILL_R};
    float ink = smoothstep(0.83, 0.865, e) * (1.0 - smoothstep(0.955, 0.99, e));
    float glint = smoothstep(0.765, 0.8, e) * (1.0 - smoothstep(0.83, 0.865, e));
    float wash = 1.0 - smoothstep(0.765, 0.8, e);
    float sheen = 0.5 + 0.5 * sin((vW.x * 0.55 + vW.z * 0.35) * 1.4 - uTime * 0.9 * uAnim);
    sheen = sheen * sheen * uAnim;
    vec3 wc = mix(c, ${glslVec3(REACH_STYLE.glint)}, sheen * 0.3 + smoothstep(0.45, 0.78, e) * 0.18);
    c = mix(wc, ${glslVec3(REACH_STYLE.glint)}, glint);
    c = mix(c, ${glslVec3(REACH_STYLE.ink)}, ink);
    a *= wash * ${REACH_STYLE.washAlpha.toFixed(3)} * (0.85 + 0.35 * sheen) + glint * ${REACH_STYLE.glintAlpha.toFixed(3)} + ink * ${REACH_STYLE.inkAlpha.toFixed(3)};
  } else if (mode < 2.5) {
    a *= (0.5 + 0.5 * smoothstep(0.35, 1.0, hx)) * pulse;
  } else if (mode < 3.5) {
    float rim = 1.0 - smoothstep(0.0, 0.16, abs(hx - 0.9));
    a *= rim * pulse;
  } else if (mode < 4.5) {
    // Uniform wash (the border bands already outline the territory; per-hex rims read as a grid).
    a *= 0.6 * (1.0 + uAtlas * 2.6);
  } else if (mode < 5.5) {
    float rim = 1.0 - smoothstep(0.0, 0.22, abs(rc - 0.82));
    a *= (rim + (1.0 - smoothstep(0.0, 0.8, rc)) * 0.25) * pulse;
  } else if (mode < 6.5) {
    float s = 1.0 - smoothstep(0.15, 1.0, rc);
    a *= s * s;
    c = uShadow;
  } else if (mode < 7.5) {
    // Ink: a drawn stroke (roads, tracks) with a soft, slightly ragged rim; bolder on the atlas.
    a *= (1.0 - smoothstep(0.7, 1.0, rc)) * (1.0 + uAtlas * 0.4);
  } else {
    // Mist: a soft round haze (jungle), gone on the atlas.
    float m = 1.0 - smoothstep(0.05, 1.0, rc);
    a *= m * m * (1.0 - uAtlas);
  }
  if (a < 0.004) discard;
  a *= 1.0 - vInst.x * 0.4;
  gl_FragColor = linearToOutputTexel(vec4(c, clamp(a, 0.0, 1.0)));
}`;
  return make('diorama-soft', u, FLAT_VERT, frag, { transparent: true, polygonOffset });
};

// --- Living world: hearth smoke ------------------------------------------------------------------

/**
 * Smoke wisps: each instance is one puff of a looping column (instance origin = chimney top,
 * scale = puff size). The puff rises, grows, drifts downwind and fades entirely in the vertex
 * shader from uTime, so a column costs no CPU per frame. aInst: x = memory, y = phase 0..1,
 * z = rise height, w = unused. Frozen (still puffs) when uAnim = 0.
 */
export const wispMaterial = (u: SceneUniforms): ShaderMaterial => {
  const vert = /* glsl */ `
${COMMON}
attribute vec4 aInst;
varying float vA;
varying float vDepth;
varying vec3 vN;
varying float vMem;
varying float vDust;
void main() {
#ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
#else
  mat4 im = mat4(1.0);
#endif
  float t = fract(uTime * uAnim * 0.09 + aInst.y);
  float size = length(im[0].xyz);
  vec3 base = (modelMatrix * vec4(im[3].xyz, 1.0)).xyz;
  // Prevailing wind (same quarter the dunes face): the column leans as it rises.
  // aInst.w = 1: crisis dust, blown flat and fast along the ground instead of rising.
  float dust = step(0.5, aInst.w);
  vec3 drift = vec3(0.32, 0.0, 0.12) * (t * t * (1.0 - dust) + t * dust * 4.5) + vec3(sin(t * 7.0 + aInst.y * 23.0), 0.0, cos(t * 5.0 + aInst.y * 11.0)) * 0.025;
  vec3 shape = position * vec3(1.0 + dust * 0.8, 1.0 - dust * 0.55, 1.0);
  vec3 w = base + shape * size * (0.4 + t * 1.3) + vec3(0.0, t * aInst.z, 0.0) + drift;
  vA = smoothstep(0.0, 0.14, t) * (1.0 - smoothstep(0.4, 1.0, t)) * (0.62 - dust * 0.1);
  vDust = dust;
  vN = normalize(position);
  vMem = aInst.x;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
  const frag = /* glsl */ `
${COMMON}
${FRAG_COMMON}
varying float vA;
varying float vDepth;
varying vec3 vN;
varying float vMem;
varying float vDust;
void main() {
  vec3 n = normalize(vN);
  // Warm grey smoke, lit from the key side; reads on grass, sand and parchment alike.
  vec3 c = mix(vec3(0.5, 0.47, 0.44), vec3(0.93, 0.9, 0.85), clamp(dot(n, uSunDir) * 0.5 + 0.55, 0.0, 1.0));
  c = mix(c, vec3(0.62, 0.47, 0.3), vDust * 0.75);
  c = memoryTint(c, vMem);
  c = finish(c, vDepth);
  gl_FragColor = linearToOutputTexel(vec4(c, vA * (1.0 - vMem * 0.5)));
}`;
  return make('diorama-wisp', u, vert, frag, { transparent: true });
};

// --- Screen-space vignette + atmospheric tint -------------------------------------------------------

/** Full-screen triangle (position.xy in clip space). Radial vignette and a cool top tint. */
export const vignetteMaterial = (strength: number): ShaderMaterial => {
  const m = new ShaderMaterial({
    name: 'vignette',
    uniforms: {
      uVig: { value: new Color(ART.vignette) },
      uSkyTint: { value: new Color(ART.bgTop) },
      uStrength: { value: strength },
      /** Drawing-buffer px (fiber scale) and a 0..1 "page settle" pulse (age transition). */
      uRes: { value: new Vector2(1, 1) },
      uFiber: { value: 1 },
      uSettle: { value: 0 },
      uPaperTone: { value: new Color(ART.paper) },
      uInkTone: { value: new Color(ART.ink) },
    },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uVig;
uniform vec3 uSkyTint;
uniform float uStrength;
uniform vec2 uRes;
uniform float uFiber;
uniform float uSettle;
uniform vec3 uPaperTone;
uniform vec3 uInkTone;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p * vec2(1.0, 0.8));
  float v = smoothstep(0.32, 0.85, r) * uStrength * (1.0 + uSettle * 0.6);
  float top = smoothstep(0.55, 1.0, vUv.y) * 0.22;
  vec3 c = mix(uVig, uSkyTint, top / max(0.001, v + top));
  float a = v + top;
  // Paper fibre over the whole frame (very subtle): long streaky fibres plus fine tooth, so the
  // diorama and the vellum UI read as one sheet. Scale in CSS-ish px (fixed on screen).
  vec2 q = vUv * uRes / 2.0;
  vec2 qr = mat2(0.94, -0.34, 0.34, 0.94) * q;
  float fib = vnoise(qr * vec2(0.09, 0.9)) - 0.5;
  fib += (vnoise(q * vec2(0.8, 0.12) + 11.0) - 0.5) * 0.6;
  float tooth = vnoise(q * 0.7) - 0.5;
  float n = (fib * 0.75 + tooth * 0.5) * uFiber * (1.0 + uSettle * 1.5);
  float fa = abs(n) * 0.045;
  vec3 fc = n > 0.0 ? uPaperTone : uInkTone;
  float a2 = clamp(a + fa, 0.0, 1.0);
  c = (c * a + fc * fa) / max(a2, 1e-4);
  gl_FragColor = linearToOutputTexel(vec4(c, a2));
}`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  return m;
};
