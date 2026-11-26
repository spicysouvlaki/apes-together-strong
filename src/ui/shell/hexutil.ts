/**
 * Small map helpers for the shell. Pure; no DOM, no signals (unit-tested in Node).
 */
import { axialToOffset, hexEquals, type Hex } from '@contracts/hex';
import type { GameState, MapState, PlayerId, Settlement, Tile, Unit } from '@contracts/sim-api';

/** Row-major tile index for an axial hex, or null when off the map (the map does not wrap). */
export const tileIndexOf = (map: MapState, hex: Hex): number | null => {
  const { col, row } = axialToOffset(hex);
  if (col < 0 || row < 0 || col >= map.width || row >= map.height) return null;
  return row * map.width + col;
};

export const tileAt = (map: MapState, hex: Hex): Tile | null => {
  const i = tileIndexOf(map, hex);
  return i === null ? null : (map.tiles[i] ?? null);
};

/** Stable unit order: numeric id suffix ("u3" before "u12"), then the raw id. */
export const compareIds = (a: string, b: string): number => {
  const na = Number(a.replace(/^\D+/, ''));
  const nb = Number(b.replace(/^\D+/, ''));
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
};

export const unitsAt = (state: GameState, hex: Hex, owner?: PlayerId): Unit[] =>
  Object.values(state.units)
    .filter((u) => hexEquals(u.at, hex) && (owner === undefined || u.owner === owner))
    .sort((a, b) => compareIds(a.id, b.id));

export const settlementAt = (state: GameState, hex: Hex): Settlement | null => {
  const t = tileAt(state.map, hex);
  const id = t?.settlement;
  if (id) return state.settlements[id] ?? null;
  return Object.values(state.settlements).find((s) => hexEquals(s.at, hex)) ?? null;
};

export const ownSettlements = (state: GameState, me: PlayerId): Settlement[] =>
  Object.values(state.settlements)
    .filter((s) => s.owner === me)
    .sort((a, b) => compareIds(a.id, b.id));

/** Where to point the camera at the start: the capital, else any settlement, else the first unit. */
export const homeHex = (state: GameState, me: PlayerId): Hex | null => {
  const mine = ownSettlements(state, me);
  const cap = mine.find((s) => s.isCapital) ?? mine[0];
  if (cap) return cap.at;
  const u = Object.values(state.units)
    .filter((x) => x.owner === me)
    .sort((a, b) => compareIds(a.id, b.id))[0];
  return u ? u.at : null;
};

/**
 * Units that still want orders this turn: own, with moves left, not fortified and not skipped.
 * Returns the one after `current` in stable order (wrapping), or the first.
 */
/**
 * Own units still waiting for orders. `ready` adds units that have spent their moves but can
 * still act (a settler that marched onto its site can found at once; playtest: it arrived with
 * no moves left and dropped out of "Next unit", so the player never knew).
 */
export const idleUnits = (state: GameState, me: PlayerId, skipped: ReadonlySet<string>, ready: ReadonlySet<string> = NONE): Unit[] =>
  Object.values(state.units)
    .filter((u) => u.owner === me && (u.movesLeft > 0 || ready.has(u.id)) && !u.fortified && !skipped.has(u.id))
    .sort((a, b) => compareIds(a.id, b.id));

const NONE: ReadonlySet<string> = new Set();

export const nextIdleUnit = (
  state: GameState,
  me: PlayerId,
  skipped: ReadonlySet<string>,
  current: string | null,
  ready: ReadonlySet<string> = NONE,
): Unit | null => {
  const list = idleUnits(state, me, skipped, ready);
  if (list.length === 0) return null;
  if (!current) return list[0] ?? null;
  const all = Object.values(state.units)
    .filter((u) => u.owner === me)
    .sort((a, b) => compareIds(a.id, b.id));
  const pos = all.findIndex((u) => u.id === current);
  if (pos < 0) return list[0] ?? null;
  // First idle unit strictly after the current one in the full order, wrapping around.
  for (let k = 1; k <= all.length; k++) {
    const u = all[(pos + k) % all.length];
    if (u && list.some((x) => x.id === u.id)) return u;
  }
  return list[0] ?? null;
};

/**
 * A unit that could found the player's first settlement, or null when they already have one
 * (or no founder). `canFoundType` comes from content (UnitDef.canFound); legality of the spot
 * is still the sim's call (q.canFound) when the player taps Found.
 */
export const firstFounder = (state: GameState, me: PlayerId, canFoundType: (type: string) => boolean): string | null => {
  if (ownSettlements(state, me).length > 0) return null;
  const u = Object.values(state.units)
    .filter((x) => x.owner === me && canFoundType(x.type))
    .sort((a, b) => compareIds(a.id, b.id))[0];
  return u ? u.id : null;
};
