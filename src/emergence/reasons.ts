/**
 * Offer reasons (GDD §4 "on each offer card, why the figure came"). A reason is a short
 * participle phrase in the second person ("drawn by your herds"), shown on the offer card and
 * rephrased into the Chronicle by `annalVoice`. It is built only from content strings (signal
 * hints), never numbers, so it cannot leak affinity.
 *
 * Variety: each signal family has several phrasings; the pick is a pure hash of the current
 * RNG state and the figure id, so it is deterministic without consuming random draws.
 */
import type { SignalMeasure } from '@contracts/content-schemas';
import type { FigureId, GameState } from '@contracts/sim-api';

export type ReasonFamily = 'land' | 'goods' | 'towns' | 'arms' | 'ties' | 'learning' | 'works' | 'faith';

export const REASON_FAMILY: Record<SignalMeasure, ReasonFamily> = {
  ownedTerrain: 'land',
  ownedFeature: 'land',
  ownedClimate: 'land',
  ownedResource: 'goods',
  goldIncome: 'goods',
  coastalSettlements: 'towns',
  riverSettlements: 'towns',
  settlementCount: 'towns',
  totalPopulation: 'towns',
  unitsOfClass: 'arms',
  unitsTotal: 'arms',
  battlesWonThisTurn: 'arms',
  citiesCapturedThisTurn: 'arms',
  tradeRoutes: 'ties',
  tradeRoutesWithCulture: 'ties',
  suzerainOfCulture: 'ties',
  envoysSent: 'ties',
  techsResearched: 'learning',
  scienceIncome: 'learning',
  cultureIncome: 'learning',
  faithIncome: 'faith',
  wondersBuilt: 'works',
  exploredPercent: 'learning',
};

/**
 * `{h}` is the signal hint ("your herds"). Every phrase must read both on the offer card and
 * after "X joined the court, " (wave 11: "joined the court, come to learn from…" did not), so
 * each is a participle phrase that can stand after a comma.
 */
export const REASON_TEMPLATES: Record<ReasonFamily, readonly string[]> = {
  land: ['drawn by {h}', 'following tales of {h}', 'curious to see {h} with their own eyes'],
  goods: ['drawn by {h}', 'following word of {h}', 'lured by {h} and minded to stay'],
  towns: ['drawn by {h}', 'seeking a place in {h}', 'having heard of {h} from passing traders'],
  arms: ['drawn by {h}', 'stirred by the songs of {h}', 'drawn by tales of {h}'],
  ties: ['drawn by {h}', 'arriving in the wake of {h}', 'won over by {h}'],
  learning: ['drawn by {h}', 'inspired by {h}', 'eager to learn from {h}'],
  // Wave 13: "eager to learn from your monument" read oddly; wonders and temples get their own.
  works: ['drawn by {h}', 'travelling to marvel at {h}', 'inspired by {h}'],
  faith: ['drawn by {h}', 'called by {h}', 'seeking the quiet of {h}'],
};

/** Last resort: no signal the player has adds to the figure's culture (offers.ts `offerReason`). */
export const WANDERER_REASONS = [
  'a wanderer who heard of your people',
  'a traveller seeking a new home',
  'a stranger drawn by rumours of your people',
] as const;
/** Age-opening offers recall the hint that promised them (offers.ts `offerAgeOpening`). */
export const AGE_OPENING_REASON = 'arriving at last, drawn by the old tales of {h}';
export const PARTNER_REASONS = ['drawn by your ties with their people', 'sent by kin who know your people well'] as const;
export const TALES_REASONS = ['drawn by the tales of your people', 'drawn by stories told of your people'] as const;

/** Deterministic index in [0, n) from the RNG state and a figure id; never advances the RNG. */
export const reasonIndex = (state: GameState, figure: FigureId, n: number): number => {
  let h = (state.rng[0] ^ Math.imul(state.rng[2], 0x9e3779b1)) >>> 0;
  for (let i = 0; i < figure.length; i++) h = Math.imul(h ^ figure.charCodeAt(i), 0x01000193) >>> 0;
  return n > 0 ? h % n : 0;
};

export const pickPhrase = (state: GameState, figure: FigureId, options: readonly string[]): string =>
  options[reasonIndex(state, figure, options.length)] ?? options[0] ?? '';

/** "drawn by your herds" or, with a second hint, "drawn by your herds and your open grasslands". */
export const signalReason = (state: GameState, figure: FigureId, measure: SignalMeasure, hint: string, second: string | null): string => {
  const template = pickPhrase(state, figure, REASON_TEMPLATES[REASON_FAMILY[measure]]);
  return template.replace('{h}', second ? `${hint} and ${second}` : hint);
};

/** Measures that count things (tiles, towns, units, routes...), so their hint has a number. */
const COUNT_MEASURES: ReadonlySet<SignalMeasure> = new Set<SignalMeasure>([
  'ownedTerrain',
  'ownedFeature',
  'ownedResource',
  'ownedClimate',
  'coastalSettlements',
  'riverSettlements',
  'settlementCount',
  'unitsOfClass',
  'unitsTotal',
  'battlesWonThisTurn',
  'citiesCapturedThisTurn',
  'tradeRoutes',
  'tradeRoutesWithCulture',
  'envoysSent',
  'wondersBuilt',
  'techsResearched',
]);

/** "towns" -> "town", "victories" -> "victory", "marshes" -> "marsh", "oases" -> "oasis". */
export const singularWord = (w: string): string => {
  if (/ases$/.test(w)) return `${w.slice(0, -4)}asis`;
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/(ch|sh|ss|x)es$/.test(w)) return w.slice(0, -2);
  if (/[^s]s$/.test(w)) return w.slice(0, -1);
  return w;
};

/** The hint with its last word made singular ("your hill towns" -> "your hill town"). */
export const singularHint = (hint: string): string => {
  const i = hint.lastIndexOf(' ');
  return i < 0 ? singularWord(hint) : `${hint.slice(0, i + 1)}${singularWord(hint.slice(i + 1))}`;
};

/**
 * May this signal be cited as a reason? (Playtest 3: reasons must never name something the
 * player does not have.) Its measured amount must be positive; "your many towns" needs two
 * towns or more; "your explorers" needs a real share of the world charted.
 */
export const REASON_MIN_EXPLORED_PERCENT = 15;
export const citable = (measure: SignalMeasure, amount: number): boolean => {
  if (!(amount > 0)) return false;
  if (measure === 'settlementCount') return amount >= 2;
  if (measure === 'exploredPercent') return amount >= REASON_MIN_EXPLORED_PERCENT;
  return true;
};

/**
 * Number-aware hint (playtest 3: "your hill towns" for a player with one town). A count
 * measure of exactly one, or a hint about towns or cities when the player has a single
 * settlement, reads in the singular.
 */
export const numberedHint = (hint: string, measure: SignalMeasure, amount: number, settlements: number): string => {
  const last = hint.slice(hint.lastIndexOf(' ') + 1);
  const aboutTowns = /^(towns|cities|harbors)$/.test(last);
  if ((COUNT_MEASURES.has(measure) && amount < 1.5) || (aboutTowns && settlements <= 1)) return singularHint(hint);
  return hint;
};
