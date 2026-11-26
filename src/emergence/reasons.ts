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

export type ReasonFamily = 'land' | 'goods' | 'towns' | 'arms' | 'ties' | 'learning';

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
  faithIncome: 'learning',
  wondersBuilt: 'learning',
  exploredPercent: 'learning',
};

/** `{h}` is the signal hint ("your herds"). Every phrase must read after "X joined the court, ". */
export const REASON_TEMPLATES: Record<ReasonFamily, readonly string[]> = {
  land: ['drawn by {h}', 'following tales of {h}', 'curious to see {h} with their own eyes'],
  goods: ['drawn by {h}', 'following word of {h}', 'come for {h} and minded to stay'],
  towns: ['drawn by {h}', 'seeking a place in {h}', 'having heard of {h} from passing traders'],
  arms: ['drawn by {h}', 'stirred by the songs of {h}', 'drawn by tales of {h}'],
  ties: ['drawn by {h}', 'arriving in the wake of {h}', 'won over by {h}'],
  learning: ['drawn by {h}', 'inspired by {h}', 'come to learn from {h}'],
};

export const WANDERER_REASONS = [
  'a wanderer who heard of your people',
  'a traveller seeking a new home',
  'a stranger drawn by rumours of your people',
] as const;
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
