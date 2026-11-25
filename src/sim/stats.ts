/**
 * Measured statistics about a player, shared by deeds (src/emergence) and legacy
 * milestones (src/sim/ages). Signature is fixed.
 */
import type { ContentBundle, StatMeasure } from '@contracts/content-schemas';
import type { GameState, PlayerId } from '@contracts/sim-api';
import { ci, isCoastalHex, playerSettlements } from './lookup';

/** Current value of `measure` for `player` (see StatMeasure in content-schemas.ts). */
export const statValue = (
  state: GameState,
  player: PlayerId,
  measure: StatMeasure,
  param: string | undefined,
  content: ContentBundle,
): number => {
  const p = state.players[player];
  if (!p) return 0;
  switch (measure) {
    case 'battlesWon':
      return p.stats.battlesWon;
    case 'citiesCaptured':
      return p.stats.citiesCaptured;
    case 'wondersBuilt':
      return p.stats.wondersBuilt;
    case 'figuresRecruited':
      return p.stats.figuresRecruited;
    case 'figuresActivated':
      return p.stats.figuresActivated;
    case 'envoysSent':
      return p.stats.envoysSent;
    case 'unitsLost':
      return p.stats.unitsLost;
    case 'siegeTurnsHeld':
      return p.stats.siegeTurnsHeld;
    case 'settlementCount':
      return playerSettlements(state, player).length;
    case 'coastalSettlements':
      return playerSettlements(state, player).filter((s) => isCoastalHex(state.map, s.at, content)).length;
    case 'largestCityPop':
      return playerSettlements(state, player).reduce((m, s) => Math.max(m, s.population), 0);
    case 'techsResearched': {
      const techs = ci(content).techs;
      return p.techs.filter((id) => techs[id]?.age === state.age).length;
    }
    case 'tradeRoutes':
      return state.tradeRoutes.filter((r) => r.owner === player).length;
    case 'exploredPercent': {
      const n = p.explored.length;
      if (n === 0) return 0;
      let seen = 0;
      for (const v of p.explored) seen += v;
      return Math.floor((seen * 100) / n);
    }
    case 'ownedClimate':
      return state.map.tiles.filter((t) => t.owner === player && t.climate === param).length;
    case 'ownedTerrain':
      return state.map.tiles.filter((t) => t.owner === player && t.terrain === param).length;
    case 'unitsOfClass': {
      let n = 0;
      for (const id of Object.keys(state.units)) {
        const u = state.units[id];
        if (u && u.owner === player && u.unitClass === param) n++;
      }
      return n;
    }
    case 'culturesRefined': {
      const traditions = new Map(content.traditions.map((t) => [t.id, t.culture]));
      return new Set(p.traditions.map((id) => traditions.get(id)).filter((c) => c !== undefined)).size;
    }
    case 'hybridsAdopted':
      return p.hybrids.length;
    case 'traditionsAdopted':
      return p.traditions.length;
  }
};
