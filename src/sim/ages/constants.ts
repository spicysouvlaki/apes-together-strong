/**
 * Tuning constants for ages, crises, transitions, refinement and legacy (GDD §5, §6, §8).
 * Numbers live here, not inline, so balance passes touch one file.
 */
import type { GameSpeed } from '@contracts/sim-api';

// --- Age meter (GDD §5 "Age meter") -----------------------------------------------------

/** The meter runs 0–100; the age ends for everyone at 100. */
export const AGE_METER_MAX = 100;

/**
 * Per-turn meter gain by game speed. GDD §5 says "+1/turn" at Standard; the other sources
 * (trees +4, milestones +3, wonders +1, figures +0.5) are expected to add ~50 points over an
 * age, so 50 + 1·50 turns ≈ 100 at Standard. Quick/Epic scale the per-turn gain so the base
 * half lasts ~35 / ~75 turns (50/35 ≈ 1.43, 50/75 ≈ 0.67).
 */
export const METER_PER_TURN: Record<GameSpeed, number> = {
  quick: 1.43,
  standard: 1,
  epic: 0.67,
};

/** Meter gain per source (GDD §5). Callers outside src/sim/ages pass these to addAgeProgress. */
export const METER_PER_TREE_COMPLETED = 4;
/**
 * GDD §5 says +3 per milestone; autoplay (3 AIs) reached ~18–21 milestone tiers per age, i.e.
 * 55–65 meter on top of the per-turn tick, ending ages after ~35 turns. 1.25 brings ages back
 * to ~45–60 turns.
 */
export const METER_PER_MILESTONE = 1.25;
export const METER_PER_WONDER = 1;
export const METER_PER_FIGURE = 0.5;

/**
 * Achievement-driven meter gains are tuned for this many players; with more living players
 * each gain is scaled by REFERENCE / living so bigger maps keep the same age length.
 */
export const METER_REFERENCE_PLAYERS = 3;

/** Meter values are kept to 2 decimals so fractional gains stay readable in saves and the HUD. */
export const METER_PRECISION = 100;

// --- Crises (GDD §5 table) ---------------------------------------------------------------

/** The crisis of the ending age starts at this meter value (stages then fire at their `at`). */
export const CRISIS_START = 70;

/** Collapse: one raider per living player every N turns, while total raiders stay under the cap. */
export const RAIDER_SPAWN_INTERVAL = 3;
export const RAIDER_CAP_PER_PLAYER = 2;
/** Raiders appear on unowned land this many tiles from a settlement. */
export const RAIDER_MIN_DISTANCE = 3;
export const RAIDER_MAX_DISTANCE = 5;

/** Plague: −1 pop every N turns in settlements above the floor; faster for trading players ("spreads by trade"). */
export const POP_LOSS_INTERVAL = 10;
export const POP_LOSS_INTERVAL_WITH_TRADE = 5;
/** Only settlements with population above this lose people. */
export const POP_LOSS_MIN_POP = 2;

/** Revolution/unrest: settlements of players with happiness below this lose production progress each turn. */
export const UNREST_HAPPINESS_BELOW = 0;
export const UNREST_PROGRESS_LOSS_PERCENT = 25;

// --- Transition and refinement (GDD §5 "Transition", §6) -----------------------------------

/** RP per legacy milestone reached during the ending age, capped (GDD §6). */
export const RP_PER_MILESTONE = 2;
export const RP_MILESTONE_CAP = 24;
/** RP per figure retiring to the Hall of Ancestors. */
export const RP_PER_RETIRED_FIGURE = 1;
/** Share of unspent RP that survives a transition (applied when the transition closes). */
export const RP_CARRY_FRACTION = 0.5;
/** Catch-up bonus RP for players whose score is below the median of living players (GDD §5). */
export const CATCH_UP_RP = 4;

/** Culture weight needed per tradition tier (GDD §6 table). Hybrids use their own `minWeight`. */
export const TIER_WEIGHT = { custom: 1, institution: 3, signature: 5 } as const;

/** Max new signature traditions / hybrids per transition (GDD §6 table). */
export const MAX_SIGNATURES_PER_TRANSITION = 1;
export const MAX_HYBRIDS_PER_TRANSITION = 1;

/** Heaviest-culture discount on refinement costs, in percent (GDD §6 "−30% on its costs"). */
export const HEAVIEST_CULTURE_DISCOUNT_PERCENT = -30;
/**
 * Extra RP per tradition or hybrid already adopted in the same transition. Not in GDD §6:
 * added after autoplay showed 5–8 cheap customs bought per transition instead of 2–4 choices.
 */
export const REFINEMENT_ESCALATION = 1;

/** Civilization names: length limits after trimming (GDD §6 "Naming"). */
export const CIV_NAME_MIN = 1;
export const CIV_NAME_MAX = 40;
export const NAME_OPTION_COUNT = 3;

// --- Legacy (GDD §8) ----------------------------------------------------------------------

/** Legacy points awarded for reaching milestone tier 1 / 2 / 3. */
export const LEGACY_POINTS_PER_TIER: readonly [number, number, number] = [5, 10, 15];

/** Legacy score weights (GDD §8). */
export const SCORE_PER_FIGURE = 10;
export const SCORE_PER_TRADITION = 15;
export const SCORE_PER_HYBRID = 40;
export const SCORE_PER_SIGNATURE_EXTRA = 25;
export const SCORE_PER_SEATED_FIGURE = 5;
