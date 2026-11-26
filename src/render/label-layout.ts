/**
 * Settlement label de-overlap (GDD §11 readability). Pure and allocation-free after setup:
 * labels are screen rectangles anchored at their bottom center; in priority order each label
 * tries its home slot, then one and two slots up, and is hidden if all collide. Labels only
 * ever move UP: each hangs on a leader above its settlement, and moving one down would cover
 * the buildings it names. A label whose slot would fall under the HUD (outside minY..maxY) is
 * not placed there either.
 * Called on camera changes with at most ~64 labels, so O(n²) is fine.
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
  /** Outputs: shift in label heights (up), and visibility (1/0). */
  readonly shift: Float32Array;
  readonly visible: Uint8Array;
  private readonly order: Int32Array;
  private readonly placedTop: Float32Array;
  count = 0;

  constructor(readonly capacity: number) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.w = new Float32Array(capacity);
    this.h = new Float32Array(capacity);
    this.priority = new Float32Array(capacity);
    this.shift = new Float32Array(capacity);
    this.visible = new Uint8Array(capacity);
    this.order = new Int32Array(capacity);
    this.placedTop = new Float32Array(capacity);
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
          if (!this.visible[j]) continue;
          const wj = this.w[j] ?? 0;
          const hj = this.h[j] ?? 0;
          const jx0 = (this.x[j] ?? 0) - wj / 2;
          const jx1 = jx0 + wj;
          const jt = this.placedTop[j] ?? 0;
          const jb = jt + hj;
          if (x0 < jx1 && x1 > jx0 && top < jb && bottom > jt) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          this.shift[i] = s;
          this.placedTop[i] = (this.y[i] ?? 0) - s * h - h;
          ok = true;
          break;
        }
      }
      this.visible[i] = ok ? 1 : 0;
      if (!ok) this.shift[i] = 0;
      placed++;
    }
  }
}
