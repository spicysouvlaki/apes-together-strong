/**
 * Fog-of-war memory for rival settlements (GDD §11 fog of war): a settlement the viewer has
 * seen stays on the map, ghosted, as it was last seen, after its tile leaves sight. Lives in
 * the renderer (not in GameState: it's presentation, and the sim's explored[] has no
 * per-tile content). Keyed by game seed + viewer; reset on a new game. Pure.
 */
import type { Settlement } from '@contracts/sim-api';
import { FOG_EXPLORED, FOG_VISIBLE } from './colors';

export type GhostSettlement = Pick<
  Settlement,
  'id' | 'owner' | 'name' | 'kind' | 'population' | 'isCapital' | 'hp' | 'maxHp' | 'at'
> & {
  /** Naming culture, for the architecture kit (optional: older memory entries lack it). */
  namedFor?: string;
};

export class GhostMemory {
  private key = '';
  private lastTurn = -1;
  private readonly byTile = new Map<number, GhostSettlement>();

  /** Number of remembered settlements (visible or not). */
  get size(): number {
    return this.byTile.size;
  }

  clear(): void {
    this.byTile.clear();
    this.lastTurn = -1;
  }

  /**
   * Fold a new snapshot into memory. `settlements` must already carry tile indices; the
   * viewer's own settlements are never remembered (they always show). A tile in sight is the
   * truth: whatever memory says about it is replaced by what is there now (or forgotten).
   */
  update(
    gameKey: string,
    turn: number,
    viewer: string | null,
    settlements: readonly { tile: number; s: Settlement }[],
    fog: Uint8Array,
  ): void {
    if (gameKey !== this.key || turn < this.lastTurn || viewer === null) {
      this.key = gameKey;
      this.byTile.clear();
    }
    this.lastTurn = turn;
    if (viewer === null) return;
    for (const tile of [...this.byTile.keys()]) {
      if (fog[tile] === FOG_VISIBLE) this.byTile.delete(tile);
    }
    for (const { tile, s } of settlements) {
      if (s.owner === viewer || fog[tile] !== FOG_VISIBLE) continue;
      this.byTile.set(tile, {
        id: s.id,
        owner: s.owner,
        name: s.name,
        kind: s.kind,
        population: s.population,
        isCapital: s.isCapital,
        hp: s.hp,
        maxHp: s.maxHp,
        at: { q: s.at.q, r: s.at.r },
        namedFor: s.namedFor,
      });
    }
  }

  /** Remembered settlements on explored-but-not-visible tiles, in tile order. */
  ghosts(fog: Uint8Array, out: { tile: number; g: GhostSettlement }[] = []): { tile: number; g: GhostSettlement }[] {
    out.length = 0;
    const tiles = [...this.byTile.keys()].sort((a, b) => a - b);
    for (const tile of tiles) {
      const g = this.byTile.get(tile);
      if (g && fog[tile] === FOG_EXPLORED) out.push({ tile, g });
    }
    return out;
  }
}
