/**
 * Pure pointer-gesture recognizer (GDD §11 "Touch"): one-finger pan, pinch zoom, two-finger
 * twist (60° steps), tap, long-press, desktop right-drag rotate. It consumes timestamped
 * pointer samples and returns actions; the renderer maps actions to camera moves. Pure so the
 * thresholds are unit-tested without a browser.
 */

export const TAP_MAX_MS = 250;
export const TAP_MAX_MOVE_PX = 8;
export const LONG_PRESS_MS = 450;
/** Accumulated two-finger twist that triggers one 60° rotation step. */
export const TWIST_STEP_RAD = (30 * Math.PI) / 180;
/**
 * Once a two-finger gesture has zoomed by more than this (|ln(spread / startSpread)|) before
 * any rotation, it's a pinch: twisting no longer rotates, so zooming never snaps the view.
 */
export const PINCH_LOCK_LOG = 0.15;
/** Horizontal right-drag distance per rotation step (desktop). */
export const ROTATE_DRAG_PX = 90;

export type GestureAction =
  | { type: 'pan'; fromX: number; fromY: number; toX: number; toY: number }
  /** Finger lifted after a pan; velocity in px/ms for inertia. */
  | { type: 'panEnd'; vx: number; vy: number }
  /** `factor` > 1 means the fingers moved together (zoom out). Centered on (cx, cy). */
  | { type: 'pinch'; factor: number; cx: number; cy: number }
  /** +1 = fingers turned clockwise on screen (or right-drag to the right). */
  | { type: 'rotateStep'; dir: 1 | -1 }
  | { type: 'tap'; x: number; y: number }
  | { type: 'longPress'; x: number; y: number }
  /** Any new touch: stop inertia and camera tweens. */
  | { type: 'interrupt' };

interface Pt {
  x: number;
  y: number;
}

type Mode = 'idle' | 'pending' | 'pan' | 'pinch' | 'rotateDrag';

interface Sample {
  x: number;
  y: number;
  t: number;
}

export class GestureRecognizer {
  private readonly pts = new Map<number, Pt>();
  private mode: Mode = 'idle';
  private startX = 0;
  private startY = 0;
  private startT = 0;
  private longFired = false;
  private multi = false;
  private spread = 0;
  private angle = 0;
  private midX = 0;
  private midY = 0;
  private twist = 0;
  private pinchStartSpread = 0;
  /** null = undecided, 'zoom' = twist ignored, 'rotate' = a step already fired. */
  private twoFingerIntent: 'zoom' | 'rotate' | null = null;
  private dragAccum = 0;
  private samples: Sample[] = [];

  /** True while a press could still become a long-press (renderer schedules `tick`). */
  get awaitingLongPress(): boolean {
    return this.mode === 'pending' && !this.longFired && !this.multi;
  }

  down(id: number, x: number, y: number, t: number, button = 0): GestureAction[] {
    const out: GestureAction[] = [{ type: 'interrupt' }];
    this.pts.set(id, { x, y });
    if (this.pts.size === 1) {
      this.startX = x;
      this.startY = y;
      this.startT = t;
      this.longFired = false;
      this.multi = false;
      this.samples = [{ x, y, t }];
      this.dragAccum = 0;
      this.mode = button === 2 ? 'rotateDrag' : 'pending';
    } else if (this.pts.size === 2 && this.mode !== 'rotateDrag') {
      this.multi = true;
      this.mode = 'pinch';
      this.twist = 0;
      this.measurePair();
      this.pinchStartSpread = this.spread;
      this.twoFingerIntent = null;
    }
    return out;
  }

  move(id: number, x: number, y: number, t: number): GestureAction[] {
    const p = this.pts.get(id);
    if (!p) return [];
    const px = p.x;
    const py = p.y;
    p.x = x;
    p.y = y;
    const out: GestureAction[] = [];
    switch (this.mode) {
      case 'pending': {
        if (Math.hypot(x - this.startX, y - this.startY) > TAP_MAX_MOVE_PX) {
          this.mode = 'pan';
          out.push({ type: 'pan', fromX: this.startX, fromY: this.startY, toX: x, toY: y });
          this.pushSample(x, y, t);
        }
        break;
      }
      case 'pan':
        out.push({ type: 'pan', fromX: px, fromY: py, toX: x, toY: y });
        this.pushSample(x, y, t);
        break;
      case 'pinch': {
        const prevSpread = this.spread;
        const prevAngle = this.angle;
        const prevMidX = this.midX;
        const prevMidY = this.midY;
        this.measurePair();
        if (prevSpread > 1 && this.spread > 1) {
          out.push({ type: 'pinch', factor: prevSpread / this.spread, cx: this.midX, cy: this.midY });
        }
        if (prevMidX !== this.midX || prevMidY !== this.midY) {
          out.push({ type: 'pan', fromX: prevMidX, fromY: prevMidY, toX: this.midX, toY: this.midY });
        }
        let da = this.angle - prevAngle;
        if (da > Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        this.twist += da;
        if (
          this.twoFingerIntent === null &&
          this.pinchStartSpread > 1 &&
          Math.abs(Math.log(this.spread / this.pinchStartSpread)) > PINCH_LOCK_LOG
        ) {
          this.twoFingerIntent = 'zoom';
        }
        if (this.twoFingerIntent !== 'zoom' && Math.abs(this.twist) >= TWIST_STEP_RAD) {
          out.push({ type: 'rotateStep', dir: this.twist > 0 ? 1 : -1 });
          this.twist = 0;
          this.twoFingerIntent = 'rotate';
        }
        break;
      }
      case 'rotateDrag': {
        this.dragAccum += x - px;
        while (Math.abs(this.dragAccum) >= ROTATE_DRAG_PX) {
          const dir = this.dragAccum > 0 ? 1 : -1;
          out.push({ type: 'rotateStep', dir });
          this.dragAccum -= dir * ROTATE_DRAG_PX;
        }
        break;
      }
      case 'idle':
        break;
    }
    return out;
  }

  up(id: number, x: number, y: number, t: number): GestureAction[] {
    if (!this.pts.has(id)) return [];
    const out: GestureAction[] = [];
    this.pts.delete(id);
    if (this.pts.size === 0) {
      if (
        this.mode === 'pending' &&
        !this.longFired &&
        !this.multi &&
        t - this.startT < TAP_MAX_MS &&
        Math.hypot(x - this.startX, y - this.startY) <= TAP_MAX_MOVE_PX
      ) {
        out.push({ type: 'tap', x, y });
      } else if (this.mode === 'pan') {
        out.push({ type: 'panEnd', ...this.velocity(t) });
      }
      this.mode = 'idle';
    } else if (this.mode === 'pinch' && this.pts.size === 1) {
      // Continue as a pan with the remaining finger (never a tap).
      this.mode = 'pan';
      const rest = this.pts.values().next().value;
      if (rest) this.samples = [{ x: rest.x, y: rest.y, t }];
    }
    return out;
  }

  cancel(id: number): GestureAction[] {
    this.pts.delete(id);
    if (this.pts.size === 0) this.mode = 'idle';
    return [];
  }

  /** Call when the long-press timer fires (or periodically); emits at most one long-press. */
  tick(t: number): GestureAction[] {
    if (this.awaitingLongPress && t - this.startT >= LONG_PRESS_MS) {
      this.longFired = true;
      return [{ type: 'longPress', x: this.startX, y: this.startY }];
    }
    return [];
  }

  private measurePair(): void {
    const it = this.pts.values();
    const a = it.next().value;
    const b = it.next().value;
    if (!a || !b) return;
    this.spread = Math.hypot(b.x - a.x, b.y - a.y);
    this.angle = Math.atan2(b.y - a.y, b.x - a.x);
    this.midX = (a.x + b.x) / 2;
    this.midY = (a.y + b.y) / 2;
  }

  private pushSample(x: number, y: number, t: number): void {
    this.samples.push({ x, y, t });
    if (this.samples.length > 6) this.samples.shift();
  }

  private velocity(t: number): { vx: number; vy: number } {
    const last = this.samples[this.samples.length - 1];
    if (!last || t - last.t > 80) return { vx: 0, vy: 0 };
    let first = last;
    for (const s of this.samples) {
      if (last.t - s.t <= 100) {
        first = s;
        break;
      }
    }
    const dt = last.t - first.t;
    if (dt < 8) return { vx: 0, vy: 0 };
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
  }
}
