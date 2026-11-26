/**
 * Camera target motion state machine (pure, unit-tested): idle, inertia after a fling, or a
 * focus tween. The renderer owns the target position; this decides how it moves.
 *
 * Why a state machine: a playtest saw `focus()` ignored right after a fast pan. A pan gesture
 * that began BEFORE a focus request could still deliver drag deltas and a fling (panEnd) after
 * it; the stale inertia then either fought the tween or took over once it ended. Rule here:
 * the latest intent wins. A focus request cancels inertia and owns the camera until the next
 * touch-down; pan deltas and flings from a gesture that started before the focus are ignored.
 * A new touch (the player taking over) cancels the tween.
 */

export const FOCUS_MS = 380;
export const INERTIA_DECAY_MS = 260;
/** Below this speed (world units per ms) inertia stops. */
const MIN_SPEED = 0.00005;

export type CameraMode = 'idle' | 'inertia' | 'tween';

export class CameraMotion {
  mode: CameraMode = 'idle';
  /** Inertia velocity, world units per ms (the target moves by −v·dt, like a dragged sheet). */
  vx = 0;
  vz = 0;
  private fromX = 0;
  private fromZ = 0;
  private toX = 0;
  private toZ = 0;
  private start = 0;
  /** Monotonic order of intents (not time: two intents in the same millisecond stay ordered). */
  private seq = 0;
  private touchSeq = 0;
  private focusSeq = -1;

  constructor(private readonly durationMs = FOCUS_MS) {}

  /** A new touch-down: the player takes over (cancels any tween and inertia). */
  touch(): void {
    this.touchSeq = ++this.seq;
    this.stop();
  }

  /** Cancel motion (wheel zoom, button zoom, new game framing). */
  stop(): void {
    this.mode = 'idle';
    this.vx = 0;
    this.vz = 0;
  }

  /**
   * Whether drag input of the current gesture may move the camera: false when a focus was
   * requested after the gesture began (until the next touch-down).
   */
  get gestureOwnsCamera(): boolean {
    return this.touchSeq > this.focusSeq;
  }

  /**
   * Request a focus from (fromX, fromZ) to (toX, toZ). Always cancels inertia. Returns true
   * when the caller should snap to the target now (instant), false when a tween started.
   */
  focus(fromX: number, fromZ: number, toX: number, toZ: number, now: number, instant: boolean): boolean {
    this.focusSeq = ++this.seq;
    this.vx = 0;
    this.vz = 0;
    if (instant) {
      this.mode = 'idle';
      return true;
    }
    this.mode = 'tween';
    this.fromX = fromX;
    this.fromZ = fromZ;
    this.toX = toX;
    this.toZ = toZ;
    this.start = now;
    return false;
  }

  /** Finger lifted after a pan: start inertia unless a later focus owns the camera. */
  fling(vx: number, vz: number): boolean {
    if (!this.gestureOwnsCamera || this.mode === 'tween') return false;
    if (Math.hypot(vx, vz) < MIN_SPEED) return false;
    this.vx = vx;
    this.vz = vz;
    this.mode = 'inertia';
    return true;
  }

  /**
   * Advance by `dt` ms at time `now`, moving `pos` (the camera target) in place. Returns true
   * while still moving (the caller schedules another frame).
   */
  step(now: number, dt: number, pos: { x: number; z: number }): boolean {
    if (this.mode === 'tween') {
      const k = Math.min(1, Math.max(0, (now - this.start) / this.durationMs));
      const e = k * k * (3 - 2 * k);
      pos.x = this.fromX + (this.toX - this.fromX) * e;
      pos.z = this.fromZ + (this.toZ - this.fromZ) * e;
      if (k >= 1) {
        this.mode = 'idle';
        return false;
      }
      return true;
    }
    if (this.mode === 'inertia') {
      pos.x -= this.vx * dt;
      pos.z -= this.vz * dt;
      const decay = Math.exp(-dt / INERTIA_DECAY_MS);
      this.vx *= decay;
      this.vz *= decay;
      if (Math.hypot(this.vx, this.vz) < MIN_SPEED) {
        this.stop();
        return false;
      }
      return true;
    }
    return false;
  }
}
