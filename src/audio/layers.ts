/**
 * The synthesis vocabulary: every sound (one-shot or ambience note) is a list of layers, plain
 * data that synth.ts turns into Web Audio nodes. Keeping sounds as data makes them testable in
 * Node (in key, in range, gains <= 1) and lets the self-check render exactly what the game plays.
 */
import type { EnvShape } from './envelope';
import type { NoiseColor } from './dsp';

export interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  q?: number;
  /** Exponential sweep target reached at the end of the layer. */
  to?: number;
}

interface LayerBase {
  /** Start offset in seconds from the sound's start. */
  at: number;
  /** Length in seconds; the envelope reaches 0 exactly here. */
  dur: number;
  /** Linear peak gain, 0..1. */
  gain: number;
  /** -1..1 */
  pan?: number;
}

interface Pitched {
  /** Detune in cents: small random variation (|c| <= 15), or a declared ornament. */
  cents?: number;
  /** A deliberate out-of-key inflection (maqam quarter tone, slide start). Tests allow these. */
  ornament?: boolean;
}

/** Karplus-Strong string. */
export interface PluckLayer extends LayerBase, Pitched {
  kind: 'pluck';
  midi: number;
  /** 0 dark (gut/nylon) .. 1 bright (metal) */
  bright: number;
  /** T60 decay of the string in seconds. */
  decay: number;
  /** Pitch bend in semitones reached ~40% into the note (zither press). */
  bend?: number;
}

export type PartialSet = 'bell' | 'glass' | 'wood' | 'bowl' | 'coin';

/** Modal strike: a few sine partials with their own decays. */
export interface BellLayer extends LayerBase, Pitched {
  kind: 'bell';
  midi: number;
  partials: PartialSet;
}

/** Oscillator voice(s): pads, bowed strings, reeds. */
export interface ToneLayer extends LayerBase, Pitched {
  kind: 'tone';
  /** One or more notes (a chord). */
  midi: readonly number[];
  wave: 'sine' | 'triangle' | 'sawtooth' | 'square';
  /** Detuned unison voices per note. */
  voices?: number;
  /** Total unison spread in cents. */
  spread?: number;
  env: EnvShape;
  filter?: FilterSpec;
  vibrato?: { rate: number; cents: number; delay?: number };
  tremolo?: { rate: number; depth: number };
  /** Start this many semitones away and slide to the note over `glideTime`. */
  glide?: number;
  glideTime?: number;
}

/** Two-operator FM: metal, electric-piano. */
export interface FmLayer extends LayerBase, Pitched {
  kind: 'fm';
  midi: number;
  ratio: number;
  index: number;
  indexEnd: number;
  env: EnvShape;
}

/** Filtered noise: rustle, breath, footsteps, swish. */
export interface NoiseLayer extends LayerBase {
  kind: 'noise';
  color: NoiseColor;
  filter: FilterSpec;
  env: EnvShape;
  /** Crackle grains: (time from layer start, relative amp). */
  grains?: readonly (readonly [number, number])[];
  /** 0..1 position in the shared noise buffer, so repeats differ. */
  offset?: number;
}

/** Membrane: pitch-dropping sine with an inharmonic overtone and optional noise snap. */
export interface DrumLayer extends LayerBase, Pitched {
  kind: 'drum';
  midi: number;
  /** Semitones above `midi` the strike starts at. */
  drop: number;
  /** 0..1 noise snap level. */
  snap: number;
}

export type Layer = PluckLayer | BellLayer | ToneLayer | FmLayer | NoiseLayer | DrumLayer;

/** Pitches a layer sounds at (for key checks); noise has none. */
export const layerPitches = (l: Layer): number[] => {
  switch (l.kind) {
    case 'tone':
      return [...l.midi];
    case 'noise':
      return [];
    case 'pluck':
      return l.bend ? [l.midi, l.midi + l.bend] : [l.midi];
    default:
      return [l.midi];
  }
};

export const layerEnd = (l: Layer): number => l.at + l.dur;
