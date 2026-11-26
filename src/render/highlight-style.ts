/**
 * Selection overlay colors (GDD §11 readability). Pure: the shader (scene/materials softMaterial
 * mode SOFT.reach) bakes these in, and tests check them against every graded terrain color.
 *
 * Playtest 3: the reachable-tile tint (a cream wash at 50%) vanished on light desert, snow and
 * next to the parchment. The reach highlight is now three tones that cannot all disappear on any
 * ground: a dark ink keyline just inside the hex edge, a bright glint line inside that, and a
 * violet wash with a slow sheen. Dark + light outline means contrast against both pale and
 * dark terrain. The wash is a soft periwinkle-violet: no terrain, water, route ribbon (cream/ink),
 * attack (red) or settle seal (gold) is near it (an aqua wash vanished on coast water).
 */
import { mix, parseHexColor, type Rgb } from './colors';
import { deltaE, rgbToLab } from './terrain-style';

export const REACH_STYLE = {
  /** Keyline just inside the hex edge. */
  ink: '#1a1538',
  /** Bright line inside the keyline. */
  glint: '#f6f3ff',
  /** Inner wash (instance color). */
  wash: '#9f86ff',
  /** Wash opacity at rest (the sheen adds a little). */
  washAlpha: 0.34,
  inkAlpha: 0.92,
  glintAlpha: 0.88,
} as const;

/** Other overlays the reach highlight must not be confused with. */
export const OVERLAY_COLORS = {
  attack: '#e0453a',
  route: '#fffaf0',
  routeInk: '#24180f',
  siteGold: '#f2c14e',
} as const;

/** sRGB 0..1 as a GLSL vec3 literal (shader constants). */
export const glslVec3 = (hex: string): string => {
  const c = parseHexColor(hex);
  return `vec3(${c[0].toFixed(4)}, ${c[1].toFixed(4)}, ${c[2].toFixed(4)})`;
};

/** Over-composite `top` at opacity `a` onto `ground`. */
export const over = (ground: Rgb, top: Rgb, a: number): Rgb => mix(ground, top, a);

/**
 * How clearly the reach highlight reads on a ground color: the best of the keyline / glint
 * contrast (CIE76 ΔE, composited at their opacities) and the wash's shift of the ground itself.
 */
export const reachContrast = (ground: Rgb): { outline: number; wash: number } => {
  const g = rgbToLab(ground);
  const ink = deltaE(g, rgbToLab(over(ground, parseHexColor(REACH_STYLE.ink), REACH_STYLE.inkAlpha)));
  const glint = deltaE(g, rgbToLab(over(ground, parseHexColor(REACH_STYLE.glint), REACH_STYLE.glintAlpha)));
  const wash = deltaE(g, rgbToLab(over(ground, parseHexColor(REACH_STYLE.wash), REACH_STYLE.washAlpha)));
  return { outline: Math.max(ink, glint), wash };
};
