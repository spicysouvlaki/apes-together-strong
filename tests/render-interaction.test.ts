import { describe, expect, it } from 'vitest';
import { CameraMotion, FOCUS_MS } from '../src/render/camera-motion';
import { FADED_ALPHA, LabelLayout } from '../src/render/label-layout';
import { labelKey, sealSpec } from '../src/render/labels';
import { SKIN_TONES as RENDER_SKIN_TONES } from '../src/render/palette';
import { SKIN_TONES as UI_SKIN_TONES } from '../src/ui/shell/setup-logic';

/** Run the motion to rest (or `ms`) in 16 ms steps from `t0`; returns the final time. */
const run = (m: CameraMotion, pos: { x: number; z: number }, t0: number, ms = 5000): number => {
  let t = t0;
  while (t - t0 < ms) {
    t += 16;
    if (!m.step(t, 16, pos)) break;
  }
  return t;
};

describe('render camera motion (focus always wins)', () => {
  it('a fling coasts and stops on its own', () => {
    const m = new CameraMotion();
    const pos = { x: 0, z: 0 };
    m.touch();
    expect(m.fling(0.02, 0)).toBe(true);
    expect(m.mode).toBe('inertia');
    run(m, pos, 0);
    expect(m.mode).toBe('idle');
    expect(pos.x).toBeLessThan(-1); // the sheet slides with the finger
  });

  it('focus right after a fast pan cancels inertia and lands exactly on target', () => {
    const m = new CameraMotion();
    const pos = { x: 0, z: 0 };
    m.touch();
    m.fling(0.05, 0.05);
    m.step(16, 16, pos);
    expect(m.focus(pos.x, pos.z, 10, -4, 16, false)).toBe(false);
    expect(m.mode).toBe('tween');
    expect(m.vx).toBe(0);
    run(m, pos, 16);
    expect(m.mode).toBe('idle');
    expect(pos).toEqual({ x: 10, z: -4 });
    // Nothing keeps drifting afterwards.
    expect(m.step(10_000, 16, pos)).toBe(false);
    expect(pos).toEqual({ x: 10, z: -4 });
  });

  it('a stale fling from a gesture that began before the focus is ignored', () => {
    const m = new CameraMotion();
    const pos = { x: 0, z: 0 };
    m.touch(); // finger down, panning
    m.focus(0, 0, 5, 5, 0, false); // e.g. the turn starts and the UI focuses the capital
    expect(m.gestureOwnsCamera).toBe(false); // drags of that gesture no longer move the camera
    expect(m.fling(0.05, 0)).toBe(false); // finger lifts: no inertia
    expect(m.mode).toBe('tween');
    run(m, pos, 0);
    expect(pos).toEqual({ x: 5, z: 5 });
    // Even after the tween, that old gesture's fling cannot move the camera.
    expect(m.fling(0.05, 0)).toBe(false);
  });

  it('a new touch after the focus hands the camera back to the player', () => {
    const m = new CameraMotion();
    const pos = { x: 0, z: 0 };
    m.focus(0, 0, 8, 0, 0, false);
    m.step(FOCUS_MS / 2, 16, pos);
    m.touch();
    expect(m.mode).toBe('idle');
    expect(m.gestureOwnsCamera).toBe(true);
    expect(m.fling(0.01, 0)).toBe(true);
  });

  it('instant focus snaps and stops everything', () => {
    const m = new CameraMotion();
    m.touch();
    m.fling(0.05, 0);
    expect(m.focus(0, 0, 3, 3, 0, true)).toBe(true);
    expect(m.mode).toBe('idle');
    expect(m.vx).toBe(0);
  });

  it('the tween eases monotonically and takes FOCUS_MS', () => {
    const m = new CameraMotion();
    const pos = { x: 0, z: 0 };
    m.focus(0, 0, 10, 0, 1000, false);
    let prev = 0;
    for (let t = 1000; t < 1000 + FOCUS_MS; t += 20) {
      expect(m.step(t, 20, pos)).toBe(true);
      expect(pos.x).toBeGreaterThanOrEqual(prev);
      prev = pos.x;
    }
    expect(m.step(1000 + FOCUS_MS, 20, pos)).toBe(false);
    expect(pos.x).toBe(10);
  });
});

describe('render label hit-testing (taps on a label pick the labelled settlement)', () => {
  /** Two labels: A at (100, 200) 80x20, B at (300, 200) 120x20. */
  const make = (): LabelLayout => {
    const L = new LabelLayout(8);
    const rects: [number, number, number, number][] = [
      [100, 200, 80, 20],
      [300, 200, 120, 20],
    ];
    rects.forEach(([x, y, w, h], i) => {
      L.x[i] = x;
      L.y[i] = y;
      L.w[i] = w;
      L.h[i] = h;
      L.priority[i] = 1;
    });
    L.count = rects.length;
    L.solve(0);
    return L;
  };

  it('hits the box between top and bottom, centred on the anchor x', () => {
    const L = make();
    // Box A spans x 60..140, y 180..200 (bottom at the anchor, label grows up).
    expect(L.hit(100, 190, 0)).toBe(0);
    expect(L.hit(61, 181, 0)).toBe(0);
    expect(L.hit(139, 199, 0)).toBe(0);
    expect(L.hit(100, 205, 0)).toBe(-1); // below: the settlement itself, not the label
    expect(L.hit(150, 190, 0)).toBe(-1);
    expect(L.hit(300, 185, 0)).toBe(1);
    expect(L.hit(239, 185, 0)).toBe(-1);
    expect(L.hit(241, 185, 0)).toBe(1);
  });

  it('slop widens every edge', () => {
    const L = make();
    expect(L.hit(143, 190, 0)).toBe(-1);
    expect(L.hit(143, 190, 4)).toBe(0);
    expect(L.hit(100, 177, 4)).toBe(0);
    expect(L.hit(100, 205, 4)).toBe(-1);
  });

  it('follows a label that de-overlap moved up, and ignores hidden ones', () => {
    const L = new LabelLayout(8);
    for (let i = 0; i < 4; i++) {
      L.x[i] = 100;
      L.y[i] = 200;
      L.w[i] = 80;
      L.h[i] = 20;
      L.priority[i] = 4 - i;
    }
    L.count = 4;
    L.solve(0);
    expect(L.visible[3]).toBe(0);
    // Label 1 was moved up by one slot: its box is now above label 0's.
    const top1 = L.top[1] ?? 0;
    expect(top1).toBeLessThan(180);
    expect(L.hit(100, top1 + 10, 0)).toBe(1);
    expect(L.hit(100, 190, 0)).toBe(0);
  });

  it('later labels draw on top and win overlapping taps; faded labels let taps through', () => {
    const L = make();
    // A non-solid seal overlapping label A (drawn after it).
    L.x[2] = 120;
    L.y[2] = 200;
    L.w[2] = 30;
    L.h[2] = 30;
    L.solid[2] = 0;
    L.count = 3;
    L.solve(0);
    expect(L.shift[0]).toBe(0); // seals never push labels
    expect(L.visible[2]).toBe(1);
    expect(L.hit(120, 190, 0)).toBe(2);
    expect(L.hit(70, 190, 0)).toBe(0);
    // A unit behind label B: B fades and taps on it fall through (to the unit's tile).
    const px = new Float32Array([300]);
    const py = new Float32Array([192]);
    L.fade(px, py, 1);
    expect(L.alpha[1]).toBeCloseTo(FADED_ALPHA, 5);
    expect(L.alpha[0]).toBe(1);
    expect(L.hit(300, 190, 0)).toBe(-1);
  });
});

describe('render site seals', () => {
  it('each rank has its own atlas key, distinct from any settlement label', () => {
    expect(labelKey(sealSpec(1))).not.toBe(labelKey(sealSpec(2)));
    expect(labelKey(sealSpec(1))).toBe(labelKey(sealSpec(1)));
    expect(labelKey(sealSpec(1)).startsWith('seal|')).toBe(true);
  });
});

describe('render skin tones', () => {
  it("the renderer's copy matches the setup screen's swatches exactly", () => {
    // The renderer may not import the UI (architecture rule 1), so it keeps a copy.
    expect([...RENDER_SKIN_TONES]).toEqual([...UI_SKIN_TONES]);
  });
});
