/**
 * End-of-age crises (GDD §5 table): start at meter 70, stages at each stage's `at`, a response
 * per stage, and the sim-side pressure behaviors named by the crisis def. The crisis `pressure`
 * modifiers are applied by `playerModifiers` while `state.crisis` is set.
 */
import type { ContentBundle, Crisis, UnitDef, YieldType } from '@contracts/content-schemas';

type CrisisOption = Crisis['stages'][number]['options'][number];
import { axialToOffset, hexDistance, hexesInRange, hexEquals, type Hex } from '@contracts/hex';
import { RAIDER_PLAYER, type GameState, type PlayerId } from '@contracts/sim-api';
import type { SimCtx } from '../ctx';
import { pick } from '../rng';
import { isUndefended } from '../raids';
import { spawnUnit } from '../units';
import {
  CRISIS_START,
  POP_LOSS_INTERVAL,
  POP_LOSS_INTERVAL_WITH_TRADE,
  POP_LOSS_MIN_POP,
  RAIDER_BAND_SIZE,
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

/**
 * Collapse: every few turns a band of raiders gathers near one settlement of each living
 * player, up to a cap. They gather near an undefended settlement when the player has one
 * (src/sim/raids.ts), so an unguarded town is what invites them.
 */
const spawnRaiders = (ctx: SimCtx): void => {
  const { state } = ctx;
  if (state.turn % RAIDER_SPAWN_INTERVAL !== 0) return;
  const type = raiderUnitType(ctx);
  if (!type) return;
  const all = livingPlayers(state);
  const cap = RAIDER_CAP_PER_PLAYER * all.length;
  // Rotate who is served first, so when the cap is reached it is not always the last seats
  // that are spared (fun audit pass 2: a hidden turn-order asymmetry).
  const shift = all.length > 0 ? Math.floor(state.turn / RAIDER_SPAWN_INTERVAL) % all.length : 0;
  const living = [...all.slice(shift), ...all.slice(0, shift)];
  for (const p of living) {
    const owned = Object.keys(state.settlements)
      .sort()
      .filter((id) => state.settlements[id]?.owner === p.id);
    if (owned.length === 0) continue;
    const open = owned.filter((id) => {
      const s = state.settlements[id];
      return !!s && isUndefended(state, s);
    });
    const settlement = state.settlements[pick(state, open.length > 0 ? open : owned)];
    if (!settlement) continue;
    let spawned = 0;
    for (let k = 0; k < RAIDER_BAND_SIZE; k++) {
      if (Object.values(state.units).filter((u) => u.owner === RAIDER_PLAYER).length >= cap) break;
      const tiles = raiderSpawnTiles(ctx, settlement.at);
      if (tiles.length === 0) break;
      if (spawnUnit(ctx, RAIDER_PLAYER, type.id, pick(state, tiles))) spawned++;
    }
    if (spawned > 0) {
      const open = isUndefended(state, settlement) ? ', and no one guards it' : '';
      ctx.events.push({ type: 'notice', player: p.id, text: `Raiders gather near ${settlement.name}${open}.` });
    }
  }
};

// --- popLoss -------------------------------------------------------------------------------

const tradesWith = (state: GameState, player: PlayerId): boolean =>
  state.tradeRoutes.some((r) => r.owner === player || state.settlements[r.to]?.owner === player);

/**
 * Plague: −1 pop in each settlement above the floor every POP_LOSS_INTERVAL turns, faster for
 * players with any trade route in or out ("spreads by trade"). Closing routes — the quarantine
 * response lowers route capacity, and routes over capacity close (src/sim/diplomacy.ts) —
 * slows it back down, at the price of the routes' gold.
 */
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

/** What a response costs beyond what the player holds, summed over its stock costs (0 = affordable). */
export const crisisShortfall = (state: GameState, player: PlayerId, option: CrisisOption): number => {
  const p = state.players[player];
  let short = 0;
  for (const key of Object.keys(option.stock) as YieldType[]) {
    const delta = option.stock[key] ?? 0;
    if (delta < 0) short += Math.max(0, -delta - (p?.stock[key] ?? 0));
  }
  return short;
};

/** Total stock an option takes (its negative deltas), to find the cheapest of two unaffordable ones. */
const crisisPrice = (option: CrisisOption): number =>
  (Object.values(option.stock) as (number | undefined)[]).reduce<number>((a, v) => a + Math.max(0, -(v ?? 0)), 0);

const costText = (state: GameState, player: PlayerId, option: CrisisOption): string => {
  const p = state.players[player];
  const parts: string[] = [];
  for (const key of Object.keys(option.stock) as YieldType[]) {
    const delta = option.stock[key] ?? 0;
    if (delta < 0 && (p?.stock[key] ?? 0) < -delta) parts.push(`${-delta} ${key}; you have ${Math.floor(p?.stock[key] ?? 0)}`);
  }
  return parts.join(', and ');
};

/**
 * Can the player pick this response right now? (Playtest 3: "Pay tribute −40 gold" was taken
 * with 18 gold in the treasury.) Rule: a response whose stock cost the player cannot pay is
 * refused while another response of the stage is affordable. When none is, the cheapest one
 * is allowed and takes whatever the player has (stocks never go below 0), so the crisis can
 * always be answered. Pure; the AI and the UI can call it to enable or explain the choices.
 * Returns a plain-words reason, or null when the response is allowed.
 */
export const crisisResponseBlocked = (state: GameState, player: PlayerId, optionId: string, content: ContentBundle): string | null => {
  const def = state.crisis ? content.crises.find((c) => c.id === state.crisis?.id) : undefined;
  const stage = def && state.crisis ? def.stages[state.crisis.stage - 1] : undefined;
  const option = stage?.options.find((o) => o.id === optionId);
  if (!stage || !option) return null;
  if (crisisShortfall(state, player, option) === 0) return null;
  const affordable = stage.options.filter((o) => crisisShortfall(state, player, o) === 0);
  if (affordable.length > 0) return `${option.label} costs ${costText(state, player, option)}. Choose another response.`;
  // Nothing is affordable: the cheapest response (first in content order on a tie) is allowed.
  let cheapest = stage.options[0];
  for (const o of stage.options) if (cheapest && crisisPrice(o) < crisisPrice(cheapest)) cheapest = o;
  if (cheapest?.id === option.id) return null;
  return `${option.label} costs ${costText(state, player, option)}. You can afford neither response; ${cheapest?.label ?? 'the other'} takes what you have.`;
};

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
  const blocked = crisisResponseBlocked(state, player, optionId, ctx.content);
  if (blocked) return blocked;
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
