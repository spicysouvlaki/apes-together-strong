/**
 * Analytic checks on rendered audio (we cannot listen, so we measure). Pure functions over
 * Float32Arrays: used by the browser self-check and unit-tested in Node.
 */

export const dbfs = (x: number): number => (x <= 0 ? -Infinity : 20 * Math.log10(x));

export const peak = (chans: readonly Float32Array[]): number => {
  let p = 0;
  for (const c of chans) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i] ?? 0));
  return p;
};

/** RMS over [from, to) samples of all channels. */
export const rms = (chans: readonly Float32Array[], from = 0, to?: number): number => {
  let s = 0;
  let n = 0;
  for (const c of chans) {
    const end = Math.min(c.length, to ?? c.length);
    for (let i = Math.max(0, from); i < end; i++) {
      const v = c[i] ?? 0;
      s += v * v;
      n++;
    }
  }
  return n ? Math.sqrt(s / n) : 0;
};

export const dcOffset = (chans: readonly Float32Array[], from = 0, to?: number): number => {
  let s = 0;
  let n = 0;
  for (const c of chans) {
    const end = Math.min(c.length, to ?? c.length);
    for (let i = Math.max(0, from); i < end; i++) {
      s += c[i] ?? 0;
      n++;
    }
  }
  return n ? s / n : 0;
};

/** First and last sample index whose |x| exceeds `threshold` (linear); null if silent. */
export const activeRange = (chans: readonly Float32Array[], threshold: number): [number, number] | null => {
  let first = Infinity;
  let last = -1;
  for (const c of chans) {
    for (let i = 0; i < c.length; i++) {
      if (Math.abs(c[i] ?? 0) > threshold) {
        if (i < first) first = i;
        if (i > last) last = i;
      }
    }
  }
  return last < 0 ? null : [first, last];
};

/** In-place radix-2 FFT (re, im of length 2^k). */
export const fft = (re: Float64Array, im: Float64Array): void => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0, ti = im[i] ?? 0;
      re[i] = re[j] ?? 0; im[i] = im[j] ?? 0;
      re[j] = tr; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = (re[b] ?? 0) * cr - (im[b] ?? 0) * ci;
        const xi = (re[b] ?? 0) * ci + (im[b] ?? 0) * cr;
        re[b] = (re[a] ?? 0) - xr; im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr; im[a] = (im[a] ?? 0) + xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
};

/**
 * Average magnitude spectrum (Hann, 2048-point frames, hop 1024) of a mono signal, and its
 * spectral centroid weighted by frame energy (loud frames count more than tails).
 */
export const spectrum = (x: Float32Array, sampleRate: number, size = 2048): { mags: Float64Array; centroid: number } => {
  const mags = new Float64Array(size / 2);
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  let num = 0;
  let den = 0;
  for (let start = 0; start + size <= Math.max(size, x.length); start += size / 2) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = (x[start + i] ?? 0) * (win[i] ?? 0);
    fft(re, im);
    let fNum = 0;
    let fDen = 0;
    for (let k = 1; k < size / 2; k++) {
      const m = Math.hypot(re[k] ?? 0, im[k] ?? 0);
      mags[k] = (mags[k] ?? 0) + m;
      fNum += m * ((k * sampleRate) / size);
      fDen += m;
    }
    const energy = fDen * fDen;
    if (fDen > 0) {
      num += (fNum / fDen) * energy;
      den += energy;
    }
  }
  return { mags, centroid: den > 0 ? num / den : 0 };
};

export const mixDown = (chans: readonly Float32Array[]): Float32Array => {
  const len = chans[0]?.length ?? 0;
  const out = new Float32Array(len);
  for (const c of chans) for (let i = 0; i < len; i++) out[i] = (out[i] ?? 0) + (c[i] ?? 0) / chans.length;
  return out;
};

/**
 * Click detector: a sample-to-sample jump in a region that is otherwise quiet. A click is a
 * discontinuity, so it stands out where the local level is low; in loud regions large jumps
 * are just bright content. A 5 ms window counts as quiet when its median |x| is low (the
 * median ignores the click itself) and so are both neighbours — a note onset is followed by
 * a loud window, an isolated click is not. Returns the largest jump in quiet windows.
 */
export const quietJump = (x: Float32Array, sampleRate: number, quietLevel = 0.003): number => {
  const w = Math.max(16, Math.floor(sampleRate * 0.005));
  const count = Math.floor(x.length / w);
  const quiet: boolean[] = [];
  const buf = new Float32Array(w);
  for (let k = 0; k < count; k++) {
    for (let i = 0; i < w; i++) buf[i] = Math.abs(x[k * w + i] ?? 0);
    buf.sort();
    quiet.push((buf[w >> 1] ?? 0) < quietLevel);
  }
  let worst = 0;
  for (let k = 0; k < count; k++) {
    if (!quiet[k] || quiet[k - 1] === false || quiet[k + 1] === false) continue;
    for (let i = Math.max(1, k * w); i < (k + 1) * w; i++) worst = Math.max(worst, Math.abs((x[i] ?? 0) - (x[i - 1] ?? 0)));
  }
  return worst;
};

/** Largest |x[n] - x[n-1]| anywhere. */
export const maxJump = (x: Float32Array): number => {
  let m = 0;
  for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs((x[i] ?? 0) - (x[i - 1] ?? 0)));
  return m;
};

/** Short-term RMS (dBFS) per window of `seconds`. */
export const loudnessCurve = (x: Float32Array, sampleRate: number, seconds = 0.4): number[] => {
  const w = Math.max(1, Math.floor(sampleRate * seconds));
  const out: number[] = [];
  for (let s = 0; s + w <= x.length; s += w) out.push(dbfs(rms([x], s, s + w)));
  return out;
};

// --- loudness (ITU-R BS.1770 / EBU R128) ------------------------------------------------------

type Biquad = [b0: number, b1: number, b2: number, a1: number, a2: number];

/** The two K-weighting stages for any sample rate (RBJ forms of the BS.1770 filters). */
export const kWeightingCoeffs = (sr: number): [Biquad, Biquad] => {
  // Stage 1: high shelf, +4 dB above ~1.7 kHz (head acoustics).
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const fc = 1681.974450955533;
  const A = Math.pow(10, G / 40);
  let w0 = (2 * Math.PI * fc) / sr;
  let cos = Math.cos(w0);
  let alpha = Math.sin(w0) / (2 * Q);
  const sa = 2 * Math.sqrt(A) * alpha;
  const a0s = A + 1 - (A - 1) * cos + sa;
  const shelf: Biquad = [
    (A * (A + 1 + (A - 1) * cos + sa)) / a0s,
    (-2 * A * (A - 1 + (A + 1) * cos)) / a0s,
    (A * (A + 1 + (A - 1) * cos - sa)) / a0s,
    (2 * (A - 1 - (A + 1) * cos)) / a0s,
    (A + 1 - (A - 1) * cos - sa) / a0s,
  ];
  // Stage 2: RLB high-pass at ~38 Hz.
  w0 = (2 * Math.PI * 38.13547087602444) / sr;
  cos = Math.cos(w0);
  alpha = Math.sin(w0) / (2 * 0.5003270373238773);
  const a0h = 1 + alpha;
  const hp: Biquad = [(1 + cos) / 2 / a0h, -(1 + cos) / a0h, (1 + cos) / 2 / a0h, (-2 * cos) / a0h, (1 - alpha) / a0h];
  return [shelf, hp];
};

const biquad = (x: Float32Array, [b0, b1, b2, a1, a2]: Biquad): Float32Array => {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] ?? 0;
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
};

export const kWeight = (x: Float32Array, sr: number): Float32Array => {
  const [shelf, hp] = kWeightingCoeffs(sr);
  return biquad(biquad(x, shelf), hp);
};

/** Loudness (LUFS) of K-weighted blocks of `win` s every `hop` s, channels summed (L/R weight 1). */
export const blockLoudness = (chans: readonly Float32Array[], sr: number, win = 0.4, hop = 0.1): number[] => {
  const k = chans.map((c) => kWeight(c, sr));
  const w = Math.max(1, Math.round(win * sr));
  const h = Math.max(1, Math.round(hop * sr));
  const len = k[0]?.length ?? 0;
  const out: number[] = [];
  for (let s = 0; s + w <= len; s += h) {
    let sum = 0;
    for (const c of k) {
      let e = 0;
      for (let i = s; i < s + w; i++) e += (c[i] ?? 0) * (c[i] ?? 0);
      sum += e / w;
    }
    out.push(sum > 0 ? -0.691 + 10 * Math.log10(sum) : -Infinity);
  }
  return out;
};

/** Gated integrated loudness (LUFS): absolute gate -70, relative gate -10 LU. */
export const integratedLoudness = (chans: readonly Float32Array[], sr: number): number => {
  const blocks = blockLoudness(chans, sr, 0.4, 0.1).filter((l) => l > -70);
  if (!blocks.length) return -Infinity;
  const mean = (ls: number[]): number => -0.691 + 10 * Math.log10(ls.reduce((s, l) => s + Math.pow(10, (l + 0.691) / 10), 0) / ls.length);
  const rel = mean(blocks) - 10;
  const gated = blocks.filter((l) => l > rel);
  return gated.length ? mean(gated) : -Infinity;
};

/** Share (0..1) of a magnitude spectrum's energy between lo and hi Hz. */
export const bandShare = (mags: Float64Array, sr: number, lo: number, hi = sr / 2): number => {
  const n = mags.length;
  let band = 0;
  let total = 0;
  for (let k = 1; k < n; k++) {
    const f = (k * sr) / (2 * n);
    const e = (mags[k] ?? 0) * (mags[k] ?? 0);
    total += e;
    if (f >= lo && f < hi) band += e;
  }
  return total > 0 ? band / total : 0;
};
