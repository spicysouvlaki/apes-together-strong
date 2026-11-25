/**
 * Pure hex <-> world layout math for the renderer (no three.js, no DOM; unit-tested in Node).
 *
 * World space: pointy-top hexes of unit radius laid out with `hexToWorld` from the contracts;
 * world x = east, world z = south (row index grows toward +z), world y = up.
 * The map is odd-r offset storage (index = row * width + col), see src/contracts/hex.ts.
 */
import { axialToOffset, hexToWorld, offsetToAxial, type Hex } from '@contracts/hex';

export const SQRT3 = Math.sqrt(3);

/** Fractional axial -> nearest hex (cube rounding). */
export const axialRound = (fq: number, fr: number): Hex => {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  // `+ 0` normalises -0 so results compare cleanly with toEqual.
  return { q: q + 0, r: r + 0 };
};

/** Inverse of `hexToWorld` (unit radius): the hex containing world point (x, z). */
export const worldToHex = (x: number, z: number): Hex => {
  const fq = (SQRT3 / 3) * x - z / 3;
  const fr = (2 / 3) * z;
  return axialRound(fq, fr);
};

/** Tile index for a hex, or -1 when the hex lies outside the width x height map. */
export const tileIndex = (h: Hex, width: number, height: number): number => {
  const { col, row } = axialToOffset(h);
  if (row < 0 || row >= height || col < 0 || col >= width) return -1;
  return row * width + col;
};

export const hexAtIndex = (index: number, width: number): Hex =>
  offsetToAxial({ col: index % width, row: Math.floor(index / width) });

export interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** World-space rectangle covering every tile center of a width x height odd-r map. */
export const mapBounds = (width: number, height: number): MapBounds => {
  // Odd rows are shifted half a hex east; col 0 of row 0 is at x = 0.
  const maxX = SQRT3 * (width - 1) + (height > 1 ? SQRT3 / 2 : 0);
  return { minX: 0, maxX, minZ: 0, maxZ: 1.5 * Math.max(0, height - 1) };
};

export { hexToWorld };

/** Pointy-top corner i (0..5) offset from the center, unit radius. Corner 0 points north-east. */
export const hexCorner = (i: number): { x: number; z: number } => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return { x: Math.cos(a), z: Math.sin(a) };
};
