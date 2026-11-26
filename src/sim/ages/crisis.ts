/**
 * End-of-age crises (GDD §5 table): start at meter 70, stages at each stage's `at`, a response
 * per stage, and the sim-side pressure behaviors named by the crisis def. The crisis `pressure`
 * modifiers are applied by `playerModifiers` while `state.crisis` is set.
 */
import type { Crisis, UnitDef } from '@contracts/content-schemas';
import { axialToOffset, hexDistance, hexesInRange, hexEquals, type Hex } from '@contracts/hex';
import { RAIDER_PLAYER, type GameState, type PlayerId } from '@contracts/sim-api';
import type { SimCtx } from '../ctx';
import { pick } from '../rng';
import { spawnUnit } from '../units';
import {
  CRISIS_START,
  POP_LOSS_INTERVAL,
  POP_LOSS_INTERVAL_WITH_TRADE,
  POP_LOSS_MIN_POP,
  RAIDER_CAP_PER_PLAYER,
  RAIDER_MAX_DISTANCE,
  RAIDER_MIN_DISTANCE,
  RAIDER_SPAWN_INTERVAL,
  UNREST_HAPPINESS_BELOW,
  UNREST_PROGRESS_LOSS_PERCENT,
} from './constants';
import { addChronicle, ageIndex, livingPlayers } from './util';

export const activeCrisisDef = (ctx: SimCtx): Crisis | null => {
  const id = ctx.state.crisis?.id;
  return id ? (ctx.content.crises.find((c) => c.id === id) ?? null) : null;
};

/**
 * Start the crisis at 70 and fire at most one stage per world phase, so every stage gets its
 * own response even if the meter jumps (players cannot end a turn while awaiting).
 */
export const advanceCrisis = (ctx: SimCtx): void => {
  const { state, content } = ctx;
  if (!state.crisis) {
    if (state.ageProgress < CRISIS_START) return;
    const def = content.crises.find((c) => c.age === state.age);
    if (!def) return;
    state.crisis = { id: def.id, stage: 0, awaiting: [] };
    ctx.events.push({ type: 'crisisStarted', crisis: def.id });
    for (const p of livingPlayers(state)) addChronicle(state, p.id, 'crisis', def.id, `${def.name}: ${def.description}`);
  }
  const crisis = state.crisis;
  const def = activeCrisisDef(ctx);
  if (!def) return;
  const next = def.stages[crisis.stage];
  if (!next || state.ageProgress < next.at) return;
  crisis.stage++;
  crisis.awaiting = livingPlayers(state).map((p) => p.id);
  ctx.events.push({ type: 'crisisStage', crisis: def.id, stage: crisis.stage });
};

/** Run each behavior the active crisis lists, once per world phase. */
export const runCrisisBehaviors = (ctx: SimCtx): void => {
  const def = activeCrisisDef(ctx);
  if (!def) return;
  for (const b of def.behaviors) {
    if (b === 'raiders') spawnRaiders(ctx);
    else if (b === 'popLoss') popLoss(ctx);
    else unrest(ctx);
  }
};

// --- raiders -------------------------------------------------------------------------------

/** The current age's infantry (falling back to the latest earlier age that has one). */
export const raiderUnitType = (ctx: SimCtx): UnitDef | null => {
  const ai = ageIndex(ctx.state.age);
  let best: UnitDef | null = null;
  for (const u of ctx.content.units) {
    if (u.unitClass !== 'infantry' || u.figureKind || u.strength <= 0) continue;
    const ui = ageIndex(u.age);
    if (ui > ai) continue;
    if (!best || ui > ageIndex(best.age)) best = u;
  }
  return best;
};

const tileAt = (state: GameState, h: Hex) => {
  const { col, row } = axialToOffset(h);
  if (col < 0 || row < 0 || col >= state.map.width || row >= state.map.height) return null;
  return state.map.tiles[row * state.map.width + col] ?? null;
};

/** Unowned, passable land tiles 3–5 from `center` with no unit on them, in hexesInRange order. */
export const raiderSpawnTiles = (ctx: SimCtx, center: Hex): Hex[] => {
  const { state, content } = ctx;
  const occupied = Object.values(state.units).map((u) => u.at);
  const out: Hex[] = [];
  for (const h of hexesInRange(center, RAIDER_MAX_DISTANCE)) {
    if (hexDistance(h, center) < RAIDER_MIN_DISTANCE) continue;
    const tile = tileAt(state, h);
    if (!tile || tile.owner !== null || tile.settlement !== null) continue;
    const terrain = content.terrain.find((t) => t.id === tile.terrain);
    if (!terrain || terrain.water || terrain.moveCost === null) continue;
    if (occupied.some((o) => hexEquals(o, h))) continue;
    out.push({ q: h.q, r: h.r });
  }
  return out;
};

/** Collapse: every few turns, one raider near a random settlement of each living player, up to a cap. */
const spawnRaiders = (ctx: SimCtx): void => {
  const { state } = ctx;
  if (state.turn % RAIDER_SPAWN_INTERVAL !== 0) return;
  const type = raiderUnitType(ctx);
  if (!type) return;
  const living = livingPlayers(state);
  const cap = RAIDER_CAP_PER_PLAYER * living.length;
  for (const p of living) {
    const raiders = Object.values(state.units).filter((u) => u.owner === RAIDER_PLAYER).length;
    if (raiders >= cap) return;
    const owned = Object.keys(state.settlements)
      .sort()
      .filter((id) => state.settlements[id]?.owner === p.id);
    if (owned.length === 0) continue;
    const settlement = state.settlements[pick(state, owned)];
    if (!settlement) continue;
    const tiles = raiderSpawnTiles(ctx, settlement.at);
    if (tiles.length === 0) continue;
    if (spawnUnit(ctx, RAIDER_PLAYER, type.id, pick(state, tiles))) {
      ctx.events.push({ type: 'notice', player: p.id, text: `Raiders gather near ${settlement.name}.` });
    }
  }
};

// --- popLoss -------------------------------------------------------------------------------

const tradesWith = (state: GameState, player: PlayerId): boolean =>
  state.tradeRoutes.some((r) => r.owner === player || state.settlements[r.to]?.owner === player);

/** Plague: −1 pop in each settlement above the floor every 10 turns (every 5 for trading players). */
const popLoss = (ctx: SimCtx): void => {
  const { state } = ctx;
  for (const p of livingPlayers(state)) {
    const interval = tradesWith(state, p.id) ? POP_LOSS_INTERVAL_WITH_TRADE : POP_LOSS_INTERVAL;
    if (state.turn % interval !== 0) continue;
    let lost = 0;
    for (const id of Object.keys(state.settlements).sort()) {
      const s = state.settlements[id];
      if (!s || s.owner !== p.id || s.population <= POP_LOSS_MIN_POP) continue;
      s.population -= 1;
      lost++;
    }
    if (lost > 0) ctx.events.push({ type: 'notice', player: p.id, text: `Sickness took people from ${lost} ${lost === 1 ? 'settlement' : 'settlements'}.` });
  }
};

// --- unrest --------------------------------------------------------------------------------

/** Unrest: unhappy players' settlements lose part of their production progress each turn. */
const unrest = (ctx: SimCtx): void => {
  const { state } = ctx;
  for (const p of livingPlayers(state)) {
    if (p.happiness >= UNREST_HAPPINESS_BELOW) continue;
    for (const id of Object.keys(state.settlements).sort()) {
      const s = state.settlements[id];
      if (!s || s.owner !== p.id || s.production.progress <= 0) continue;
      s.production.progress = Math.floor((s.production.progress * (100 - UNREST_PROGRESS_LOSS_PERCENT)) / 100);
    }
  }
};

// --- responses -----------------------------------------------------------------------------

export const chooseCrisisResponse = (ctx: SimCtx, player: PlayerId, optionId: string): string | null => {
  const { state } = ctx;
  if (state.phase !== 'playing') return 'Crisis responses are chosen during play, not at an age transition.';
  const crisis = state.crisis;
  const def = activeCrisisDef(ctx);
  if (!crisis || !def) return 'No crisis is under way.';
  if (!crisis.awaiting.includes(player)) return 'No crisis response is due from you right now.';
  const stage = def.stages[crisis.stage - 1];
  const option = stage?.options.find((o) => o.id === optionId);
  if (!option) return 'That is not an option at this stage of the crisis.';
  const p = state.players[player];
  if (!p) return 'That player is not in this game.';
  for (const key of Object.keys(option.stock) as (keyof typeof option.stock)[]) {
    const delta = option.stock[key] ?? 0;
    p.stock[key] = Math.max(0, (p.stock[key] ?? 0) + delta);
  }
  if (option.modifiers.length > 0) {
    p.effects.push({ source: `crisis:${option.id}`, untilTurn: -1, modifiers: option.modifiers });
  }
  p.crisisChoices.push(option.id);
  crisis.awaiting = crisis.awaiting.filter((id) => id !== player);
  addChronicle(state, player, 'crisis', option.id, `${def.name}: ${option.label}. ${option.description}`);
  return null;
};
