/**
 * Pure color logic for the renderer: parsing, owner colors, fog classification and the
 * per-tile color the instanced meshes receive. Colors are sRGB triples in [0, 1]; the scene
 * converts them to linear when writing instance colors.
 */
import { CITY_STATE_PREFIX, RAIDER_PLAYER, type GameState, type PlayerId } from '@contracts/sim-api';

export type Rgb = [number, number, number];

export const parseHexColor = (hex: string, fallback: Rgb = [1, 0, 1]): Rgb => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || m[1] === undefined) return [fallback[0], fallback[1], fallback[2]];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const rgbToHex = (c: Rgb): string =>
  '#' +
  c
    .map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0'))
    .join('');

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export const luminance = (c: Rgb): number => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/** Pull toward grey by `amount` (0 = unchanged, 1 = fully grey) then scale brightness. */
export const desaturate = (c: Rgb, amount: number, brightness = 1): Rgb => {
  const l = luminance(c);
  const g: Rgb = [l, l, l];
  const m = mix(c, g, amount);
  return [m[0] * brightness, m[1] * brightness, m[2] * brightness];
};

// --- Palette (render-only stand-in colors; terrain colors come from content) -------------

export const PALETTE = {
  background: '#f3ede1',
  parchment: '#e9dfc8',
  parchmentSide: '#d8caa8',
  soil: '#8a6a4a',
  waterSide: '#4f8396',
  river: '#6fa8c8',
  /** River ribbons: saturated so they read over every land color. */
  riverRibbon: '#2f86c6',
  forest: '#4f7d42',
  jungle: '#2f8a4c',
  marsh: '#7fa392',
  oasis: '#4fb3a8',
  hills: '#a99c6c',
  snowCap: '#f4f6f7',
  houseWall: '#efe6d4',
  gold: '#d9a933',
  hpBack: '#3b3b3b',
  hpGood: '#5cbf4a',
  hpMid: '#e3c13b',
  hpLow: '#d9493b',
  select: '#ffffff',
  selectUnit: '#ffd65a',
  reachable: '#ffffff',
  reachableRing: '#1d5fbf',
  attackable: '#e0453a',
  path: '#ffffff',
  pathBack: '#1f2a36',
  /** Dark keyline under border bands so light owner colors (yellow, white) read on light land. */
  borderKeyline: '#23201c',
  ownRim: '#ffffff',
  rivalRim: '#2a2522',
  warRim: '#e0453a',
  ready: '#fff4b8',
  shield: '#d6dde6',
  wallStone: '#cdbfa6',
  wallDamaged: '#d9493b',
  resourceBadge: '#fffaf0',
  tradeRoute: '#fff2c4',
} as const;

// --- Owner colors ----------------------------------------------------------------------------

export interface OwnerColors {
  primary: string;
  secondary: string;
}

/**
 * City-states: neutral warm grey so they never read as a rival empire; raiders: dark red.
 * Both are kept far (CIELAB) from every banner color (tests/render-style.test.ts).
 */
export const CITY_STATE_COLORS: OwnerColors = { primary: '#9c9a96', secondary: '#f1efe9' };
/** Crisis raiders (GDD §5): dark red. */
export const RAIDER_COLORS: OwnerColors = { primary: '#7a1e1e', secondary: '#2a2222' };
/** An owner id we can't resolve (stale snapshot, removed player). */
export const UNKNOWN_COLORS: OwnerColors = { primary: '#777777', secondary: '#dddddd' };

export const ownerColors = (state: Pick<GameState, 'players'>, owner: PlayerId | null): OwnerColors => {
  if (owner === null) return UNKNOWN_COLORS;
  if (owner.startsWith(CITY_STATE_PREFIX)) return CITY_STATE_COLORS;
  if (owner === RAIDER_PLAYER) return RAIDER_COLORS;
  const p = state.players[owner];
  return p ? p.colors : UNKNOWN_COLORS;
};

// --- Fog of war -------------------------------------------------------------------------------

export const FOG_UNEXPLORED = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;
export type FogClass = typeof FOG_UNEXPLORED | typeof FOG_EXPLORED | typeof FOG_VISIBLE;

/**
 * Build the per-tile fog classes for a viewer into `out` (reused across calls).
 * viewer null => everything visible (debug reveal).
 */
export const classifyFog = (
  tileCount: number,
  explored: readonly number[] | null,
  visible: readonly number[],
  out: Uint8Array,
): Uint8Array => {
  if (explored === null) {
    out.fill(FOG_VISIBLE, 0, tileCount);
    return out;
  }
  for (let i = 0; i < tileCount; i++) out[i] = explored[i] ? FOG_EXPLORED : FOG_UNEXPLORED;
  for (const i of visible) if (i >= 0 && i < tileCount) out[i] = FOG_VISIBLE;
  return out;
};

/** Explored-but-not-visible look: muted and slightly darker, never confused with parchment. */
export const fogged = (c: Rgb): Rgb => desaturate(c, 0.5, 0.8);

/** Explored water stays recognisably blue (land/water must read apart even in memory). */
export const foggedWater = (c: Rgb): Rgb => desaturate(c, 0.25, 0.82);

/**
 * Final top color of a tile. Unexplored tiles are parchment (no terrain hint); explored ones
 * are dimmed; rivers tint the top slightly blue.
 */
export const tileTopColor = (terrainColor: Rgb, river: boolean, fog: FogClass, water = false): Rgb => {
  if (fog === FOG_UNEXPLORED) return parseHexColor(PALETTE.parchment);
  // Rivers are drawn as ribbons now; the tile keeps only a faint wet tint.
  const base = river ? mix(terrainColor, parseHexColor(PALETTE.river), 0.1) : terrainColor;
  if (fog !== FOG_EXPLORED) return base;
  return water ? foggedWater(base) : fogged(base);
};

/** Color for features/props drawn on a tile with the given fog class (unexplored: hidden). */
export const propColor = (c: Rgb, fog: FogClass): Rgb => (fog === FOG_EXPLORED ? fogged(c) : c);

// --- Resources --------------------------------------------------------------------------------

/** FNV-1a 32-bit; stable across platforms. */
export const hashString = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

export const hslToRgb = (h: number, s: number, l: number): Rgb => {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
};

/** The resource list is data and growing, so marker colors are hashed from the id. */
export const resourceColor = (id: string): Rgb => hslToRgb(hashString(id) % 360, 0.72, 0.55);
