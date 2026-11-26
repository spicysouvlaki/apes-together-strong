/**
 * Two tabs (or a Safari tab and the Home Screen app on desktop) share one IndexedDB. Without a
 * guard, both would autosave into the same ring and Continue would mix two games.
 *
 * Rule: the tab that most recently started or loaded a game OWNS the autosaves (last claimer
 * wins). The claim is a key in IndexedDB that every autosave checks atomically in its own write
 * transaction (src/platform/saves.ts), so even a frozen background tab that wakes up later can
 * never write over the newer tab's saves. This channel only makes the older tab find out at
 * once, instead of at its next save, so it can tell the player.
 *
 * Why not Web Locks: a lock held by a suspended iOS tab would block the player in their only
 * live tab, and stale locks need expiry. Last-claimer-wins never blocks anyone and has no
 * stale state: a crashed tab simply never claims again.
 */

export interface TabChannel {
  /** Tell other tabs that `owner` now owns the saves. */
  announce(owner: string): void;
  /** Called with the owner id another tab announced. */
  onClaim(cb: (owner: string) => void): void;
  close(): void;
}

const CHANNEL_NAME = 'apes-together-strong.saves-owner';

interface ClaimMessage {
  type: 'claim';
  owner: string;
}

const isClaim = (d: unknown): d is ClaimMessage =>
  typeof d === 'object' && d !== null && (d as ClaimMessage).type === 'claim' && typeof (d as ClaimMessage).owner === 'string';

/** BroadcastChannel-backed channel, or null where BroadcastChannel is missing (then the IDB check alone guards). */
export const createBroadcastTabChannel = (name: string = CHANNEL_NAME): TabChannel | null => {
  if (typeof BroadcastChannel === 'undefined') return null;
  let bc: BroadcastChannel;
  try {
    bc = new BroadcastChannel(name);
  } catch {
    return null;
  }
  const listeners: ((owner: string) => void)[] = [];
  bc.onmessage = (e: MessageEvent) => {
    if (isClaim(e.data)) for (const cb of listeners) cb(e.data.owner);
  };
  return {
    announce: (owner) => {
      try {
        bc.postMessage({ type: 'claim', owner } satisfies ClaimMessage);
      } catch {
        // A closed channel: the IDB ownership check still protects the saves.
      }
    },
    onClaim: (cb) => void listeners.push(cb),
    close: () => bc.close(),
  };
};

/** In-process stand-in for tests: every channel from one bus hears the others, never itself. */
export const createMemoryTabBus = (): { channel(): TabChannel } => {
  const all = new Set<(owner: string, from: object) => void>();
  return {
    channel() {
      const self = {};
      const listeners: ((owner: string) => void)[] = [];
      const deliver = (owner: string, from: object): void => {
        if (from !== self) for (const cb of listeners) cb(owner);
      };
      all.add(deliver);
      return {
        announce: (owner) => {
          for (const d of [...all]) d(owner, self);
        },
        onClaim: (cb) => void listeners.push(cb),
        close: () => void all.delete(deliver),
      };
    },
  };
};
