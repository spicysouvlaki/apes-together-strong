/**
 * Tuning constants for the emergence engine (GDD §3, §4, §6). First-pass values; the M2
 * emergence check (tests/emergence.check.test.ts) and the gp pacing test lock their intent:
 * a focused player reaches ~100 affinity in their main culture by mid-age, the first offer
 * arrives around turn 8, and a normal player sees roughly 8–12 offers per ~50-turn age.
 */
import type { ActivateEffect, Age, FigureKind, YieldType } from '@contracts/content-schemas';

// --- Affinity (GDD §4 "Affinity engine") ---

/** A[c] ← DECAY · A[c] + gain. */
export const AFFINITY_DECAY = 0.98;
/**
 * Global multiplier on Σ w·x. Signals count dozens of tiles, so raw sums are large; this
 * keeps signal weights in content readable (≈1 per tile) while hitting ~100 by mid-age.
 */
export const AFFINITY_SCALE = 0.07;
/** Hint thresholds, in order. `hintsShown[c]` stores the highest one already fired. */
export const HINT_THRESHOLDS = [50, 100] as const;
/** Below this affinity an offer reason uses the "wanderer" fallback. */
export const REASON_MIN_AFFINITY = 3;

// --- Great-people points (GDD §4 "Great-people points") ---

export const GP_START_THRESHOLD = 60;
export const GP_THRESHOLD_GROWTH = 1.4;
/**
 * Onboarding (GDD §11: "first figure offer scripted early (~turn 8)"): on this turn, a player
 * who has never had a points offer gets one from their fullest pool even below threshold.
 */
export const FIRST_OFFER_TURN = 8;
/**
 * A pool banks at most this many times its threshold. Points keep accruing while a pool has
 * no eligible figures or offers are capped; without a ceiling they would flood the next age.
 */
export const GP_BANK_MAX_THRESHOLDS = 2;
/** Skipping an offer returns this share of the pool's (new) threshold as points. */
export const SKIP_REFUND_SHARE = 0.25;
/** Points every pool gets per turn while the player has a settlement (the court's renown). */
export const GP_BASE_PER_POOL = 1.1;
/**
 * Global multiplier on the play-derived points below. Autoplay balance pass: at 1, AI
 * players saw 10–14 offers in a ~50-turn ancient age (target ~8, GDD §4) because real
 * empires out-produce the scripted scenario of tests/emergence.check.test.ts.
 */
export const GP_SCALE = 0.55;
/**
 * Multiplier per age on play-derived and building/wonder points (not the base). Yields and
 * buildings multiply each age while thresholds only grow per offer, so without this the
 * classical age produced ~2× the offers of the ancient one (autoplay: 13–20 per AI).
 * Keeps every age near the same offer count.
 */
export const GP_AGE_SCALE: Record<Age, number> = { ancient: 1, classical: 0.4, exploration: 0.3, modern: 0.25 };
export const GP_MILITARY_PER_UNIT = 0.4;
export const GP_MILITARY_PER_BATTLE_WON = 3;
export const GP_MILITARY_PER_CITY_CAPTURED = 8;
export const GP_STATESMAN_PER_SETTLEMENT = 0.45;
export const GP_STATESMAN_PER_INFLUENCE = 0.4;
export const GP_STATESMAN_PER_CULTURE = 0.15;
export const GP_THOUGHT_PER_SCIENCE = 0.25;
export const GP_FAITH_PER_FAITH = 0.45;
export const GP_BUILDING_PER_PRODUCTION = 0.1;
/** Multiplier on building/wonder `gp` values (they are already per-turn points). */
export const GP_PER_BUILDING_POINT = 1;
export const GP_EXPLORATION_PER_EXPLORED_PERCENT = 0.04;
export const GP_EXPLORATION_PER_SCOUT = 0.8;
export const GP_EXPLORATION_PER_TRADE_ROUTE = 1;
export const GP_EXPLORATION_PER_COASTAL = 0.4;

// --- Offers (GDD §4 "Offer generation") ---

export const OFFER_CANDIDATES = 3;
/** Weight = (A + OFFER_WEIGHT_BASE) ^ OFFER_WEIGHT_EXPONENT. */
export const OFFER_WEIGHT_BASE = 5;
export const OFFER_WEIGHT_EXPONENT = 1.5;
/** ×2 when the player is suzerain of, or trades with, a settlement of that culture. */
export const PARTNER_WEIGHT_MULT = 2;
/** The draw guarantees one candidate from the player's top N affinity cultures. */
export const TOP_CULTURES_GUARANTEED = 3;
/** Points-offers (incl. legends) a player may have open at once; further points bank. */
export const MAX_OPEN_OFFERS = 2;

// --- Legend slot (GDD §3: one per age) ---

/** Legend offer once total affinity across cultures reaches this... */
export const LEGEND_TOTAL_AFFINITY = 300;
/** ...or the player has recruited this many figures in the current age. */
export const LEGEND_FIGURES_THIS_AGE = 4;

// --- Figures (GDD §3 "Figure states and actions") ---

export const CABINET_COOLDOWN_TURNS = 2;
export const RECRUIT_AGE_PROGRESS = 0.5;
/** Consume-for-yields: a burst of the figure's main yield lasting this many turns. */
export const CONSUME_BURST_TURNS = 10;
/** Per-turn burst = consumeValue × this. */
export const CONSUME_BURST_PER_VALUE = 2;
/** Hall of Ancestors: per retired figure, per turn. */
export const ANCESTOR_YIELD = 1;
/** Culture weight: +1 per this many seated turns (GDD §6). */
export const SEATED_TURNS_PER_WEIGHT = 10;
/** Hit points a figure-unit keeps after retreating from a lost battle. */
export const FIGURE_RETREAT_HP = 1;
export const MAX_UNIT_HP = 100;

/** Main yield by kind: Hall of Ancestors income and consume-for-yields bursts. */
export const MAIN_YIELD: Record<FigureKind, YieldType> = {
  general: 'production',
  statesman: 'gold',
  thinker: 'science',
  spiritual: 'faith',
  builder: 'production',
  explorer: 'gold',
  legend: 'culture',
};

/** Used when a figure's `activate.amount` is omitted. */
export const ACTIVATE_DEFAULT_AMOUNT: Record<ActivateEffect, number> = {
  rush_wonder: 50,
  production_burst: 40,
  culture_burst: 40,
  science_burst: 40,
  gold_burst: 60,
  faith_burst: 40,
  influence_burst: 30,
  explore_reveal: 4,
  free_unit: 1,
  heal_units: 50,
  grow_city: 1,
};

/**
 * Minimum turns between two deed offers to the same player. Deeds count lifetime stats, so
 * several can already be met when an age starts; spacing keeps them story beats, not a flood.
 */
export const DEED_SPACING_TURNS = 8;
