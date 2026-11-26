/**
 * Named tuning constants for the sim core. All numbers are first-pass values (docs/GDD.md
 * "All numbers are first-pass tuning values"). Content-specific numbers live in content/*.json;
 * these are rule-level knobs that no single content entry owns.
 */
import type { Age, YieldType, Yields } from '@contracts/content-schemas';
import type { Difficulty } from '@contracts/sim-api';

// --- Settlements (GDD §7 "Settlements") -------------------------------------

/** No settlement may be founded within this distance of another (so the minimum gap is 4). */
export const MIN_SETTLEMENT_DISTANCE = 3;
/** Radius claimed when a settlement is founded. */
export const FOUND_CLAIM_RADIUS = 1;
/** Border radius by population: [minPop, radius], highest matching wins. */
export const BORDER_RADIUS_BY_POP: readonly [number, number][] = [
  [1, 1],
  [3, 2],
  [6, 3],
];
/** Furthest a settlement can work tiles. */
export const WORK_RADIUS = 3;
/** Population a city-state starts with. */
export const CITY_STATE_START_POP = 3;
/** Food eaten per citizen each turn. */
export const FOOD_PER_POP = 2;
/** Growth cost per pop = 5 + 4·pop + pop^1.4 (GDD §7). */
export const GROWTH_BASE = 5;
export const GROWTH_LINEAR = 4;
export const GROWTH_EXPONENT = 1.4;
/** The settlement's own tile always yields at least this much (it is the urban core). */
export const CITY_CENTER_MIN_YIELDS: Yields = { food: 2, production: 2 };
/** Flat yields every city (not town) adds; towns convert production into gold instead. */
export const CITY_BASE_YIELDS: Yields = { science: 1, culture: 1 };
/**
 * Extra flat yields of the capital. Production and culture tuned up from 0/1 by the fun audit
 * (scripts/fun-audit.ts): the first build and first civic took 12+ turns, leaving turns 2–7
 * without a decision (target: first build by turn ~5, first tech by ~7).
 */
export const CAPITAL_YIELDS: Yields = { science: 2, culture: 2, gold: 2, influence: 2, production: 1 };
/** Per-citizen yields (fractional, rounded at the empire level). */
export const POP_YIELDS: Yields = { science: 0.5, culture: 0.3 };
/** Towns turn this share of their production into gold (GDD §7: "production → gold"). */
export const TOWN_PRODUCTION_TO_GOLD = 1;
/** Cities with no production item bank this share of production as gold. */
export const IDLE_PRODUCTION_TO_GOLD = 0.5;
/**
 * Wave 13 (banked progress churn): when an item finishes, up to PRODUCTION_CHAIN_MAX queued
 * items the leftover can pay for finish the same turn, and the leftover then carried to the
 * next item is capped at this share of the finished item's cost (at least one turn's
 * production); the excess is sold at IDLE_PRODUCTION_TO_GOLD.
 */
export const PRODUCTION_CARRY_SHARE = 0.5;
export const PRODUCTION_CHAIN_MAX = 3;
/** Shared settlement cap per age (GDD §7); +`settlementCap` modifiers. */
export const SETTLEMENT_CAP: Record<Age, number> = { ancient: 4, classical: 6, exploration: 8, modern: 10 };
/** Gold cost of upgrading a town to a city = base + perPop·pop (then `cost/upgrade` modifiers). */
export const UPGRADE_COST_BASE = 80;
export const UPGRADE_COST_PER_POP = 20;
/** Buying an item costs this many gold per remaining production point. */
export const BUY_GOLD_PER_PRODUCTION = 2;
/** Wonders cannot be bought with gold (Civ convention; they must be built). */
export const WONDERS_PURCHASABLE = false;
/** Past-age buildings keep this share of their yields (GDD §5 "Transition", §7). */
export const PAST_AGE_BUILDING_YIELD = 0.5;
/** Tile-picking weights for citizen auto-assignment. */
export const TILE_SCORE: Record<string, number> = {
  food: 2,
  production: 1.6,
  gold: 1,
  science: 1.2,
  culture: 1.2,
  faith: 0.8,
  influence: 0.8,
  happiness: 0,
};

/**
 * Balanced citizens (fun audit pass 2): once a settlement's food surplus reaches
 * BASE + PER_POP·pop (rounded up), further food on a tile counts at SATISFIED_FOOD_SHARE of its
 * usual weight when citizens pick tiles, so food-rich starts also work production tiles.
 */
export const FOOD_SURPLUS_SOFT_CAP_BASE = 2;
export const FOOD_SURPLUS_SOFT_CAP_PER_POP = 0.5;
export const SATISFIED_FOOD_SHARE = 0.5;

// --- Happiness (GDD §7) ------------------------------------------------------

export const HAPPINESS_BASE = 5;
/** Each citizen above this count in one settlement costs 1 happiness. */
export const HAPPINESS_POP_FREE = 5;
/** Happiness lost per settlement above the cap. */
export const HAPPINESS_PER_OVER_CAP = 5;
/** War weariness per ongoing war. */
export const WAR_WEARINESS_PER_WAR = 1;
/**
 * Wave 13 ("wars resolve themselves"): weariness grows with the war's length, +1 happiness
 * lost per this many turns at war, up to WAR_WEARINESS_MAX per war. A long war now costs
 * both sides something the player can see (the happiness breakdown), and it pushes the AI to
 * end wars it is not winning.
 */
export const WAR_WEARINESS_TURNS_PER_POINT = 8;
export const WAR_WEARINESS_MAX = 4;
export const CELEBRATION_THRESHOLD = 10;
export const CELEBRATION_YIELD_PERCENT = 10;
/** Yield percent lost per point of negative happiness. */
export const UNHAPPY_YIELD_PERCENT_PER_POINT = 2;
/** Cap on the unhappiness penalty. */
export const UNHAPPY_YIELD_PERCENT_MAX = 50;

// --- Tiles (GDD §7 "Map") ----------------------------------------------------

/**
 * Feature yields, added to terrain yields. Hills, forest and jungle give production (timber,
 * cane, forest products); marsh, and jungle's thin rainforest soils, cost food. Jungle gave
 * +1 food until fun audit pass 2: on tropical grassland that made 3-food, 0-production tiles
 * everywhere and tropical capitals finished last (rank 2.5 of 3); +1 production alone
 * overshot (rank 1.46 over 13 tropical starts).
 */
export const FEATURE_YIELDS: Record<string, Yields> = {
  hills: { production: 1 },
  forest: { production: 1 },
  jungle: { food: -1, production: 1 },
  marsh: { food: -1 },
  oasis: { food: 2, gold: 1 },
};
/** Feature move cost (replaces terrain cost when higher). */
export const FEATURE_MOVE_COST: Record<string, number> = { hills: 2, forest: 2, jungle: 2, marsh: 2 };
/** Feature defense bonus (GDD §7: hills +3, forest +2). */
export const FEATURE_DEFENSE: Record<string, number> = { hills: 3, forest: 2, jungle: 2 };
/** Food lost on every polar-climate tile unless an `ignoreCold` modifier applies (GDD §7 map bands). */
export const COLD_FOOD_PENALTY = 1;
/** River tiles give +1 gold. */
export const RIVER_GOLD = 1;
/** Move cost for land units on water once they can embark. */
export const EMBARK_MOVE_COST = 1;

// --- Units and combat (GDD §7 "Combat") -------------------------------------

export const UNIT_MAX_HP = 100;
export const COMBAT_BASE_DAMAGE = 30;
export const COMBAT_EXPONENT = 0.04;
export const COMBAT_RANDOM_MIN = 0.8;
export const COMBAT_RANDOM_MAX = 1.2;
export const RIVER_CROSSING_PENALTY = 5;
export const FLANKING_PER_UNIT = 2;
export const FORTIFY_BONUS = 5;
/** −1 strength per this many HP lost. */
export const HP_PER_STRENGTH_LOST = 10;
/** Strength of a land unit while embarked on water. */
export const EMBARKED_STRENGTH = 5;
/** Defending unit inside a settlement whose walls still stand. */
export const GARRISON_BONUS = 4;
/** Healing per turn (start of turn). */
export const HEAL_IN_SETTLEMENT = 20;
export const HEAL_IN_TERRITORY = 10;
export const HEAL_RESTING = 5;
/** Settlement walls (GDD §7: "A city falls when walls hit 0 and a melee unit enters"). */
export const WALL_BASE_HP = 100;
export const WALL_HEAL_PER_TURN = 15;
/** Walls do not heal while an enemy military unit is within this distance (siege range). */
export const WALL_SIEGE_RADIUS = 2;
/** Settlement defense strength = base by age + perPop·pop + walls' extra HP / divisor. */
export const SETTLEMENT_STRENGTH_BY_AGE: Record<Age, number> = { ancient: 18, classical: 28, exploration: 42, modern: 60 };
export const SETTLEMENT_STRENGTH_PER_POP = 1;
export const SETTLEMENT_STRENGTH_WALL_DIVISOR = 10;
/**
 * Gold upkeep (autoplay balance pass): each military unit beyond the free allowance costs
 * this much gold per turn. Deployed figure-units are free (the figure is the cost). When the
 * treasury cannot pay, one unit deserts per turn (see `startOfTurnForPlayer`).
 */
export const UNIT_GOLD_UPKEEP = 1;
export const FREE_MILITARY_UNITS = 2;
/**
 * Playtest 3 ("scouts running out of map by turn 27"): a scout's work does not end with the
 * map. A scout may fortify as a lookout (+LOOKOUT_VISION sight while it holds), and any
 * non-figure unit disbanded inside its owner's borders returns DISBAND_REFUND_SHARE of its
 * production cost as gold.
 */
export const LOOKOUT_VISION = 2;
export const DISBAND_REFUND_SHARE = 0.25;
/**
 * Gold raiders carry off when they pillage a settlement (src/sim/raids.ts): this share of the
 * treasury, at most RAIDER_PILLAGE_GOLD_CAP. Wave 11: a flat 25 per raider, with a band of
 * raiders each pillaging the same town in one world phase, emptied a 51-gold treasury; now a
 * settlement is pillaged at most once per turn and never loses more than this share.
 */
export const RAIDER_PILLAGE_GOLD_SHARE = 0.25;
export const RAIDER_PILLAGE_GOLD_CAP = 25;
/** Raiders go for an undefended settlement within this distance before anything else. */
export const RAIDER_SEEK_RANGE = 8;

/** Items a city may queue after its current one (wave 11, `setProductionQueue`). */
export const PRODUCTION_QUEUE_MAX = 3;
/** `TimedEffect.source` prefix: this settlement may finish a past age's wonder it had begun. */
export const WONDER_CARRY_SOURCE = 'wonderCarry:';

// --- Trees and government (GDD §7 "Trees", "Governments") --------------------

/** Age-meter points for completing a whole tree of the current age (GDD §5). */
export const TREE_COMPLETE_AGE_PROGRESS = 4;
/** Age-meter points for a wonder (GDD §5). */
export const WONDER_AGE_PROGRESS = 1;
/** Mid-age government change (GDD §7). */
export const ANARCHY_TURNS = 2;

// --- Diplomacy, city-states, trade (GDD §7) ----------------------------------

export const PEACE_INFLUENCE_COST = 40;
export const MIN_WAR_TURNS = 10;

// --- War warnings, objectives and peace terms (wave 13, src/sim/war-intent.ts) --------

/**
 * `TimedEffect.source` prefixes (modifier-free markers on the AI player, plain JSON):
 * - `warIntent:<target>:<settlementId>:<dueTurn>` — the AI warned `target` it will declare war
 *   over that settlement on `dueTurn` (untilTurn = dueTurn + WAR_INTENT_GRACE_TURNS);
 * - `warGoal:<target>:<settlementId>` — the announced objective of a war under way;
 * - `stoodDown:<target>` — no new threat against `target` until untilTurn;
 * - `warTally:<enemy>:<battlesWon>:<unitsLost>` — this player's counters when the war began.
 */
export const WAR_INTENT_SOURCE = 'warIntent:';
export const WAR_GOAL_SOURCE = 'warGoal:';
export const STOOD_DOWN_SOURCE = 'stoodDown:';
export const WAR_TALLY_SOURCE = 'warTally:';
/** An intent the AI neither carries out nor withdraws lapses (with a stand-down line) this long after it is due. */
export const WAR_INTENT_GRACE_TURNS = 4;
/** After standing down or being paid off, no new threat against that player for this many turns. */
export const STOOD_DOWN_TURNS = 15;
/** Influence a threatened player pays as tribute to buy off a threat (`makePeace` before the war). */
export const WAR_TRIBUTE_INFLUENCE = 30;
/**
 * Peace terms: each side's war score = PEACE_SCORE_PER_CAPTURE per settlement it took from the
 * other + 1 per enemy unit lost since the war began. When peace is made, a side behind by at
 * least PEACE_TERMS_MIN_MARGIN pays the other PEACE_TRIBUTE_BASE + PEACE_TRIBUTE_PER_POINT gold
 * per point of margin, at most PEACE_TRIBUTE_MAX and PEACE_TRIBUTE_MAX_SHARE of its treasury.
 */
export const PEACE_SCORE_PER_CAPTURE = 4;
export const PEACE_TERMS_MIN_MARGIN = 2;
export const PEACE_TRIBUTE_BASE = 20;
export const PEACE_TRIBUTE_PER_POINT = 8;
export const PEACE_TRIBUTE_MAX = 120;
export const PEACE_TRIBUTE_MAX_SHARE = 0.4;
export const ENVOY_BASE_COST = 20;
/** Each envoy a player has already sent to that city-state raises the next one's cost. */
export const ENVOY_COST_STEP = 10;
/** "Big affinity" for the city-state's culture per envoy (GDD §7). */
export const ENVOY_AFFINITY = 15;
export const SUZERAIN_MIN_ENVOYS = 3;
/** Merchant range (GDD §7: 10 tiles land, 20 sea). Distance is measured hex-to-hex. */
export const TRADE_RANGE = 10;
export const TRADE_ROUTE_GOLD = 3;
/** Gold the partner (if a player) gets per turn from each route ending in their settlement. */
export const TRADE_PARTNER_GOLD = 1;
/** Base trade-route capacity; +`tradeRoutes` modifiers. */
export const TRADE_ROUTE_BASE_CAP = 1;

export const AGE_INDEX: Record<Age, number> = { ancient: 0, classical: 1, exploration: 2, modern: 3 };

/** Below this empire happiness settlements stop growing (GDD §7 "< −10 unrest"). */
export const UNREST_THRESHOLD = -10;
/** Settlements make visible every tile within this distance. */
export const SETTLEMENT_VISION = 3;

// --- Settlement sites (settler hints and the AI's site choice) ---------------

/**
 * Weights of the one settlement-site score (src/sim/sites.ts). These are the neutral values
 * shown to players; the AI overrides the yield, luxury and coast weights with its persona.
 */
export interface SiteWeights {
  /** Value of one point of each yield on a tile the settlement would claim or work. */
  yield: Record<YieldType, number>;
  /** Per luxury kind in reach that the player does not own yet. */
  newLuxury: number;
  /** Per strategic resource tile in reach. */
  strategic: number;
  /** Fresh water: the center is on a river. */
  river: number;
  /** The center touches water (harbors, sea trade). */
  coast: number;
  /** The center is on hills (defense). */
  hills: number;
  /** Per tile in the first two rings already owned by anyone (shared or lost tiles). */
  overlap: number;
  /** Per point of closeness to a settlement of someone the player is at war with. */
  rivalAtWar: number;
}

export const SITE_WEIGHTS: SiteWeights = {
  yield: { food: 1.2, production: 1.2, gold: 0.8, science: 1, culture: 0.9, faith: 0.5, happiness: 0.8, influence: 0.6 },
  newLuxury: 3.2,
  strategic: 1,
  river: 3,
  coast: 1.5,
  hills: 1.5,
  overlap: 0.5,
  rivalAtWar: 2,
};
/** Rings a new settlement is scored on (it claims ring 1 at once and grows into ring 2). */
export const SITE_SCORE_RADIUS = 2;
/** Share of a ring-2 tile's value (ring 1 counts fully). */
export const SITE_OUTER_RING_SHARE = 0.6;
/** Share of a water tile's value (workable, but weaker without harbors). */
export const SITE_WATER_SHARE = 0.6;
/** More water tiles than this in reach make a site cramped; each extra costs SITE_WATER_PENALTY. */
export const SITE_MAX_WATER = 12;
export const SITE_WATER_PENALTY = 1.5;
/** Fewer land tiles than this make a site cramped; each missing one costs SITE_LAND_PENALTY. */
export const SITE_MIN_LAND = 5;
export const SITE_LAND_PENALTY = 2;
/** Settlements of enemies at war within this distance lower a site's score. */
export const SITE_WAR_RADIUS = 5;
/** `queries.settleSites` looks this far from the settler and returns at most this many sites. */
export const SETTLE_SITE_RANGE = 8;
export const SETTLE_SITE_MAX = 30;

// --- Difficulty (GDD §9: "yield bonuses and depth, never hidden information") ------

/** Yields the difficulty level scales for non-human players. */
export const DIFFICULTY_YIELDS: readonly YieldType[] = ['food', 'production', 'gold', 'science', 'culture'];
/**
 * Percent change to those yields for non-human players. 'normal' must stay 0 (today's game).
 * Calibrated by fun audit pass 2 with the AI playing the human seat (3 players, parity 33%):
 * a few percent swings the win rate a lot, because scores finish close. At −20/+25 (and −15%
 * costs) the seat won 92% on easy and 0% on hard; targets are ~70% / ~33% / ~12%.
 */
export const DIFFICULTY_RIVAL_YIELD_PERCENT: Record<Difficulty, number> = { easy: -5, normal: 0, hard: 6 };
/** Percent change to unit and building costs for non-human players. */
export const DIFFICULTY_RIVAL_COST_PERCENT: Record<Difficulty, number> = { easy: 0, normal: 0, hard: -5 };
/**
 * Turns an AI waits after warning a human player — first contact or "our borders touch" —
 * before it may declare war on them (wave 11: a Conqueror declared one turn after its border
 * warning). Recorded by src/sim/voice.ts as a modifier-free `WAR_WARNING_SOURCE` effect on
 * the AI; read by src/ai/war.ts.
 */
export const WAR_WARNING_TURNS: Record<Difficulty, number> = { easy: 10, normal: 6, hard: 3 };
export const WAR_WARNING_SOURCE = 'warnedOf:';
/** Happiness each human-owned settlement adds. */
export const DIFFICULTY_HUMAN_SETTLEMENT_HAPPINESS: Record<Difficulty, number> = { easy: 1, normal: 0, hard: 0 };
