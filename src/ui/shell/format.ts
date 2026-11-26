/**
 * Display helpers for the shell: yield icons (src/ui/art/icons-data.ts), number formatting,
 * age names. Pure.
 */
import type { Age, YieldType } from '@contracts/content-schemas';
import type { IconName } from '../art/icons-data';

/** Each yield's drawing in the icon set (named the same as the yield). */
export const YIELD_ICON: Record<YieldType, IconName> = {
  food: 'food',
  production: 'production',
  gold: 'gold',
  science: 'science',
  culture: 'culture',
  faith: 'faith',
  happiness: 'happiness',
  influence: 'influence',
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

/** One-line meaning of each yield for the legend (plain words, no numbers: those live in content). */
export const YIELD_HELP: Record<YieldType, string> = {
  food: 'grows your cities',
  production: 'builds units, buildings and wonders',
  gold: 'buys items, upgrades towns, pays upkeep',
  science: 'researches technologies',
  culture: 'adopts civics',
  faith: 'spiritual strength; draws spiritual figures',
  happiness: 'content people work harder; unrest hurts',
  influence: 'sends envoys to city-states',
};

/** Legend order: city yields first, then the empire-wide ones. */
export const LEGEND_YIELDS: readonly YieldType[] = ['food', 'production', 'gold', 'science', 'culture', 'faith', 'influence', 'happiness'];

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
export const happinessIcon = (h: number): IconName => (h >= 10 ? 'moodHigh' : h >= 0 ? 'moodOk' : h > -10 ? 'moodLow' : 'moodBad');

export const happinessWord = (h: number): string =>
  h >= 10 ? 'Celebrating' : h >= 0 ? 'Content' : h > -10 ? 'Unhappy' : 'Unrest';

export const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export const turnsText = (t: number | null): string => (t === null ? '—' : t === 1 ? '1 turn' : `${t} turns`);
