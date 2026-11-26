/**
 * Pure sample generators, computed once per AudioContext (or per pluck pitch) and reused:
 * noise of three colours, Karplus-Strong strings, a small reverb impulse response and the
 * soft-clip curve of the master limiter. No Web Audio here, so all of it is testable in Node.
 */
import type { Rand } from './random';

export type NoiseColor = 'white' | 'pink' | 'brown';

const normalize = (x: Float32Array, target: number): void => {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i] ?? 0));
  if (peak <= 0) return;
  const k = target / peak;
  for (let i = 0; i < x.length; i++) x[i] = (x[i] ?? 0) * k;
};

const removeMean = (x: Float32Array): void => {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] ?? 0;
  const m = sum / (x.length || 1);
  for (let i = 0; i < x.length; i++) x[i] = (x[i] ?? 0) - m;
};

/**
 * Loopable noise: the tail is crossfaded into the head so a looping buffer source has no
 * seam (brown noise would otherwise jump at the loop point).
 */
export const noiseSamples = (color: NoiseColor, length: number, rand: Rand): Float32Array => {
  const fade = Math.min(2048, Math.floor(length / 8));
  const raw = new Float32Array(length + fade);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = rand() * 2 - 1;
    if (color === 'white') raw[i] = w;
    else if (color === 'pink') {
      // Paul Kellet's economy pink filter.
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      raw[i] = b0 + b1 + b2 + w * 0.1848;
    } else {
      last = (last + 0.02 * w) / 1.02;
      raw[i] = last;
    }
  }
  const out = raw.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const x = i / fade;
    out[i] = (raw[i] ?? 0) * x + (raw[length + i] ?? 0) * (1 - x);
  }
  removeMean(out);
  normalize(out, 0.9);
  return out;
};

export interface PluckSamples {
  data: Float32Array;
  /** playbackRate that puts the generated string exactly on the requested pitch. */
  rate: number;
}

/**
 * Karplus-Strong plucked string. The delay line length is an integer N, which with the
 * two-point averaging filter gives a period of N + 0.5 samples; instead of a fractional
 * delay we play the buffer back at `rate` so the pitch is exact (and the same buffer can be
 * reused for tiny random detunes).
 */
export const karplusStrong = (
  sampleRate: number,
  freq: number,
  dur: number,
  bright: number,
  decay: number,
  rand: Rand,
): PluckSamples => {
  const N = Math.max(2, Math.floor(sampleRate / freq - 0.5));
  const rate = (freq * (N + 0.5)) / sampleRate;
  const len = Math.max(N + 2, Math.ceil(dur * sampleRate));
  const y = new Float32Array(len);
  // Excitation: one period of noise, low-passed by brightness, with a pick-position comb
  // (plucking ~1/7 along the string) so it sounds like a string, not a noise burst.
  const a = 0.08 + 0.9 * Math.min(1, Math.max(0, bright));
  let lp = 0;
  const exc = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    lp += a * (rand() * 2 - 1 - lp);
    exc[i] = lp;
  }
  const pickAt = Math.max(1, Math.floor(N / 7));
  for (let i = 0; i < N; i++) y[i] = (exc[i] ?? 0) - 0.6 * (i >= pickAt ? (exc[i - pickAt] ?? 0) : 0);
  let mean = 0;
  for (let i = 0; i < N; i++) mean += y[i] ?? 0;
  mean /= N;
  for (let i = 0; i < N; i++) y[i] = (y[i] ?? 0) - mean;
  // Loss per period so the string falls 60 dB in `decay` seconds. The two-point average is
  // the classic string damping (highs die first) and is what makes the period N + 0.5.
  const periods = (Math.max(0.05, decay) * sampleRate) / (N + 0.5);
  const g = Math.pow(10, -3 / periods);
  for (let n = N; n < len; n++) {
    const p0 = y[n - N] ?? 0;
    const p1 = n - N - 1 >= 0 ? (y[n - N - 1] ?? 0) : 0;
    y[n] = g * 0.5 * (p0 + p1);
  }
  // DC blocker, then a 1 ms fade-in so the first sample is 0 (no click), and a 10 ms fade-out.
  let x1 = 0, y1 = 0;
  for (let n = 0; n < len; n++) {
    const x = y[n] ?? 0;
    const o = x - x1 + 0.995 * y1;
    x1 = x;
    y1 = o;
    y[n] = o;
  }
  const fin = Math.min(len, Math.ceil(sampleRate * 0.001));
  for (let n = 0; n < fin; n++) y[n] = (y[n] ?? 0) * (n / fin);
  const fout = Math.min(len, Math.ceil(sampleRate * 0.01));
  for (let n = 0; n < fout; n++) {
    const i = len - 1 - n;
    y[i] = (y[i] ?? 0) * (n / fout);
  }
  normalize(y, 1);
  return { data: y, rate };
};

/**
 * A small warm room: 12 ms pre-delay, a few early reflections, then noise decaying 60 dB over
 * `seconds` whose high end dies faster than its low end (like air and soft furnishings).
 */
export const reverbImpulse = (sampleRate: number, seconds: number, rand: Rand): [Float32Array, Float32Array] => {
  const len = Math.ceil(seconds * sampleRate);
  const pre = Math.floor(0.012 * sampleRate);
  const make = (side: number): Float32Array => {
    const out = new Float32Array(len);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      const env = Math.exp((-6.9 * t) / seconds);
      const cutoff = 0.12 + 0.6 * Math.exp(-t * 5);
      lp += cutoff * (rand() * 2 - 1 - lp);
      out[i] = lp * env;
    }
    const taps = side === 0 ? [0.017, 0.029, 0.047, 0.061] : [0.021, 0.034, 0.043, 0.067];
    taps.forEach((tap, k) => {
      const i = Math.floor(tap * sampleRate);
      if (i < len) out[i] = (out[i] ?? 0) + 0.5 * Math.pow(0.7, k) * (k % 2 ? -1 : 1);
    });
    const fin = Math.floor(0.004 * sampleRate);
    for (let i = 0; i < fin; i++) out[pre + i] = (out[pre + i] ?? 0) * (i / fin);
    removeMean(out);
    return out;
  };
  return [make(0), make(1)];
};

/** Master soft clip: linear below `knee`, tanh into `ceiling` (-1 dBFS) above. */
export const softClip = (a: number, ceiling = 0.891, knee = 0.6): number => {
  const m = Math.abs(a);
  if (m <= knee) return a;
  const y = knee + (ceiling - knee) * Math.tanh((m - knee) / (ceiling - knee));
  return a < 0 ? -y : y;
};

/**
 * WaveShaper curve for softClip. A WaveShaper's input domain is [-1, 1], so the graph feeds
 * it the signal scaled by 1/inputRange and this curve undoes that scale.
 */
export const softClipCurve = (n = 2049, inputRange = 2, ceiling = 0.891, knee = 0.6): Float32Array => {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = softClip(x * inputRange, ceiling, knee);
  }
  return c;
};
