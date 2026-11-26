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
  uPatterns: IUniform<number>;
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
    uPatterns: { value: patterns ? 1 : 0 },
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
vec3 memoryTint(vec3 c, float m) {
  float l = luma(c);
  vec3 sepia = vec3(1.26, 0.94, 0.54) * (0.08 + l * 1.04);
  vec3 g = mix(c, sepia, 0.7);
  g = mix(g, uPaper * (0.45 + l * 0.6), 0.14);
  return mix(c, g, clamp(m, 0.0, 1.0));
}
vec3 finish(vec3 c, float depth) {
  float f = smoothstep(uFogNear, uFogFar, depth);
  c = mix(c, uFogColor, f * 0.8);
  // Gentle filmic shoulder (keeps highlights from clipping to white).
  c = c * 1.08 / (1.0 + c * 0.1);
  return c;
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
export const propMaterial = (u: SceneUniforms, opts: { tint?: boolean; sway?: boolean; flag?: boolean; alpha?: boolean } = {}): ShaderMaterial => {
  const defines: Record<string, number> = {};
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
  vec3 c2 = memoryTint(lit, vInst.x);
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
  vec3 c = mix(uShallow, uDeep, deep * 0.82);
  c = mix(c, vCol, 0.15);
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
  c = mix(c, uShallow * 1.1, lip * 0.55);
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
  c = finish(memoryTint(lit, vInst.x * 0.45), vDepth);
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
void main() {
  vec4 d = texture2D(uDetail, vW.xz * 0.19);
  vec4 d2 = texture2D(uDetail, vW.xz * 1.1 + 0.5);
  float stain = texture2D(uDetail, vW.xz * 0.035 + 0.2).r;
  vec3 c = uPaper * (0.94 + 0.09 * d.r) * (0.97 + 0.05 * d2.a);
  c = mix(c, uPaperShade, smoothstep(0.5, 0.78, stain) * 0.45);
  // Ink is applied with a little paper grain so strokes look drawn, not vector-perfect.
  float grain = 0.75 + 0.25 * d2.r;
  float lines = max(rays(vW.xz, uCompass.xy), rays(vW.xz, uCompass.zw));
  c = mix(c, uInk, lines * 0.14);
  vec2 ra = rose(vW.xz, uCompass.xy);
  vec2 rb = rose(vW.xz, uCompass.zw);
  vec2 rr = max(ra, rb);
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

export const SOFT = { wash: 0, reach: 1, attack: 2, ring: 3, territory: 4, glow: 5, shadow: 6 } as const;

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
    // Reachable: a gentle raised tint with a bright soft rim.
    a *= 0.45 + 0.55 * smoothstep(0.55, 0.98, hx);
    c = mix(c, vec3(1.0), smoothstep(0.9, 1.0, hx) * 0.6);
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
  } else {
    float s = 1.0 - smoothstep(0.15, 1.0, rc);
    a *= s * s;
    c = uShadow;
  }
  if (a < 0.004) discard;
  a *= 1.0 - vInst.x * 0.4;
  gl_FragColor = linearToOutputTexel(vec4(c, clamp(a, 0.0, 1.0)));
}`;
  return make('diorama-soft', u, FLAT_VERT, frag, { transparent: true, polygonOffset });
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
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p * vec2(1.0, 0.8));
  float v = smoothstep(0.32, 0.85, r) * uStrength;
  float top = smoothstep(0.55, 1.0, vUv.y) * 0.22;
  vec3 c = mix(uVig, uSkyTint, top / max(0.001, v + top));
  gl_FragColor = linearToOutputTexel(vec4(c, clamp(v + top, 0.0, 1.0)));
}`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  return m;
};
