/**
 * Toast policy (playtest: toasts covered the top of the map, hiding raiders next to the unit the
 * player was moving). News runs through a one-line ticker under the top bar, one item at a time;
 * only threats the player must answer right away appear as a prominent slip. Pure.
 */
import type { PlayerId, SimEvent } from '@contracts/sim-api';

/**
 * A threat: something hostile happening to the player right now. War declared on us, our unit
 * or city attacked (raiders included), a settlement lost, a figure taken, a crisis beginning.
 */
export const isThreat = (ev: SimEvent, me: PlayerId): boolean => {
  switch (ev.type) {
    case 'warDeclared':
      return ev.on === me;
    case 'combat':
      return ev.defenderOwner === me && ev.attackerOwner !== me;
    case 'settlementCaptured':
      return ev.from === me && ev.to !== me;
    case 'figureCaptured':
      return ev.from === me && ev.to !== me;
    case 'crisisStarted':
      return true;
    case 'playerEliminated':
      return ev.player === me;
    default:
      return false;
  }
};

export interface TickerItem {
  id: number;
  threat?: boolean;
  /** A rival leader speaking: a slip too (wave 13). */
  voice?: string;
}

/** At most this many threat slips at once (older ones wait in the ticker's list). */
export const MAX_SLIPS = 2;

/** Threat slips (newest batch first, capped) and the ticker queue (everything else, in order). */
export const splitToasts = <T extends TickerItem>(list: readonly T[]): { slips: T[]; ticker: T[] } => {
  const slips: T[] = [];
  const ticker: T[] = [];
  for (const t of list) {
    if ((t.threat || t.voice) && slips.length < MAX_SLIPS) slips.push(t);
    else ticker.push(t);
  }
  return { slips, ticker };
};

/** How long a ticker line stays before the next one (culture whispers get the most time). */
export const tickerDuration = (tone: 'info' | 'good' | 'bad' | 'culture'): number =>
  tone === 'culture' ? 7000 : tone === 'bad' ? 5000 : 3500;

/** Threat slips stay until tapped or for this long. */
export const SLIP_DURATION_MS = 9000;

/** "2 more" counter next to the ticker line (null when nothing else waits). */
export const tickerMore = (queue: number): string | null => (queue > 1 ? `+${queue - 1}` : null);

/**
 * While a unit is in hand, threat slips fold into the ticker (they would cover the map the unit
 * acts on, playtest 3); a leader's words stay a slip, one at a time (wave 13: never folded).
 */
export const splitWhileAnswering = <T extends TickerItem>(list: readonly T[]): { slips: T[]; ticker: T[] } => {
  const voice = list.find((t) => t.voice);
  return { slips: voice ? [voice] : [], ticker: list.filter((t) => t !== voice) };
};
