/** Read-only views of the world the AI needs every turn (public information only). */
import type { ContentBundle } from '@contracts/content-schemas';
import { hexDistance, type Hex } from '@contracts/hex';
import { CITY_STATE_PREFIX, RAIDER_PLAYER, warKey, type GameState, type PlayerId, type Settlement, type Unit } from '@contracts/sim-api';
import { ci } from '../sim/lookup';

export const ownSettlements = (state: GameState, player: PlayerId): Settlement[] => {
  const out: Settlement[] = [];
  for (const id of Object.keys(state.settlements)) {
    const s = state.settlements[id];
    if (s && s.owner === player) out.push(s);
  }
  return out;
};

export const ownUnits = (state: GameState, player: PlayerId): Unit[] => {
  const out: Unit[] = [];
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (u && u.owner === player) out.push(u);
  }
  return out;
};

export const isMilitary = (u: Unit): boolean => u.unitClass !== 'civilian';

/** Rival players (not city-states, not raiders) this player is at war with. */
export const enemiesAtWar = (state: GameState, player: PlayerId): PlayerId[] => {
  const out: PlayerId[] = [];
  for (const id of state.playerOrder) {
    if (id === player || !state.players[id]?.alive) continue;
    if (state.wars[warKey(player, id)] !== undefined) out.push(id);
  }
  return out;
};

/** Owner ids (`cs:<id>`) of living city-states this player is at war with. */
export const cityStatesAtWar = (state: GameState, player: PlayerId): PlayerId[] => {
  const out: PlayerId[] = [];
  for (const id of Object.keys(state.cityStates)) {
    const cs = state.cityStates[id];
    const owner = CITY_STATE_PREFIX + id;
    if (cs?.alive && state.wars[warKey(player, owner)] !== undefined) out.push(owner);
  }
  return out;
};

/** Everyone whose settlements are war goals for this player: rivals and city-states at war. */
export const warFoes = (state: GameState, player: PlayerId): PlayerId[] => [...enemiesAtWar(state, player), ...cityStatesAtWar(state, player)];

export const hostileTo = (state: GameState, player: PlayerId, owner: PlayerId): boolean => {
  if (owner === player) return false;
  if (owner === RAIDER_PLAYER) return true;
  return state.wars[warKey(player, owner)] !== undefined;
};

/** Hostile military units within `radius` of `at`. */
export const hostilesNear = (state: GameState, player: PlayerId, at: Hex, radius: number): Unit[] => {
  const out: Unit[] = [];
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (!u || u.unitClass === 'civilian' || !hostileTo(state, player, u.owner)) continue;
    if (hexDistance(u.at, at) <= radius) out.push(u);
  }
  return out;
};

/** Sum of the best strength of a player's military units (a coarse, public power estimate). */
export const militaryPower = (state: GameState, player: PlayerId, content: ContentBundle): number => {
  const units = ci(content).units;
  let power = 0;
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (!u || u.owner !== player || u.unitClass === 'civilian') continue;
    const def = units[u.type];
    if (!def) continue;
    power += Math.max(def.strength, def.rangedStrength ?? 0) * (0.5 + u.hp / 200);
  }
  return power;
};
