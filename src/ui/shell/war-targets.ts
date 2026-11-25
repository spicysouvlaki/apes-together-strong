/**
 * Targets the selected unit could attack if the player declared war on their owner (GDD §7
 * "Diplomacy": attacking a neutral asks to declare war first). Pure and rule-free: it asks the
 * sim's own attack query about a hypothetical snapshot in which that war already exists, so the
 * UI never decides what is attackable itself. Hidden tiles are skipped (no fog leaks).
 */
import { hexEquals, type Hex } from '@contracts/hex';
import { RAIDER_PLAYER, warKey, type GameState, type PlayerId, type UnitId } from '@contracts/sim-api';
import { targetOwner } from './tap-intent';
import { tileIndexOf } from './hexutil';

export interface WarTarget {
  hex: Hex;
  owner: PlayerId;
}

/** Everyone the player could be at war with but is not: living rivals and city-states. */
export const peacefulOwners = (state: GameState, me: PlayerId): PlayerId[] => {
  const out: PlayerId[] = [];
  for (const id of state.playerOrder) {
    if (id !== me && state.players[id]?.alive && state.wars[warKey(me, id)] === undefined) out.push(id);
  }
  for (const cs of Object.values(state.cityStates)) {
    const id = `cs:${cs.id}`;
    if (cs.alive && state.wars[warKey(me, id)] === undefined) out.push(id);
  }
  return out;
};

export const warTargetsFor = (
  state: GameState,
  me: PlayerId,
  unit: UnitId,
  attackTargets: (s: GameState, unit: UnitId) => Hex[],
  visible: ReadonlySet<number>,
): WarTarget[] => {
  const u = state.units[unit];
  if (!u || u.owner !== me || u.unitClass === 'civilian') return [];
  const out: WarTarget[] = [];
  for (const owner of peacefulOwners(state, me)) {
    if (owner === RAIDER_PLAYER) continue;
    const hypo: GameState = { ...state, wars: { ...state.wars, [warKey(me, owner)]: state.turn } };
    for (const hex of attackTargets(hypo, unit)) {
      const i = tileIndexOf(state.map, hex);
      if (i === null || !visible.has(i)) continue;
      if (targetOwner(state, hex, me) !== owner) continue;
      if (!out.some((t) => hexEquals(t.hex, hex))) out.push({ hex, owner });
    }
  }
  return out;
};
