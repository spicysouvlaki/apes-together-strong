/**
 * "The story so far" when a saved game is resumed (playtest 4: after a reload the player landed
 * on the map with no memory of what they were doing, and the turn log is empty after a reload).
 * Built from the sim's own chronicle of the player's people. Pure apart from the signal.
 */
import { signal } from '@preact/signals';
import type { ChronicleEntry } from '@contracts/sim-api';

/** Set when a game is resumed from a save (not for a new game); cleared when dismissed. */
export const resumeRecap = signal<{ seed: number; turn: number } | null>(null);

/** A resumed game (turn > 1) is worth a recap; a fresh one starts with the guide instead. */
export const shouldRecap = (prevSeed: number | null, nextSeed: number, nextTurn: number): boolean =>
  prevSeed !== nextSeed && nextTurn > 1;

/**
 * The last few things the chronicle remembers, newest last, as short lines. A tradition entry is
 * "Name: long history note"; the recap keeps only "Adopted Name". Age boundaries and the naming
 * are kept: they are the big beats. Repeated lines (a figure joining, then retiring) stay
 * separate because they say different things.
 */
export const recapLines = (chronicle: readonly ChronicleEntry[], max = 4): { turn: number; text: string }[] =>
  chronicle
    .slice(-Math.max(max * 3, 12))
    .map((e) => {
      if (e.kind === 'tradition' || e.kind === 'hybrid') {
        const name = e.text.split(':')[0]?.trim() ?? e.text;
        return { turn: e.turn, text: `Adopted ${name}${e.kind === 'hybrid' ? ', a hybrid tradition' : ''}.` };
      }
      return { turn: e.turn, text: e.text.trim() };
    })
    .filter((l, i, all) => all.findIndex((x) => x.text === l.text) === i)
    .slice(-max);
