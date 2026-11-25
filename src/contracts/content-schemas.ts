/**
 * Schemas for every file in /content. These are the single source of truth for content
 * types: TypeScript types are inferred from them, and `npm run validate:content` checks
 * every file plus cross-references at build time.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const Id = z.string().regex(/^[a-z0-9_]+$/, 'ids are snake_case');

export const AGES = ['ancient', 'classical', 'exploration', 'modern'] as const;
export const Age = z.enum(AGES);
export type Age = z.infer<typeof Age>;

export const YIELDS = [
  'food',
  'production',
  'gold',
  'science',
  'culture',
  'faith',
  'happiness',
  'influence',
] as const;
export const YieldType = z.enum(YIELDS);
export type YieldType = z.infer<typeof YieldType>;
export const Yields = z.partialRecord(YieldType, z.number());
export type Yields = z.infer<typeof Yields>;

/** The six great-people point pools; each figure kind except `legend` maps to one. */
export const GP_KINDS = ['military', 'statesman', 'thought', 'faith', 'building', 'exploration'] as const;
export const GpKind = z.enum(GP_KINDS);
export type GpKind = z.infer<typeof GpKind>;

export const FIGURE_KINDS = ['general', 'statesman', 'thinker', 'spiritual', 'builder', 'explorer', 'legend'] as const;
export const FigureKind = z.enum(FIGURE_KINDS);
export type FigureKind = z.infer<typeof FigureKind>;

export const FIGURE_KIND_TO_GP: Record<Exclude<FigureKind, 'legend'>, GpKind> = {
  general: 'military',
  statesman: 'statesman',
  thinker: 'thought',
  spiritual: 'faith',
  builder: 'building',
  explorer: 'exploration',
};

export const UNIT_CLASSES = ['infantry', 'ranged', 'cavalry', 'siege', 'naval', 'civilian', 'commander'] as const;
export const UnitClass = z.enum(UNIT_CLASSES);
export type UnitClass = z.infer<typeof UnitClass>;

export const CLIMATES = ['polar', 'boreal', 'temperate', 'arid', 'tropical'] as const;
export const Climate = z.enum(CLIMATES);
export type Climate = z.infer<typeof Climate>;

// ---------------------------------------------------------------------------
// Modifier language — how traditions, figures, governments, policies and leaders
// change the rules. Every bonus in the game is a Modifier; the sim has one engine
// that evaluates them. Add new effect kinds here, never ad-hoc in sim code.
// ---------------------------------------------------------------------------

export const Condition = z
  .object({
    terrain: z.array(Id).optional(),
    feature: z.array(Id).optional(),
    resource: z.array(Id).optional(),
    climate: z.array(Climate).optional(),
    adjacentTerrain: z.array(Id).optional(),
    coastal: z.boolean().optional(),
    river: z.boolean().optional(),
    cityMinPop: z.number().int().optional(),
    cityMaxPop: z.number().int().optional(),
    minTradeRoutes: z.number().int().optional(),
    unitClass: z.array(UnitClass).optional(),
    age: z.array(Age).optional(),
    atWar: z.boolean().optional(),
    /** Settlement kind (town/city) or capital only. */
    settlementKind: z.enum(['town', 'city']).optional(),
    capital: z.boolean().optional(),
  })
  .strict();
export type Condition = z.infer<typeof Condition>;

export const Effect = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('yield'), yield: YieldType, add: z.number().optional(), percent: z.number().optional() }),
  z.object({ kind: z.literal('combat'), add: z.number(), vs: UnitClass.optional() }),
  z.object({ kind: z.literal('movement'), add: z.number() }),
  z.object({ kind: z.literal('gpPoints'), gp: GpKind, percent: z.number() }),
  z.object({ kind: z.literal('affinityGain'), culture: Id.optional(), percent: z.number() }),
  z.object({
    kind: z.literal('cost'),
    target: z.enum(['unit', 'building', 'wonder', 'settler', 'tradition', 'upgrade']),
    percent: z.number(),
  }),
  z.object({ kind: z.literal('cabinetSlot'), slot: Id }),
  z.object({ kind: z.literal('settlementCap'), add: z.number().int() }),
  z.object({ kind: z.literal('tradeRoutes'), add: z.number().int() }),
  z.object({ kind: z.literal('vision'), add: z.number().int() }),
  z.object({
    kind: z.literal('unlock'),
    what: z.enum(['unit', 'building', 'improvement', 'wonder', 'government', 'embark']),
    id: Id,
  }),
  z.object({ kind: z.literal('ignoreCold') }),
]);
export type Effect = z.infer<typeof Effect>;

export const Modifier = z
  .object({
    /** What the effect applies to. */
    scope: z.enum(['empire', 'settlement', 'tile', 'unit']),
    when: Condition.optional(),
    effect: Effect,
  })
  .strict();
export type Modifier = z.infer<typeof Modifier>;

const History = z.object({
  /** Player-facing, ≤ 280 chars, honest about harms (see docs/CONTENT_GUIDELINES.md). */
  note: z.string().max(280),
  /** Where the note's facts come from; not shown in game. */
  source: z.string().min(3),
});

// ---------------------------------------------------------------------------
// Content files
// ---------------------------------------------------------------------------

export const Culture = z
  .object({
    id: Id,
    name: z.string(),
    adjective: z.string(),
    firstPlayable: z.boolean(),
    /** Building motif set for procedural architecture. */
    architecture: Id,
    /** Music stem id layered in by culture weight. */
    musicStem: Id,
    cityNames: z.array(z.string()).min(4),
  })
  .strict();
export type Culture = z.infer<typeof Culture>;

export const Figure = z
  .object({
    id: Id,
    name: z.string(),
    culture: Id,
    age: Age,
    kind: FigureKind,
    /** `true` for oral-record archetypes ("A Thule umiak captain") — never invented named people. */
    archetype: z.boolean().default(false),
    uses: z.array(z.enum(['unit', 'cabinet', 'activate'])).min(1),
    cabinetSlots: z.array(Id).default([]),
    cabinetModifiers: z.array(Modifier).default([]),
    unitModifiers: z.array(Modifier).default([]),
    activate: z.object({ effect: Id, amount: z.number().optional() }).optional(),
    consumeValue: z.number().int().min(1),
    /** If set, the figure only arrives through this deed, never through a points offer. */
    deed: Id.optional(),
    bio: z.string().max(280),
    source: z.string().min(3),
    quote: z.string().optional(),
    portraitPrompt: z.string().optional(),
  })
  .strict();
export type Figure = z.infer<typeof Figure>;

export const Tradition = z
  .object({
    id: Id,
    name: z.string(),
    culture: Id,
    tier: z.enum(['custom', 'institution', 'signature']),
    /** First age at which this tradition is offered. */
    age: Age,
    cost: z.number().int().min(1),
    requires: z.array(Id).default([]),
    modifiers: z.array(Modifier).min(1),
    description: z.string(),
    history: History,
  })
  .strict();
export type Tradition = z.infer<typeof Tradition>;

export const Hybrid = z
  .object({
    id: Id,
    name: z.string(),
    cultures: z.tuple([Id, Id]),
    age: Age,
    cost: z.number().int().min(1),
    minWeight: z.number().int().default(3),
    modifiers: z.array(Modifier).min(1),
    description: z.string(),
    history: History,
  })
  .strict();
export type Hybrid = z.infer<typeof Hybrid>;

/**
 * A signal is something the sim can measure about a player each turn. Its value times
 * each culture weight is added to that player's affinity (docs/GDD.md, "Affinity engine").
 */
export const SignalMeasure = z.enum([
  'ownedTerrain', // count of owned tiles with terrain = param
  'ownedFeature', // count of owned tiles with feature = param
  'ownedResource', // count of owned tiles with resource = param
  'ownedClimate', // count of owned tiles in climate band = param
  'coastalSettlements',
  'settlementCount',
  'totalPopulation',
  'unitsOfClass', // count of units with class = param
  'battlesWonThisTurn',
  'citiesCapturedThisTurn',
  'tradeRoutesWithCulture', // routes to settlements whose top culture = each weighted culture
  'tradeRoutes', // total trade routes owned
  'riverSettlements',
  'wondersBuilt',
  'techsResearched',
  'envoysSent',
  'suzerainOfCulture', // city-states of each weighted culture the player is suzerain of
  'unitsTotal', // military units
  'faithIncome',
  'cultureIncome',
  'scienceIncome',
  'goldIncome',
  'exploredPercent', // 0–100
]);
export type SignalMeasure = z.infer<typeof SignalMeasure>;

export const Signal = z
  .object({
    id: Id,
    description: z.string(),
    measure: SignalMeasure,
    param: z.string().optional(),
    /** Hint shown when this signal pushes a culture over a threshold, e.g. "your herds". */
    hint: z.string(),
    weights: z.record(Id, z.number()),
  })
  .strict();
export type Signal = z.infer<typeof Signal>;

export const Terrain = z
  .object({
    id: Id,
    name: z.string(),
    yields: Yields,
    moveCost: z.number().int().min(1).nullable(),
    defense: z.number().default(0),
    water: z.boolean().default(false),
    /** Renderer color, sRGB hex. Placeholder until the art kit lands. */
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
  })
  .strict();
export type Terrain = z.infer<typeof Terrain>;

export const Resource = z
  .object({
    id: Id,
    name: z.string(),
    class: z.enum(['bonus', 'luxury', 'strategic']),
    yields: Yields,
    terrains: z.array(Id).min(1),
    revealAge: Age.default('ancient'),
  })
  .strict();
export type Resource = z.infer<typeof Resource>;

export const Leader = z
  .object({
    id: Id,
    name: z.string(),
    ability: z.string(),
    modifiers: z.array(Modifier).min(1),
    aiAgendaBias: z.array(Id).default([]),
  })
  .strict();
export type Leader = z.infer<typeof Leader>;

export const Dream = z
  .object({
    id: Id,
    /** As written in the source language, e.g. "天下". */
    native: z.string(),
    romanized: z.string(),
    language: z.string(),
    meaning: z.string(),
    modifiers: z.array(Modifier).min(1),
  })
  .strict();
export type Dream = z.infer<typeof Dream>;

export const Government = z
  .object({
    id: Id,
    name: z.string(),
    age: Age,
    cabinetSlots: z.array(Id).min(1),
    policySlots: z.number().int().min(0),
    modifiers: z.array(Modifier).default([]),
  })
  .strict();
export type Government = z.infer<typeof Government>;

export const CabinetSlot = z
  .object({
    id: Id,
    name: z.string(),
    accepts: z.array(FigureKind).min(1),
  })
  .strict();
export type CabinetSlot = z.infer<typeof CabinetSlot>;

// ---------------------------------------------------------------------------
// M1–M4 additions (contracts: units, buildings, wonders, trees, deeds, city-states,
// crises, legacy milestones). Ids of units, buildings and wonders share one namespace
// because all three are production items (`Settlement.production.item`).
// ---------------------------------------------------------------------------

/**
 * Effects a figure's `activate.effect` may name. The schema keeps `Id` for forward
 * compatibility; `npm run validate:content` rejects anything not in this list.
 *  - rush_wonder: +amount% of the current wonder's cost in the figure's settlement (or capital)
 *  - production_burst / culture_burst / science_burst / gold_burst / faith_burst / influence_burst:
 *    +amount to the settlement's production progress or the player's stockpile
 *  - explore_reveal: reveal tiles within `amount` of every owned settlement and unit
 *  - free_unit: spawn the best available military unit in the capital (`amount` = count)
 *  - heal_units: heal all own units by `amount` HP
 *  - grow_city: +amount population in the figure's settlement (or capital)
 *  - found_wonder_points / age_progress are NOT effects; keep the list short.
 */
export const ACTIVATE_EFFECTS = [
  'rush_wonder',
  'production_burst',
  'culture_burst',
  'science_burst',
  'gold_burst',
  'faith_burst',
  'influence_burst',
  'explore_reveal',
  'free_unit',
  'heal_units',
  'grow_city',
] as const;
export type ActivateEffect = (typeof ACTIVATE_EFFECTS)[number];

export const UnitDef = z
  .object({
    id: Id,
    name: z.string(),
    age: Age,
    unitClass: UnitClass,
    /** Melee strength (GDD §7 combat table). 0 for civilians. */
    strength: z.number().int().min(0),
    /** Ranged strength; requires `range`. Ranged attacks take no return damage. */
    rangedStrength: z.number().int().optional(),
    range: z.number().int().min(1).optional(),
    moves: z.number().int().min(1),
    /** Production cost. */
    cost: z.number().int().min(1),
    requiresTech: Id.optional(),
    requiresResource: Id.optional(),
    /** Settler-type unit: may found a settlement and is consumed doing so. */
    canFound: z.boolean().default(false),
    /** Merchant-type unit: may open a trade route and is consumed doing so. */
    canTrade: z.boolean().default(false),
    /** Bonus vs settlements (siege). */
    siegeBonus: z.number().default(0),
    /** Unit id of the next age's equivalent, if any. */
    upgradesTo: Id.optional(),
    /** The stand-in unit a deployed figure of this kind becomes (one def per kind). */
    figureKind: FigureKind.optional(),
    vision: z.number().int().default(2),
  })
  .strict();
export type UnitDef = z.infer<typeof UnitDef>;

export const Building = z
  .object({
    id: Id,
    name: z.string(),
    age: Age,
    cost: z.number().int().min(1),
    /** Flat per-turn yields for the settlement. Past-age buildings give 50% (GDD §7). */
    yields: Yields.default({}),
    /** Great-people points per turn. */
    gp: z.partialRecord(GpKind, z.number()).default({}),
    modifiers: z.array(Modifier).default([]),
    requiresTech: Id.optional(),
    /** Only in settlements matching this condition (coastal, river, ...). */
    requires: Condition.optional(),
    /** Added to the settlement's max wall HP. */
    defense: z.number().default(0),
    description: z.string(),
  })
  .strict();
export type Building = z.infer<typeof Building>;

export const Wonder = z
  .object({
    id: Id,
    name: z.string(),
    age: Age,
    cost: z.number().int().min(1),
    /** Building it adds affinity for this culture (GDD §7). */
    culture: Id,
    affinity: z.number().default(20),
    yields: Yields.default({}),
    gp: z.partialRecord(GpKind, z.number()).default({}),
    modifiers: z.array(Modifier).default([]),
    requiresTech: Id.optional(),
    requires: Condition.optional(),
    description: z.string(),
    history: History,
  })
  .strict();
export type Wonder = z.infer<typeof Wonder>;

/** One node of a tech tree (science) or civic tree (culture). GDD §7 "Trees". */
export const Tech = z
  .object({
    id: Id,
    name: z.string(),
    tree: z.enum(['tech', 'civic']),
    age: Age,
    cost: z.number().int().min(1),
    requires: z.array(Id).default([]),
    /** Layout hint for the tree screen: column (depth) and row. */
    col: z.number().int().min(0),
    row: z.number().int().min(0),
    /** `unlock` effects are informational; the sim gates on `requiresTech`. */
    modifiers: z.array(Modifier).default([]),
    description: z.string(),
  })
  .strict();
export type Tech = z.infer<typeof Tech>;

/** Things a deed or legacy milestone can count about a player (lifetime unless noted). */
export const StatMeasure = z.enum([
  'battlesWon',
  'citiesCaptured',
  'wondersBuilt',
  'figuresRecruited',
  'figuresActivated',
  'settlementCount',
  'coastalSettlements',
  'largestCityPop',
  'techsResearched', // completed tree nodes of the current age (both trees)
  'tradeRoutes',
  'envoysSent',
  'exploredPercent', // 0–100
  'ownedClimate', // owned tiles in climate = param
  'ownedTerrain', // owned tiles with terrain = param
  'unitsOfClass', // units with class = param
  'culturesRefined', // distinct cultures among adopted traditions
  'hybridsAdopted',
  'traditionsAdopted',
  'siegeTurnsHeld', // consecutive turns a settlement survived with damaged walls
  'unitsLost',
]);
export type StatMeasure = z.infer<typeof StatMeasure>;

/**
 * A story beat that delivers one figure immediately, once per world (GDD §4 "Deed figures").
 * The figure is the one whose `deed` field names this id.
 */
export const Deed = z
  .object({
    id: Id,
    name: z.string(),
    /** Player-facing: what you did, e.g. "You held a city through a five-turn siege." */
    description: z.string(),
    trigger: z.object({ measure: StatMeasure, param: z.string().optional(), count: z.number() }),
  })
  .strict();
export type Deed = z.infer<typeof Deed>;

export const CityStateDef = z
  .object({
    id: Id,
    name: z.string(),
    culture: Id,
    type: z.enum(['trade', 'military', 'scholarly', 'sacred', 'cultural']),
    /** Applied to the suzerain (most envoys, at least 3). */
    suzerainModifiers: z.array(Modifier).min(1),
    description: z.string(),
    history: History,
  })
  .strict();
export type CityStateDef = z.infer<typeof CityStateDef>;

/** End-of-age crisis (GDD §5). Stages fire at age meter 70 / 80 / 90. */
export const Crisis = z
  .object({
    id: Id,
    name: z.string(),
    /** The age this crisis ends. */
    age: Age,
    description: z.string(),
    /** Applied to every player while the crisis is active. */
    pressure: z.array(Modifier).default([]),
    /** Sim-side pressure behaviors; implemented by src/sim/ages. */
    behaviors: z.array(z.enum(['raiders', 'popLoss', 'unrest'])).default([]),
    stages: z
      .array(
        z.object({
          at: z.number(),
          text: z.string(),
          options: z
            .array(
              z.object({
                id: Id,
                label: z.string(),
                description: z.string(),
                /** Lasts until the age ends. */
                modifiers: z.array(Modifier).default([]),
                /** One-time stockpile changes (may be negative). */
                stock: Yields.default({}),
              }),
            )
            .length(2),
        }),
      )
      .length(3),
  })
  .strict();
export type Crisis = z.infer<typeof Crisis>;

export const LEGACY_TRACKS = ['science', 'military', 'culture', 'legacy'] as const;
export const LegacyTrack = z.enum(LEGACY_TRACKS);
export type LegacyTrack = z.infer<typeof LegacyTrack>;

/** One row of the GDD §8 table for one age: three thresholds, each a legacy milestone. */
export const LegacyMilestone = z
  .object({
    id: Id,
    track: LegacyTrack,
    age: Age,
    measure: StatMeasure,
    param: z.string().optional(),
    thresholds: z.tuple([z.number(), z.number(), z.number()]),
    /** e.g. "Research {n} technologies"; `{n}` is replaced by the threshold. */
    description: z.string(),
  })
  .strict();
export type LegacyMilestone = z.infer<typeof LegacyMilestone>;

export const ContentBundle = z.object({
  cultures: z.array(Culture),
  figures: z.array(Figure),
  traditions: z.array(Tradition),
  hybrids: z.array(Hybrid),
  signals: z.array(Signal),
  terrain: z.array(Terrain),
  resources: z.array(Resource),
  leaders: z.array(Leader),
  dreams: z.array(Dream),
  governments: z.array(Government),
  cabinetSlots: z.array(CabinetSlot),
  units: z.array(UnitDef),
  buildings: z.array(Building),
  wonders: z.array(Wonder),
  techs: z.array(Tech),
  deeds: z.array(Deed),
  cityStates: z.array(CityStateDef),
  crises: z.array(Crisis),
  legacy: z.array(LegacyMilestone),
});
export type ContentBundle = z.infer<typeof ContentBundle>;
