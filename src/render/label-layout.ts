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
 * `liftOver` raises a cartouche (its leader stretches) over a unit standing on or in front of
 * its own settlement, so the name always stays legible (playtest 3: "Ugarit" sat under a
 * figurine once units grew 25%); `fade` still dims a label that covers a unit BEHIND it (the
 * unit stays readable and tappable), and `hit`
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
  /**
   * Horizontal nudge (px, + = right) that keeps a cartouche inside minX..maxX (playtest: names
   * clipped at the screen edge). Capped so the anchor stays under the cartouche: the leader
   * still points straight down at the settlement.
   */
  readonly dx: Float32Array;
  readonly visible: Uint8Array;
  /** Screen top (px) of each placed label's box (valid while visible). */
  readonly top: Float32Array;
  /** Draw opacity: 0 hidden, 1 shown, FADED_ALPHA when it covers a unit (see fade()). */
  readonly alpha: Float32Array;
  /** Input: caller tag per label (the settlement's tile), matched against obstacle tags. */
  readonly tag: Int32Array;
  /**
   * Leader stretch in label heights (≥ 0): the cartouche rises this much above its home slot
   * while the leader foot stays on the settlement (set by liftOver, used by solve).
   */
  readonly lift: Float32Array;
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
    this.dx = new Float32Array(capacity);
    this.visible = new Uint8Array(capacity);
    this.top = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.tag = new Int32Array(capacity).fill(-1);
    this.lift = new Float32Array(capacity);
    this.order = new Int32Array(capacity);
  }

  /**
   * Raise each solid label above the units that stand on or in front of its own settlement
   * (obstacle tag === label tag): the cartouche bottom must clear the unit's top by `pad` px.
   * Obstacles: screen x, top y (px), half width (px) and tag. Capped at MAX_LIFT label heights;
   * beyond that the label stays put (and fade() dims it instead). Call before solve().
   */
  liftOver(ox: Float32Array, otop: Float32Array, ohw: Float32Array, otag: Int32Array, count: number, pad = 3, maxLift = MAX_LIFT): void {
    const n = Math.min(this.count, this.capacity);
    for (let i = 0; i < n; i++) {
      this.lift[i] = 0;
      const t = this.tag[i] ?? -1;
      const w = this.w[i] ?? 0;
      const h = this.h[i] ?? 0;
      if (!this.solid[i] || t < 0 || w <= 0 || h <= 0) continue;
      const x0 = (this.x[i] ?? 0) - w / 2;
      const x1 = x0 + w;
      const bottom = this.y[i] ?? 0;
      let need = 0;
      for (let j = 0; j < count; j++) {
        if (otag[j] !== t) continue;
        const x = ox[j] ?? 0;
        const hw = ohw[j] ?? 0;
        if (x + hw < x0 || x - hw > x1) continue;
        const up = (bottom - ((otop[j] ?? 0) - pad)) / h;
        if (up > need) need = up;
      }
      this.lift[i] = need > maxLift ? 0 : need;
    }
  }

  /**
   * Lay out labels 0..count-1. `pad` = extra px kept between labels; a label must fit between
   * screen rows `minY` and `maxY` (HUD-free band, px from the top), and is nudged sideways to
   * fit between columns `minX` and `maxX` (see `dx`). With unit points (`px`, `py`, the fade
   * points), a label whose slot would cover a unit first tries stretching its leader one or two
   * label heights higher (added to `lift`), so both stay readable; only if that collides too does
   * fade() dim it later.
   */
  solve(
    pad = 2,
    minY = -Infinity,
    maxY = Infinity,
    minX = -Infinity,
    maxX = Infinity,
    px: Float32Array | null = null,
    py: Float32Array | null = null,
    points = 0,
  ): void {
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
      this.dx[i] = 0;
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
      const dx = edgeNudge(this.x[i] ?? 0, w, minX, maxX);
      this.dx[i] = dx;
      const x0 = (this.x[i] ?? 0) + dx - w / 2 - pad;
      const x1 = x0 + w + pad * 2;
      let ok = false;
      const yi = (this.y[i] ?? 0) - (this.lift[i] ?? 0) * h;
      for (const s of LABEL_SHIFTS) {
        const bottom = yi - s * h + pad;
        const top = bottom - h - pad * 2;
        if (!this.blocked(x0, x1, top, bottom, placed, pad, minY, maxY)) {
          this.shift[i] = s;
          this.top[i] = yi - s * h - h;
          ok = true;
          break;
        }
      }
      if (ok && px && py && points > 0 && w > 0) {
        const s = this.shift[i] ?? 0;
        const bx0 = x0 + pad;
        const bx1 = x1 - pad;
        if (covers(bx0, bx1, yi - s * h - h, yi - s * h, px, py, points)) {
          for (const e of AVOID_LIFTS) {
            const bottom = yi - (s + e) * h;
            if (covers(bx0, bx1, bottom - h, bottom, px, py, points)) continue;
            if (this.blocked(x0, x1, bottom - h - pad, bottom + pad, placed, pad, minY, maxY)) continue;
            this.lift[i] = (this.lift[i] ?? 0) + e;
            this.top[i] = bottom - h;
            break;
          }
        }
      }
      this.visible[i] = ok ? 1 : 0;
      this.alpha[i] = ok ? 1 : 0;
      if (!ok) this.shift[i] = 0;
      placed++;
    }
  }

  /** Whether box (x0..x1, top..bottom) leaves the HUD-free band or hits an already placed label. */
  private blocked(x0: number, x1: number, top: number, bottom: number, placed: number, pad: number, minY: number, maxY: number): boolean {
    if (top + pad < minY || bottom - pad > maxY) return true;
    const { order } = this;
    for (let p = 0; p < placed; p++) {
      const j = order[p] ?? 0;
      if (!this.visible[j] || !this.solid[j]) continue;
      const wj = this.w[j] ?? 0;
      const hj = this.h[j] ?? 0;
      const jx0 = (this.x[j] ?? 0) + (this.dx[j] ?? 0) - wj / 2;
      const jx1 = jx0 + wj;
      const jt = this.top[j] ?? 0;
      const jb = jt + hj;
      if (x0 < jx1 && x1 > jx0 && top < jb && bottom > jt) return true;
    }
    return false;
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
      const x0 = (this.x[i] ?? 0) + (this.dx[i] ?? 0) - w / 2;
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
      const x0 = (this.x[i] ?? 0) + (this.dx[i] ?? 0) - w / 2 - slop;
      const t = (this.top[i] ?? 0) - slop;
      if (x >= x0 && x <= x0 + w + slop * 2 && y >= t && y <= t + (this.h[i] ?? 0) + slop * 2) return i;
    }
    return -1;
  }
}

/** Opacity of a label that covers a unit. */
export const FADED_ALPHA = 0.3;

/** Most a label rises over a unit on its own settlement (label heights); more and it fades. */
export const MAX_LIFT = 3.2;

/** Extra leader stretch tried (label heights) when a label's slot would cover another unit. */
export const AVOID_LIFTS: readonly number[] = [1.05, 2.1];

/** Whether any point (px, py) lies inside the box. */
const covers = (x0: number, x1: number, top: number, bottom: number, px: Float32Array, py: Float32Array, n: number): boolean => {
  for (let k = 0; k < n; k++) {
    const x = px[k] ?? 0;
    const y = py[k] ?? 0;
    if (x >= x0 && x <= x1 && y >= top && y <= bottom) return true;
  }
  return false;
};

/**
 * Sideways nudge (px) that brings a box of width `w` centred at `x` inside [minX, maxX], capped
 * at w/2 − STEM_KEEP so the anchor (and the leader hanging from it) stays under the box.
 */
export const edgeNudge = (x: number, w: number, minX: number, maxX: number): number => {
  if (w <= 0) return 0;
  const cap = Math.max(0, w / 2 - STEM_KEEP);
  let d = 0;
  if (x - w / 2 < minX) d = minX - (x - w / 2);
  else if (x + w / 2 > maxX) d = maxX - (x + w / 2);
  return d > cap ? cap : d < -cap ? -cap : d;
};

/** Px of cartouche kept on the far side of the leader when nudged (clears the notched end). */
export const STEM_KEEP = 14;
