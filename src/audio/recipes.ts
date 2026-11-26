/**
 * The Sfx palette: a wooden board game on a table in a sunlit room. Wood taps on felt,
 * parchment rustles, a wax-seal thump for confirmations, small bells and plucked strings for
 * good news, low frame drums and bowed strings for war and crisis.
 *
 * Every pitched layer is in D dorian (theory.ts) so overlapping sounds harmonise. Each build()
 * takes a Rand: pitch (a few cents), timing, brightness and grain positions vary per play so
 * repeats do not fatigue. Signature moment: `offer` is a call that ends open on E (the 2nd,
 * a question); `recruit` is the answer, picking up that E in the same voice and resolving to D
 * over a full warm chord. `ageEnd` / `ageStart` form a IV -> i dorian cadence (G major -> D).
 */
import type { Sfx } from './types';
import type { BellLayer, DrumLayer, FmLayer, Layer, NoiseLayer, PluckLayer, ToneLayer } from './layers';
import { N } from './theory';
import { chance, jitter, pick, range, type Rand } from './random';

export type Tier = 'ui' | 'small' | 'event' | 'big' | 'fanfare';

/** Relative loudness: UI taps quiet, events louder, fanfares loudest (still under the limiter). */
export const TIER_GAIN: Record<Tier, number> = { ui: 0.4, small: 0.6, event: 0.75, big: 0.9, fanfare: 1 };

export interface Recipe {
  tier: Tier;
  /** Longest the sound can last (s); every layer ends by then. */
  dur: number;
  /** Intended spectral-centroid band (Hz) for the self-check. */
  band: readonly [number, number];
  /** Reverb send 0..1. */
  wet: number;
  /** The same sound is not retriggered closer than this. */
  minGapMs: number;
  build(r: Rand): Layer[];
}

// --- layer helpers (with per-play variation) ------------------------------------------------

const c = (r: Rand, amt = 6): number => jitter(r, amt);
const g = (r: Rand, gain: number): number => Math.min(1, gain * (1 + jitter(r, 0.12)));

const pluck = (r: Rand, at: number, midi: number, o: Partial<PluckLayer> = {}): PluckLayer => ({
  kind: 'pluck', at, midi, dur: 0.8, gain: 0.4, bright: 0.5, decay: 0.9, cents: c(r, 5), ...o,
  ...(o.gain !== undefined ? { gain: g(r, o.gain) } : {}),
  ...(o.bright !== undefined ? { bright: Math.min(1, Math.max(0, o.bright + jitter(r, 0.06))) } : {}),
});

const bell = (r: Rand, at: number, midi: number, o: Partial<BellLayer> = {}): BellLayer => ({
  kind: 'bell', at, midi, dur: 0.6, gain: 0.2, partials: 'bell', cents: c(r, 4), ...o,
  ...(o.gain !== undefined ? { gain: g(r, o.gain) } : {}),
});

const wood = (r: Rand, at: number, midi: number, o: Partial<BellLayer> = {}): BellLayer =>
  bell(r, at, midi, { partials: 'wood', dur: 0.07, ...o });

const tone = (r: Rand, at: number, midi: readonly number[], o: Partial<ToneLayer> = {}): ToneLayer => ({
  kind: 'tone', at, midi, dur: 1, gain: 0.15, wave: 'sawtooth', voices: 2, spread: 10, cents: c(r, 4),
  env: { kind: 'adsr', attack: 0.3, decay: 0.3, sustain: 0.65, release: 0.4 }, ...o,
  ...(o.gain !== undefined ? { gain: g(r, o.gain) } : {}),
});

const noise = (r: Rand, at: number, o: Partial<NoiseLayer> & Pick<NoiseLayer, 'filter'>): NoiseLayer => ({
  kind: 'noise', at, dur: 0.2, gain: 0.2, color: 'pink', env: { kind: 'perc', attack: 0.005 }, offset: r(), ...o,
  ...(o.gain !== undefined ? { gain: g(r, o.gain) } : {}),
});

const drum = (r: Rand, at: number, midi: number, o: Partial<DrumLayer> = {}): DrumLayer => ({
  kind: 'drum', at, midi, dur: 0.35, gain: 0.5, drop: 5, snap: 0.2, cents: c(r, 8), ...o,
  ...(o.gain !== undefined ? { gain: g(r, o.gain) } : {}),
});

const fm = (r: Rand, at: number, midi: number, o: Partial<FmLayer> = {}): FmLayer => ({
  kind: 'fm', at, midi, dur: 0.3, gain: 0.15, ratio: 1.41, index: 3, indexEnd: 0.2,
  env: { kind: 'perc', attack: 0.002, curve: 6 }, cents: c(r, 5), ...o,
  ...(o.gain !== undefined ? { gain: g(r, o.gain) } : {}),
});

/** Paper/parchment crackle grains spread over [from, to), >= 18 ms apart. */
const grains = (r: Rand, n: number, from: number, to: number): [number, number][] => {
  const out: [number, number][] = [];
  const step = (to - from) / n;
  for (let i = 0; i < n; i++) out.push([from + step * i + range(r, 0, step - 0.018), range(r, 0.4, 1)]);
  return out;
};

/** Small timing humanisation. */
const h = (r: Rand, t: number, amt = 0.008): number => Math.max(0, t + jitter(r, amt));

// --- the palette ------------------------------------------------------------------------------

export const RECIPES: Record<Sfx, Recipe> = {
  // UI: a wooden piece set down on felt.
  tap: {
    tier: 'ui', dur: 0.12, band: [400, 3500], wet: 0.04, minGapMs: 35,
    build: (r) => [
      wood(r, 0, pick(r, [N.A4, N.D5, N.E5]), { gain: 0.7, dur: 0.07 }),
      noise(r, 0, { color: 'pink', filter: { type: 'bandpass', freq: range(r, 2200, 3000), q: 0.8 }, dur: 0.025, gain: 0.2, env: { kind: 'perc', attack: 0.0008, curve: 7 } }),
    ],
  },
  select: {
    tier: 'ui', dur: 0.24, band: [500, 4000], wet: 0.08, minGapMs: 40,
    build: (r) => [
      wood(r, 0, pick(r, [N.D5, N.E5]), { gain: 0.6, dur: 0.07 }),
      pluck(r, h(r, 0.015, 0.004), pick(r, [N.A5, N.D6]), { gain: 0.32, bright: 0.6, decay: 0.3, dur: 0.2 }),
    ],
  },
  deselect: {
    tier: 'ui', dur: 0.16, band: [350, 3000], wet: 0.05, minGapMs: 40,
    build: (r) => [
      wood(r, 0, N.D5, { gain: 0.55, dur: 0.06 }),
      wood(r, h(r, 0.05, 0.006), N.A4, { gain: 0.45, dur: 0.08 }),
    ],
  },
  // A sheet of parchment slid open / folded shut.
  open: {
    tier: 'small', dur: 0.36, band: [900, 6000], wet: 0.12, minGapMs: 80,
    build: (r) => [
      noise(r, 0, {
        color: 'pink', filter: { type: 'bandpass', freq: range(r, 1200, 1600), q: 0.9, to: range(r, 3400, 4200) },
        dur: 0.3, gain: 0.3, env: { kind: 'adsr', attack: 0.06, decay: 0.05, sustain: 0.6, release: 0.12 },
        grains: grains(r, 6, 0.03, 0.26),
      }),
      pluck(r, 0.02, N.D5, { gain: 0.12, bright: 0.3, decay: 0.3, dur: 0.3 }),
    ],
  },
  close: {
    tier: 'small', dur: 0.34, band: [700, 5000], wet: 0.1, minGapMs: 80,
    build: (r) => [
      noise(r, 0, {
        color: 'pink', filter: { type: 'bandpass', freq: range(r, 3400, 4000), q: 0.9, to: range(r, 1100, 1400) },
        dur: 0.24, gain: 0.28, env: { kind: 'adsr', attack: 0.03, decay: 0.05, sustain: 0.6, release: 0.1 },
        grains: grains(r, 5, 0.02, 0.2),
      }),
      wood(r, h(r, 0.22, 0.01), N.D4, { gain: 0.4, dur: 0.09 }),
    ],
  },
  // A soft, low "nuh-uh": two dull wooden knocks falling a third.
  error: {
    tier: 'ui', dur: 0.34, band: [200, 2000], wet: 0.06, minGapMs: 150,
    build: (r) => [
      wood(r, 0, N.F4, { gain: 0.6, dur: 0.1 }),
      wood(r, 0.11, N.D4, { gain: 0.6, dur: 0.14 }),
      tone(r, 0, [N.D3], { wave: 'triangle', voices: 1, dur: 0.28, gain: 0.25, filter: { type: 'lowpass', freq: 700 }, env: { kind: 'adsr', attack: 0.01, decay: 0.08, sustain: 0.5, release: 0.12 } }),
    ],
  },
  // Footsteps on packed earth.
  move: {
    tier: 'small', dur: 0.5, band: [150, 1500], wet: 0.06, minGapMs: 120,
    build: (r) => {
      const steps = pick(r, [3, 3, 4]);
      const out: Layer[] = [];
      for (let i = 0; i < steps; i++) {
        const at = h(r, i * 0.11, 0.015);
        out.push(
          noise(r, at, { color: 'brown', filter: { type: 'lowpass', freq: range(r, 600, 900), q: 0.7 }, dur: 0.07, gain: i === steps - 1 ? 0.55 : 0.45, env: { kind: 'perc', attack: 0.003, curve: 5 } }),
          noise(r, at, { color: 'pink', filter: { type: 'bandpass', freq: range(r, 1500, 2200), q: 1.2 }, dur: 0.03, gain: 0.08, env: { kind: 'perc', attack: 0.002, curve: 6 } }),
          wood(r, at, pick(r, [N.D3, N.A3]), { gain: 0.25, dur: 0.06 }),
        );
      }
      return out;
    },
  },
  // A stake driven in, then an open fifth rising: home.
  found: {
    tier: 'event', dur: 1.0, band: [200, 3000], wet: 0.3, minGapMs: 300,
    build: (r) => [
      drum(r, 0, N.D3, { drop: 7, dur: 0.35, gain: 0.55, snap: 0.2 }),
      pluck(r, h(r, 0.05), N.D4, { gain: 0.38, bright: 0.55, decay: 1.0, dur: 0.75 }),
      pluck(r, h(r, 0.13), N.A4, { gain: 0.36, bright: 0.55, decay: 1.0, dur: 0.7 }),
      pluck(r, h(r, 0.21), N.D5, { gain: 0.34, bright: 0.55, decay: 1.0, dur: 0.7 }),
      bell(r, 0.3, N.A5, { gain: 0.16, dur: 0.65, partials: 'bowl' }),
    ],
  },
  // Three hammer taps on a wooden peg, then a fourth-chord pluck: done.
  build: {
    tier: 'event', dur: 0.85, band: [300, 3500], wet: 0.2, minGapMs: 250,
    build: (r) => {
      const out: Layer[] = [];
      for (let i = 0; i < 3; i++) {
        const at = h(r, i * 0.13, 0.01);
        out.push(
          wood(r, at, pick(r, [N.D5, N.E5]), { gain: 0.55, dur: 0.07 }),
          noise(r, at, { color: 'white', filter: { type: 'bandpass', freq: range(r, 2800, 3600), q: 1.5 }, dur: 0.02, gain: 0.15, env: { kind: 'perc', attack: 0.0006, curve: 7 } }),
        );
      }
      out.push(
        pluck(r, 0.4, N.G4, { gain: 0.32, bright: 0.5, decay: 0.8, dur: 0.42 }),
        pluck(r, h(r, 0.415, 0.004), N.D5, { gain: 0.3, bright: 0.5, decay: 0.8, dur: 0.42 }),
      );
      return out;
    },
  },
  wonder: {
    tier: 'fanfare', dur: 2.5, band: [200, 3000], wet: 0.45, minGapMs: 1500,
    build: (r) => [
      drum(r, 0, N.D3, { drop: 6, snap: 0.3, dur: 0.5, gain: 0.5 }),
      drum(r, 0.32, N.A2, { drop: 5, snap: 0.2, dur: 0.6, gain: 0.42 }),
      tone(r, 0, [N.D3, N.A3, N.D4, N.E4, N.A4], { voices: 2, spread: 8, dur: 2.3, gain: 0.2, filter: { type: 'lowpass', freq: 600, q: 0.5, to: 2200 }, env: { kind: 'adsr', attack: 0.5, decay: 0.4, sustain: 0.7, release: 0.8 }, vibrato: { rate: 4.5, cents: 6, delay: 0.4 } }),
      ...[N.D4, N.E4, N.A4, N.D5, N.E5, N.A5].map((m, i) => pluck(r, h(r, 0.1 + i * 0.08, 0.006), m, { gain: 0.3, bright: 0.6, decay: 1.2, dur: 1.2 })),
      bell(r, 0.6, N.D6, { gain: 0.22, dur: 1.7 }),
      bell(r, 0.9, N.A5, { gain: 0.16, dur: 1.5, partials: 'bowl' }),
    ],
  },
  // A quick rising pentatonic pluck run with a glass tip.
  research: {
    tier: 'event', dur: 0.95, band: [400, 3500], wet: 0.3, minGapMs: 300,
    build: (r) => [
      ...[N.D4, N.E4, N.G4, N.A4, N.D5].map((m, i) => pluck(r, h(r, i * 0.07, 0.005), m, { gain: 0.34, bright: 0.6, decay: 0.7, dur: 0.55 })),
      bell(r, 0.36, N.A5, { gain: 0.16, dur: 0.55, partials: 'glass' }),
    ],
  },
  // Thud, clack and a faint ring of metal.
  attack: {
    tier: 'event', dur: 0.4, band: [200, 2500], wet: 0.12, minGapMs: 90,
    build: (r) => [
      drum(r, 0, N.D3, { drop: 5, dur: 0.22, gain: 0.55, snap: 0.5 }),
      wood(r, 0.005, N.F4, { gain: 0.4, dur: 0.06 }),
      fm(r, 0.01, N.A4, { gain: 0.1, dur: 0.2, ratio: 1.41, index: 3, indexEnd: 0.2 }),
      noise(r, 0, { color: 'pink', filter: { type: 'bandpass', freq: range(r, 1500, 2200), q: 1 }, dur: 0.06, gain: 0.18, env: { kind: 'perc', attack: 0.001, curve: 6 } }),
    ],
  },
  // An arrow swish, then a soft thunk.
  ranged: {
    tier: 'event', dur: 0.48, band: [600, 6000], wet: 0.1, minGapMs: 90,
    build: (r) => [
      noise(r, 0, { color: 'white', filter: { type: 'bandpass', freq: range(r, 1600, 2000), q: 2, to: range(r, 4800, 5600) }, dur: 0.28, gain: 0.3, env: { kind: 'adsr', attack: 0.12, decay: 0.05, sustain: 0.5, release: 0.1 } }),
      wood(r, 0.3, N.D4, { gain: 0.42, dur: 0.09 }),
      noise(r, 0.3, { color: 'brown', filter: { type: 'lowpass', freq: 600 }, dur: 0.07, gain: 0.3, env: { kind: 'perc', attack: 0.002 } }),
    ],
  },
  // A bowed fifth sagging a step, over a muffled drum.
  unitLost: {
    tier: 'event', dur: 1.0, band: [120, 1200], wet: 0.35, minGapMs: 250,
    build: (r) => [
      tone(r, 0, [N.D3, N.A3], { voices: 2, spread: 10, dur: 0.95, gain: 0.26, glide: 2, glideTime: 0.6, filter: { type: 'lowpass', freq: 900, to: 400 }, env: { kind: 'adsr', attack: 0.08, decay: 0.3, sustain: 0.5, release: 0.4 } }),
      drum(r, 0, N.D3, { drop: 3, dur: 0.4, gain: 0.35, snap: 0 }),
    ],
  },
  victory: {
    tier: 'event', dur: 1.0, band: [300, 3000], wet: 0.3, minGapMs: 300,
    build: (r) => [
      drum(r, 0, N.D3, { snap: 0.3, dur: 0.3, gain: 0.45 }),
      pluck(r, h(r, 0.02), N.A4, { gain: 0.38, bright: 0.7, decay: 0.9, dur: 0.6 }),
      pluck(r, h(r, 0.1), N.D5, { gain: 0.38, bright: 0.7, decay: 0.9, dur: 0.65 }),
      bell(r, 0.18, N.D6, { gain: 0.2, dur: 0.75 }),
      bell(r, 0.26, N.A5, { gain: 0.14, dur: 0.65, partials: 'bowl' }),
    ],
  },
  // The call: a bowed open fifth swells while a harp-like pluck climbs A–D–E and stops on the
  // 2nd. It sounds like a question; recruit answers it.
  offer: {
    tier: 'big', dur: 1.7, band: [250, 3000], wet: 0.5, minGapMs: 800,
    build: (r) => [
      tone(r, 0, [N.D4, N.A4], { voices: 3, spread: 10, dur: 1.6, gain: 0.16, filter: { type: 'lowpass', freq: 900, q: 0.6, to: 1800 }, env: { kind: 'adsr', attack: 0.45, decay: 0.3, sustain: 0.6, release: 0.5 }, vibrato: { rate: 5, cents: 5, delay: 0.3 } }),
      pluck(r, h(r, 0.05, 0.005), N.A4, { gain: 0.36, bright: 0.55, decay: 1.2, dur: 1.0 }),
      pluck(r, h(r, 0.17, 0.005), N.D5, { gain: 0.36, bright: 0.55, decay: 1.2, dur: 1.0 }),
      pluck(r, h(r, 0.29, 0.005), N.E5, { gain: 0.4, bright: 0.55, decay: 1.3, dur: 1.2 }),
      bell(r, 0.42, N.E6, { gain: 0.12, dur: 1.0, partials: 'glass' }),
    ],
  },
  // The answer: same strings pick up the E, resolve to D, then a strummed D chord over a warm
  // bowed swell and a bell on the tonic. The game's signature moment.
  recruit: {
    tier: 'fanfare', dur: 2.2, band: [200, 3000], wet: 0.5, minGapMs: 800,
    build: (r) => [
      tone(r, 0, [N.D3, N.A3, N.D4, N.A4], { voices: 3, spread: 10, dur: 2.1, gain: 0.18, filter: { type: 'lowpass', freq: 800, q: 0.6, to: 2400 }, env: { kind: 'adsr', attack: 0.3, decay: 0.5, sustain: 0.65, release: 0.7 }, vibrato: { rate: 5, cents: 5, delay: 0.4 } }),
      pluck(r, 0, N.E5, { gain: 0.36, bright: 0.55, decay: 0.8, dur: 0.3 }),
      pluck(r, h(r, 0.16, 0.004), N.D5, { gain: 0.4, bright: 0.55, decay: 1.4, dur: 1.4 }),
      ...[N.D4, N.A4, N.D5].map((m, i) => pluck(r, 0.34 + i * 0.03, m, { gain: 0.28, bright: 0.6, decay: 1.4, dur: 1.4 })),
      drum(r, 0.34, N.D3, { gain: 0.25, snap: 0.1, dur: 0.5 }),
      bell(r, 0.38, N.D6, { gain: 0.22, dur: 1.5 }),
      bell(r, 0.7, N.A6, { gain: 0.08, dur: 1.1, partials: 'glass' }),
    ],
  },
  // A wax seal pressed: soft low thump, squish, a low string.
  seat: {
    tier: 'small', dur: 0.5, band: [100, 1200], wet: 0.15, minGapMs: 200,
    build: (r) => [
      drum(r, 0, N.A2, { drop: 4, dur: 0.25, gain: 0.5, snap: 0 }),
      noise(r, 0, { color: 'brown', filter: { type: 'lowpass', freq: range(r, 500, 650) }, dur: 0.1, gain: 0.35, env: { kind: 'perc', attack: 0.004 } }),
      pluck(r, 0.01, N.D3, { gain: 0.28, bright: 0.15, decay: 0.6, dur: 0.45 }),
    ],
  },
  // A rising bowed fifth with a bell: someone acts.
  activate: {
    tier: 'event', dur: 1.0, band: [300, 3000], wet: 0.4, minGapMs: 400,
    build: (r) => [
      tone(r, 0, [N.D4], { dur: 0.42, gain: 0.16, filter: { type: 'lowpass', freq: 1600 }, env: { kind: 'adsr', attack: 0.12, decay: 0.1, sustain: 0.7, release: 0.15 } }),
      tone(r, 0.3, [N.A4], { dur: 0.65, gain: 0.16, filter: { type: 'lowpass', freq: 1700 }, env: { kind: 'adsr', attack: 0.08, decay: 0.15, sustain: 0.7, release: 0.3 }, vibrato: { rate: 5.5, cents: 6, delay: 0.15 } }),
      pluck(r, 0.32, N.D5, { gain: 0.3, bright: 0.55, decay: 0.8, dur: 0.6 }),
      bell(r, 0.33, N.A5, { gain: 0.18, dur: 0.65 }),
    ],
  },
  // A small glass motif (grace G, then A up to D) and a breath: "something stirs".
  hint: {
    tier: 'small', dur: 0.85, band: [900, 5000], wet: 0.5, minGapMs: 600,
    build: (r) => [
      bell(r, 0, N.G5, { gain: 0.12, dur: 0.25, partials: 'glass' }),
      bell(r, h(r, 0.06, 0.004), N.A5, { gain: 0.2, dur: 0.4, partials: 'glass' }),
      bell(r, h(r, 0.22, 0.006), N.D6, { gain: 0.24, dur: 0.6, partials: 'glass' }),
      noise(r, 0, { color: 'pink', filter: { type: 'bandpass', freq: 4000, q: 0.7 }, dur: 0.32, gain: 0.05, env: { kind: 'adsr', attack: 0.1, decay: 0.05, sustain: 0.6, release: 0.15 } }),
    ],
  },
  // Two or three coins dropping onto each other.
  coin: {
    tier: 'small', dur: 0.45, band: [1500, 9000], wet: 0.2, minGapMs: 120,
    build: (r) => {
      const out: Layer[] = [
        bell(r, 0, N.A6, { gain: 0.26, dur: 0.22, partials: 'coin' }),
        bell(r, h(r, 0.07, 0.02), N.D7, { gain: 0.22, dur: 0.26, partials: 'coin' }),
      ];
      if (chance(r, 0.5)) out.push(bell(r, h(r, 0.15, 0.02), N.E6, { gain: 0.14, dur: 0.25, partials: 'coin' }));
      return out;
    },
  },
  // A messenger's reed call, A up to D, and a letter rustle.
  envoy: {
    tier: 'event', dur: 0.8, band: [300, 2600], wet: 0.3, minGapMs: 300,
    build: (r) => [
      tone(r, 0, [N.A4], { wave: 'square', voices: 1, dur: 0.22, gain: 0.1, filter: { type: 'lowpass', freq: 2000, q: 0.7 }, env: { kind: 'adsr', attack: 0.04, decay: 0.1, sustain: 0.7, release: 0.08 } }),
      tone(r, 0.2, [N.D5], { wave: 'square', voices: 1, dur: 0.48, gain: 0.1, filter: { type: 'lowpass', freq: 2000, q: 0.7 }, env: { kind: 'adsr', attack: 0.04, decay: 0.1, sustain: 0.7, release: 0.2 }, vibrato: { rate: 5.5, cents: 8, delay: 0.1 } }),
      noise(r, 0, { color: 'pink', filter: { type: 'bandpass', freq: 2500, q: 0.9 }, dur: 0.18, gain: 0.12, env: { kind: 'adsr', attack: 0.04, decay: 0.03, sustain: 0.6, release: 0.08 }, grains: grains(r, 3, 0.03, 0.14) }),
      pluck(r, 0.2, N.D4, { gain: 0.22, bright: 0.45, decay: 0.8, dur: 0.55 }),
    ],
  },
  // Frame drums and a low bowed D minor with tremolo.
  war: {
    tier: 'big', dur: 1.6, band: [100, 1500], wet: 0.35, minGapMs: 800,
    build: (r) => [
      drum(r, 0, N.D3, { drop: 5, dur: 0.5, gain: 0.6, snap: 0.4 }),
      drum(r, h(r, 0.26, 0.01), N.D3, { drop: 5, dur: 0.45, gain: 0.45, snap: 0.3 }),
      drum(r, h(r, 0.52, 0.01), N.A2, { drop: 6, dur: 0.6, gain: 0.6, snap: 0.3 }),
      tone(r, 0, [N.D3, N.F3, N.A3], { voices: 2, spread: 12, dur: 1.5, gain: 0.22, filter: { type: 'lowpass', freq: 500, to: 1100 }, env: { kind: 'adsr', attack: 0.35, decay: 0.3, sustain: 0.6, release: 0.4 }, tremolo: { rate: 7, depth: 0.25 } }),
    ],
  },
  // Two singing-bowl tones over a soft open pad.
  peace: {
    tier: 'big', dur: 1.4, band: [300, 3000], wet: 0.5, minGapMs: 600,
    build: (r) => [
      tone(r, 0, [N.D4, N.A4, N.E5], { wave: 'triangle', voices: 2, spread: 8, dur: 1.3, gain: 0.16, filter: { type: 'lowpass', freq: 1500 }, env: { kind: 'adsr', attack: 0.3, decay: 0.2, sustain: 0.6, release: 0.6 } }),
      bell(r, 0.05, N.D5, { gain: 0.22, dur: 0.95, partials: 'bowl' }),
      bell(r, h(r, 0.35, 0.01), N.A5, { gain: 0.18, dur: 0.95, partials: 'bowl' }),
    ],
  },
  // A deep drum and a darker bowed cluster (D–F–C) trembling, a lone bowl on F.
  crisis: {
    tier: 'big', dur: 1.7, band: [100, 1300], wet: 0.45, minGapMs: 800,
    build: (r) => [
      drum(r, 0, N.D3, { drop: 6, snap: 0.25, dur: 0.7, gain: 0.6 }),
      tone(r, 0, [N.D3, N.F3, N.C4], { voices: 2, spread: 14, dur: 1.6, gain: 0.22, filter: { type: 'lowpass', freq: 400, to: 900 }, env: { kind: 'adsr', attack: 0.4, decay: 0.3, sustain: 0.6, release: 0.5 }, tremolo: { rate: 5, depth: 0.2 } }),
      bell(r, 0.35, N.F4, { gain: 0.12, dur: 1.1, partials: 'bowl' }),
    ],
  },
  milestone: {
    tier: 'fanfare', dur: 2.0, band: [250, 3000], wet: 0.45, minGapMs: 1000,
    build: (r) => [
      drum(r, 0, N.D3, { gain: 0.4, snap: 0.2, dur: 0.35 }),
      ...[N.D4, N.A4, N.D5, N.E5, N.A5].map((m, i) => pluck(r, h(r, i * 0.09, 0.006), m, { gain: 0.32, bright: 0.6, decay: 1.0, dur: 1.0 })),
      tone(r, 0, [N.D3, N.A3, N.D4, N.E4], { voices: 2, spread: 10, dur: 1.8, gain: 0.18, filter: { type: 'lowpass', freq: 700, to: 2000 }, env: { kind: 'adsr', attack: 0.35, decay: 0.4, sustain: 0.65, release: 0.6 } }),
      bell(r, 0.42, N.D6, { gain: 0.2, dur: 1.4 }),
      bell(r, 0.6, N.A6, { gain: 0.08, dur: 0.9, partials: 'glass' }),
    ],
  },
  // A wax seal, then a slow strum on the open D chord.
  adopt: {
    tier: 'event', dur: 1.0, band: [200, 2500], wet: 0.35, minGapMs: 400,
    build: (r) => [
      drum(r, 0, N.A2, { drop: 4, dur: 0.25, gain: 0.4, snap: 0 }),
      noise(r, 0, { color: 'brown', filter: { type: 'lowpass', freq: 900 }, dur: 0.1, gain: 0.25, env: { kind: 'perc', attack: 0.004 } }),
      ...[N.D3, N.A3, N.D4, N.E4, N.A4].map((m, i) => pluck(r, 0.08 + i * 0.03, m, { gain: 0.26, bright: 0.45, decay: 1.2, dur: 0.8 })),
    ],
  },
  // Cadence part 1: the dorian IV (G major) swells and hangs, unresolved.
  ageEnd: {
    tier: 'fanfare', dur: 2.3, band: [200, 2500], wet: 0.55, minGapMs: 1500,
    build: (r) => [
      drum(r, 0, N.D3, { gain: 0.35, dur: 0.5, snap: 0.15 }),
      tone(r, 0, [N.G3, N.B3, N.D4, N.G4], { voices: 3, spread: 10, dur: 2.2, gain: 0.18, filter: { type: 'lowpass', freq: 700, to: 1800 }, env: { kind: 'adsr', attack: 0.6, decay: 0.4, sustain: 0.7, release: 0.8 } }),
      ...[N.G3, N.D4, N.G4, N.B4].map((m, i) => pluck(r, i * 0.05, m, { gain: 0.28, bright: 0.5, decay: 1.4, dur: 1.3 })),
      bell(r, 0.4, N.B5, { gain: 0.14, dur: 1.4, partials: 'bowl' }),
    ],
  },
  // Cadence part 2: home on D, drums and bells. A new age.
  ageStart: {
    tier: 'fanfare', dur: 2.5, band: [200, 3000], wet: 0.55, minGapMs: 1500,
    build: (r) => [
      drum(r, 0, N.D3, { gain: 0.5, snap: 0.3, dur: 0.5 }),
      drum(r, 0.25, N.A2, { gain: 0.42, snap: 0.2, dur: 0.6 }),
      tone(r, 0, [N.D3, N.A3, N.D4, N.F4, N.A4], { voices: 2, spread: 10, dur: 2.3, gain: 0.18, filter: { type: 'lowpass', freq: 700, to: 2200 }, env: { kind: 'adsr', attack: 0.4, decay: 0.4, sustain: 0.7, release: 0.8 } }),
      ...[N.D4, N.A4, N.D5, N.F5].map((m, i) => pluck(r, 0.05 + i * 0.05, m, { gain: 0.28, bright: 0.6, decay: 1.4, dur: 1.4 })),
      bell(r, 0.45, N.D6, { gain: 0.24, dur: 1.8 }),
      bell(r, 0.7, N.A5, { gain: 0.16, dur: 1.5, partials: 'bowl' }),
    ],
  },
  // A page turned and a low string: "your move is done".
  endTurn: {
    tier: 'small', dur: 0.45, band: [200, 2500], wet: 0.15, minGapMs: 300,
    build: (r) => [
      wood(r, 0, N.G4, { gain: 0.45, dur: 0.08 }),
      pluck(r, 0.03, N.D3, { gain: 0.32, bright: 0.35, decay: 0.7, dur: 0.4 }),
      noise(r, 0, { color: 'pink', filter: { type: 'bandpass', freq: 2500, q: 0.9 }, dur: 0.12, gain: 0.1, env: { kind: 'adsr', attack: 0.02, decay: 0.02, sustain: 0.6, release: 0.05 }, grains: grains(r, 2, 0.02, 0.09) }),
    ],
  },
  turnStart: {
    tier: 'small', dur: 0.7, band: [400, 4000], wet: 0.4, minGapMs: 500,
    build: (r) => [
      bell(r, 0, N.A5, { gain: 0.2, dur: 0.6, partials: 'bowl' }),
      pluck(r, 0.05, N.D5, { gain: 0.2, bright: 0.5, decay: 0.6, dur: 0.5 }),
    ],
  },
  // A slow falling line over a darkening bowed fifth and two muffled drums.
  defeat: {
    tier: 'fanfare', dur: 2.5, band: [100, 1500], wet: 0.55, minGapMs: 2000,
    build: (r) => [
      tone(r, 0, [N.D3, N.A3], { voices: 2, spread: 10, dur: 2.4, gain: 0.22, filter: { type: 'lowpass', freq: 700, to: 350 }, env: { kind: 'adsr', attack: 0.5, decay: 0.5, sustain: 0.6, release: 0.9 } }),
      ...[N.A4, N.F4, N.E4, N.D4].map((m, i) => pluck(r, i * 0.35, m, { gain: 0.3, bright: 0.35, decay: 1.5, dur: i === 3 ? 1.4 : 1.0 })),
      drum(r, 0, N.D3, { gain: 0.5, snap: 0.1, dur: 0.9, drop: 3 }),
      drum(r, 1.05, N.D3, { gain: 0.4, snap: 0.05, dur: 0.9, drop: 3 }),
    ],
  },
  // A resolved closing phrase: A–G–E–D settling over a warm D chord and a bowl.
  chronicle: {
    tier: 'fanfare', dur: 2.5, band: [200, 2500], wet: 0.5, minGapMs: 2000,
    build: (r) => [
      ...[N.A4, N.G4, N.E4, N.D4].map((m, i) => pluck(r, h(r, [0, 0.22, 0.44, 0.7][i] ?? 0, 0.01), m, { gain: 0.32, bright: 0.5, decay: 1.4, dur: i === 3 ? 1.6 : 0.8 })),
      tone(r, 0.6, [N.D3, N.A3, N.D4, N.A4], { voices: 2, spread: 10, dur: 1.85, gain: 0.17, filter: { type: 'lowpass', freq: 900, to: 1600 }, env: { kind: 'adsr', attack: 0.4, decay: 0.3, sustain: 0.65, release: 0.8 } }),
      bell(r, 0.7, N.D5, { gain: 0.2, dur: 1.6, partials: 'bowl' }),
    ],
  },
};

export const SFX_LIST = Object.keys(RECIPES) as Sfx[];
