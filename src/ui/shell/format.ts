/**
 * Display helpers for the shell: stand-in Unicode glyphs (CLAUDE.md "Art for now"), number
 * formatting, age names. Pure.
 */
import type { Age, YieldType } from '@contracts/content-schemas';

export const YIELD_GLYPH: Record<YieldType, string> = {
  food: '❦',
  production: '⚒',
  gold: '◉',
  science: '⚗',
  culture: '✿',
  faith: '☼',
  happiness: '☺',
  influence: '✉',
};

export const YIELD_NAME: Record<YieldType, string> = {
  food: 'Food',
  production: 'Production',
  gold: 'Gold',
  science: 'Science',
  culture: 'Culture',
  faith: 'Faith',
  happiness: 'Happiness',
  influence: 'Influence',
};

/** Stockpiles shown in the top bar, in order. */
export const HUD_YIELDS: readonly YieldType[] = ['gold', 'science', 'culture', 'faith', 'influence'];

export const AGE_NAME: Record<Age, string> = {
  ancient: 'Ancient',
  classical: 'Classical',
  exploration: 'Exploration',
  modern: 'Modern',
};

/** One decimal at most, no trailing ".0". */
export const num = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

export const signed = (n: number): string => (n >= 0 ? `+${num(n)}` : num(n));

/** Thresholds from GDD §7: ≥10 celebration, <0 penalties, < −10 unrest. */
export const happinessFace = (h: number): string => (h >= 10 ? '😄' : h >= 0 ? '🙂' : h > -10 ? '😟' : '😠');

export const happinessWord = (h: number): string =>
  h >= 10 ? 'Celebrating' : h >= 0 ? 'Content' : h > -10 ? 'Unhappy' : 'Unrest';

export const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export const turnsText = (t: number | null): string => (t === null ? '—' : t === 1 ? '1 turn' : `${t} turns`);
