import { describe, expect, it } from 'vitest';
import {
  GestureRecognizer,
  LONG_PRESS_MS,
  ROTATE_DRAG_PX,
  TAP_MAX_MOVE_PX,
  type GestureAction,
} from '../src/render/gestures';

const types = (a: GestureAction[]): string[] => a.map((x) => x.type).filter((t) => t !== 'interrupt');

describe('render gestures', () => {
  it('quick still press is a tap', () => {
    const g = new GestureRecognizer();
    g.down(1, 100, 100, 0);
    g.move(1, 103, 102, 50);
    expect(types(g.up(1, 103, 102, 120))).toEqual(['tap']);
  });

  it('slow press is not a tap; long-press fires once after the threshold', () => {
    const g = new GestureRecognizer();
    g.down(1, 10, 10, 0);
    expect(g.tick(LONG_PRESS_MS - 1)).toEqual([]);
    expect(types(g.tick(LONG_PRESS_MS))).toEqual(['longPress']);
    expect(g.tick(LONG_PRESS_MS + 100)).toEqual([]);
    expect(types(g.up(1, 10, 10, LONG_PRESS_MS + 200))).toEqual([]);
  });

  it('press held past the tap window without long-press is nothing', () => {
    const g = new GestureRecognizer();
    g.down(1, 10, 10, 0);
    expect(types(g.up(1, 10, 10, 300))).toEqual([]);
  });

  it('moving past the slop starts a pan (no tap, no long-press)', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    const a = g.move(1, TAP_MAX_MOVE_PX + 1, 0, 30);
    expect(a[0]).toEqual({ type: 'pan', fromX: 0, fromY: 0, toX: TAP_MAX_MOVE_PX + 1, toY: 0 });
    expect(g.tick(LONG_PRESS_MS + 1)).toEqual([]);
    g.move(1, 40, 0, 50);
    const end = g.up(1, 40, 0, 60);
    expect(end[0]?.type).toBe('panEnd');
    if (end[0]?.type === 'panEnd') expect(end[0].vx).toBeGreaterThan(0);
  });

  it('two fingers pinch (factor < 1 when spreading) and never tap', () => {
    const g = new GestureRecognizer();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 10);
    const a = g.move(2, 300, 100, 20);
    const pinch = a.find((x) => x.type === 'pinch');
    expect(pinch && pinch.type === 'pinch' && pinch.factor).toBeCloseTo(0.5);
    g.up(2, 300, 100, 30);
    expect(types(g.up(1, 100, 100, 40))).not.toContain('tap');
  });

  it('two-finger twist emits a 60-degree rotation step', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    g.down(2, 100, 0, 0);
    // rotate finger 2 by 40 degrees clockwise on screen (y down)
    const ang = (40 * Math.PI) / 180;
    const a = g.move(2, 100 * Math.cos(ang), 100 * Math.sin(ang), 20);
    expect(a.filter((x) => x.type === 'rotateStep')).toEqual([{ type: 'rotateStep', dir: 1 }]);
  });

  it('right-drag rotates on desktop', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0, 2);
    const a = g.move(1, -ROTATE_DRAG_PX - 5, 0, 50);
    expect(a).toEqual([{ type: 'rotateStep', dir: -1 }]);
    expect(types(g.up(1, -ROTATE_DRAG_PX - 5, 0, 60))).toEqual([]);
  });
});

describe('gestures: pinch does not fight rotation', () => {
  it('a pinch that has clearly zoomed ignores twist', () => {
    const g = new GestureRecognizer();
    g.down(1, 100, 300, 0);
    g.down(2, 300, 300, 0);
    // Spread to 2x first (zoom intent)...
    g.move(2, 500, 300, 10);
    // ...then twist 45 degrees while holding the spread.
    const r = 400;
    const a = (45 * Math.PI) / 180;
    const out = g.move(2, 100 + Math.cos(a) * r, 300 + Math.sin(a) * r, 20);
    expect(out.some((x) => x.type === 'rotateStep')).toBe(false);
  });
});
