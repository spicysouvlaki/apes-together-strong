import { describe, expect, it } from 'vitest';
import { hexToWorld, offsetToAxial, type Hex } from '../src/contracts/hex';
import {
  BAND_HYSTERESIS,
  CLOSE_MAX,
  MAX_PITCH,
  MIN_PITCH,
  REGIONAL_MAX,
  cameraOffset,
  clampTarget,
  maxDistanceFor,
  nextZoomBand,
  pickHex,
  pitchFor,
  shortAxisFactor,
  snapYaw,
  zoomBandFor,
  type Ray,
} from '../src/render/camera-math';
import { FOG_TOP, LAND_TOP, MOUNTAIN_PEAK, WATER_TOP, tileTop } from '../src/render/heights';
import { hexAtIndex, mapBounds, tileIndex, worldToHex } from '../src/render/layout';

const W = 48;
const H = 30;

describe('render layout: world <-> hex', () => {
  it('round-trips every tile center of a 48x30 map (odd and even rows)', () => {
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const h = offsetToAxial({ col, row });
        const w = hexToWorld(h);
        expect(worldToHex(w.x, w.z)).toEqual(h);
        expect(tileIndex(h, W, H)).toBe(row * W + col);
        expect(hexAtIndex(row * W + col, W)).toEqual(h);
      }
    }
  });

  it('points well inside a hex (not just centers) resolve to that hex', () => {
    const h = offsetToAxial({ col: 7, row: 5 });
    const c = hexToWorld(h);
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      // 0.8 * apothem stays inside the hex in every direction.
      const r = 0.8 * (Math.sqrt(3) / 2);
      expect(worldToHex(c.x + Math.cos(ang) * r, c.z + Math.sin(ang) * r)).toEqual(h);
    }
  });

  it('rejects hexes off the map', () => {
    expect(tileIndex({ q: -1, r: 0 }, W, H)).toBe(-1);
    expect(tileIndex({ q: 0, r: -1 }, W, H)).toBe(-1);
    expect(tileIndex(offsetToAxial({ col: W, row: 3 }), W, H)).toBe(-1);
    expect(tileIndex(offsetToAxial({ col: 0, row: H }), W, H)).toBe(-1);
  });

  it('map bounds cover every tile center', () => {
    const b = mapBounds(W, H);
    for (let i = 0; i < W * H; i++) {
      const w = hexToWorld(hexAtIndex(i, W));
      expect(w.x).toBeGreaterThanOrEqual(b.minX - 1e-9);
      expect(w.x).toBeLessThanOrEqual(b.maxX + 1e-9);
      expect(w.z).toBeGreaterThanOrEqual(b.minZ - 1e-9);
      expect(w.z).toBeLessThanOrEqual(b.maxZ + 1e-9);
    }
  });
});

describe('render heights', () => {
  it('stacks water < land < hills < mountains', () => {
    const water = tileTop({ elevation: 0, feature: null }, { isWater: true, isMountain: false });
    const land = tileTop({ elevation: 0, feature: null }, { isWater: false, isMountain: false });
    const hill = tileTop({ elevation: 0, feature: 'hills' }, { isWater: false, isMountain: false });
    const mountain = tileTop({ elevation: 0, feature: null }, { isWater: false, isMountain: true });
    expect(water).toBe(WATER_TOP);
    expect(land).toBe(LAND_TOP);
    expect(hill).toBeGreaterThan(land);
    expect(mountain).toBeGreaterThan(hill);
    expect(MOUNTAIN_PEAK).toBeGreaterThan(0);
    expect(FOG_TOP).toBeLessThan(LAND_TOP);
  });

  it('clamps silly elevations', () => {
    const a = tileTop({ elevation: 999, feature: null }, { isWater: false, isMountain: false });
    const b = tileTop({ elevation: -5, feature: null }, { isWater: false, isMountain: false });
    expect(a).toBeLessThan(2);
    expect(b).toBe(LAND_TOP);
  });
});

describe('render camera math', () => {
  it('zoom bands by distance', () => {
    expect(zoomBandFor(CLOSE_MAX - 0.01)).toBe('close');
    expect(zoomBandFor(CLOSE_MAX)).toBe('regional');
    expect(zoomBandFor(REGIONAL_MAX - 0.01)).toBe('regional');
    expect(zoomBandFor(REGIONAL_MAX)).toBe('strategic');
  });

  it('zoom bands have hysteresis around thresholds', () => {
    const justOver = CLOSE_MAX * (1 + BAND_HYSTERESIS / 2);
    expect(nextZoomBand(justOver, 'close')).toBe('close');
    expect(nextZoomBand(CLOSE_MAX * (1 + BAND_HYSTERESIS * 1.5), 'close')).toBe('regional');
    const justUnder = CLOSE_MAX * (1 - BAND_HYSTERESIS / 2);
    expect(nextZoomBand(justUnder, 'regional')).toBe('regional');
    expect(nextZoomBand(CLOSE_MAX * (1 - BAND_HYSTERESIS * 1.5), 'regional')).toBe('close');
    expect(nextZoomBand(REGIONAL_MAX * (1 + BAND_HYSTERESIS / 2), 'regional')).toBe('regional');
    expect(nextZoomBand(REGIONAL_MAX * (1 + BAND_HYSTERESIS * 1.5), 'regional')).toBe('strategic');
    expect(nextZoomBand(REGIONAL_MAX * (1 - BAND_HYSTERESIS / 2), 'strategic')).toBe('strategic');
    expect(nextZoomBand(REGIONAL_MAX * (1 - BAND_HYSTERESIS * 1.5), 'strategic')).toBe('regional');
    // Large jumps skip bands.
    expect(nextZoomBand(3, 'strategic')).toBe('close');
    expect(nextZoomBand(200, 'close')).toBe('strategic');
  });

  it('tilts toward top-down when zoomed out', () => {
    expect(pitchFor(0)).toBeCloseTo(MIN_PITCH);
    expect(pitchFor(1000)).toBeCloseTo(MAX_PITCH);
    expect(pitchFor(20)).toBeGreaterThan(pitchFor(10));
  });

  it('max distance fits a portrait phone and is past the strategic threshold', () => {
    const b = mapBounds(W, H);
    const d = maxDistanceFor(b, 375 / 812, 40);
    expect(d).toBeGreaterThan(REGIONAL_MAX);
    expect(d).toBeLessThanOrEqual(480);
    // normalized for the narrow axis, it still reaches the strategic band
    expect(d * shortAxisFactor(375 / 812)).toBeGreaterThan(REGIONAL_MAX);
  });

  it('clamps the camera target to the map', () => {
    const b = mapBounds(W, H);
    expect(clampTarget(-50, -50, b, 1)).toEqual({ x: -1, z: -1 });
    expect(clampTarget(1e6, 1e6, b, 1)).toEqual({ x: b.maxX + 1, z: b.maxZ + 1 });
    expect(clampTarget(10, 10, b, 1)).toEqual({ x: 10, z: 10 });
    // A view wider than the map centers it.
    const c = clampTarget(0, 0, b, 1, 1000, 1000);
    expect(c.x).toBeCloseTo((b.minX + b.maxX) / 2);
    expect(c.z).toBeCloseTo((b.minZ + b.maxZ) / 2);
    // A moderately wide view keeps the target further from the edge.
    expect(clampTarget(-50, 10, b, 1, 10, 0).x).toBeCloseTo(-1 + 10);
  });

  it('snaps yaw to 60 degree steps', () => {
    expect(snapYaw(0.2)).toBeCloseTo(0);
    expect(snapYaw(Math.PI / 3 + 0.1)).toBeCloseTo(Math.PI / 3);
    expect(snapYaw(-Math.PI / 3 - 0.1)).toBeCloseTo(-Math.PI / 3);
  });

  it('camera offset sits south of the target at yaw 0 (row 0 at screen top)', () => {
    const o = cameraOffset(10, Math.PI / 4, 0);
    expect(o.z).toBeGreaterThan(0);
    expect(Math.abs(o.x)).toBeLessThan(1e-9);
    expect(o.y).toBeGreaterThan(0);
  });
});

describe('render picking', () => {
  const rayAt = (x: number, y: number, z: number, from: { x: number; y: number; z: number }): Ray => {
    const dx = x - from.x;
    const dy = y - from.y;
    const dz = z - from.z;
    const l = Math.hypot(dx, dy, dz);
    return { ox: from.x, oy: from.y, oz: from.z, dx: dx / l, dy: dy / l, dz: dz / l };
  };
  const flat = (h: Hex): number | null => (tileIndex(h, W, H) < 0 ? null : LAND_TOP);

  it('picks every tile of a 48x30 map from a tilted camera', () => {
    for (let i = 0; i < W * H; i++) {
      const h = hexAtIndex(i, W);
      const c = hexToWorld(h);
      const cam = { x: c.x + 3, y: 12, z: c.z + 9 };
      expect(pickHex(rayAt(c.x, LAND_TOP, c.z, cam), flat)).toEqual(h);
    }
  });

  it('corrects for raised tiles (a hill in front of a flat tile)', () => {
    const hill = offsetToAxial({ col: 10, row: 10 });
    const hillTop = 1.0;
    const topAt = (h: Hex): number | null =>
      tileIndex(h, W, H) < 0 ? null : h.q === hill.q && h.r === hill.r ? hillTop : 0;
    const c = hexToWorld(hill);
    // Low grazing camera from the south: aiming at the hill's raised top would hit the tile
    // north of it if we ignored height.
    const cam = { x: c.x, y: 3, z: c.z + 6 };
    expect(pickHex(rayAt(c.x, hillTop, c.z, cam), topAt, 0)).toEqual(hill);
  });

  it('returns null off the map or when looking at the sky', () => {
    expect(pickHex(rayAt(-50, 0, -50, { x: -50, y: 10, z: -45 }), flat)).toBeNull();
    expect(pickHex({ ox: 0, oy: 5, oz: 0, dx: 0, dy: 1, dz: 0 }, flat)).toBeNull();
  });
});
