/**
 * Settlement label keys and the label-atlas slot allocator. Pure (no canvas): the scene draws
 * a label into an atlas slot once per distinct key and reuses it until evicted.
 */
import type { Settlement } from '@contracts/sim-api';

export interface LabelSpec {
  text: string;
  capital: boolean;
  /** Owner primary color (#rrggbb), drawn as a swatch. */
  color: string;
}

export const labelText = (s: Pick<Settlement, 'name' | 'population'>): string => `${s.name}  ${s.population}`;

export const labelSpec = (s: Pick<Settlement, 'name' | 'population' | 'isCapital'>, color: string): LabelSpec => ({
  text: labelText(s),
  capital: s.isCapital,
  color: color.toLowerCase(),
});

/** Cache key: everything that changes the pixels, nothing else. */
export const labelKey = (spec: LabelSpec): string => `${spec.capital ? '*' : '-'}${spec.color}|${spec.text}`;

/**
 * Fixed-capacity LRU of atlas slots keyed by label key. `acquire` returns the slot and whether
 * it must be (re)drawn. Slots marked in use this frame are never evicted.
 */
export class LabelSlotCache {
  private readonly keyToSlot = new Map<string, number>();
  private readonly slotKey: (string | null)[];
  private readonly lastUsed: number[];
  private readonly usedIn: number[];
  private clock = 0;
  private frame = 0;

  constructor(readonly capacity: number) {
    this.slotKey = new Array<string | null>(capacity).fill(null);
    this.lastUsed = new Array<number>(capacity).fill(-1);
    this.usedIn = new Array<number>(capacity).fill(-1);
  }

  /** Start a new update pass; slots acquired in earlier passes become evictable. */
  beginPass(): void {
    this.frame++;
  }

  /** null when every slot is already taken in this pass. */
  acquire(key: string): { slot: number; fresh: boolean } | null {
    this.clock++;
    const hit = this.keyToSlot.get(key);
    if (hit !== undefined) {
      this.lastUsed[hit] = this.clock;
      this.usedIn[hit] = this.frame;
      return { slot: hit, fresh: false };
    }
    let best = -1;
    let bestAge = Infinity;
    for (let i = 0; i < this.capacity; i++) {
      if (this.usedIn[i] === this.frame) continue;
      const age = this.lastUsed[i] ?? -1;
      if (age < bestAge) {
        bestAge = age;
        best = i;
      }
    }
    if (best < 0) return null;
    const old = this.slotKey[best];
    if (old != null) this.keyToSlot.delete(old);
    this.slotKey[best] = key;
    this.keyToSlot.set(key, best);
    this.lastUsed[best] = this.clock;
    this.usedIn[best] = this.frame;
    return { slot: best, fresh: true };
  }

  has(key: string): boolean {
    return this.keyToSlot.has(key);
  }

  clear(): void {
    this.keyToSlot.clear();
    this.slotKey.fill(null);
    this.lastUsed.fill(-1);
    this.usedIn.fill(-1);
  }
}
