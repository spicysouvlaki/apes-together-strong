/**
 * Great-people points (GDD §4): six pools fed by the yields and deeds of play, plus the
 * `gp` values of buildings and wonders. Every pool can be fed by any play style (GDD §1,
 * pillar 2), but each leans on one: battles feed military, science feeds thought, etc.
 */
import { GP_KINDS, type ContentBundle, type GpKind } from '@contracts/content-schemas';
import type { GameState, PlayerId } from '@contracts/sim-api';
import { gpPercent, playerModifiers } from '../sim/modifiers';
import * as K from './constants';
import type { PlayerMeasures } from './signals';
import { ownSettlements } from './util';

const zeroPools = (): Record<GpKind, number> => ({
  military: 0,
  statesman: 0,
  thought: 0,
  faith: 0,
  building: 0,
  exploration: 0,
});

/** Points each pool gains this turn, after `gpPoints` modifiers. */
export const gpGain = (
  state: GameState,
  player: PlayerId,
  content: ContentBundle,
  m: PlayerMeasures,
): Record<GpKind, number> => {
  const p = state.players[player];
  const out = zeroPools();
  if (!p) return out;
  const inc = p.income;
  const pos = (n: number | undefined): number => Math.max(0, n ?? 0);

  // Building and wonder `gp` values (already per-turn points).
  const fromBuildings = zeroPools();
  for (const s of ownSettlements(state, player)) {
    for (const b of s.buildings) {
      const def = content.buildings.find((d) => d.id === b);
      if (!def) continue;
      for (const k of GP_KINDS) fromBuildings[k] += def.gp[k] ?? 0;
    }
  }
  for (const w of content.wonders) {
    if (state.wonders[w.id]?.owner !== player) continue;
    for (const k of GP_KINDS) fromBuildings[k] += w.gp[k] ?? 0;
  }

  let buildings = 0;
  for (const s of ownSettlements(state, player)) buildings += s.buildings.length;
  let wars = 0;
  for (const key of Object.keys(state.wars)) if (key.split('|').includes(player)) wars++;
  let suzerainties = 0;
  for (const id of Object.keys(state.cityStates)) if (state.cityStates[id]?.suzerain === player) suzerainties++;

  const base = m.settlementCount > 0 ? K.GP_BASE_PER_POOL : 0;
  const play: Record<GpKind, number> = {
    military:
      K.GP_MILITARY_PER_UNIT * m.unitsTotal +
      K.GP_MILITARY_PER_BATTLE_WON * p.stats.battlesWonThisTurn +
      K.GP_MILITARY_PER_CITY_CAPTURED * p.stats.citiesCapturedThisTurn +
      K.GP_MILITARY_PER_WAR * wars,
    statesman:
      K.GP_STATESMAN_PER_SETTLEMENT * m.settlementCount +
      K.GP_STATESMAN_PER_INFLUENCE * pos(inc.influence) +
      K.GP_STATESMAN_PER_CULTURE * pos(inc.culture) +
      K.GP_STATESMAN_PER_TRADE_ROUTE * m.tradeRoutes +
      K.GP_STATESMAN_PER_SUZERAINTY * suzerainties +
      K.GP_STATESMAN_PER_GOLD * pos(inc.gold),
    thought: K.GP_THOUGHT_PER_SCIENCE * pos(inc.science),
    faith: K.GP_FAITH_PER_FAITH * pos(inc.faith),
    building: K.GP_BUILDING_PER_PRODUCTION * pos(inc.production) + K.GP_BUILDING_PER_BUILDING * buildings,
    exploration:
      K.GP_EXPLORATION_PER_EXPLORED_PERCENT * m.exploredPercent +
      K.GP_EXPLORATION_PER_SCOUT * m.scouts +
      K.GP_EXPLORATION_PER_SHIP * (m.unitsOfClass.naval ?? 0) +
      K.GP_EXPLORATION_PER_TRADE_ROUTE * m.tradeRoutes +
      K.GP_EXPLORATION_PER_COASTAL * m.coastalSettlements,
  };

  const mods = playerModifiers(state, player, content);
  for (const k of GP_KINDS) {
    const raw = base + K.GP_AGE_SCALE[state.age] * (K.GP_SCALE * play[k] + K.GP_PER_BUILDING_POINT * fromBuildings[k]);
    out[k] = raw * Math.max(0, 1 + gpPercent(mods, k) / 100);
  }
  return out;
};

/** Add this turn's points to the player's pools, banking at most GP_BANK_MAX_THRESHOLDS thresholds. */
export const accrueGp = (state: GameState, player: PlayerId, gains: Record<GpKind, number>): void => {
  const p = state.players[player];
  if (!p) return;
  for (const k of GP_KINDS) {
    const cap = K.GP_BANK_MAX_THRESHOLDS * p.gpThreshold[k];
    const before = p.gp[k] ?? 0;
    p.gp[k] = before >= cap ? before : Math.min(cap, before + gains[k]);
  }
};

/**
 * Stored faith turns into faith great-people points (FAITH_STOCK_DRAIN_SHARE per turn), the
 * stock's one sink without a new command. Skipped while the faith pool is banked full, so no
 * faith is wasted.
 */
export const devoteFaith = (state: GameState, player: PlayerId): void => {
  const p = state.players[player];
  if (!p || p.stock.faith <= 0) return;
  const cap = K.GP_BANK_MAX_THRESHOLDS * p.gpThreshold.faith;
  if (p.gp.faith >= cap) return;
  const spent = Math.round(p.stock.faith * K.FAITH_STOCK_DRAIN_SHARE * 100) / 100;
  if (spent <= 0) return;
  p.stock.faith = Math.round((p.stock.faith - spent) * 100) / 100;
  const points = spent * K.FAITH_STOCK_TO_GP * K.GP_SCALE * K.GP_AGE_SCALE[state.age];
  p.gp.faith = Math.min(cap, p.gp.faith + points);
};
