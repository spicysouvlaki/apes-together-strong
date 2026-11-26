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
import { RAIDER_PILLAGE_GOLD, RAIDER_SEEK_RANGE, WALL_BASE_HP } from './constants';
import type { SimCtx } from './ctx';
import { isCivilian, unitsAt } from './lookup';
import { removeUnit } from './units';

/** `TimedEffect.source` prefix marking "this settlement already lost a citizen to raiders this crisis". */
export const PILLAGE_MARK = 'pillaged:';

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
      if (s && s.at.q === n.q && s.at.r === n.r && state.players[s.owner] && isUndefended(state, s)) return s;
    }
  }
  return null;
};

/**
 * Raiders pillage `s` and scatter with their loot: stored food, production progress and up to
 * RAIDER_PILLAGE_GOLD gold are lost; the first raid on a settlement in this crisis also carries
 * off a citizen (never below 1). Also used when raiders break a walled settlement.
 */
export const pillage = (ctx: SimCtx, raider: Unit, s: Settlement): void => {
  const { state } = ctx;
  const victim: PlayerId = s.owner;
  const p = state.players[victim];
  const mark = PILLAGE_MARK + s.id;
  const firstRaid = !p?.effects.some((e) => e.source === mark);
  const lostPop = firstRaid && s.population > 1;
  if (lostPop) s.population -= 1;
  s.foodStored = 0;
  s.production.progress = 0;
  if (p) {
    p.stock.gold = Math.max(0, p.stock.gold - RAIDER_PILLAGE_GOLD);
    // Lasts until the age (and its crisis) ends; carries no modifiers.
    if (firstRaid) p.effects.push({ source: mark, untilTurn: -1, modifiers: [] });
  }
  const what = lostPop ? 'its stores, its work in progress and some of its people are gone' : 'its stores and its work in progress are gone';
  ctx.events.push({ type: 'notice', player: victim, text: `Raiders pillaged ${s.name}: ${what}. A garrison or walls would keep them out.` });
  if (raider.owner === RAIDER_PLAYER) removeUnit(ctx, raider.id);
};
