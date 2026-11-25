/**
 * The simulation contract. The sim (src/sim, src/emergence, src/ai) owns GameState and is the
 * only code that changes it. The UI and renderer read GameState snapshots and send Commands.
 *
 * Invariants:
 * - GameState is plain JSON: no classes, Maps, Sets, Dates, undefined-vs-missing tricks, or functions.
 * - The sim is deterministic: same state + same commands => byte-identical next state.
 *   All randomness comes from `state.rng`; never Math.random, Date.now or performance.now.
 * - Object key insertion order must be deterministic too (it affects JSON.stringify output).
 */
import type { Age, ContentBundle, FigureKind, GpKind, LegacyTrack, Modifier, UnitClass, YieldType } from './content-schemas';
import type { Hex } from './hex';

export type PlayerId = string;
export type SettlementId = string;
export type UnitId = string;
export type FigureId = string;
export type CultureId = string;
export type OfferId = string;

export type MapSize = 'small' | 'standard' | 'large';
export type GameSpeed = 'quick' | 'standard' | 'epic';

/** Settlements of city-states are owned by the pseudo-player `cs:<cityStateId>`. */
export const CITY_STATE_PREFIX = 'cs:';
/** Crisis raiders (GDD §5 "Collapse") belong to this pseudo-player; always hostile to everyone. */
export const RAIDER_PLAYER: PlayerId = 'raiders';
export const isCityStateOwner = (owner: string): boolean => owner.startsWith(CITY_STATE_PREFIX);

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
  /** Last age to play; the game ends when its meter hits 100. Default 'classical' (M4). */
  finalAge?: Age;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** sfc32 generator state: four uint32 words. */
export type RngState = [number, number, number, number];

export interface Tile extends Hex {
  terrain: string;
  /** 'forest' | 'hills' | 'jungle' | 'marsh' | 'oasis' | null (ids used by content/signals.json). */
  feature: string | null;
  resource: string | null;
  river: boolean;
  /** 0 = sea level; hills and mountains are higher. Used by the renderer for stacking. */
  elevation: number;
  climate: 'polar' | 'boreal' | 'temperate' | 'arid' | 'tropical';
  owner: PlayerId | null;
  settlement: SettlementId | null;
  /** Landmass id (0 = water). Tiles sharing an id are connected by land. */
  continent: number;
}

export interface MapState {
  width: number;
  height: number;
  /** Row-major, odd-r offset layout: index = row * width + col. The map does not wrap. */
  tiles: Tile[];
}

export interface Settlement {
  id: SettlementId;
  /** A PlayerId, or `cs:<cityStateId>` for a city-state. */
  owner: PlayerId;
  /** Who founded it; used for "original capital" rules and conquest. */
  originalOwner: PlayerId;
  name: string;
  /** Culture whose name list this settlement was named from. */
  namedFor: CultureId;
  at: Hex;
  kind: 'town' | 'city';
  population: number;
  foodStored: number;
  isCapital: boolean;
  foundedTurn: number;
  /** Building ids, in build order. */
  buildings: string[];
  /** Wall HP. A settlement falls when this is 0 and a melee unit attacks it (GDD §7). */
  hp: number;
  maxHp: number;
  /** Consecutive turns survived with hp < maxHp while an enemy was adjacent (deeds). */
  siegeTurns: number;
  /** `item` is a unit, building or wonder id (one shared namespace). Towns cannot produce. */
  production: { item: string | null; progress: number };
}

export interface Unit {
  id: UnitId;
  /** A PlayerId or RAIDER_PLAYER. */
  owner: PlayerId;
  /** Id in content/units.json. */
  type: string;
  unitClass: UnitClass;
  at: Hex;
  hp: number;
  movesLeft: number;
  /** Fortified units get +5 defense (GDD §7); cleared on move or attack. */
  fortified: boolean;
  /** A unit may attack once per turn. */
  hasAttacked: boolean;
  /** Set when this unit is a deployed figure. */
  figure: FigureId | null;
}

export type FigureLocation =
  | { state: 'based'; settlement: SettlementId }
  | { state: 'unit'; unit: UnitId }
  /** `slot` is a cabinet slot KEY (see PlayerState.cabinet). */
  | { state: 'seated'; slot: string }
  /** Hall of Ancestors: +1 of their main yield per turn forever (GDD §3). */
  | { state: 'retired' }
  | { state: 'consumed' };

export interface FigureState {
  id: FigureId;
  owner: PlayerId;
  recruitedTurn: number;
  recruitedAge: Age;
  /** Why they came, kept for the roster and Chronicle ("drawn by your tea trade"). */
  reason: string;
  /** True once the one-time activate effect was used (then location is 'retired'). */
  activated: boolean;
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
  /** For deed offers: the deed id (single candidate, cannot be skipped away to a rival). */
  deed: string | null;
  createdTurn: number;
}

/** A temporary set of modifiers (consume-for-yields burst, crisis responses, celebrations). */
export interface TimedEffect {
  source: string;
  /** Last turn on which the effect applies; -1 = until the current age ends. */
  untilTurn: number;
  modifiers: Modifier[];
}

/** Counters the emergence engine, deeds and legacy milestones read. Maintained by the sim. */
export interface PlayerStats {
  battlesWonThisTurn: number;
  citiesCapturedThisTurn: number;
  battlesWon: number;
  /** Battles won during the current age (resets at transition). */
  battlesWonThisAge: number;
  citiesCaptured: number;
  unitsLost: number;
  wondersBuilt: number;
  figuresRecruited: number;
  figuresActivated: number;
  envoysSent: number;
  /** Highest `Settlement.siegeTurns` ever reached by one of this player's settlements. */
  siegeTurnsHeld: number;
}

export interface ResearchSlot {
  current: string | null;
  progress: number;
}

export type ChronicleKind =
  | 'founding'
  | 'figure'
  | 'tradition'
  | 'hybrid'
  | 'name'
  | 'wonder'
  | 'city'
  | 'war'
  | 'crisis'
  | 'age'
  | 'deed';

/** One line of the end-of-game Chronicle (GDD §8). `ref` is a content or entity id. */
export interface ChronicleEntry {
  turn: number;
  age: Age;
  kind: ChronicleKind;
  ref: string;
  text: string;
}

export interface PlayerState {
  id: PlayerId;
  isHuman: boolean;
  leader: string;
  dream: string;
  colors: { primary: string; secondary: string };
  skinTone: number;
  alive: boolean;
  /** Player-chosen civilization name; null until the first refinement (GDD §6 "Naming"). */
  civName: string | null;
  /** Accumulated stockpiles (gold, science, culture, faith, influence). */
  stock: Record<YieldType, number>;
  /** Last computed per-turn income, for the HUD. */
  income: Record<YieldType, number>;
  /** Empire happiness as last computed (GDD §7). */
  happiness: number;
  /** HIDDEN from the player UI by design. The worker strips it from posted snapshots. */
  affinity: Record<CultureId, number>;
  /** Cultures whose hint thresholds (50, 100) have already fired. */
  hintsShown: Record<CultureId, number>;
  gp: Record<GpKind, number>;
  gpThreshold: Record<GpKind, number>;
  legendSlotUsed: boolean;
  government: string | null;
  /** Turns of anarchy left (mid-age government change); no cabinet bonuses meanwhile. */
  anarchyTurns: number;
  /**
   * Cabinet seats keyed by slot KEY = `${slotId}#${n}` where n counts duplicates in the
   * government's `cabinetSlots` (e.g. despotism: "warleader#0", "warleader#1").
   * Extra seats from `cabinetSlot` modifiers continue the numbering.
   */
  cabinet: Record<string, FigureId | null>;
  /** Slot key -> first turn a figure may be seated there again (2-turn unseat cooldown). */
  cabinetCooldown: Record<string, number>;
  /** Total turns figures of each culture have spent seated (culture weight, GDD §6). */
  seatedTurns: Record<CultureId, number>;
  traditions: string[];
  hybrids: string[];
  /** Completed tech and civic node ids (all ages). */
  techs: string[];
  research: { tech: ResearchSlot; civic: ResearchSlot };
  /** Achieved legacy milestones as `${milestoneId}:${1|2|3}`. */
  milestones: string[];
  legacyPoints: number;
  refinementPoints: number;
  /** Running Legacy score (GDD §8), refreshed each turn. */
  score: number;
  effects: TimedEffect[];
  stats: PlayerStats;
  /** 0/1 per tile index: has this player ever seen the tile. */
  explored: number[];
  /** Crisis response option ids chosen so far in the current crisis. */
  crisisChoices: string[];
  chronicle: ChronicleEntry[];
}

export interface CityStateState {
  /** Id in content/city_states.json. */
  id: string;
  settlement: SettlementId;
  envoys: Record<PlayerId, number>;
  /** Player with the most envoys (minimum 3), else null. */
  suzerain: PlayerId | null;
  alive: boolean;
}

export interface TradeRoute {
  id: string;
  owner: PlayerId;
  from: SettlementId;
  to: SettlementId;
}

export interface CrisisState {
  /** Id in content/crises.json. */
  id: string;
  /** Number of stages that have fired (0–3). */
  stage: number;
  /** Players who still owe a response to the latest stage. They cannot end their turn. */
  awaiting: PlayerId[];
}

/** What a player takes into the refinement screen (GDD §5 "Transition", §6). */
export interface TransitionRecap {
  legacyPointsEarned: number;
  rpEarned: number;
  milestones: string[];
  retiredFigures: FigureId[];
  /** Three proposed civilization names. */
  nameOptions: string[];
  /** Signature / hybrid purchases made this transition (max 1 each). */
  signaturesBought: number;
  hybridsBought: number;
  done: boolean;
}

export interface TransitionState {
  fromAge: Age;
  toAge: Age;
  recap: Record<PlayerId, TransitionRecap>;
}

export interface GameResult {
  winner: PlayerId;
  scores: Record<PlayerId, number>;
  reason: string;
}

export interface GameState {
  version: 2;
  seed: number;
  speed: GameSpeed;
  mapSize: MapSize;
  finalAge: Age;
  turn: number;
  age: Age;
  /**
   * 'playing': normal turns. 'transition': between ages; every player refines, names and picks
   * a government, then sends `finishTransition`. 'ended': `result` is set; only the Chronicle remains.
   */
  phase: 'playing' | 'transition' | 'ended';
  /** Whose turn it is during 'playing'. Players act in `playerOrder`; after the last, the world phase runs. */
  currentPlayer: PlayerId;
  /** Shared world age meter, 0–100 (GDD §5). */
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
  /** Deed ids already completed by anyone (once per world). */
  deedsDone: string[];
  /** wonderId -> who built it and where. */
  wonders: Record<string, { owner: PlayerId; settlement: SettlementId; turn: number }>;
  cityStates: Record<string, CityStateState>;
  tradeRoutes: TradeRoute[];
  /** Pairs at war, as sorted `${a}|${b}` keys -> turn war began. Absent = peace. */
  wars: Record<string, number>;
  crisis: CrisisState | null;
  transition: TransitionState | null;
  result: GameResult | null;
}

export const warKey = (a: PlayerId, b: PlayerId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

// ---------------------------------------------------------------------------
// Commands (UI / AI -> sim)
// ---------------------------------------------------------------------------

export type Command =
  // Units
  | { type: 'moveUnit'; unit: UnitId; to: Hex }
  /** Melee or ranged, decided by the unit and the distance. Target may be a unit or a settlement. */
  | { type: 'attack'; unit: UnitId; target: Hex }
  | { type: 'fortify'; unit: UnitId }
  | { type: 'disbandUnit'; unit: UnitId }
  | { type: 'foundSettlement'; unit: UnitId }
  | { type: 'openTradeRoute'; unit: UnitId; to: SettlementId }
  // Settlements
  | { type: 'setProduction'; settlement: SettlementId; item: string | null }
  /** Buy the item outright with gold. */
  | { type: 'buyItem'; settlement: SettlementId; item: string }
  /** Town -> city, for gold. */
  | { type: 'upgradeSettlement'; settlement: SettlementId }
  // Trees and government
  | { type: 'setResearch'; tree: 'tech' | 'civic'; id: string }
  | { type: 'setGovernment'; government: string }
  // Figures
  | { type: 'chooseOffer'; offer: OfferId; figure: FigureId | null }
  /** `slot` is a cabinet slot KEY (e.g. "warleader#0"). */
  | { type: 'seatFigure'; figure: FigureId; slot: string }
  | { type: 'unseatFigure'; figure: FigureId }
  | { type: 'deployFigure'; figure: FigureId; settlement: SettlementId }
  /** Return a deployed figure-unit standing in an own settlement to 'based'. */
  | { type: 'recallFigure'; figure: FigureId }
  | { type: 'activateFigure'; figure: FigureId }
  | { type: 'consumeFigure'; figure: FigureId; as: 'refinement' | 'yields' }
  // Diplomacy and city-states
  | { type: 'declareWar'; target: PlayerId }
  /** Costs influence (GDD §7); accepted automatically after a minimum war length. */
  | { type: 'makePeace'; target: PlayerId }
  | { type: 'sendEnvoy'; cityState: string }
  // Crisis and transition
  | { type: 'chooseCrisisResponse'; option: string }
  | { type: 'adoptTradition'; tradition: string }
  | { type: 'adoptHybrid'; hybrid: string }
  | { type: 'nameCiv'; name: string }
  | { type: 'finishTransition' }
  | { type: 'endTurn' };

// ---------------------------------------------------------------------------
// Events (sim -> UI), emitted alongside each new state
// ---------------------------------------------------------------------------

export type SimEvent =
  | { type: 'turnStarted'; turn: number }
  | { type: 'offerCreated'; offer: OfferId; player: PlayerId }
  | { type: 'figureRecruited'; figure: FigureId; player: PlayerId }
  | { type: 'figureJoinedRival'; figure: FigureId; player: PlayerId; rival: PlayerId }
  | { type: 'figureRetired'; figure: FigureId; player: PlayerId }
  | { type: 'figureCaptured'; figure: FigureId; from: PlayerId; to: PlayerId }
  | { type: 'deedCompleted'; deed: string; figure: FigureId; player: PlayerId }
  | { type: 'cultureHint'; player: PlayerId; culture: CultureId; text: string }
  | { type: 'settlementFounded'; settlement: SettlementId; player: PlayerId }
  | { type: 'settlementGrew'; settlement: SettlementId; population: number }
  | { type: 'settlementCaptured'; settlement: SettlementId; from: PlayerId; to: PlayerId }
  | { type: 'productionCompleted'; settlement: SettlementId; item: string; player: PlayerId }
  | { type: 'wonderBuilt'; wonder: string; player: PlayerId; settlement: SettlementId }
  | { type: 'researchCompleted'; player: PlayerId; tree: 'tech' | 'civic'; id: string }
  | {
      type: 'combat';
      attacker: UnitId;
      attackerOwner: PlayerId;
      defenderOwner: PlayerId;
      /** Null when the target was a settlement's walls. */
      defender: UnitId | null;
      at: Hex;
      damageToAttacker: number;
      damageToDefender: number;
      attackerDied: boolean;
      defenderDied: boolean;
    }
  | { type: 'warDeclared'; by: PlayerId; on: PlayerId }
  | { type: 'peaceMade'; a: PlayerId; b: PlayerId }
  | { type: 'envoySent'; player: PlayerId; cityState: string }
  | { type: 'suzerainChanged'; cityState: string; suzerain: PlayerId | null }
  | { type: 'tradeRouteOpened'; player: PlayerId; from: SettlementId; to: SettlementId }
  | { type: 'milestoneReached'; player: PlayerId; milestone: string; track: LegacyTrack }
  | { type: 'crisisStarted'; crisis: string }
  | { type: 'crisisStage'; crisis: string; stage: number }
  | { type: 'traditionAdopted'; player: PlayerId; tradition: string }
  | { type: 'hybridAdopted'; player: PlayerId; hybrid: string }
  | { type: 'civNamed'; player: PlayerId; name: string }
  | { type: 'ageProgress'; value: number }
  | { type: 'ageEnded'; age: Age }
  | { type: 'transitionStarted'; from: Age; to: Age }
  | { type: 'ageStarted'; age: Age }
  | { type: 'playerEliminated'; player: PlayerId; by: PlayerId | null }
  | { type: 'gameEnded'; winner: PlayerId }
  /** Generic player-facing toast; `player` null = everyone. */
  | { type: 'notice'; player: PlayerId | null; text: string };

export type CommandResult =
  | { ok: true; state: GameState; events: SimEvent[] }
  | { ok: false; error: string };

/** The full sim surface. Implemented in src/sim/index.ts; must stay pure. */
export interface Sim {
  createGame(setup: GameSetup, content: ContentBundle): { state: GameState; events: SimEvent[] };
  applyCommand(state: GameState, player: PlayerId, command: Command, content: ContentBundle): CommandResult;
}

// ---------------------------------------------------------------------------
// Read-only queries. Pure functions of (state, content) implemented by the sim in
// src/sim/queries.ts and importable by the UI, renderer and AI so that rules
// (what is legal, what it costs) live in one place. They never mutate state.
// ---------------------------------------------------------------------------

export interface ProductionOption {
  item: string;
  kind: 'unit' | 'building' | 'wonder';
  cost: number;
  /** Turns at current production, null if production is 0. */
  turns: number | null;
  goldCost: number;
}

export interface ResearchOption {
  id: string;
  cost: number;
  turns: number | null;
}

export interface CabinetSeat {
  /** Slot key, e.g. "warleader#0". */
  key: string;
  /** Slot id in content/cabinet_slots.json. */
  slot: string;
  figure: FigureId | null;
  /** First turn a figure may be seated here; <= state.turn means free. */
  availableTurn: number;
}

export interface FigureActions {
  /** Slot keys this figure may be seated in right now. */
  seat: string[];
  /** Own settlements (cities) the figure may be deployed to as a unit. */
  deploy: SettlementId[];
  canUnseat: boolean;
  canRecall: boolean;
  canActivate: boolean;
  canConsume: boolean;
}

export interface RefinementOption {
  id: string;
  kind: 'tradition' | 'hybrid';
  /** Cost after the heaviest-culture discount and modifiers. */
  cost: number;
  available: boolean;
  /** Why not, when unavailable ("Needs weight 3 in Greek", "Needs Symposium", "Not enough points"). */
  blocked: string | null;
}

export type Decision =
  | { type: 'offer'; offer: OfferId }
  | { type: 'crisis'; crisis: string; stage: number }
  | { type: 'production'; settlement: SettlementId }
  | { type: 'research'; tree: 'tech' | 'civic' }
  | { type: 'government' }
  | { type: 'transition' };

export interface MilestoneProgress {
  id: string;
  track: LegacyTrack;
  description: string;
  value: number;
  thresholds: [number, number, number];
  achieved: number;
}

export interface SimQueries {
  /** Tiles the unit can move to this turn (excluding its own tile), with movement cost. */
  reachable(state: GameState, unit: UnitId, content: ContentBundle): { hex: Hex; cost: number }[];
  /** Tiles holding something this unit can attack right now. */
  attackTargets(state: GameState, unit: UnitId, content: ContentBundle): Hex[];
  canFound(state: GameState, unit: UnitId, content: ContentBundle): boolean;
  /** Settlements a merchant unit could open a route to from where it stands. */
  tradeTargets(state: GameState, unit: UnitId, content: ContentBundle): SettlementId[];
  productionOptions(state: GameState, settlement: SettlementId, content: ContentBundle): ProductionOption[];
  settlementYields(state: GameState, settlement: SettlementId, content: ContentBundle): Record<YieldType, number>;
  /** Tiles the settlement is working this turn. */
  workedTiles(state: GameState, settlement: SettlementId, content: ContentBundle): Hex[];
  /** Food needed for the next population point (GDD §7). */
  growthCost(population: number): number;
  upgradeCost(state: GameState, settlement: SettlementId, content: ContentBundle): number;
  settlementCap(state: GameState, player: PlayerId, content: ContentBundle): number;
  researchOptions(state: GameState, player: PlayerId, tree: 'tech' | 'civic', content: ContentBundle): ResearchOption[];
  governmentOptions(state: GameState, player: PlayerId, content: ContentBundle): string[];
  /** Tile indices currently visible to the player (fog of war lifts here). */
  visibleTiles(state: GameState, player: PlayerId, content: ContentBundle): number[];
  atWar(state: GameState, a: PlayerId, b: PlayerId): boolean;
  envoyCost(state: GameState, player: PlayerId, cityState: string, content: ContentBundle): number;
  cabinetSeats(state: GameState, player: PlayerId, content: ContentBundle): CabinetSeat[];
  figureActions(state: GameState, figure: FigureId, content: ContentBundle): FigureActions;
  /**
   * Culture weight (GDD §6): figures recruited + seated turns / 10. Public information,
   * unlike affinity, because the player can count their own figures.
   */
  cultureWeights(state: GameState, player: PlayerId, content: ContentBundle): Record<CultureId, number>;
  refinementOptions(state: GameState, player: PlayerId, content: ContentBundle): RefinementOption[];
  milestones(state: GameState, player: PlayerId, content: ContentBundle): MilestoneProgress[];
  score(state: GameState, player: PlayerId, content: ContentBundle): number;
  /** Things the player must answer before `endTurn` is accepted, most urgent first. */
  pendingDecisions(state: GameState, player: PlayerId, content: ContentBundle): Decision[];
}

// ---------------------------------------------------------------------------
// Worker protocol (main thread <-> src/worker/sim.worker.ts)
//
// The worker owns the authoritative GameState and the saves (IndexedDB is available in
// workers). Snapshots posted to the main thread have every player's `affinity` emptied,
// so affinity numbers can never reach the UI (GDD §4 "Hidden affinity").
// ---------------------------------------------------------------------------

export interface SaveMeta {
  /** 'auto:0'..'auto:4' (0 = newest) or 'slot:0'..'slot:9'. */
  slot: string;
  savedAt: number;
  turn: number;
  age: Age;
  civName: string | null;
  leader: string;
}

export type ToWorker =
  | { type: 'newGame'; setup: GameSetup }
  | { type: 'command'; player: PlayerId; command: Command }
  | { type: 'save'; slot: string }
  | { type: 'load'; slot: string }
  | { type: 'deleteSave'; slot: string }
  | { type: 'listSaves' };

export type FromWorker =
  | { type: 'state'; state: GameState; events: SimEvent[] }
  /** Sent while rival turns are being computed, so the UI can show "Rivals are moving…". */
  | { type: 'thinking'; player: PlayerId }
  | { type: 'saves'; saves: SaveMeta[] }
  | { type: 'error'; message: string };

/** Figure kinds that can sit in each family of cabinet slot (mirrors content/cabinet_slots.json). */
export type SlotAccepts = Record<string, FigureKind[]>;
