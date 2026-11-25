/**
 * Read-only query surface (`SimQueries` in src/contracts/sim-api.ts). Implements the
 * map/settlement/unit/tree queries and re-exports the figure queries from src/emergence and
 * the refinement/legacy queries from src/sim/ages. Never mutates state.
 */
import type { Decision, ProductionOption, SimQueries } from '@contracts/sim-api';
import { cabinetSeats, cultureWeights, figureActions } from '../emergence';
import { milestones, refinementOptions, score } from './ages';
import { attackTargetsOf, isHostile } from './combat';
import { envoyCostFor, tradeTargetsOf } from './diplomacy';
import { ci, hexOfIndex, playerSettlements } from './lookup';
import { empireModifiers } from './modifiers';
import { governmentOptionsFor, researchOptionsFor } from './research';
import { availableItems, canFoundAt, goldCostOf, itemCost, upgradeCostOf } from './settlements';
import { findPaths, visibleTileSet } from './units';
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
  // TODO(sim): implement settleSites and pathTo (contracts: added for settler hints and multi-turn moves).
  settleSites: () => [],
  pathTo: () => null,
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

