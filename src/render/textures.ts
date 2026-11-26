/**
 * Procedural texel generation for the shaders (no image files: CLAUDE.md "Art and audio
 * direction"). Pure and deterministic, so it's unit-testable and identical on every device.
 *
 * Detail texture (tileable, RGBA8):
 *   R  soft fBm value noise   (painterly mottling, paper grain, water sparkle)
 *   G  cracks                  (Worley cell edges: cracked earth, stone)
 *   B  ripples                 (warped bands: dunes, snow drifts, water ripples)
 *   A  fine speckle            (paper fibre, sand grain)
 */

/** Small integer hash -> [0, 1). */
const h2 = (x: number, y: number, s: number): number => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Tileable value noise with `cells` cells across the period. */
const valueNoise = (u: number, v: number, cells: number, seed: number): number => {
  const x = u * cells;
  const y = v * cells;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const w = (i: number): number => ((i % cells) + cells) % cells;
  const a = h2(w(xi), w(yi), seed);
  const b = h2(w(xi + 1), w(yi), seed);
  const c = h2(w(xi), w(yi + 1), seed);
  const d = h2(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
};

const fbm = (u: number, v: number, seed: number): number => {
  let sum = 0;
  let amp = 0.5;
  let cells = 4;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += valueNoise(u, v, cells, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    cells *= 2;
  }
  return sum / norm;
};

/** Tileable Worley F2 - F1 (small near cell borders). */
const worleyEdge = (u: number, v: number, cells: number, seed: number): number => {
  const x = u * cells;
  const y = v * cells;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const wx = ((cx % cells) + cells) % cells;
      const wy = ((cy % cells) + cells) % cells;
      const px = cx + h2(wx, wy, seed);
      const py = cy + h2(wx, wy, seed + 1);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  return f2 - f1;
};

export const DETAIL_SIZE = 128;

export const generateDetailTexels = (size = DETAIL_SIZE, seed = 7): Uint8Array => {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbm(u, v, seed);
      const edge = worleyEdge(u, v, 6, seed + 50);
      const crack = Math.max(0, 1 - edge / 0.09);
      const warp = valueNoise(u, v, 4, seed + 90) * 1.3;
      // Integer frequency along v keeps the bands tileable; the warp is tileable too.
      const ripple = 0.5 + 0.5 * Math.sin((v * 10 + warp) * Math.PI * 2);
      const speck = h2(x, y, seed + 200);
      const o = (y * size + x) * 4;
      out[o] = Math.round(n * 255);
      out[o + 1] = Math.round(crack * crack * 255);
      out[o + 2] = Math.round(ripple * 255);
      out[o + 3] = Math.round(speck * 255);
    }
  }
  return out;
};

/**
 * Per-tile map field (odd-r storage, one texel per tile), sampled with bilinear filtering for
 * soft gradients that ignore hex edges:
 *   R  water depth   (0 = land or shore, rising with distance from land; 255 = open sea)
 *   G  knowledge     (255 = explored or visible, 0 = unexplored) -> ink wash on the parchment
 *   B  visible       (255 = in sight)
 * `dist` is the hex distance from land (0 for land) computed by `waterDistance`.
 */
export const fillMapField = (
  n: number,
  dist: Uint8Array,
  fog: Uint8Array,
  out: Uint8Array,
): Uint8Array => {
  for (let i = 0; i < n; i++) {
    const d = dist[i] ?? 0;
    const f = fog[i] ?? 0;
    out[i * 4] = Math.min(255, d * 70);
    out[i * 4 + 1] = f > 0 ? 255 : 0;
    out[i * 4 + 2] = f === 2 ? 255 : 0;
    out[i * 4 + 3] = 255;
  }
  return out;
};

/**
 * Hex distance from the nearest land tile for every tile (0 on land), capped at `cap`.
 * Multi-source BFS over `neighbors(i, d)` (d = 0..5, -1 when off the map).
 */
export const waterDistance = (
  n: number,
  isWater: (i: number) => boolean,
  neighbor: (i: number, d: number) => number,
  out: Uint8Array,
  cap = 4,
): Uint8Array => {
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (isWater(i)) out[i] = cap;
    else {
      out[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++] ?? 0;
    const d = out[i] ?? 0;
    if (d + 1 >= cap) continue;
    for (let k = 0; k < 6; k++) {
      const j = neighbor(i, k);
      if (j < 0) continue;
      if ((out[j] ?? 0) > d + 1) {
        out[j] = d + 1;
        queue[tail++] = j;
      }
    }
  }
  return out;
};
