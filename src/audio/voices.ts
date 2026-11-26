/**
 * Ambience voices: how each composer note sounds, as layers. Instruments are evoked simply
 * but recognisably through timbre, register and ornament, never caricature:
 *   arghul      reedy square-wave pipe with vibrato over its own drone pipe
 *   lyre        bright, short gut-string plucks
 *   guzheng     bright long-ringing plucks, glissandi and pressed bends (composer)
 *   oud         dark, round low plucks; bayati half-flat E and risha tremolo (composer)
 *   hardingfele bowed fiddle with an open-string drone and sympathetic-string shimmer
 *   katajjaq    breathy voiced/unvoiced pulses, two voices interlocking
 *   morin khuur low bowed notes sliding into pitch, a faint overtone whistle above
 *   guitar      nylon-string plucks, soft strums
 */
import type { NoteEvent } from './composer';
import type { Layer } from './layers';
import { jitter, type Rand } from './random';

const ATT = (a: number, r: number, s = 0.75, d = 0.2) => ({ kind: 'adsr' as const, attack: a, decay: d, sustain: s, release: r });

export const voiceLayers = (ev: NoteEvent, r: Rand): Layer[] => {
  const base = { at: 0, pan: ev.pan ?? jitter(r, 0.2), cents: (ev.cents ?? 0) + jitter(r, 3), ornament: ev.ornament };
  const g = Math.min(1, Math.max(0, ev.gain));
  switch (ev.voice) {
    case 'pluck':
      return [{ ...base, kind: 'pluck', midi: ev.midi, dur: Math.min(2.5, ev.dur), gain: 0.16 * g, bright: 0.45, decay: 1.6 }];
    case 'bellMelody':
      return [
        { ...base, kind: 'fm', midi: ev.midi, dur: Math.min(2.5, ev.dur + 0.4), gain: 0.045 * g, ratio: 1, index: 1.6, indexEnd: 0.2, env: { kind: 'perc', attack: 0.004, curve: 4 } },
        { ...base, kind: 'bell', midi: ev.midi, dur: Math.min(2.5, ev.dur + 0.6), gain: 0.036 * g, partials: 'glass' },
      ];
    case 'pad':
      // Warm string-pad: detuned saws, low-passed, slow swell, long release into the next chord.
      return [{ ...base, pan: 0, kind: 'tone', midi: ev.chord ?? [ev.midi], dur: ev.dur, gain: 0.063 * g, wave: 'sawtooth', voices: 2, spread: 14, env: ATT(ev.dur * 0.3, ev.dur * 0.3, 0.85, 0.1), filter: { type: 'lowpass', freq: 750, q: 0.5 }, vibrato: { rate: 0.3, cents: 4 } }];
    case 'bass':
      return [{ ...base, pan: 0, kind: 'pluck', midi: ev.midi, dur: Math.min(2.5, ev.dur), gain: 0.12 * g, bright: 0.3, decay: 2 }];
    case 'arp':
      return [{ ...base, kind: 'pluck', midi: ev.midi, dur: Math.min(1.5, ev.dur), gain: 0.19 * g, bright: 0.5, decay: 0.9 }];
    case 'lyre':
      return [{ ...base, kind: 'pluck', midi: ev.midi, dur: Math.min(1.6, ev.dur), gain: 0.14 * g, bright: 0.62, decay: 1.1 }];
    case 'guzheng':
      return [{ ...base, kind: 'pluck', midi: ev.midi, dur: Math.min(2.5, ev.dur + 0.6), gain: 0.18 * g, bright: 0.8, decay: 2.2, ...(ev.bend ? { bend: ev.bend } : {}) }];
    case 'oud':
      return [{ ...base, kind: 'pluck', midi: ev.midi, dur: Math.min(1.8, ev.dur), gain: 0.16 * g, bright: 0.28, decay: 1.0 }];
    case 'guitar':
      return [{ ...base, kind: 'pluck', midi: ev.midi, dur: Math.min(2, ev.dur), gain: 0.21 * g, bright: 0.38, decay: 1.5 }];
    case 'drum':
      return [{ ...base, kind: 'drum', midi: ev.midi, dur: ev.dur, gain: 0.09 * g, drop: 4, snap: 0.25 }];
    case 'drumHi':
      return [
        { ...base, kind: 'drum', midi: ev.midi, dur: ev.dur, gain: 0.2 * g, drop: 2, snap: 0.6 },
      ];
    case 'bell':
      return [{ ...base, kind: 'bell', midi: ev.midi, dur: ev.dur, gain: 0.08 * g, partials: 'bowl' }];
    case 'keys':
      return [{ ...base, kind: 'fm', midi: ev.midi, dur: ev.dur, gain: 0.06 * g, ratio: 1, index: 1.4, indexEnd: 0.15, env: { kind: 'perc', attack: 0.004, curve: 4 } }];
    case 'bowed':
      return [{ ...base, kind: 'tone', midi: [ev.midi], dur: ev.dur, gain: 0.08 * g, wave: 'sawtooth', voices: 2, spread: 9, env: ATT(ev.dur * 0.35, ev.dur * 0.4, 0.8), filter: { type: 'lowpass', freq: 900, q: 0.6 }, vibrato: { rate: 4.8, cents: 7, delay: ev.dur * 0.3 } }];
    case 'arghul':
      return [{ ...base, kind: 'tone', midi: [ev.midi], dur: ev.dur, gain: 0.045 * g, wave: 'square', voices: 1, env: ATT(0.03, Math.min(0.12, ev.dur * 0.3), 0.85, 0.05), filter: { type: 'lowpass', freq: 1900, q: 1.2 }, vibrato: { rate: 5.5, cents: 9, delay: 0.12 } }];
    case 'arghulDrone':
      return [{ ...base, pan: -0.15, kind: 'tone', midi: [ev.midi], dur: ev.dur, gain: 0.03 * g, wave: 'square', voices: 1, env: ATT(0.25, 0.4, 0.9), filter: { type: 'lowpass', freq: 1100, q: 1 } }];
    case 'fiddle':
      return [{ ...base, kind: 'tone', midi: [ev.midi], dur: ev.dur, gain: 0.075 * g, wave: 'sawtooth', voices: 1, env: ATT(0.06, Math.min(0.15, ev.dur * 0.3), 0.8, 0.08), filter: { type: 'bandpass', freq: 1500, q: 0.6 }, vibrato: { rate: 6, cents: 8, delay: 0.1 } }];
    case 'fiddleDrone':
      return [{ ...base, kind: 'tone', midi: [ev.midi], dur: ev.dur, gain: 0.06 * g, wave: 'sawtooth', voices: 1, env: ATT(0.15, 0.3, 0.9), filter: { type: 'bandpass', freq: 1100, q: 0.6 } }];
    case 'sympathetic':
      return [{ ...base, kind: 'tone', midi: [ev.midi, ev.midi + 7], dur: ev.dur, gain: 0.05 * g, wave: 'sine', voices: 2, spread: 6, env: ATT(ev.dur * 0.3, ev.dur * 0.55, 0.8) }];
    case 'throatLow':
      return [
        { ...base, kind: 'tone', midi: [ev.midi], dur: ev.dur, gain: 0.12 * g, wave: 'triangle', voices: 1, env: ATT(0.015, ev.dur * 0.5, 0.6, 0.03), filter: { type: 'lowpass', freq: 1200, q: 2 } },
        { at: 0, pan: base.pan, kind: 'noise', color: 'pink', dur: ev.dur, gain: 0.05 * g, filter: { type: 'bandpass', freq: 700, q: 2 }, env: ATT(0.01, ev.dur * 0.5, 0.5, 0.03), offset: r() },
      ];
    case 'throatBreath':
      return [{ at: 0, pan: base.pan, kind: 'noise', color: 'pink', dur: ev.dur, gain: 0.12 * g, filter: { type: 'bandpass', freq: 1900 + jitter(r, 300), q: 1.5 }, env: ATT(0.012, ev.dur * 0.5, 0.5, 0.03), offset: r() }];
    case 'khuur':
      return [{ ...base, kind: 'tone', midi: [ev.midi], dur: ev.dur, gain: 0.07 * g, wave: 'sawtooth', voices: 2, spread: 7, glide: ev.glide ?? -2, glideTime: 0.25, env: ATT(0.2, ev.dur * 0.35, 0.8), filter: { type: 'lowpass', freq: 1300, q: 0.8 }, vibrato: { rate: 5, cents: 10, delay: 0.4 } }];
    case 'overtone':
      return [{ ...base, kind: 'tone', midi: [ev.midi], dur: ev.dur, gain: 0.02 * g, wave: 'sine', voices: 1, env: ATT(ev.dur * 0.4, ev.dur * 0.4, 0.8), vibrato: { rate: 4, cents: 6, delay: 0.3 } }];
  }
};
