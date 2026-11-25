/**
 * Maps SimQueries.pendingDecisions to the End Turn button (GDD §5: "End Turn blocks only on
 * decisions needing an answer"). Pure. The sim refuses `endTurn` while an offer or a crisis
 * response is open; a missing government is answered here too (when its screen exists) because
 * playing without one silently forfeits cabinet bonuses. Idle research and production are
 * advisory: the player may end the turn anyway (with one confirm for an idle city).
 */
import type { Decision } from '@contracts/sim-api';
import type { Modal, ModalKind } from '../store';

/** Decision types that turn the button into "Next: …". */
const ALWAYS_BLOCKING: ReadonlySet<Decision['type']> = new Set(['transition', 'offer', 'crisis']);

export const decisionModal = (d: Decision): Modal => {
  switch (d.type) {
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

export const decisionLabel = (d: Decision): string => {
  switch (d.type) {
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
  next: Decision | null;
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

export const planEndTurn = (decisions: readonly Decision[], isRegistered: (kind: ModalKind) => boolean): EndTurnPlan => {
  const blocking = decisions.filter((d) => isBlocking(d, isRegistered));
  const advisory = decisions.filter((d) => !isBlocking(d, isRegistered));
  const idleCities = advisory.flatMap((d) => (d.type === 'production' ? [d.settlement] : []));
  const first = blocking[0];
  if (first) return { mode: 'next', next: first, advisory, idleCities };
  return { mode: 'end', next: advisory[0] ?? null, advisory, idleCities };
};
