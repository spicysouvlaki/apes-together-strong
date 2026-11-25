/**
 * Colorblind ownership patterns (GDD §11 accessibility: "ownership never relies on hue alone").
 * Each owner gets a pattern id; the border shader and flag shader cut the owner's color with
 * it, and the label swatch draws it. Pure.
 */
import { CITY_STATE_PREFIX, RAIDER_PLAYER } from '@contracts/sim-api';

export const PATTERN = {
  solid: 0,
  dash: 1,
  dots: 2,
  dashDot: 3,
  double: 4,
  zigzag: 5,
  ladder: 6,
} as const;
export type PatternId = (typeof PATTERN)[keyof typeof PATTERN];

/** Player patterns by turn-order index (cycled past 5 players, which the game doesn't allow). */
export const PLAYER_PATTERNS: readonly PatternId[] = [PATTERN.solid, PATTERN.dash, PATTERN.dots, PATTERN.dashDot, PATTERN.ladder];
export const CITY_STATE_PATTERN: PatternId = PATTERN.double;
export const RAIDER_PATTERN: PatternId = PATTERN.zigzag;

export const patternFor = (owner: string | null, playerOrder: readonly string[]): PatternId => {
  if (owner === null) return PATTERN.solid;
  if (owner.startsWith(CITY_STATE_PREFIX)) return CITY_STATE_PATTERN;
  if (owner === RAIDER_PLAYER) return RAIDER_PATTERN;
  const i = playerOrder.indexOf(owner);
  if (i < 0) return PATTERN.solid;
  return PLAYER_PATTERNS[i % PLAYER_PATTERNS.length] ?? PATTERN.solid;
};

/**
 * Whether a point of a border band is painted, for pattern `p`. `t` = distance along the edge
 * (world units), `u` = 0..1 across the band (0 = outer edge). Mirrors the GLSL in
 * scene/pattern-material.ts so tests can check the patterns differ.
 */
export const patternKeep = (p: PatternId, t: number, u: number): boolean => {
  const fract = (v: number): number => v - Math.floor(v);
  switch (p) {
    case PATTERN.solid:
      return true;
    case PATTERN.dash:
      return fract(t * 3.2) < 0.62;
    case PATTERN.dots: {
      const c = fract(t * 4.5) - 0.5;
      return c * c * 4 + (u - 0.5) * (u - 0.5) * 4 < 0.75;
    }
    case PATTERN.dashDot: {
      const f = fract(t * 2.2);
      return f < 0.5 || (f > 0.68 && f < 0.82);
    }
    case PATTERN.double:
      return u < 0.36 || u > 0.64;
    case PATTERN.zigzag: {
      const tri = Math.abs(fract(t * 3.5) * 2 - 1);
      return Math.abs(u - tri) < 0.38;
    }
    case PATTERN.ladder:
      return u < 0.3 || fract(t * 5) < 0.4;
  }
  return true;
};

/** GLSL twin of `patternKeep` (keep in sync). */
export const PATTERN_GLSL = /* glsl */ `
bool patternKeep(float p, float t, float u) {
  if (p < 0.5) return true;
  if (p < 1.5) return fract(t * 3.2) < 0.62;
  if (p < 2.5) { float c = fract(t * 4.5) - 0.5; return c * c * 4.0 + (u - 0.5) * (u - 0.5) * 4.0 < 0.75; }
  if (p < 3.5) { float f = fract(t * 2.2); return f < 0.5 || (f > 0.68 && f < 0.82); }
  if (p < 4.5) return u < 0.36 || u > 0.64;
  if (p < 5.5) { float tri = abs(fract(t * 3.5) * 2.0 - 1.0); return abs(u - tri) < 0.38; }
  return u < 0.3 || fract(t * 5.0) < 0.4;
}`;
