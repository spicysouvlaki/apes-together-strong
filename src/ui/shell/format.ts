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
  science: 'researches technologies; each turn’s science goes straight into the tech tree',
  culture: 'studies civics; each turn’s culture goes straight into the civic tree',
  faith: 'spiritual strength; draws spiritual figures',
  happiness: 'content people work harder; unrest hurts',
  influence: 'sends envoys to city-states',
};

/** Legend order: city yields first, then the empire-wide ones. */
export const LEGEND_YIELDS: readonly YieldType[] = ['food', 'production', 'gold', 'science', 'culture', 'faith', 'influence', 'happiness'];

/** Stockpiles shown in the top bar, in order. */
export const HUD_YIELDS: readonly YieldType[] = ['gold', 'science', 'culture', 'faith', 'influence'];

/**
 * Yields the HUD shows as a rate, not a stockpile (wave 13 playtest: "science 412" grew without
 * limit and with no visible use). The sim adds each turn's science and culture straight to the
 * tech and civic trees (sim/turn.ts advanceResearch); nothing ever spends their stock. Gold, faith
 * (drained into faith great-people points) and influence are spent, so they keep their stock.
 */
export const RATE_YIELDS: ReadonlySet<YieldType> = new Set(['science', 'culture']);
export const isRateYield = (y: YieldType): boolean => RATE_YIELDS.has(y);

export const AGE_NAME: Record<Age, string> = {
  ancient: 'Ancient',
  classical: 'Classical',
  exploration: 'Exploration',
  modern: 'Modern',
};

const group = (n: number): string => {
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? `-${s}` : s;
};

/** One decimal at most, no trailing ".0"; whole numbers from 100 up, grouped from 1,000 up. */
export const num = (n: number): string => {
  if (Math.abs(n) >= 100) return group(Math.round(n));
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/** Stockpiles in the top bar's narrow columns: 9,999 then 12.3k. */
export const hudNum = (n: number): string => {
  const a = Math.abs(n);
  if (a < 10000) return group(Math.round(n));
  const k = Math.round(n / 100) / 10;
  return `${a >= 100000 ? Math.round(n / 1000) : k}k`;
};

export const signed = (n: number): string => (n >= 0 ? `+${num(n)}` : num(n));

/** Thresholds from GDD §7: ≥10 celebration, <0 penalties, < −10 unrest. */
export const happinessIcon = (h: number): IconName => (h >= 10 ? 'moodHigh' : h >= 0 ? 'moodOk' : h > -10 ? 'moodLow' : 'moodBad');

export const happinessWord = (h: number): string =>
  h >= 10 ? 'Celebrating' : h >= 0 ? 'Content' : h > -10 ? 'Unhappy' : 'Unrest';

export const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export const turnsText = (t: number | null): string => (t === null ? '—' : t === 1 ? '1 turn' : `${t} turns`);

/** "grows in 3 turns" / "not growing" / "starving" for the city sheet's growth line. */
export const growthText = (stored: number, cost: number, surplus: number): string => {
  if (surplus < 0) return 'starving';
  if (surplus === 0) return 'not growing';
  const turns = Math.max(1, Math.ceil((cost - stored) / surplus));
  return `grows in ${turns} ${turns === 1 ? 'turn' : 'turns'}`;
};
