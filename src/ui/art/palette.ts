/**
 * Culture art palette. Pure. Cosmetic only, so it lives with the UI rather than in content.
 *
 * Art is keyed by a culture's `architecture` style from content/cultures.json (the same key the
 * renderer uses for settlement motif kits), never by culture id, so a new culture with a known
 * style gets art for free and an unknown style still gets a stable, hashed look.
 */
export type ArtStyle = 'nile' | 'aegean' | 'sinic' | 'arabian' | 'nordic' | 'arctic' | 'steppe' | 'iberian' | 'generic';

export const ART_STYLES: readonly ArtStyle[] = ['nile', 'aegean', 'sinic', 'arabian', 'nordic', 'arctic', 'steppe', 'iberian'];

/** Earth and mineral pigments, distinct from one another and legible under paper-light text. */
const STYLE_COLOR: Record<Exclude<ArtStyle, 'generic'>, string> = {
  nile: '#a97a26', // Egyptian ochre-gold
  aegean: '#2f5288', // lapis
  sinic: '#b0432c', // cinnabar
  arabian: '#2c6b56', // malachite
  nordic: '#674683', // whortleberry
  arctic: '#3a7b8e', // sea ice
  steppe: '#6a7030', // steppe olive
  iberian: '#822a3e', // carmine
};

export const artStyleOf = (architecture: string | undefined): ArtStyle =>
  architecture && (ART_STYLES as readonly string[]).includes(architecture) ? (architecture as ArtStyle) : 'generic';

/** FNV-1a: stable 32-bit hash of a string (used for every seeded art choice). */
export const hashString = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** A tiny seeded generator for art choices (UI only, never the sim's RNG). */
export const artRng = (seed: string): (() => number) => {
  let a = hashString(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hsl = (h: number, s: number, l: number): string => `hsl(${Math.round(h)} ${s}% ${l}%)`;

/** Main pigment for a culture (field of its crest and portrait medallions). */
export const styleColor = (style: ArtStyle, cultureId: string): string =>
  style === 'generic' ? hsl(hashString(cultureId) % 360, 38, 38) : STYLE_COLOR[style];

/** Parse '#rrggbb' or 'hsl(h s% l%)' into rgb 0..255. */
export const toRgb = (color: string): [number, number, number] => {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1] ?? '0', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /^hsl\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\)$/.exec(color);
  if (m) {
    const h = Number(m[1]) / 360;
    const s = Number(m[2]) / 100;
    const l = Number(m[3]) / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t: number): number => {
      const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
      if (x < 1 / 6) return p + (q - p) * 6 * x;
      if (x < 1 / 2) return q;
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
      return p;
    };
    return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
  }
  return [128, 128, 128];
};

const toHex = ([r, g, b]: [number, number, number]): string =>
  `#${[r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;

/** Mix two colors (t = 0 → a, 1 → b). */
export const mix = (a: string, b: string, t: number): string => {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
};

export const PAPER = '#efe3c8';
export const PAPER_HI = '#f8f0dc';
export const INK = '#2b2118';
export const GOLD = '#c79a3d';

/** Relative luminance (WCAG), for picking ink or paper text over a color. */
export const luminance = (color: string): number => {
  const [r, g, b] = toRgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Ink on light colors, paper on dark ones. */
export const textOn = (color: string): string => (luminance(color) > 0.33 ? INK : PAPER_HI);

/** The full set of tones a culture's art uses. */
export interface CultureTones {
  base: string;
  deep: string;
  light: string;
  tint: string;
}

export const cultureTones = (style: ArtStyle, cultureId: string): CultureTones => {
  const base = styleColor(style, cultureId);
  return { base, deep: mix(base, INK, 0.45), light: mix(base, PAPER_HI, 0.55), tint: mix(base, PAPER_HI, 0.82) };
};
