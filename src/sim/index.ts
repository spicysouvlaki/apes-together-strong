/**
 * Sim entry point implementing `Sim` (src/contracts/sim-api.ts).
 *
 * `applyCommand` clones the input state, applies one command to the clone through the
 * owning module and returns the new state plus events; the input is never mutated.
 * Figure commands go to src/emergence, crisis/refinement/transition commands to src/sim/ages.
 */
import { AGES, type ContentBundle, type UnitDef } from '@contracts/content-schemas';
import {
  CITY_STATE_PREFIX,
  type Command,
  type GameSetup,
  type GameState,
  type PlayerId,
  type Sim,
} from '@contracts/sim-api';
import { handleFigureCommand } from '../emergence';
import { handleAgesCommand } from './ages';
import { attack } from './combat';
import { CITY_STATE_START_POP } from './constants';
import type { SimCtx } from './ctx';
import { declareWar, makePeace, openTradeRoute, sendEnvoy } from './diplomacy';
import { generateMap, MAP_DIMENSIONS } from './mapgen';
import { newPlayer } from './players';
import { setGovernment, setResearch } from './research';
import { seedRng, shuffle } from './rng';
import { buyItem, createSettlement, foundSettlement, setProduction, upgradeSettlement } from './settlements';
import { endTurn, beginNextTurn, refreshIncome, startOfTurnForPlayer } from './turn';
import { moveUnit, removeUnit, spawnUnit } from './units';

const FIGURE_COMMANDS: ReadonlySet<Command['type']> = new Set([
  'chooseOffer',
  'seatFigure',
  'unseatFigure',
  'deployFigure',
  'recallFigure',
  'activateFigure',
  'consumeFigure',
]);
const AGES_COMMANDS: ReadonlySet<Command['type']> = new Set([
  'chooseCrisisResponse',
  'adoptTradition',
  'adoptHybrid',
  'nameCiv',
  'finishTransition',
]);

/** Starting units, found by property so content can grow: cheapest of each kind available at the start. */
const startingUnitTypes = (content: ContentBundle): string[] => {
  const free = (u: UnitDef): boolean => u.age === AGES[0] && !u.requiresTech && !u.requiresResource && !u.figureKind;
  const cheapest = (pred: (u: UnitDef) => boolean): UnitDef | undefined =>
    content.units.filter((u) => free(u) && pred(u)).sort((a, b) => a.cost - b.cost)[0];
  const settler = cheapest((u) => u.canFound);
  const infantry = cheapest((u) => u.unitClass === 'infantry');
  const scout = cheapest((u) => u.unitClass === 'civilian' && !u.canFound && !u.canTrade);
  return [settler, infantry, scout].filter((u): u is UnitDef => !!u).map((u) => u.id);
};

const createGame: Sim['createGame'] = (setup: GameSetup, content: ContentBundle) => {
  if (setup.players.length === 0) throw new Error('createGame: no players');
  const holder = { rng: seedRng(setup.seed) };
  const gen = generateMap(setup.mapSize, setup.players.length, content, holder);
  if (gen.starts.length < setup.players.length) throw new Error('createGame: map has too few start positions');
  const tiles = gen.map.tiles.length;
  const state: GameState = {
    version: 2,
    seed: setup.seed,
    speed: setup.speed,
    mapSize: setup.mapSize,
    finalAge: setup.finalAge ?? 'classical',
    difficulty: setup.difficulty ?? 'normal',
    turn: 1,
    age: AGES[0],
    phase: 'playing',
    currentPlayer: setup.players[0]?.id ?? '',
    ageProgress: 0,
    rng: holder.rng,
    nextId: 1,
    map: gen.map,
    playerOrder: setup.players.map((p) => p.id),
    players: {},
    settlements: {},
    units: {},
    figures: {},
    offers: [],
    deedsDone: [],
    wonders: {},
    cityStates: {},
    tradeRoutes: [],
    wars: {},
    crisis: null,
    transition: null,
    result: null,
  };
  for (const ps of setup.players) state.players[ps.id] = newPlayer(ps, tiles, content);
  const ctx: SimCtx = { state, content, events: [] };

  const unitTypes = startingUnitTypes(content);
  setup.players.forEach((ps, i) => {
    const start = gen.starts[i];
    if (!start) return;
    for (const type of unitTypes) spawnUnit(ctx, ps.id, type, start);
  });

  // City-states: a seeded pick of the content list, one per site (GDD §7 "City-states").
  const wanted = Math.min(MAP_DIMENSIONS[setup.mapSize].cityStates, content.cityStates.length, gen.cityStateSites.length);
  const chosen = shuffle(state, content.cityStates).slice(0, wanted);
  chosen.forEach((def, i) => {
    const site = gen.cityStateSites[i];
    if (!site) return;
    const s = createSettlement(state, CITY_STATE_PREFIX + def.id, site, {
      name: def.name,
      namedFor: def.culture,
      kind: 'city',
      isCapital: true,
      population: CITY_STATE_START_POP,
    });
    state.cityStates[def.id] = { id: def.id, settlement: s.id, envoys: {}, suzerain: null, alive: true };
  });

  for (const pid of state.playerOrder) startOfTurnForPlayer(ctx, pid);
  state.currentPlayer = state.playerOrder[0] ?? '';
  ctx.events.push({ type: 'turnStarted', turn: state.turn });
  return { state, events: ctx.events };
};

const dispatch = (ctx: SimCtx, player: PlayerId, command: Command): string | null => {
  const { state } = ctx;
  if (state.phase === 'ended') return 'The game is over.';
  const p = state.players[player];
  if (!p) return 'That player is not in this game.';
  if (!p.alive) return 'You have been eliminated.';

  if (AGES_COMMANDS.has(command.type)) {
    const before = state.phase;
    const err = handleAgesCommand(ctx, player, command);
    if (err) return err;
    if (before === 'transition' && ctx.state.phase === 'playing') beginNextTurn(ctx);
    return null;
  }
  if (state.phase === 'transition') {
    if (command.type === 'setGovernment') return setGovernment(ctx, player, command.government);
    return 'During the age transition you can only refine traditions, name your civilization and choose a government.';
  }
  if (player !== state.currentPlayer) return 'It is not your turn.';
  if (FIGURE_COMMANDS.has(command.type)) return handleFigureCommand(ctx, player, command);

  switch (command.type) {
    case 'moveUnit':
      return moveUnit(ctx, player, command.unit, command.to);
    case 'attack':
      return attack(ctx, player, command.unit, command.target);
    case 'fortify': {
      const u = state.units[command.unit];
      if (!u || u.owner !== player) return 'That unit is not yours.';
      if (u.unitClass === 'civilian') return 'Civilian units cannot fortify.';
      u.fortified = true;
      u.movesLeft = 0;
      return null;
    }
    case 'disbandUnit': {
      const u = state.units[command.unit];
      if (!u || u.owner !== player) return 'That unit is not yours.';
      if (u.figure) return 'A figure cannot be disbanded; recall them to a settlement instead.';
      removeUnit(ctx, u.id);
      return null;
    }
    case 'foundSettlement':
      return foundSettlement(ctx, player, command.unit);
    case 'openTradeRoute':
      return openTradeRoute(ctx, player, command.unit, command.to);
    case 'setProduction':
      return setProduction(ctx, player, command.settlement, command.item);
    case 'buyItem':
      return buyItem(ctx, player, command.settlement, command.item);
    case 'upgradeSettlement':
      return upgradeSettlement(ctx, player, command.settlement);
    case 'setResearch':
      return setResearch(ctx, player, command.tree, command.id);
    case 'setGovernment':
      return setGovernment(ctx, player, command.government);
    case 'declareWar':
      return declareWar(ctx, player, command.target);
    case 'makePeace':
      return makePeace(ctx, player, command.target);
    case 'sendEnvoy':
      return sendEnvoy(ctx, player, command.cityState);
    case 'endTurn':
      return endTurn(ctx, player);
    default:
      return 'That action is not recognized.';
  }
};

/**
 * Commands that change what a player earns per turn. After one succeeds, the shown `income`
 * and `happiness` are refreshed (stockpiles untouched) so the HUD does not read "+0 science"
 * until the next turn after founding a city, a capture, a government change, a seat change…
 */
const YIELD_COMMANDS: ReadonlySet<Command['type']> = new Set([
  'foundSettlement',
  'attack',
  'setProduction',
  'buyItem',
  'upgradeSettlement',
  'setGovernment',
  'seatFigure',
  'unseatFigure',
  'deployFigure',
  'recallFigure',
  'activateFigure',
  'consumeFigure',
  'chooseOffer',
  'adoptTradition',
  'adoptHybrid',
  'sendEnvoy',
  'openTradeRoute',
  'declareWar',
  'makePeace',
  'chooseCrisisResponse',
]);

const isStr = (v: unknown): boolean => typeof v === 'string';
const isHex = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && Number.isInteger((v as { q?: unknown }).q) && Number.isInteger((v as { r?: unknown }).r);

/** Fields each command needs, so a malformed command from a buggy caller gets a clean error. */
const COMMAND_SHAPE: Record<Command['type'], Record<string, (v: unknown) => boolean>> = {
  moveUnit: { unit: isStr, to: isHex },
  attack: { unit: isStr, target: isHex },
  fortify: { unit: isStr },
  disbandUnit: { unit: isStr },
  foundSettlement: { unit: isStr },
  openTradeRoute: { unit: isStr, to: isStr },
  setProduction: { settlement: isStr, item: (v) => v === null || isStr(v) },
  buyItem: { settlement: isStr, item: isStr },
  upgradeSettlement: { settlement: isStr },
  setResearch: { tree: (v) => v === 'tech' || v === 'civic', id: isStr },
  setGovernment: { government: isStr },
  chooseOffer: { offer: isStr, figure: (v) => v === null || isStr(v) },
  seatFigure: { figure: isStr, slot: isStr },
  unseatFigure: { figure: isStr },
  deployFigure: { figure: isStr, settlement: isStr },
  recallFigure: { figure: isStr },
  activateFigure: { figure: isStr },
  consumeFigure: { figure: isStr, as: (v) => v === 'refinement' || v === 'yields' },
  declareWar: { target: isStr },
  makePeace: { target: isStr },
  sendEnvoy: { cityState: isStr },
  chooseCrisisResponse: { option: isStr },
  adoptTradition: { tradition: isStr },
  adoptHybrid: { hybrid: isStr },
  nameCiv: { name: isStr },
  finishTransition: {},
  endTurn: {},
};

const wellFormed = (command: unknown): command is Command => {
  if (typeof command !== 'object' || command === null) return false;
  const shape = Object.prototype.hasOwnProperty.call(COMMAND_SHAPE, (command as { type?: unknown }).type as string)
    ? COMMAND_SHAPE[(command as Command).type]
    : undefined;
  if (!shape) return false;
  for (const [field, ok] of Object.entries(shape)) if (!ok((command as unknown as Record<string, unknown>)[field])) return false;
  return true;
};

/**
 * Never throws: a bug in any module (or a malformed command from the UI) becomes
 * `{ ok: false, error }` with the original message, and the input state is untouched because
 * every module works on the clone.
 */
const applyCommand: Sim['applyCommand'] = (state, player, command, content) => {
  try {
    if (!wellFormed(command)) return { ok: false, error: 'That action is not recognized.' };
    const ctx: SimCtx = { state: structuredClone(state), content, events: [] };
    const error = dispatch(ctx, player, command);
    if (error !== null) return { ok: false, error };
    if (YIELD_COMMANDS.has(command.type) && ctx.state.phase !== 'ended') {
      // Captures, wars and routes touch the other side too: refresh every living player then.
      const all = command.type === 'attack' || command.type === 'declareWar' || command.type === 'makePeace' || command.type === 'openTradeRoute';
      for (const pid of all ? ctx.state.playerOrder : [player]) refreshIncome(ctx.state, pid, content);
    }
    return { ok: true, state: ctx.state, events: ctx.events };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

export const sim: Sim = { createGame, applyCommand };

export { createGame, applyCommand };
export { queries } from './queries';
