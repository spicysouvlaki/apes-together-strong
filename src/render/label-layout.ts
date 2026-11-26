/**
 * Settlement label de-overlap (GDD §11 readability). Pure and allocation-free after setup:
 * labels are screen rectangles anchored at their bottom center; in priority order each label
 * tries its home slot, then one and two slots up, and is hidden if all collide. Labels only
 * ever move UP: each hangs on a leader above its settlement, and moving one down would cover
 * the buildings it names. A label whose slot would fall under the HUD (outside minY..maxY) is
 * not placed there either.
 * Called on camera changes with at most ~64 labels, so O(n²) is fine.
 *
 * Non-solid labels (settler site seals) never move, never hide and never block others.
 * `fade` dims labels that cover a unit (the unit stays readable and tappable), and `hit`
 * resolves a tap to the label under it, so a tap on a settlement's name selects that
 * settlement rather than the tile behind the cartouche.
 */

/** Candidate vertical shifts, in label heights (positive = up on screen). */
export const LABEL_SHIFTS: readonly number[] = [0, 1.05, 2.1];

export class LabelLayout {
  /** Inputs per label: screen anchor x, bottom y (px, y down), width, height, priority. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly w: Float32Array;
  readonly h: Float32Array;
  readonly priority: Float32Array;
  /** 1 = takes part in de-overlap (default); 0 = fixed in place, never blocks (site seals). */
  readonly solid: Uint8Array;
  /** Outputs: shift in label heights (up), and visibility (1/0). */
  readonly shift: Float32Array;
  readonly visible: Uint8Array;
  /** Screen top (px) of each placed label's box (valid while visible). */
  readonly top: Float32Array;
  /** Draw opacity: 0 hidden, 1 shown, FADED_ALPHA when it covers a unit (see fade()). */
  readonly alpha: Float32Array;
  private readonly order: Int32Array;
  count = 0;

  constructor(readonly capacity: number) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.w = new Float32Array(capacity);
    this.h = new Float32Array(capacity);
    this.priority = new Float32Array(capacity);
    this.solid = new Uint8Array(capacity).fill(1);
    this.shift = new Float32Array(capacity);
    this.visible = new Uint8Array(capacity);
    this.top = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.order = new Int32Array(capacity);
  }

  /**
   * Lay out labels 0..count-1. `pad` = extra px kept between labels; a label must fit between
   * screen rows `minY` and `maxY` (HUD-free band, px from the top).
   */
  solve(pad = 2, minY = -Infinity, maxY = Infinity): void {
    const n = Math.min(this.count, this.capacity);
    const { order } = this;
    for (let i = 0; i < n; i++) order[i] = i;
    // Insertion sort by priority desc, index asc (stable, deterministic, no allocation).
    for (let i = 1; i < n; i++) {
      const v = order[i] ?? 0;
      const pv = this.priority[v] ?? 0;
      let j = i - 1;
      while (j >= 0) {
        const o = order[j] ?? 0;
        const po = this.priority[o] ?? 0;
        if (po > pv || (po === pv && o < v)) break;
        order[j + 1] = o;
        j--;
      }
      order[j + 1] = v;
    }
    let placed = 0;
    for (let k = 0; k < n; k++) {
      const i = order[k] ?? 0;
      if (!this.solid[i]) {
        this.shift[i] = 0;
        this.top[i] = (this.y[i] ?? 0) - (this.h[i] ?? 0);
        this.visible[i] = 1;
        this.alpha[i] = 1;
        placed++;
        continue;
      }
      const w = this.w[i] ?? 0;
      const h = this.h[i] ?? 0;
      const x0 = (this.x[i] ?? 0) - w / 2 - pad;
      const x1 = x0 + w + pad * 2;
      let ok = false;
      for (const s of LABEL_SHIFTS) {
        const bottom = (this.y[i] ?? 0) - s * h + pad;
        const top = bottom - h - pad * 2;
        let hit = top + pad < minY || bottom - pad > maxY;
        for (let p = 0; p < placed; p++) {
          const j = order[p] ?? 0;
          if (!this.visible[j] || !this.solid[j]) continue;
          const wj = this.w[j] ?? 0;
          const hj = this.h[j] ?? 0;
          const jx0 = (this.x[j] ?? 0) - wj / 2;
          const jx1 = jx0 + wj;
          const jt = this.top[j] ?? 0;
          const jb = jt + hj;
          if (x0 < jx1 && x1 > jx0 && top < jb && bottom > jt) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          this.shift[i] = s;
          this.top[i] = (this.y[i] ?? 0) - s * h - h;
          ok = true;
          break;
        }
      }
      this.visible[i] = ok ? 1 : 0;
      this.alpha[i] = ok ? 1 : 0;
      if (!ok) this.shift[i] = 0;
      placed++;
    }
  }

  /**
   * Dim every shown, solid label whose box contains one of the screen points (px, py)
   * (e.g. a unit standing on the tile behind a city label). Call after solve().
   */
  fade(px: Float32Array, py: Float32Array, points: number, faded = FADED_ALPHA): void {
    const n = Math.min(this.count, this.capacity);
    for (let i = 0; i < n; i++) {
      if (!this.visible[i] || !this.solid[i]) continue;
      const w = this.w[i] ?? 0;
      if (w <= 0) continue;
      const x0 = (this.x[i] ?? 0) - w / 2;
      const x1 = x0 + w;
      const t = this.top[i] ?? 0;
      const b = t + (this.h[i] ?? 0);
      for (let k = 0; k < points; k++) {
        const x = px[k] ?? 0;
        const y = py[k] ?? 0;
        if (x >= x0 && x <= x1 && y >= t && y <= b) {
          this.alpha[i] = faded;
          break;
        }
      }
    }
  }

  /**
   * Index of the label drawn on top at screen point (x, y), or -1. `slop` px widens every box
   * (fingers are wide). Faded labels let taps through to the unit they cover. Later indices
   * draw on top, so they are tested first.
   */
  hit(x: number, y: number, slop = 4): number {
    const n = Math.min(this.count, this.capacity);
    for (let i = n - 1; i >= 0; i--) {
      if (!this.visible[i] || (this.alpha[i] ?? 0) < 1) continue;
      const w = this.w[i] ?? 0;
      if (w <= 0) continue;
      const x0 = (this.x[i] ?? 0) - w / 2 - slop;
      const t = (this.top[i] ?? 0) - slop;
      if (x >= x0 && x <= x0 + w + slop * 2 && y >= t && y <= t + (this.h[i] ?? 0) + slop * 2) return i;
    }
    return -1;
  }
}

/** Opacity of a label that covers a unit. */
export const FADED_ALPHA = 0.3;
