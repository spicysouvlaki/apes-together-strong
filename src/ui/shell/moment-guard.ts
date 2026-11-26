/**
 * Moments (first contact, the recruit reveal, the resume card) must be seen before a stray tap can
 * send them away (wave 13 playtest: a first-contact card appeared under a finger already on its way
 * to End Turn; the tap landed on its backdrop and closed it unseen). A backdrop tap within
 * MOMENT_GUARD_MS of the card appearing is ignored, and End Turn does nothing while one is up.
 */
import { computed } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { firstContacts } from './first-contact';
import { recruitReveal } from './recruit-reveal';
import { resumeRecap } from './resume-recap';

export const MOMENT_GUARD_MS = 600;

/** May a backdrop tap at `now` dismiss a moment shown at `shownAt`? */
export const backdropMayDismiss = (shownAt: number, now: number, guard: number = MOMENT_GUARD_MS): boolean => now - shownAt >= guard;

/** Is any moment waiting for the player? (They show one at a time; any of them blocks End Turn.) */
export const momentShowing = (m: { contacts: number; reveal: boolean; recap: boolean }): boolean => m.contacts > 0 || m.reveal || m.recap;

export const momentUp = computed(() => momentShowing({ contacts: firstContacts.value.length, reveal: recruitReveal.value !== null, recap: resumeRecap.value !== null }));

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * For a moment component: returns a backdrop handler that only closes once the moment has been up
 * long enough. `key` changes when a new moment replaces the old one (the clock restarts).
 */
export const useGuardedBackdrop = (key: unknown, close: () => void): (() => void) => {
  const shown = useRef<{ key: unknown; at: number }>({ key, at: now() });
  if (shown.current.key !== key) shown.current = { key, at: now() };
  return () => {
    if (backdropMayDismiss(shown.current.at, now())) close();
  };
};
