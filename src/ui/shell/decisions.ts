/**
 * Maps SimQueries.pendingDecisions to the End Turn button (GDD §5: "End Turn blocks only on
 * decisions needing an answer"). Pure. The sim refuses `endTurn` while an offer or a crisis
 * response is open; a missing government is answered here too (when its screen exists) because
 * playing without one silently forfeits cabinet bonuses. Idle research and production are
 * advisory: the player may end the turn anyway (with one confirm for an idle city).
 */
import type { Decision, UnitId } from '@contracts/sim-api';
import type { Modal, ModalKind } from '../store';

/**
 * What the End Turn button can point at: a sim decision, or the UI-only "found your first city"
 * nudge (a player with no settlement but a founder; GDD §11 first-turn clarity). The nudge is
 * not a rule: the sim never asks for it, so it blocks End Turn only until the player has looked.
 */
export type Prompt = Decision | { type: 'found'; unit: UnitId };

/** Decision types that turn the button into "Next: …". */
const ALWAYS_BLOCKING: ReadonlySet<Decision['type']> = new Set(['transition', 'offer', 'crisis']);

/** The modal a prompt opens; null for the found-city nudge (it selects the settler instead). */
export const decisionModal = (d: Prompt): Modal | null => {
  switch (d.type) {
    case 'found':
      return null;
    case 'offer':
      return { kind: 'offer', offer: d.offer };
    case 'crisis':
      return { kind: 'crisis' };
    case 'government':
      return { kind: 'government' };
    case 'research':
      return { kind: 'tree', tree: d.tree };
    case 'production':
      return { kind: 'city', settlement: d.settlement };
    case 'transition':
      return { kind: 'transition' };
  }
};

export const decisionLabel = (d: Prompt): string => {
  switch (d.type) {
    case 'found':
      return 'Found city';
    case 'offer':
      return 'Figure offer';
    case 'crisis':
      return 'Crisis';
    case 'government':
      return 'Government';
    case 'research':
      return d.tree === 'tech' ? 'Research' : 'Civics';
    case 'production':
      return 'Production';
    case 'transition':
      return 'New age';
  }
};

export interface EndTurnPlan {
  /** 'next' = the button opens `next`; 'end' = the button ends the turn. */
  mode: 'next' | 'end';
  next: Prompt | null;
  /** Non-blocking things still open (shown as a badge and a small hint chip). */
  advisory: Decision[];
  /** Cities with nothing in production (triggers the one-time confirm). */
  idleCities: string[];
}

export const isBlocking = (d: Decision, isRegistered: (kind: ModalKind) => boolean): boolean => {
  if (ALWAYS_BLOCKING.has(d.type)) return true;
  // Government blocks only if its screen exists; otherwise the player could never get past it.
  if (d.type === 'government') return isRegistered('government');
  return false;
};

/**
 * `founder`: a unit that could found the player's first settlement (only when they have none and
 * have not dismissed the nudge this turn). It goes first: nothing else makes sense before a city.
 */
export const planEndTurn = (
  decisions: readonly Decision[],
  isRegistered: (kind: ModalKind) => boolean,
  founder: UnitId | null = null,
): EndTurnPlan => {
  const blocking = decisions.filter((d) => isBlocking(d, isRegistered));
  const advisory = decisions.filter((d) => !isBlocking(d, isRegistered));
  const idleCities = advisory.flatMap((d) => (d.type === 'production' ? [d.settlement] : []));
  // A pending offer/crisis/transition still wins: the sim will not end the turn without it.
  const hardFirst = blocking.find((d) => d.type !== 'government');
  if (founder && !hardFirst) return { mode: 'next', next: { type: 'found', unit: founder }, advisory, idleCities };
  const first = blocking[0];
  if (first) return { mode: 'next', next: first, advisory, idleCities };
  return { mode: 'end', next: advisory[0] ?? null, advisory, idleCities };
};
