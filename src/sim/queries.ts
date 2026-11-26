/**
 * Read-only query surface (`SimQueries` in src/contracts/sim-api.ts). Implements the
 * map/settlement/unit/tree queries and re-exports the figure queries from src/emergence and
 * the refinement/legacy queries from src/sim/ages. Never mutates state.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { Decision, GameState, PlayerId, ProductionOption, SimQueries } from '@contracts/sim-api';
import { cabinetSeats, cultureWeights, figureActions } from '../emergence';
import { milestones, refinementOptions, score, scoreBreakdown, type ScoreBreakdown } from './ages';
import { attackTargetsOf, isHostile } from './combat';
import { combatPreview } from './combat-preview';
import { envoyCostFor, tradeTargetsOf } from './diplomacy';
import { ci, hexOfIndex, playerSettlements, tileIndex } from './lookup';
import { empireModifiers } from './modifiers';
import { governmentOptionsFor, researchOptionsFor } from './research';
import { availableItems, canFoundAt, goldCostOf, itemCost, upgradeCostOf } from './settlements';
import { settleSitesFor } from './sites';
import { findPaths, planPath, visibleTileSet } from './units';
import { contactsOf } from './voice';
import { growthCost, settlementCapFor, settlementYields, workedTilesWithYields } from './yields';

export const queries: SimQueries = {
  reachable: (state, unitId, content) => {
    const u = state.units[unitId];
    if (!u) return [];
    const paths = findPaths(state, u, content);
    return paths.endable.map((idx) => ({ hex: hexOfIndex(state.map, idx), cost: u.movesLeft - (paths.remaining.get(idx) ?? 0) }));
  },
  attackTargets: (state, unitId, content) => {
    const u = state.units[unitId];
    return u ? attackTargetsOf(state, u, content) : [];
  },
  canFound: (state, unitId, content) => {
    const u = state.units[unitId];
    if (!u || !ci(content).units[u.type]?.canFound) return false;
    return canFoundAt(state, u.owner, u.at, content);
  },
  tradeTargets: (state, unitId, content) => tradeTargetsOf(state, unitId, content),
  productionOptions: (state, sid, content) => {
    const s = state.settlements[sid];
    if (!s || s.kind !== 'city' || !state.players[s.owner]) return [];
    const mods = empireModifiers(state, s.owner, content);
    const production = settlementYields(state, s, content, mods).production;
    return availableItems(state, s, content).map((x): ProductionOption => {
      const cost = itemCost(state, s, x.item, content, mods);
      const left = Math.max(0, cost - (s.production.item === x.item ? s.production.progress : 0));
      return {
        item: x.item,
        kind: x.kind,
        cost,
        turns: production > 0 ? Math.ceil(left / production) : null,
        goldCost: goldCostOf(state, s, x.item, content, mods),
      };
    });
  },
  settlementYields: (state, sid, content) => {
    const s = state.settlements[sid];
    if (!s) return { food: 0, production: 0, gold: 0, science: 0, culture: 0, faith: 0, happiness: 0, influence: 0 };
    return settlementYields(state, s, content);
  },
  workedTiles: (state, sid, content) => {
    const s = state.settlements[sid];
    if (!s) return [];
    return workedTilesWithYields(state, s, content).map((w) => ({ q: w.tile.q, r: w.tile.r }));
  },
  growthCost,
  upgradeCost: (state, sid, content) => {
    const s = state.settlements[sid];
    return s ? upgradeCostOf(state, s, content) : 0;
  },
  settlementCap: (state, player, content) => settlementCapFor(state, player, content),
  researchOptions: (state, player, tree, content) => researchOptionsFor(state, player, tree, content),
  governmentOptions: (state, player, content) => governmentOptionsFor(state, player, content),
  visibleTiles: (state, player, content) => visibleTileSet(state, player, content),
  atWar: (state, a, b) => isHostile(state, a, b),
  envoyCost: (state, player, cityState) => envoyCostFor(state, player, cityState),
  cabinetSeats,
  figureActions,
  combatPreview: (state, unitId, target, content) => combatPreview(state, unitId, target, content),
  settleSites: (state, unitId, content) => {
    const u = state.units[unitId];
    return u ? settleSitesFor(state, u, content) : [];
  },
  pathTo: (state, unitId, to, content) => {
    const u = state.units[unitId];
    if (!u) return null;
    const plan = planPath(state, u, tileIndex(state.map, to), content);
    return plan ? plan.tiles.map((i) => hexOfIndex(state.map, i)) : null;
  },
  cultureWeights,
  refinementOptions,
  milestones,
  score,
  pendingDecisions: (state, player, content) => {
    const out: Decision[] = [];
    const p = state.players[player];
    if (!p || !p.alive) return out;
    if (state.phase === 'transition') {
      if (state.transition && !state.transition.recap[player]?.done) out.push({ type: 'transition' });
      return out;
    }
    if (state.phase !== 'playing') return out;
    for (const o of state.offers) if (o.player === player) out.push({ type: 'offer', offer: o.id });
    if (state.crisis?.awaiting.includes(player)) out.push({ type: 'crisis', crisis: state.crisis.id, stage: state.crisis.stage });
    if (p.government === null && governmentOptionsFor(state, player, content).length > 0) out.push({ type: 'government' });
    for (const tree of ['tech', 'civic'] as const) {
      if (p.research[tree].current === null && researchOptionsFor(state, player, tree, content).length > 0)
        out.push({ type: 'research', tree });
    }
    for (const s of playerSettlements(state, player)) {
      if (s.kind === 'city' && s.production.item === null) out.push({ type: 'production', settlement: s.id });
    }
    return out;
  },
};


/**
 * Not (yet) part of SimQueries (src/contracts is frozen): why a crisis response cannot be
 * chosen right now, or null (playtest 3: unaffordable responses). The UI may import it from
 * here to disable and explain the response buttons with the same rule the command applies.
 */
export { crisisResponseBlocked } from './ages/crisis';
/** Gold a unit returns when disbanded where it stands now (0 outside its owner's borders). */
export { disbandRefund } from './units';

// --- Wave 13 (not yet in SimQueries; src/contracts is frozen) ----------------------------

/** One row of the standings a player may see during play. */
export interface Standing {
  player: PlayerId;
  score: number;
  breakdown: ScoreBreakdown;
}

/**
 * Score standing during play, as `viewer` may see it: their own row plus every rival they have
 * met (`contactsOf`), highest first (ties in turn order). Unmet rivals are left out, so the UI
 * never leaks a people the player has not found. Each row carries the score breakdown.
 */
export const standings = (state: GameState, viewer: PlayerId, content: ContentBundle): Standing[] => {
  const met = contactsOf(state, viewer);
  return state.playerOrder
    .filter((id) => id === viewer || (met[id] === true && state.players[id] !== undefined))
    .map((id) => {
      const breakdown = scoreBreakdown(state, id, content);
      return { player: id, score: breakdown.total, breakdown };
    })
    .sort((a, b) => b.score - a.score || state.playerOrder.indexOf(a.player) - state.playerOrder.indexOf(b.player));
};

/** Has `player` met `other` (seen their land or units)? The gate for naming a rival in news. */
export const hasMet = (state: GameState, player: PlayerId, other: PlayerId): boolean => player === other || contactsOf(state, player)[other] === true;

/** Open war threats against `player` (who, which city, the turn war may come), soonest first. */
export { threatsAgainst, peaceTerms, warGoalOf, type WarIntent } from './war-intent';
/** Happiness each war costs `player`, by foe (the happiness breakdown's war line). */
export { warWeariness } from './yields';
export { WAR_TRIBUTE_INFLUENCE } from './constants';
export type { ScoreBreakdown };
