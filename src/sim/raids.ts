/**
 * Crisis raiders (GDD §5 "Collapse": "Raiders spawn"). Raiders are the RAIDER_PLAYER's units,
 * moved in the world phase (src/sim/turn.ts `moveRaiders`). They seek out settlements nobody
 * defends and pillage them, rather than throwing themselves at walls and armies.
 *
 * Fun audit pass 2: raiders used to walk at the nearest unit or wall and die (~0.5 units lost
 * per player per crisis, nothing ever pillaged). Now an undefended settlement — no military
 * unit inside and no wall building — is pillaged as soon as a raider stands next to it:
 * stored food, gold and the work in progress are lost, and at most once per settlement per
 * crisis a citizen is carried off. A garrison or walls force the raiders to fight first, so a
 * prepared player weathers the crisis.
 */
import { hexDistance, hexNeighbors, type Hex } from '@contracts/hex';
import { RAIDER_PLAYER, type GameState, type PlayerId, type Settlement, type Unit } from '@contracts/sim-api';
import { RAIDER_PILLAGE_GOLD_CAP, RAIDER_PILLAGE_GOLD_SHARE, RAIDER_SEEK_RANGE, WALL_BASE_HP } from './constants';
import type { SimCtx } from './ctx';
import { isCivilian, unitsAt } from './lookup';
import { removeUnit } from './units';

/** `TimedEffect.source` prefix marking "this settlement already lost a citizen to raiders this crisis". */
export const PILLAGE_MARK = 'pillaged:';
/** `TimedEffect.source` prefix marking "pillaged this turn" (expires at the next turn start). */
export const PILLAGED_THIS_TURN = 'pillagedNow:';

const pillagedThisTurn = (state: GameState, s: Settlement): boolean =>
  state.players[s.owner]?.effects.some((e) => e.source === PILLAGED_THIS_TURN + s.id && e.untilTurn >= state.turn) === true;

/** Gold a pillage takes from a treasury of `gold`: a capped share (never the whole treasury). */
export const pillageGold = (gold: number): number =>
  Math.floor(Math.min(RAIDER_PILLAGE_GOLD_CAP, Math.max(0, gold) * RAIDER_PILLAGE_GOLD_SHARE));

/** A settlement raiders can pillage without a fight: no military unit of its owner inside and no wall building. */
export const isUndefended = (state: GameState, s: Settlement): boolean =>
  s.maxHp <= WALL_BASE_HP && !unitsAt(state, s.at).some((u) => u.owner === s.owner && !isCivilian(u));

/** Raiders' goal: the nearest undefended player settlement within RAIDER_SEEK_RANGE, else the nearest settlement. */
export const raiderGoal = (state: GameState, u: Unit): Hex | null => {
  let best: Settlement | null = null;
  let bestKey = Infinity;
  for (const id of Object.keys(state.settlements)) {
    const s = state.settlements[id];
    if (!s || !state.players[s.owner]) continue; // city-states keep their own guards
    const d = hexDistance(u.at, s.at);
    // Undefended settlements in reach come first; then distance.
    const key = (isUndefended(state, s) && d <= RAIDER_SEEK_RANGE ? 0 : 1000) + d;
    if (key < bestKey) {
      bestKey = key;
      best = s;
    }
  }
  return best ? best.at : null;
};

/** An undefended player settlement next to the raider, if any (lowest id first). */
export const pillageTarget = (state: GameState, u: Unit): Settlement | null => {
  for (const n of hexNeighbors(u.at)) {
    for (const id of Object.keys(state.settlements).sort()) {
      const s = state.settlements[id];
      if (s && s.at.q === n.q && s.at.r === n.r && state.players[s.owner] && isUndefended(state, s) && !pillagedThisTurn(state, s)) return s;
    }
  }
  return null;
};

/**
 * Raiders pillage `s` and scatter with their loot: stored food, production progress and a
 * capped share of the treasury (`pillageGold`) are lost; the first raid on a settlement in this
 * crisis also carries off a citizen (never below 1). A settlement is pillaged at most once per
 * turn: later raiders that turn find nothing left (wave 11: three raiders in one world phase
 * each took 25 gold and emptied the treasury). Also used when raiders break a walled settlement.
 */
export const pillage = (ctx: SimCtx, raider: Unit, s: Settlement): void => {
  const { state } = ctx;
  const victim: PlayerId = s.owner;
  const p = state.players[victim];
  if (raider.owner === RAIDER_PLAYER) removeUnit(ctx, raider.id);
  if (pillagedThisTurn(state, s)) return;
  const mark = PILLAGE_MARK + s.id;
  const firstRaid = !p?.effects.some((e) => e.source === mark);
  const lostPop = firstRaid && s.population > 1;
  if (lostPop) s.population -= 1;
  s.foodStored = 0;
  s.production.progress = 0;
  let gold = 0;
  if (p) {
    gold = pillageGold(p.stock.gold);
    p.stock.gold = Math.round((p.stock.gold - gold) * 100) / 100;
    // Lasts until the age (and its crisis) ends; carries no modifiers.
    if (firstRaid) p.effects.push({ source: mark, untilTurn: -1, modifiers: [] });
    p.effects.push({ source: PILLAGED_THIS_TURN + s.id, untilTurn: state.turn, modifiers: [] });
  }
  // No numbers in the text (the amount travels in `amount`): notices read as story, not ledger.
  const goods = gold > 0 ? 'its stores, its work in progress and part of the treasury' : 'its stores and its work in progress';
  const what = lostPop ? `${goods} are gone, and some of its people with them` : `${goods} are gone`;
  ctx.events.push({
    type: 'notice',
    player: victim,
    kind: 'pillaged',
    settlement: s.id,
    amount: gold,
    text: `Raiders pillaged ${s.name}: ${what}. A garrison or walls would keep them out.`,
  });
};

/**
 * The age (and its crisis) has ended: every raider band scatters (GDD §5: raiders are the
 * Collapse crisis's pressure, so they do not outlive it). Wave 11: raiders from the Ancient
 * crisis kept pillaging well into the Classical age. Returns how many units left the map.
 */
export const disperseRaiders = (ctx: SimCtx): number => {
  const ids = Object.keys(ctx.state.units).filter((id) => ctx.state.units[id]?.owner === RAIDER_PLAYER);
  for (const id of ids) removeUnit(ctx, id);
  if (ids.length > 0) {
    ctx.events.push({ type: 'notice', player: null, kind: 'other', text: 'With the old age gone, the raider bands scatter back into the wilds.' });
  }
  return ids.length;
};

/** Raiders within this many tiles of an undefended settlement trigger a warning (two turns' march). */
export const RAIDER_WARNING_RANGE = 4;

/**
 * Playtest 3: a player lost both towns to raiders without a word of warning. At the end of
 * each world phase, every undefended player settlement with raiders within
 * RAIDER_WARNING_RANGE gets one notice naming how close they are ("Raiders are two days from
 * Waset, and no one guards it."), unless the "gather near" notice already named it this phase.
 */
export const warnOfRaiders = (ctx: SimCtx): void => {
  const { state } = ctx;
  const raiders = Object.values(state.units).filter((u) => u.owner === RAIDER_PLAYER);
  if (raiders.length === 0) return;
  for (const id of Object.keys(state.settlements).sort()) {
    const s = state.settlements[id];
    if (!s || !state.players[s.owner]?.alive || !isUndefended(state, s)) continue;
    let d = Infinity;
    for (const r of raiders) d = Math.min(d, hexDistance(r.at, s.at));
    if (d > RAIDER_WARNING_RANGE) continue;
    if (ctx.events.some((e) => e.type === 'notice' && e.player === s.owner && e.kind === 'raiderWarning' && e.settlement === s.id)) continue;
    const when = d <= 2 ? 'a day' : 'two days';
    ctx.events.push({ type: 'notice', player: s.owner, kind: 'raiderWarning', settlement: s.id, text: `Raiders are ${when} from ${s.name}, and no one guards it.` });
  }
};
