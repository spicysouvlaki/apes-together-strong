/**
 * Emergence engine public surface (GDD §3, §4). STUB — owned by workstream 2.
 * The sim core and src/sim/ages call these; signatures are fixed. All functions taking a
 * SimCtx mutate ctx.state (already a clone) and push to ctx.events.
 */
import type { ContentBundle, Yields } from '@contracts/content-schemas';
import type {
  CabinetSeat,
  Command,
  CultureId,
  FigureActions,
  FigureId,
  GameState,
  PlayerId,
  PlayerState,
  SettlementId,
  UnitId,
} from '@contracts/sim-api';
import type { SimCtx } from '../sim/ctx';

const todo = (name: string): never => {
  throw new Error(`TODO(emergence): ${name} not implemented`);
};

/** Initial emergence fields for a new player (zeroed affinity for every culture, GP pools at 0, thresholds at 60). */
export const initEmergence = (
  _content: ContentBundle,
): Pick<PlayerState, 'affinity' | 'hintsShown' | 'gp' | 'gpThreshold' | 'legendSlotUsed' | 'seatedTurns'> =>
  todo('initEmergence');

/**
 * Once per player at the start of each turn, after the sim has computed yields/income and
 * `player.stats`: measure signals, update affinity (A ← 0.98·A + Σ w·x), fire 50/100 hints,
 * accrue great-people points, create offers when pools cross thresholds, tick seatedTurns,
 * and check deeds. The sim resets the `...ThisTurn` stats after calling this.
 */
export const emergenceTick = (_ctx: SimCtx, _player: PlayerId): void => todo('emergenceTick');

/** Direct affinity grant (wonder built, envoy sent, trade route, cultural exchange). Applies affinityGain modifiers. */
export const addAffinity = (_ctx: SimCtx, _player: PlayerId, _culture: CultureId, _amount: number): void =>
  todo('addAffinity');

/**
 * Handles chooseOffer, seatFigure, unseatFigure, deployFigure, recallFigure, activateFigure,
 * consumeFigure. Returns an error string, or null on success. The sim core routes these
 * command types here and does not validate them itself.
 */
export const handleFigureCommand = (_ctx: SimCtx, _player: PlayerId, _command: Command): string | null =>
  todo('handleFigureCommand');

/** Rebuild `player.cabinet` keys for the current government + cabinetSlot modifiers; unseat figures whose seat vanished (they become 'based' in the capital). */
export const syncCabinet = (_ctx: SimCtx, _player: PlayerId): void => todo('syncCabinet');

/** Spoils of conquest (GDD §3): figures based in the settlement move to the captor. */
export const onSettlementCaptured = (_ctx: SimCtx, _settlement: SettlementId, _from: PlayerId, _to: PlayerId): void =>
  todo('onSettlementCaptured');

/** Eliminating a rival takes all of their figures (`to` null = they retire from the world). */
export const onPlayerEliminated = (_ctx: SimCtx, _loser: PlayerId, _to: PlayerId | null): void =>
  todo('onPlayerEliminated');

/**
 * A figure-unit lost a battle (hp would reach 0). Instead of dying it retreats to the owner's
 * nearest settlement at 1 HP; if there is nowhere to go it is captured by `victor` (the unit is
 * removed and the figure becomes 'based' in the victor's capital). The sim calls this INSTEAD
 * of deleting the unit.
 */
export const onFigureUnitDefeated = (_ctx: SimCtx, _unit: UnitId, _victor: PlayerId): void =>
  todo('onFigureUnitDefeated');

/** Age transition: every non-consumed figure of the player retires to the Hall of Ancestors; cabinet empties. Returns the retired ids. */
export const retireFigures = (_ctx: SimCtx, _player: PlayerId): FigureId[] => todo('retireFigures');

/** New age: reset per-age emergence state (legend slot; GP thresholds keep growing). */
export const onAgeStarted = (_ctx: SimCtx, _player: PlayerId): void => todo('onAgeStarted');

/** Hall of Ancestors income: +1 of each retired figure's main yield per turn (GDD §3). */
export const ancestorYields = (_state: GameState, _player: PlayerId, _content: ContentBundle): Yields =>
  todo('ancestorYields');

// --- Queries (re-exported through src/sim/queries.ts) ---

export const cabinetSeats = (_state: GameState, _player: PlayerId, _content: ContentBundle): CabinetSeat[] =>
  todo('cabinetSeats');

export const figureActions = (_state: GameState, _figure: FigureId, _content: ContentBundle): FigureActions =>
  todo('figureActions');

export const cultureWeights = (
  _state: GameState,
  _player: PlayerId,
  _content: ContentBundle,
): Record<CultureId, number> => todo('cultureWeights');
