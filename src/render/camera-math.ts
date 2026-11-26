/**
 * Pure camera math: zoom bands (GDD §11 "strategic / regional / close-up"), tilt by distance,
 * pan clamping, rotation steps and ray -> hex picking. No three.js so it runs in Node tests.
 */
import type { Hex } from '@contracts/hex';
import type { MapBounds } from './layout';
import { worldToHex } from './layout';

export type ZoomBand = 'close' | 'regional' | 'strategic';

/** Camera distance (world units from the look-at target). */
export const MIN_DISTANCE = 5;
/**
 * Close band ends a little past the default framing (DEFAULT_HEXES_ACROSS on a phone is a
 * normalized distance of ~16.7), so a new game opens in full diorama detail.
 */
export const CLOSE_MAX = 19;
export const REGIONAL_MAX = 44;
/** Fraction of a threshold a band must overshoot before switching back (no flicker). */
export const BAND_HYSTERESIS = 0.06;

/** Band for a distance, with no history. */
export const zoomBandFor = (distance: number): ZoomBand =>
  distance < CLOSE_MAX ? 'close' : distance < REGIONAL_MAX ? 'regional' : 'strategic';

/**
 * Band for a distance given the current band: a band is only left once the distance is
 * clearly past the threshold, so pinching around a boundary doesn't toggle icons.
 */
export const nextZoomBand = (distance: number, current: ZoomBand): ZoomBand => {
  const raw = zoomBandFor(distance);
  if (raw === current) return raw;
  const h = BAND_HYSTERESIS;
  switch (current) {
    case 'close':
      return distance < CLOSE_MAX * (1 + h) ? 'close' : raw;
    case 'regional':
      if (raw === 'close') return distance < CLOSE_MAX * (1 - h) ? 'close' : 'regional';
      return distance >= REGIONAL_MAX * (1 + h) ? 'strategic' : 'regional';
    case 'strategic':
      return distance >= REGIONAL_MAX * (1 - h) ? 'strategic' : raw;
  }
};

/** How many hexes span the short screen axis at the default framing (GDD §11 first impression). */
export const DEFAULT_HEXES_ACROSS = 7;

/**
 * Camera distance that shows `hexes` pointy-top hexes (√3 wide each) across the short screen
 * axis at the look-at point. Pure; accounts for the aspect so portrait phones are not too far.
 */
export const defaultDistanceFor = (aspect: number, fovYDeg: number, hexes = DEFAULT_HEXES_ACROSS): number => {
  const tanY = Math.tan(((fovYDeg / 2) * Math.PI) / 180);
  const across = hexes * Math.sqrt(3);
  return across / (2 * tanY * Math.max(0.1, Math.min(1, aspect)));
};

/** Pitch (radians above the horizon): tilted when close, nearly top-down when far. */
export const MIN_PITCH = (48 * Math.PI) / 180;
export const MAX_PITCH = (78 * Math.PI) / 180;
export const pitchFor = (distance: number): number => {
  const t = Math.max(0, Math.min(1, (distance - MIN_DISTANCE) / (REGIONAL_MAX * 1.4 - MIN_DISTANCE)));
  const s = t * t * (3 - 2 * t);
  return MIN_PITCH + (MAX_PITCH - MIN_PITCH) * s;
};

/**
 * Farthest zoom: enough to fit the whole map on screen (with a margin), never closer than
 * the strategic threshold so the strategic band always exists.
 */
export const maxDistanceFor = (bounds: MapBounds, aspect: number, fovYDeg: number): number => {
  const w = bounds.maxX - bounds.minX + 6;
  const h = bounds.maxZ - bounds.minZ + 6;
  const tanY = Math.tan(((fovYDeg / 2) * Math.PI) / 180);
  const tanX = tanY * Math.max(0.1, aspect);
  const need = Math.max(h / 2 / tanY, w / 2 / tanX);
  return Math.max((REGIONAL_MAX * 1.5) / shortAxisFactor(aspect), Math.min(need, 480));
};

export const clampDistance = (d: number, maxDistance: number, minDistance = MIN_DISTANCE): number =>
  Math.max(minDistance, Math.min(maxDistance, d));

/**
 * Zoom bands, pitch and min zoom are defined for a square-ish screen. On a portrait phone the
 * narrow axis is the limit, so the camera must sit further back to show the same number of
 * hexes across: distances are divided by min(1, aspect) to get a "normalized" distance.
 */
export const shortAxisFactor = (aspect: number): number => Math.max(0.2, Math.min(1, aspect));

/**
 * Keep the look-at target over the map (a small margin past the edge tiles). `viewHalfW/H`
 * are the half extents of the ground area on screen: the wider the view, the further the
 * target is kept from the edges, and when the view is wider than the map it is centered, so
 * zooming out never leaves the map off to one side.
 */
export const clampTarget = (
  x: number,
  z: number,
  b: MapBounds,
  margin = 1,
  viewHalfW = 0,
  viewHalfH = 0,
): { x: number; z: number } => {
  const axis = (v: number, min: number, max: number, half: number): number => {
    const lo = min - margin + half;
    const hi = max + margin - half;
    if (lo > hi) return (min + max) / 2;
    return Math.max(lo, Math.min(hi, v));
  };
  return { x: axis(x, b.minX, b.maxX, viewHalfW), z: axis(z, b.minZ, b.maxZ, viewHalfH) };
};

/**
 * Half extent to clamp the target with. Zoomed in, only a fraction of the view is kept over the
 * map, so the start or a coastal capital can sit at the screen center even next to the map
 * edge (the first-impression framing); as the view approaches the map's size it blends to the
 * full extent, so zooming all the way out still centers the board.
 */
export const softHalfExtent = (half: number, mapSpan: number): number => {
  const k = Math.max(0, Math.min(1, half / Math.max(1e-6, mapSpan / 2)));
  return half * (0.25 + 0.75 * k * k);
};

/** Approximate half extents of the ground visible at `distance` (for clampTarget). */
export const viewHalfExtents = (distance: number, aspect: number, fovYDeg: number): { w: number; h: number } => {
  const tanY = Math.tan(((fovYDeg / 2) * Math.PI) / 180);
  return { w: distance * tanY * Math.max(0.1, aspect), h: distance * tanY };
};

export const ROTATION_STEP = Math.PI / 3;

/** Snap an angle to the nearest multiple of 60°. */
export const snapYaw = (yaw: number): number => Math.round(yaw / ROTATION_STEP) * ROTATION_STEP;

/**
 * Camera offset from its target for (distance, pitch, yaw). Yaw 0 looks north (-z) from the
 * south, so row 0 is at the top of the screen.
 */
export const cameraOffset = (distance: number, pitch: number, yaw: number): { x: number; y: number; z: number } => {
  const h = Math.cos(pitch) * distance;
  return { x: Math.sin(yaw) * h, y: Math.sin(pitch) * distance, z: Math.cos(yaw) * h };
};

export interface Ray {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
}

/** Where the ray meets the plane y = h, or null if it points away from it. */
export const rayPlaneY = (ray: Ray, h: number): { x: number; z: number } | null => {
  if (Math.abs(ray.dy) < 1e-9) return null;
  const t = (h - ray.oy) / ray.dy;
  if (t < 0) return null;
  return { x: ray.ox + ray.dx * t, z: ray.oz + ray.dz * t };
};

/**
 * Pick the hex under a ray without raycasting meshes: the ray can only hit a tile top between
 * the planes y = maxTop and y = minTop, so walk that short segment front to back in small
 * steps and return the first hex whose top is at or above the ray there (a raised hill hides
 * the flat tile behind it). Bounded number of steps => O(1). `topAt` returns the top height
 * of a hex, or null when it's off the map.
 */
export const pickHex = (
  ray: Ray,
  topAt: (h: Hex) => number | null,
  minTop = 0,
  maxTop = 1,
): Hex | null => {
  const a = rayPlaneY(ray, maxTop);
  const b = rayPlaneY(ray, minTop);
  if (!b) return null;
  const ax = a ? a.x : ray.ox;
  const az = a ? a.z : ray.oz;
  const ay = a ? maxTop : ray.oy;
  const len = Math.hypot(b.x - ax, b.z - az);
  const steps = Math.min(64, Math.ceil(len / 0.15) + 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (b.x - ax) * t;
    const z = az + (b.z - az) * t;
    const y = ay + (minTop - ay) * t;
    const hex = worldToHex(x, z);
    const top = topAt(hex);
    if (top === null) continue;
    if (top >= y - 1e-6) return hex;
  }
  return null;
};
