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
});
export type ContentBundle = z.infer<typeof ContentBundle>;
