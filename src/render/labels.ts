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
  /** Name and population drawn separately (pop in a badge); default: parsed from `text`. */
  name?: string;
  population?: number;
  /** Colorblind pattern id for the swatch (patterns.ts); omitted = solid. */
  pattern?: number;
  /** Last-seen memory of a rival settlement under fog (drawn faded, dashed outline). */
  ghost?: boolean;
  /** Owner is at war with the viewer (red outline + crossed-swords mark). */
  war?: boolean;
  /** City-state (diamond swatch instead of a circle). */
  cityState?: boolean;
  /** Wall HP fraction (0..1, quantized to tenths); omitted or 1 = undamaged, no bar. */
  wall?: number;
  /** A settler site seal: a round gold seal with this rank's numeral instead of a cartouche. */
  seal?: number;
  /** A floating combat number ("−29"): HP lost, drawn as inked red numerals, no cartouche. */
  damage?: number;
}

/** Floating damage number spec (combat feedback over the hit unit or city). */
export const damageSpec = (hp: number): LabelSpec => ({ text: String(hp), capital: false, color: '#d8392b', damage: Math.max(0, Math.round(hp)) });

/** Fixed labels (seals, damage numbers) never move, never hide and never block names. */
export const isFixedLabel = (spec: LabelSpec): boolean => spec.seal !== undefined || spec.damage !== undefined;

/** Site seal spec (rank 1 = best site, drawn a little larger). */
export const sealSpec = (rank: number): LabelSpec => ({ text: String(rank), capital: false, color: '#c9a03a', seal: rank });

export interface LabelExtras {
  pattern?: number;
  ghost?: boolean;
  war?: boolean;
  cityState?: boolean;
  wall?: number;
}

/** Wall fraction quantized to tenths (bounded atlas churn); never rounds damage away. */
export const wallFraction = (hp: number, maxHp: number): number => {
  if (maxHp <= 0 || hp >= maxHp) return 1;
  return Math.min(0.9, Math.max(0, Math.floor((hp / maxHp) * 10) / 10));
};

export const labelText = (s: Pick<Settlement, 'name' | 'population'>): string => `${s.name}  ${s.population}`;

export const labelSpec = (
  s: Pick<Settlement, 'name' | 'population' | 'isCapital'>,
  color: string,
  extras: LabelExtras = {},
): LabelSpec => ({
  text: labelText(s),
  capital: s.isCapital,
  color: color.toLowerCase(),
  name: s.name,
  population: s.population,
  ...extras,
});

/** Cache key: everything that changes the pixels, nothing else. */
export const labelKey = (spec: LabelSpec): string =>
  spec.seal !== undefined
    ? `seal|${spec.seal}`
    : spec.damage !== undefined
      ? `dmg|${spec.damage}`
      : `${spec.capital ? '*' : '-'}${spec.color}|${spec.pattern ?? 0}${spec.ghost ? 'g' : ''}${spec.war ? 'w' : ''}${spec.cityState ? 'c' : ''}${spec.wall !== undefined && spec.wall < 1 ? `h${spec.wall}` : ''}|${spec.text}`;

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
