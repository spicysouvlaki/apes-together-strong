/**
 * The simulation contract. The sim (src/sim, src/emergence, src/ai) owns GameState and is the
 * only code that changes it. The UI and renderer read GameState snapshots and send Commands.
 *
 * Invariants:
 * - GameState is plain JSON: no classes, Maps, Sets, Dates, undefined-vs-missing tricks, or functions.
 * - The sim is deterministic: same state + same commands => byte-identical next state.
 *   All randomness comes from `state.rng`; never Math.random, Date.now or performance.now.
 */
import type { Age, ContentBundle, FigureKind, GpKind, UnitClass, YieldType } from './content-schemas';
import type { Hex } from './hex';

export type PlayerId = string;
export type SettlementId = string;
export type UnitId = string;
export type FigureId = string;
export type CultureId = string;
export type OfferId = string;

export type MapSize = 'small' | 'standard' | 'large';
export type GameSpeed = 'quick' | 'standard' | 'epic';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export interface PlayerSetup {
  id: PlayerId;
  isHuman: boolean;
  leader: string;
  dream: string;
  colors: { primary: string; secondary: string };
  /** Index into the skin-tone palette; cosmetic only. */
  skinTone: number;
}

export interface GameSetup {
  seed: number;
  mapSize: MapSize;
  speed: GameSpeed;
  players: PlayerSetup[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** sfc32 generator state: four uint32 words. */
export type RngState = [number, number, number, number];

export interface Tile extends Hex {
  terrain: string;
  feature: string | null;
  resource: string | null;
  river: boolean;
  /** 0 = sea level; hills and mountains are higher. Used by the renderer for stacking. */
  elevation: number;
  climate: 'polar' | 'boreal' | 'temperate' | 'arid' | 'tropical';
  owner: PlayerId | null;
  settlement: SettlementId | null;
}

export interface MapState {
  width: number;
  height: number;
  /** Row-major, odd-r offset layout: index = row * width + col. */
  tiles: Tile[];
}

export interface Settlement {
  id: SettlementId;
  owner: PlayerId;
  name: string;
  /** Culture whose name list this settlement was named from. */
  namedFor: CultureId;
  at: Hex;
  kind: 'town' | 'city';
  population: number;
  foodStored: number;
  isCapital: boolean;
  production: { item: string | null; progress: number };
}

export interface Unit {
  id: UnitId;
  owner: PlayerId;
  type: string;
  unitClass: UnitClass;
  at: Hex;
  hp: number;
  movesLeft: number;
  /** Set when this unit is a deployed figure. */
  figure: FigureId | null;
}

export type FigureLocation =
  | { state: 'based'; settlement: SettlementId }
  | { state: 'unit'; unit: UnitId }
  | { state: 'seated'; slot: string }
  | { state: 'retired' }
  | { state: 'consumed' };

export interface FigureState {
  id: FigureId;
  owner: PlayerId;
  recruitedTurn: number;
  location: FigureLocation;
}

export interface Offer {
  id: OfferId;
  player: PlayerId;
  /** The points pool that triggered it, or 'deed' / 'legend'. */
  source: GpKind | 'deed' | 'legend';
  candidates: FigureId[];
  /** Player-facing reason per candidate, e.g. "drawn by your tea trade". */
  reasons: Record<FigureId, string>;
}

export interface PlayerState {
  id: PlayerId;
  isHuman: boolean;
  leader: string;
  dream: string;
  colors: { primary: string; secondary: string };
  skinTone: number;
  alive: boolean;
  /** Accumulated stockpiles (gold, science, culture, faith, influence). */
  stock: Record<YieldType, number>;
  /** Last computed per-turn income, for the HUD. */
  income: Record<YieldType, number>;
  /** HIDDEN from the player UI by design. Only flavor hints are shown. */
  affinity: Record<CultureId, number>;
  /** Cultures whose hint thresholds (50, 100) have already fired. */
  hintsShown: Record<CultureId, number>;
  gp: Record<GpKind, number>;
  gpThreshold: Record<GpKind, number>;
  legendSlotUsed: boolean;
  government: string | null;
  cabinet: Record<string, FigureId | null>;
  traditions: string[];
  hybrids: string[];
  legacyPoints: number;
  refinementPoints: number;
}

export interface GameState {
  version: 1;
  seed: number;
  speed: GameSpeed;
  turn: number;
  age: Age;
  /** Shared world age meter, 0–100 (docs: "Age progress, crises and transitions"). */
  ageProgress: number;
  rng: RngState;
  /** Monotonic counter for minting ids deterministically. */
  nextId: number;
  map: MapState;
  playerOrder: PlayerId[];
  players: Record<PlayerId, PlayerState>;
  settlements: Record<SettlementId, Settlement>;
  units: Record<UnitId, Unit>;
  /** Only figures that have been recruited by someone. Unrecruited figures live in content. */
  figures: Record<FigureId, FigureState>;
  offers: Offer[];
}

// ---------------------------------------------------------------------------
// Commands (UI / AI -> sim)
// ---------------------------------------------------------------------------

export type Command =
  | { type: 'moveUnit'; unit: UnitId; to: Hex }
  | { type: 'foundSettlement'; unit: UnitId }
  | { type: 'setProduction'; settlement: SettlementId; item: string | null }
  | { type: 'chooseOffer'; offer: OfferId; figure: FigureId | null }
  | { type: 'seatFigure'; figure: FigureId; slot: string }
  | { type: 'unseatFigure'; figure: FigureId }
  | { type: 'deployFigure'; figure: FigureId; settlement: SettlementId }
  | { type: 'activateFigure'; figure: FigureId }
  | { type: 'consumeFigure'; figure: FigureId; as: 'refinement' | 'yields' }
  | { type: 'setGovernment'; government: string }
  | { type: 'endTurn' };

// ---------------------------------------------------------------------------
// Events (sim -> UI), emitted alongside each new state
// ---------------------------------------------------------------------------

export type SimEvent =
  | { type: 'turnStarted'; turn: number }
  | { type: 'offerCreated'; offer: OfferId; player: PlayerId }
  | { type: 'figureRecruited'; figure: FigureId; player: PlayerId }
  | { type: 'figureJoinedRival'; figure: FigureId; player: PlayerId; rival: PlayerId }
  | { type: 'cultureHint'; player: PlayerId; culture: CultureId; text: string }
  | { type: 'settlementFounded'; settlement: SettlementId; player: PlayerId }
  | { type: 'settlementGrew'; settlement: SettlementId; population: number }
  | { type: 'ageProgress'; value: number }
  | { type: 'ageEnded'; age: Age };

export type CommandResult =
  | { ok: true; state: GameState; events: SimEvent[] }
  | { ok: false; error: string };

/** The full sim surface. Implemented in src/sim/index.ts; must stay pure. */
export interface Sim {
  createGame(setup: GameSetup, content: ContentBundle): { state: GameState; events: SimEvent[] };
  applyCommand(state: GameState, player: PlayerId, command: Command, content: ContentBundle): CommandResult;
}

// ---------------------------------------------------------------------------
// Worker protocol (main thread <-> src/worker/sim.worker.ts)
// ---------------------------------------------------------------------------

export type ToWorker =
  | { type: 'newGame'; setup: GameSetup }
  | { type: 'loadGame'; state: GameState }
  | { type: 'command'; player: PlayerId; command: Command };

export type FromWorker =
  | { type: 'state'; state: GameState; events: SimEvent[] }
  | { type: 'error'; message: string };

/** Figure kinds that can sit in each family of cabinet slot (mirrors content/cabinet_slots.json). */
export type SlotAccepts = Record<string, FigureKind[]>;
