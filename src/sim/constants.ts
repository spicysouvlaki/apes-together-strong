/**
 * Named tuning constants for the sim core. All numbers are first-pass values (docs/GDD.md
 * "All numbers are first-pass tuning values"). Content-specific numbers live in content/*.json;
 * these are rule-level knobs that no single content entry owns.
 */
import type { Age, Yields } from '@contracts/content-schemas';

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
/** Extra flat yields of the capital. */
export const CAPITAL_YIELDS: Yields = { science: 2, culture: 1, gold: 2, influence: 2 };
/** Per-citizen yields (fractional, rounded at the empire level). */
export const POP_YIELDS: Yields = { science: 0.5, culture: 0.3 };
/** Towns turn this share of their production into gold (GDD §7: "production → gold"). */
export const TOWN_PRODUCTION_TO_GOLD = 1;
/** Cities with no production item bank this share of production as gold. */
export const IDLE_PRODUCTION_TO_GOLD = 0.5;
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

// --- Happiness (GDD §7) ------------------------------------------------------

export const HAPPINESS_BASE = 5;
/** Each citizen above this count in one settlement costs 1 happiness. */
export const HAPPINESS_POP_FREE = 5;
/** Happiness lost per settlement above the cap. */
export const HAPPINESS_PER_OVER_CAP = 5;
/** War weariness per ongoing war. */
export const WAR_WEARINESS_PER_WAR = 1;
export const CELEBRATION_THRESHOLD = 10;
export const CELEBRATION_YIELD_PERCENT = 10;
/** Yield percent lost per point of negative happiness. */
export const UNHAPPY_YIELD_PERCENT_PER_POINT = 2;
/** Cap on the unhappiness penalty. */
export const UNHAPPY_YIELD_PERCENT_MAX = 50;

// --- Tiles (GDD §7 "Map") ----------------------------------------------------

/** Feature yields, added to terrain yields. Hills/forest give production, jungle food, marsh costs food. */
export const FEATURE_YIELDS: Record<string, Yields> = {
  hills: { production: 1 },
  forest: { production: 1 },
  jungle: { food: 1 },
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
/** Raiders that break a settlement's walls pillage instead of capturing. */
export const RAIDER_PILLAGE_GOLD = 25;

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
