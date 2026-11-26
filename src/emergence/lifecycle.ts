/**
 * Figures over time: conquest (GDD §3 "Spoils of conquest"), defeat in battle, retirement at
 * transitions and the Hall of Ancestors, per-age resets, seated-turn bookkeeping.
 */
import { YIELDS, type ContentBundle, type Yields } from '@contracts/content-schemas';
import { hexDistance } from '@contracts/hex';
import type { FigureId, FigureState, GameState, PlayerId, SettlementId, UnitId } from '@contracts/sim-api';
import type { SimCtx } from '../sim/ctx';
import { removeUnit, spawnUnit } from '../sim/units';
import { baseAtHome, vacateSeat } from './cabinet';
import * as K from './constants';
import { dropOffer, offerAgeOpening } from './offers';
import { figureDef, getPlayer, homeSettlement, ownSettlements } from './util';

const figuresOf = (state: GameState, player: PlayerId): FigureState[] => {
  const out: FigureState[] = [];
  for (const id of Object.keys(state.figures)) {
    const f = state.figures[id];
    if (f && f.owner === player) out.push(f);
  }
  return out;
};

export const onSettlementCaptured = (ctx: SimCtx, settlement: SettlementId, from: PlayerId, to: PlayerId): void => {
  for (const fs of figuresOf(ctx.state, from)) {
    if (fs.location.state !== 'based' || fs.location.settlement !== settlement) continue;
    fs.owner = to;
    ctx.events.push({ type: 'figureCaptured', figure: fs.id, from, to });
  }
};

export const onPlayerEliminated = (ctx: SimCtx, loser: PlayerId, to: PlayerId | null): void => {
  const { state } = ctx;
  for (const fs of figuresOf(state, loser)) {
    const st = fs.location.state;
    if (st !== 'based' && st !== 'seated' && st !== 'unit') continue; // the Hall and consumed stay put
    if (fs.location.state === 'unit' && state.units[fs.location.unit]) removeUnit(ctx, fs.location.unit);
    vacateSeat(state, fs);
    if (to !== null && homeSettlement(state, to)) {
      fs.owner = to;
      baseAtHome(state, fs);
      ctx.events.push({ type: 'figureCaptured', figure: fs.id, from: loser, to });
    } else {
      fs.location = { state: 'retired' };
    }
  }
  const p = state.players[loser];
  if (p) for (const k of Object.keys(p.cabinet)) p.cabinet[k] = null;
  for (const o of state.offers.slice()) if (o.player === loser) dropOffer(state, o.id, false);
};

export const onFigureUnitDefeated = (ctx: SimCtx, unitId: UnitId, victor: PlayerId): void => {
  const { state } = ctx;
  const unit = state.units[unitId];
  if (!unit || !unit.figure) return;
  const fs = state.figures[unit.figure];
  if (!fs) return;
  const owner = unit.owner;
  const at = unit.at;
  let nearest = null;
  let best = Infinity;
  for (const s of ownSettlements(state, owner)) {
    const d = hexDistance(s.at, at);
    if (d < best) {
      best = d;
      nearest = s;
    }
  }
  removeUnit(ctx, unitId);
  if (nearest) {
    const type = unit.type;
    const id = spawnUnit(ctx, owner, type, nearest.at, fs.id);
    const respawned = id ? state.units[id] : undefined;
    if (id && respawned) {
      respawned.hp = K.FIGURE_RETREAT_HP;
      respawned.movesLeft = 0;
      fs.location = { state: 'unit', unit: id };
    } else {
      fs.location = { state: 'based', settlement: nearest.id };
    }
    return;
  }
  // Nowhere to retreat: captured (or lost to the Hall if the victor has no city, e.g. raiders).
  if (homeSettlement(state, victor)) {
    fs.owner = victor;
    baseAtHome(state, fs);
    ctx.events.push({ type: 'figureCaptured', figure: fs.id, from: owner, to: victor });
  } else {
    fs.location = { state: 'retired' };
  }
};

export const retireFigures = (ctx: SimCtx, player: PlayerId): FigureId[] => {
  const { state } = ctx;
  const retired: FigureId[] = [];
  for (const fs of figuresOf(state, player)) {
    const st = fs.location.state;
    if (st !== 'based' && st !== 'seated' && st !== 'unit') continue;
    if (fs.location.state === 'unit' && state.units[fs.location.unit]) removeUnit(ctx, fs.location.unit);
    fs.location = { state: 'retired' };
    retired.push(fs.id);
  }
  const p = getPlayer(state, player);
  for (const k of Object.keys(p.cabinet)) p.cabinet[k] = null;
  return retired;
};

export const onAgeStarted = (ctx: SimCtx, player: PlayerId): void => {
  const { state } = ctx;
  const p = getPlayer(state, player);
  // Offers from the old age are stale: age-locked figures (GDD §3). Points offers refund.
  for (const o of state.offers.slice()) {
    if (o.player !== player) continue;
    const stale = o.candidates.some((id) => figureDef(ctx.content, id)?.age !== state.age);
    if (stale) dropOffer(state, o.id, true);
  }
  p.legendSlotUsed = false;
  // A culture promised by an earlier hint ("one day its people will find you") arrives now.
  if (p.alive && homeSettlement(state, player)) offerAgeOpening(ctx, player);
};

export const ancestorYields = (state: GameState, player: PlayerId, content: ContentBundle): Yields => {
  const totals: Partial<Record<(typeof YIELDS)[number], number>> = {};
  for (const fs of figuresOf(state, player)) {
    if (fs.location.state !== 'retired') continue;
    const def = figureDef(content, fs.id);
    if (!def) continue;
    const y = K.MAIN_YIELD[def.kind];
    totals[y] = (totals[y] ?? 0) + K.ANCESTOR_YIELD;
  }
  const out: Yields = {};
  for (const y of YIELDS) {
    const v = totals[y];
    if (v) out[y] = v;
  }
  return out;
};

/** +1 seated turn to each seated figure's culture (culture weight, GDD §6). Not during anarchy. */
export const tickSeatedTurns = (state: GameState, player: PlayerId, content: ContentBundle): void => {
  const p = getPlayer(state, player);
  if (p.anarchyTurns > 0) return;
  for (const k of Object.keys(p.cabinet)) {
    const id = p.cabinet[k];
    const def = id ? figureDef(content, id) : undefined;
    if (def) p.seatedTurns[def.culture] = (p.seatedTurns[def.culture] ?? 0) + 1;
  }
};
