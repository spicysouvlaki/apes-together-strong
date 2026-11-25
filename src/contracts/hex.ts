/**
 * Axial hex coordinates (pointy-top). See https://www.redblobgames.com/grids/hexagons/
 * The map is stored as a row-major array of `width * height` tiles using "odd-r" offset
 * layout; convert with `offsetToAxial` / `axialToOffset`.
 */
export interface Hex {
  q: number;
  r: number;
}

export const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const hexKey = (h: Hex): string => `${h.q},${h.r}`;

export const hexEquals = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r;

export const hexAdd = (a: Hex, b: Hex): Hex => ({ q: a.q + b.q, r: a.r + b.r });

export const hexNeighbors = (h: Hex): Hex[] => HEX_DIRECTIONS.map((d) => hexAdd(h, d));

export const hexDistance = (a: Hex, b: Hex): number =>
  (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;

/** All hexes within `radius` of `center`, including the center. */
export const hexesInRange = (center: Hex, radius: number): Hex[] => {
  const out: Hex[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      out.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return out;
};

export interface Offset {
  col: number;
  row: number;
}

export const offsetToAxial = ({ col, row }: Offset): Hex => ({
  q: col - (row - (row & 1)) / 2,
  r: row,
});

export const axialToOffset = ({ q, r }: Hex): Offset => ({
  col: q + (r - (r & 1)) / 2,
  row: r,
});

/** World-space center of a hex for rendering (pointy-top, unit radius). */
export const hexToWorld = ({ q, r }: Hex, size = 1): { x: number; z: number } => ({
  x: size * Math.sqrt(3) * (q + r / 2),
  z: size * 1.5 * r,
});
