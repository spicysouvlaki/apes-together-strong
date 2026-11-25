/**
 * Seeded value noise and fBm for map generation. Every lattice value is drawn from the passed
 * RNG holder up front, so sampling is pure and the map stays deterministic (CLAUDE.md rule 2).
 */
import { nextFloat, type HasRng } from '../rng';

export type Noise2 = (x: number, y: number) => number;

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * One octave of value noise covering [0, width] × [0, height] with lattice spacing `cell`.
 * Returns values in [0, 1].
 */
export const valueNoise = (h: HasRng, width: number, height: number, cell: number): Noise2 => {
  const gw = Math.ceil(width / cell) + 2;
  const gh = Math.ceil(height / cell) + 2;
  const lattice = new Float64Array(gw * gh);
  for (let i = 0; i < lattice.length; i++) lattice[i] = nextFloat(h);
  const at = (gx: number, gy: number): number => {
    const cx = Math.min(gw - 1, Math.max(0, gx));
    const cy = Math.min(gh - 1, Math.max(0, gy));
    return lattice[cy * gw + cx] as number;
  };
  return (x, y) => {
    const fx = Math.max(0, x) / cell;
    const fy = Math.max(0, y) / cell;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
};

/** Fractal sum of `octaves` value-noise layers, halving the cell size each octave. In [0, 1]. */
export const fbm = (h: HasRng, width: number, height: number, cell: number, octaves: number): Noise2 => {
  const layers: Noise2[] = [];
  const weights: number[] = [];
  let c = cell;
  let w = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    layers.push(valueNoise(h, width, height, Math.max(1, c)));
    weights.push(w);
    total += w;
    c /= 2;
    w /= 2;
  }
  return (x, y) => {
    let sum = 0;
    for (let i = 0; i < layers.length; i++) sum += (layers[i] as Noise2)(x, y) * (weights[i] as number);
    return sum / total;
  };
};
