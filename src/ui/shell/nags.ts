/**
 * Advisory nags ("Next: Production", the "Research" chip) are dismissible for the turn
 * (playtest, turn 1: closing the city sheet without choosing left "Next: Production" pointing
 * at it forever). Opening a nag, or tapping its ×, puts it to rest until the next turn, so the
 * button moves on to the next thing and never shows the same nag twice in a row. Pure.
 */
import type { Prompt } from './decisions';

export interface NagMemory {
  turn: number;
  keys: readonly string[];
}

export const EMPTY_NAGS: NagMemory = { turn: -1, keys: [] };

/** Stable key of a prompt ("production:s3", "research:tech", "government", "found"). */
export const promptKey = (d: Prompt): string => {
  switch (d.type) {
    case 'production':
      return `production:${d.settlement}`;
    case 'research':
      return `research:${d.tree}`;
    case 'offer':
      return `offer:${d.offer}`;
    default:
      return d.type;
  }
};

/** Keys at rest on `turn` (a memory from another turn is empty). */
export const restingNags = (mem: NagMemory, turn: number): ReadonlySet<string> => new Set(mem.turn === turn ? mem.keys : []);

/** The memory with `key` at rest for `turn`. */
export const restNag = (mem: NagMemory, turn: number, key: string): NagMemory => {
  const keys = mem.turn === turn ? mem.keys : [];
  return keys.includes(key) ? mem : { turn, keys: [...keys, key] };
};
