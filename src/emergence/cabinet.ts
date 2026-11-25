/**
 * Cabinet seats (GDD §3, §7 "Governments"). Slot KEY = `${slotId}#${n}`, n counting duplicates
 * across the government's `cabinetSlots` followed by extra slots from `cabinetSlot` modifiers.
 *
 * Seating rule (one rule, used everywhere): a figure may sit in a slot iff the figure lists
 * 'cabinet' in `uses` AND the slot's `accepts` (content/cabinet_slots.json) includes the
 * figure's kind. `Figure.cabinetSlots` is only a UI hint ("best seats") and is not enforced.
 */
import type { ContentBundle, Figure } from '@contracts/content-schemas';
import type { CabinetSeat, FigureState, GameState, PlayerId } from '@contracts/sim-api';
import type { SimCtx } from '../sim/ctx';
import { extraCabinetSlots, playerModifiers } from '../sim/modifiers';
import { getPlayer, homeSettlement } from './util';

export const slotIdOfKey = (key: string): string => key.split('#')[0] ?? key;

/** Slot keys the player should have right now, in seat order. */
export const cabinetKeys = (state: GameState, player: PlayerId, content: ContentBundle): string[] => {
  const p = getPlayer(state, player);
  const gov = content.governments.find((g) => g.id === p.government);
  const slots = [...(gov?.cabinetSlots ?? []), ...extraCabinetSlots(playerModifiers(state, player, content))];
  const counts: Record<string, number> = {};
  return slots.map((slot) => {
    const n = counts[slot] ?? 0;
    counts[slot] = n + 1;
    return `${slot}#${n}`;
  });
};

export const slotAccepts = (content: ContentBundle, key: string, fig: Figure): boolean => {
  if (!fig.uses.includes('cabinet')) return false;
  const slot = content.cabinetSlots.find((s) => s.id === slotIdOfKey(key));
  return slot !== undefined && slot.accepts.includes(fig.kind);
};

/** Move a figure to 'based' in the owner's home settlement (or the Hall if they have none). */
export const baseAtHome = (state: GameState, fs: FigureState): void => {
  const home = homeSettlement(state, fs.owner);
  fs.location = home ? { state: 'based', settlement: home.id } : { state: 'retired' };
};

/** Empty the seat a figure holds (no cooldown); safe to call for unseated figures. */
export const vacateSeat = (state: GameState, fs: FigureState): void => {
  if (fs.location.state !== 'seated') return;
  const p = state.players[fs.owner];
  if (p && p.cabinet[fs.location.slot] === fs.id) p.cabinet[fs.location.slot] = null;
};

export const syncCabinet = (ctx: SimCtx, player: PlayerId): void => {
  const { state, content } = ctx;
  const p = getPlayer(state, player);
  const keys = cabinetKeys(state, player, content);
  const next: Record<string, string | null> = {};
  for (const k of keys) next[k] = p.cabinet[k] ?? null;
  for (const k of Object.keys(p.cabinet)) {
    const figId = p.cabinet[k];
    if (k in next || !figId) continue;
    const fs = state.figures[figId];
    if (fs) baseAtHome(state, fs);
  }
  p.cabinet = next;
  const cooldown: Record<string, number> = {};
  for (const k of keys) {
    const c = p.cabinetCooldown[k];
    if (c !== undefined) cooldown[k] = c;
  }
  p.cabinetCooldown = cooldown;
};

export const cabinetSeats = (state: GameState, player: PlayerId, _content: ContentBundle): CabinetSeat[] => {
  const p = state.players[player];
  if (!p) return [];
  return Object.keys(p.cabinet).map((key) => ({
    key,
    slot: slotIdOfKey(key),
    figure: p.cabinet[key] ?? null,
    availableTurn: p.cabinetCooldown[key] ?? 0,
  }));
};
