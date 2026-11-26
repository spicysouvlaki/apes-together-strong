/**
 * The ambience composer: slow random phrase generators quantised to D dorian, one stream per
 * age layer (plucks, hand drum, bowed notes, bells, keys) and one per culture the player has
 * absorbed (GDD §11: per-age base + culture stems faded in by weight). Phrases are generated
 * on demand with random lengths and rests, so the bed never loops audibly.
 *
 * Pure apart from its own stream state: no Web Audio, seedable, testable in Node.
 */
import type { Age } from '@contracts/content-schemas';
import { chance, pick, range, type Rand } from './random';
import { DARK_PCS, KEY_PCS, N, PENTA_PCS, inKey, keyNotes, pc } from './theory';

/** Instrument families, keyed by the suffix of a culture's `musicStem` in content. */
export const INSTRUMENTS = ['arghul', 'lyre', 'guzheng', 'oud', 'hardingfele', 'katajjaq', 'morin_khuur', 'guitar'] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export type VoiceId =
  | 'pluck' | 'bellMelody' | 'pad' | 'bass' | 'arp' | 'drum' | 'drumHi' | 'bowed' | 'bell' | 'keys'
  | 'arghul' | 'arghulDrone' | 'lyre' | 'guzheng' | 'oud' | 'fiddle' | 'fiddleDrone' | 'sympathetic'
  | 'throatLow' | 'throatBreath' | 'khuur' | 'overtone' | 'guitar';

export interface NoteEvent {
  /** Context time in seconds. */
  t: number;
  /** 'bed' (harmony and pulse), 'base' (age melody) or a culture id. */
  source: string;
  voice: VoiceId;
  midi: number;
  dur: number;
  /** 0..1 within the voice. */
  gain: number;
  cents?: number;
  /** Deliberate out-of-key inflection (oud's half-flat E in maqam bayati). */
  ornament?: boolean;
  bend?: number;
  glide?: number;
  pan?: number;
  /** Pad voicing (voice 'pad'); `midi` is its lowest note. */
  chord?: readonly number[];
}

export interface ComposerScene {
  age: Age;
  crisis: boolean;
  /** culture id -> instrument, weight 0..1 (only cultures above the threshold). */
  cultures: readonly { id: string; instrument: Instrument; weight: number }[];
}

type PhraseNote = Omit<NoteEvent, 't' | 'source'> & { at: number };
interface Phrase {
  notes: PhraseNote[];
  length: number;
  rest: number;
}
type Maker = (r: Rand, s: ComposerScene, weight: number, clock: Clock) => Phrase;

/** A culture is heard once its weight passes this. */
export const CULTURE_THRESHOLD = 0.05;

// --- helpers ----------------------------------------------------------------------------------

const clampIdx = (i: number, n: number): number => Math.max(0, Math.min(n - 1, i));
const at = <T>(xs: readonly T[], i: number): T => {
  const x = xs[clampIdx(i, xs.length)];
  if (x === undefined) throw new Error('empty pitch set');
  return x;
};

/** A stepwise random walk over a pitch set; tends to settle on D or A at the end. */
const walk = (r: Rand, set: readonly number[], n: number, steps: readonly number[] = [-2, -1, -1, 1, 1, 2]): number[] => {
  let i = Math.floor(r() * set.length);
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    out.push(at(set, i));
    i = clampIdx(i + pick(r, steps), set.length);
  }
  if (chance(r, 0.65)) {
    const last = out[out.length - 1] ?? set[0] ?? N.D4;
    const home = set.filter((m) => pc(m) === 2 || pc(m) === 9);
    if (home.length) out[out.length - 1] = home.reduce((b, m) => (Math.abs(m - last) < Math.abs(b - last) ? m : b));
  }
  return out;
};

/** Fewer, quieter phrases for a lightly-held culture. */
const restFor = (r: Rand, lo: number, hi: number, weight: number, crisis: boolean): number =>
  range(r, lo, hi) * (1 + 2 * (1 - Math.min(1, weight))) * (crisis ? 1.8 : 1);

const melodyLine = (r: Rand, set: readonly number[], voice: VoiceId, n: number, durs: readonly number[], gain: number): { notes: PhraseNote[]; length: number } => {
  const pitches = walk(r, set, n);
  const notes: PhraseNote[] = [];
  let t = 0;
  pitches.forEach((midi, i) => {
    const last = i === pitches.length - 1;
    const d = last ? Math.max(...durs) * 1.5 : pick(r, durs);
    notes.push({ at: t, voice, midi, dur: d * 1.6, gain: gain * range(r, 0.8, 1) });
    t += d;
  });
  return { notes, length: t };
};

// --- harmony, tempo and the per-age bed ------------------------------------------------------

export interface Chord {
  name: string;
  /** Bass note (MIDI, A2–G3 so phone speakers still hear it through its harmonics). */
  root: number;
  /** Pad voicing, octave 3–4. */
  tones: readonly number[];
}
const chord = (name: string, root: number, ...tones: number[]): Chord => ({ name, root, tones });

const Dm = chord('Dm', N.D3, N.D3, N.A3, N.D4, N.F4);
const G = chord('G', N.G2, N.G3, N.B3, N.D4, N.G4);
const C = chord('C', N.C3, N.C3, N.G3, N.C4, N.E4);
const F = chord('F', N.F2, N.F3, N.A3, N.C4, N.F4);
const Am = chord('Am', N.A2, N.A3, N.C4, N.E4);
const D5 = chord('D5', N.D3, N.D3, N.A3, N.D4);
const C5 = chord('C5', N.C3, N.C3, N.G3, N.C4);
const G5 = chord('G5', N.G2, N.G3, N.D4, N.G4);
const Dm7 = chord('Dm7', N.D3, N.D3, N.A3, N.C4, N.F4);
const Fmaj7 = chord('Fmaj7', N.F2, N.F3, N.A3, N.C4, N.E4);
const Em7 = chord('Em7', N.E3, N.E3, N.B3, N.D4, N.G4);

/**
 * Progressions per age, all diatonic to D dorian. Ancient is open fifths (no thirds: archaic),
 * classical leans on the dorian i–IV, exploration widens, modern adds sevenths. Crisis falls
 * back to the minor side (i–v–bVII–i), slower.
 */
export const PROGRESSIONS: Record<Age, readonly Chord[]> = {
  ancient: [D5, D5, C5, D5, G5, D5, C5, D5],
  classical: [Dm, G, Dm, C, Dm, G, F, C],
  exploration: [Dm, F, C, G, Dm, F, G, Dm],
  modern: [Dm7, G, Fmaj7, C, Dm7, Em7, Fmaj7, C],
};
export const CRISIS_PROGRESSION: readonly Chord[] = [Dm, Am, C, Dm, Dm, Am, F, Dm];
export const TEMPO: Record<Age, number> = { ancient: 70, classical: 78, exploration: 84, modern: 74 };

export interface Clock {
  beat: number;
  bar: number;
  /** Absolute start time of this phrase. */
  start: number;
  /** Chord sounding at absolute time t. */
  chordAt(t: number): Chord;
}

/** A chord tone of `c` nearest to `m` within a pitch set (falls back to m). */
const nearestChordTone = (c: Chord, m: number, set: readonly number[]): number => {
  const pcs = c.tones.map(pc);
  const cand = set.filter((x) => pcs.includes(pc(x)));
  if (!cand.length) return m;
  return cand.reduce((b, x) => (Math.abs(x - m) < Math.abs(b - m) ? x : b));
};

/** One bar of pad chord and bass: the harmonic floor everything else sits on. */
const harmony: Maker = (r, s, _w, k) => {
  const c = k.chordAt(k.start + 0.01);
  const notes: PhraseNote[] = [
    { at: 0, voice: 'pad', midi: c.tones[0] ?? N.D3, dur: k.bar * 1.15, gain: 0.8, chord: c.tones },
    { at: 0, voice: 'bass', midi: c.root, dur: k.bar * 0.95, gain: 0.85 },
  ];
  if (!s.crisis && chance(r, 0.5)) notes.push({ at: k.beat * 2.5, voice: 'bass', midi: c.root + 7 <= N.A3 && inKey(c.root + 7) ? c.root + 7 : c.root, dur: k.beat * 1.4, gain: 0.5 });
  return { notes, length: k.bar, rest: 0 };
};

const ARP_SHAPES: readonly (readonly number[])[] = [
  [0, 1, 2, 1, 0, 1, 2, 1],
  [0, 2, 1, 2, 0, 2, 1, 3],
  [0, 1, 2, 3, 2, 1, 0, 1],
];

/** Gentle eighth-note figure on the chord, some notes left out so it breathes. */
const arpeggio: Maker = (r, s, _w, k) => {
  const c = k.chordAt(k.start + 0.01);
  const up = c.tones.map((m) => (m < N.A3 ? m + 12 : m)).sort((a, b) => a - b);
  const shape = pick(r, ARP_SHAPES);
  const density = s.crisis ? 0.35 : s.age === 'ancient' ? 0.45 : s.age === 'modern' ? 0.6 : 0.7;
  const voice: VoiceId = s.age === 'modern' ? 'keys' : 'arp';
  const notes: PhraseNote[] = [];
  shape.forEach((idx, i) => {
    if (i > 0 && !chance(r, density)) return;
    notes.push({ at: i * k.beat * 0.5, voice, midi: at(up, idx), dur: k.beat * 1.2, gain: (i % 2 ? 0.55 : 0.75) * range(r, 0.85, 1), pan: i % 2 ? 0.2 : -0.2 });
  });
  return { notes, length: k.bar, rest: chance(r, s.crisis ? 0.5 : 0.25) ? k.bar : 0 };
};

type Hit = readonly [beat: number, voice: 'drum' | 'drumHi', accent: number];
const DRUM_PATTERNS: readonly (readonly Hit[])[] = [
  [[0, 'drum', 1], [1.5, 'drumHi', 0.5], [2, 'drum', 0.8], [3, 'drumHi', 0.5]],
  [[0, 'drum', 1], [0.75, 'drumHi', 0.4], [1.5, 'drumHi', 0.5], [2, 'drum', 0.7], [3.5, 'drumHi', 0.4]],
  [[0, 'drum', 1], [2, 'drum', 0.7], [3, 'drumHi', 0.35]],
];
const CRISIS_PATTERN: readonly Hit[] = [[0, 'drum', 1], [2, 'drum', 0.6]];

/** Hand drum: a soft frame-drum pulse (ancient every bar, later ages now and then). */
const handDrum: Maker = (r, s, _w, k) => {
  const bars = 2;
  const pattern = s.crisis ? CRISIS_PATTERN : pick(r, DRUM_PATTERNS);
  const notes: PhraseNote[] = [];
  for (let b = 0; b < bars; b++) {
    for (const [bt, voice, acc] of pattern) {
      notes.push({ at: (b * 4 + bt) * k.beat, voice, midi: voice === 'drum' ? N.D3 : N.A3, dur: voice === 'drum' ? 0.4 : 0.18, gain: acc * range(r, 0.75, 1), pan: voice === 'drumHi' ? 0.25 : -0.1 });
    }
  }
  const restBars = s.age === 'ancient' ? (chance(r, 0.3) ? 2 : 0) : pick(r, [2, 4, 6]);
  return { notes, length: bars * k.bar, rest: restBars * k.bar };
};

/**
 * The tune: one or two bars on a half-beat grid, strong beats on chord tones, a stepwise
 * line between, ending on a long chord tone. Then a bar or two of rest.
 */
const melody: Maker = (r, s, _w, k) => {
  const set = s.crisis ? keyNotes(N.A3, N.A4, DARK_PCS) : s.age === 'ancient' ? keyNotes(N.D4, N.D5, PENTA_PCS) : keyNotes(N.D4, N.E5);
  const voice: VoiceId = s.age === 'modern' ? 'bellMelody' : 'pluck';
  const bars = chance(r, 0.6) ? 2 : 1;
  const rhythms: readonly (readonly number[])[] = [
    [1, 1, 1, 1], [1.5, 0.5, 1, 1], [1, 0.5, 0.5, 2], [2, 1, 1], [0.5, 0.5, 1, 2], [1, 1, 2],
  ];
  const notes: PhraseNote[] = [];
  let idx = Math.floor(r() * set.length);
  let t = 0;
  for (let b = 0; b < bars; b++) {
    const rhythm = b === bars - 1 ? pick(r, rhythms.filter((x) => (x[x.length - 1] ?? 0) >= 2)) : pick(r, rhythms);
    for (const d of rhythm) {
      const when = k.start + t;
      const strong = Math.abs((t / k.beat) % 2) < 1e-6;
      let m = at(set, idx);
      if (strong) m = nearestChordTone(k.chordAt(when + 0.01), m, set);
      idx = set.indexOf(m) >= 0 ? set.indexOf(m) : idx;
      notes.push({ at: t, voice, midi: m, dur: Math.min(2.5, d * k.beat * 1.8), gain: (strong ? 0.85 : 0.65) * range(r, 0.85, 1) });
      idx = clampIdx(idx + pick(r, [-2, -1, -1, 1, 1, 2]), set.length);
      t += d * k.beat;
    }
  }
  return { notes, length: bars * k.bar, rest: pick(r, [1, 1, 2]) * k.bar * (s.crisis ? 1.5 : 1) };
};

/** A slow bowed counter-line on chord tones. */
const bowed: Maker = (r, s, _w, k) => {
  const c = k.chordAt(k.start + 0.01);
  const set = keyNotes(N.C3, N.D4);
  const m = nearestChordTone(c, pick(r, set), set);
  return {
    notes: [{ at: 0, voice: 'bowed', midi: m, dur: k.bar * 2, gain: range(r, 0.6, 0.85), pan: range(r, -0.3, 0.3) }],
    length: k.bar * 2,
    rest: pick(r, [2, 4, 6]) * k.bar * (s.crisis ? 1.5 : 1),
  };
};

const bells: Maker = (r, s, _w, k) => {
  const c = k.chordAt(k.start + 0.01);
  const set = keyNotes(N.D5, N.A5);
  return {
    notes: [{ at: 0, voice: 'bell', midi: nearestChordTone(c, pick(r, set), set), dur: 2.5, gain: range(r, 0.5, 0.8), pan: range(r, -0.5, 0.5) }],
    length: k.bar,
    rest: pick(r, [3, 5, 7]) * k.bar * (s.crisis ? 1.6 : 1),
  };
};

/** [stream id, source bus, maker]. 'bed' (harmony, pulse) is never ducked; 'base' melody steps back as cultures come in. */
const BASE_STREAMS: Record<Age, readonly (readonly [string, 'bed' | 'base', Maker])[]> = {
  ancient: [['harmony', 'bed', harmony], ['arp', 'bed', arpeggio], ['drum', 'bed', handDrum], ['melody', 'base', melody]],
  classical: [['harmony', 'bed', harmony], ['arp', 'bed', arpeggio], ['drum', 'bed', handDrum], ['melody', 'base', melody], ['bowed', 'base', bowed]],
  exploration: [['harmony', 'bed', harmony], ['arp', 'bed', arpeggio], ['melody', 'base', melody], ['bowed', 'base', bowed], ['bell', 'base', bells]],
  modern: [['harmony', 'bed', harmony], ['arp', 'bed', arpeggio], ['melody', 'base', melody], ['bell', 'base', bells]],
};

// --- culture makers ---------------------------------------------------------------------------

const NO_B: readonly number[] = KEY_PCS.filter((p) => p !== 11);

/** Arghul: a reedy double pipe, melody over its own drone pipe, with quick upper-neighbour graces. */
const arghul: Maker = (r, s, w) => {
  const set = keyNotes(N.D4, N.A4);
  const { notes, length } = melodyLine(r, set, 'arghul', 4 + Math.floor(r() * 4), [0.35, 0.5, 0.5, 0.8], 0.6);
  const graced: PhraseNote[] = [];
  for (const n of notes) {
    const up = set.find((m) => m > n.midi);
    if (up !== undefined && n.at > 0.1 && chance(r, 0.35)) graced.push({ at: n.at - 0.07, voice: 'arghul', midi: up, dur: 0.09, gain: n.gain * 0.7 });
    graced.push(n);
  }
  graced.push({ at: 0, voice: 'arghulDrone', midi: N.D3, dur: length + 1, gain: 0.5 });
  return { notes: graced, length, rest: restFor(r, 3, 7, w, s.crisis) };
};

/** Lyre: a few bright plucks, sometimes as fifths. */
const lyre: Maker = (r, s, w) => {
  const set = keyNotes(N.D4, N.D5, NO_B);
  const { notes, length } = melodyLine(r, set, 'lyre', 3 + Math.floor(r() * 3), [0.4, 0.6, 0.8], 0.6);
  const extra: PhraseNote[] = notes.filter((n) => inKey(n.midi + 7) && pc(n.midi) !== 11 && chance(r, 0.3)).map((n) => ({ ...n, midi: n.midi + 7, gain: n.gain * 0.6, at: n.at + 0.012 }));
  return { notes: [...notes, ...extra], length, rest: restFor(r, 2.5, 6, w, s.crisis) };
};

/** Guzheng: pentatonic, with glissando hints and pressed bends. */
const guzheng: Maker = (r, s, w) => {
  const set = keyNotes(N.D4, N.D6, PENTA_PCS);
  const notes: PhraseNote[] = [];
  let t = 0;
  if (chance(r, 0.35)) {
    const start = Math.floor(r() * 3);
    const len = 5 + Math.floor(r() * 3);
    for (let k = 0; k < len; k++) {
      notes.push({ at: t, voice: 'guzheng', midi: at(set, start + k), dur: 1.0, gain: 0.25 + (0.3 * k) / len, pan: -0.3 + (0.6 * k) / len });
      t += 0.035;
    }
    t += 0.3;
  }
  const line = melodyLine(r, keyNotes(N.D4, N.A5, PENTA_PCS), 'guzheng', 2 + Math.floor(r() * 3), [0.45, 0.7, 0.9], 0.6);
  for (const n of line.notes) notes.push({ ...n, at: n.at + t });
  const lastNote = notes[notes.length - 1];
  if (lastNote && chance(r, 0.4)) {
    const bend = [2, 3].find((b) => set.includes(lastNote.midi + b));
    if (bend !== undefined) lastNote.bend = bend;
  }
  return { notes, length: t + line.length, rest: restFor(r, 3, 7, w, s.crisis) };
};

/** Oud: low, warm plucks with maqam bayati's half-flat E and risha tremolo figures. */
const oud: Maker = (r, s, w) => {
  const set = keyNotes(N.D3, N.D4, NO_B);
  const { notes, length } = melodyLine(r, set, 'oud', 4 + Math.floor(r() * 4), [0.35, 0.5, 0.5, 0.8], 0.65);
  const out: PhraseNote[] = [];
  for (const n of notes) {
    const halfFlat = pc(n.midi) === 4;
    const base: PhraseNote = halfFlat ? { ...n, cents: -50, ornament: true } : n;
    if (chance(r, 0.25) && n.dur < 1.2) {
      for (let k = 0; k < 3; k++) out.push({ ...base, at: n.at + k * 0.075, dur: 0.4, gain: base.gain * (1 - k * 0.2) });
    } else out.push(base);
  }
  return { notes: out, length, rest: restFor(r, 3, 7, w, s.crisis) };
};

/** Hardingfele: a lilting bowed tune over an open-string drone, sympathetic strings shimmering. */
const hardingfele: Maker = (r, s, w) => {
  const set = keyNotes(N.D4, N.A5);
  const lilt = [0.35, 0.45, 0.3];
  const pitches = walk(r, set, 4 + Math.floor(r() * 4));
  const notes: PhraseNote[] = [];
  let t = 0;
  pitches.forEach((midi, i) => {
    const d = (lilt[i % 3] ?? 0.4) * (i === pitches.length - 1 ? 3 : 1);
    notes.push({ at: t, voice: 'fiddle', midi, dur: d * 1.15, gain: range(r, 0.6, 0.85) });
    t += d;
  });
  notes.push({ at: 0, voice: 'fiddleDrone', midi: pick(r, [N.D4, N.A3]), dur: t + 0.4, gain: 0.45 });
  const top = pitches[pitches.length - 1] ?? N.D5;
  notes.push({ at: t * 0.5, voice: 'sympathetic', midi: top + 12, dur: t * 0.5 + 2.5, gain: 0.5 });
  return { notes, length: t, rest: restFor(r, 3, 7, w, s.crisis) };
};

/** Katajjaq: two interlocking breathy voices, voiced low tones against unvoiced breaths. */
const katajjaq: Maker = (r, s, w) => {
  const sp = range(r, 0.13, 0.16);
  const n = 12 + Math.floor(r() * 10);
  const patterns: readonly (readonly ('low' | 'breath')[])[] = [['low', 'breath'], ['low', 'low', 'breath'], ['low', 'breath', 'breath']];
  const pa = pick(r, patterns);
  const pb = pick(r, patterns);
  const lowA = pick(r, [N.D3, N.A3]);
  const lowB = pick(r, [N.A3, N.D4]);
  const notes: PhraseNote[] = [];
  for (let k = 0; k < n; k++) {
    const fade = Math.min(1, (k + 1) / 4, (n - k) / 3);
    const a = pa[k % pa.length];
    const b = pb[k % pb.length];
    notes.push({ at: k * sp, voice: a === 'low' ? 'throatLow' : 'throatBreath', midi: lowA, dur: sp * 0.8, gain: 0.7 * fade, pan: -0.35 });
    notes.push({ at: k * sp + sp / 2, voice: b === 'low' ? 'throatLow' : 'throatBreath', midi: lowB, dur: sp * 0.8, gain: 0.6 * fade, pan: 0.35 });
  }
  return { notes, length: n * sp, rest: restFor(r, 4, 9, w, s.crisis) };
};

/** Morin khuur: long bowed notes sliding up into pitch, an overtone whistle above. */
const morinKhuur: Maker = (r, s, w) => {
  const set = keyNotes(N.A3, N.D5);
  const pitches = walk(r, set, 2 + Math.floor(r() * 2), [-2, -1, 1, 2, 3]);
  const notes: PhraseNote[] = [];
  let t = 0;
  for (const midi of pitches) {
    const d = range(r, 1.2, 2.4);
    notes.push({ at: t, voice: 'khuur', midi, dur: d, gain: range(r, 0.6, 0.85), glide: pick(r, [-2, -1]) });
    t += d * 0.9;
  }
  const last = pitches[pitches.length - 1] ?? N.D4;
  notes.push({ at: t * 0.4, voice: 'overtone', midi: last + 24, dur: t * 0.6 + 0.5, gain: 0.5 });
  return { notes, length: t, rest: restFor(r, 3, 8, w, s.crisis) };
};

const GUITAR_CHORDS: readonly (readonly number[])[] = [
  [N.D3, N.A3, N.D4, N.F4, N.A4],
  [N.C3, N.G3, N.C4, N.E4, N.G4],
  [N.G2, N.D3, N.G3, N.B3, N.D4],
];
/** Nylon-string guitar: a short melody, sometimes a soft strum. */
const guitar: Maker = (r, s, w) => {
  const notes: PhraseNote[] = [];
  let t = 0;
  if (chance(r, 0.35)) {
    const chord = pick(r, GUITAR_CHORDS);
    chord.forEach((midi, i) => notes.push({ at: i * 0.018, voice: 'guitar', midi, dur: 1.6, gain: 0.35 + 0.05 * i }));
    t = 0.9;
  }
  const line = melodyLine(r, keyNotes(N.G3, N.D5), 'guitar', 4 + Math.floor(r() * 4), [0.3, 0.45, 0.6], 0.6);
  for (const n of line.notes) notes.push({ ...n, at: n.at + t });
  return { notes, length: t + line.length, rest: restFor(r, 3, 7, w, s.crisis) };
};

export const CULTURE_MAKERS: Record<Instrument, Maker> = {
  arghul, lyre, guzheng, oud, hardingfele, katajjaq, morin_khuur: morinKhuur, guitar,
};

/** 'arab_oud' -> 'oud'; unknown instruments fall back to the lyre. */
export const instrumentForStem = (stem: string): Instrument => {
  const suffix = stem.includes('_') ? stem.slice(stem.indexOf('_') + 1) : stem;
  return (INSTRUMENTS as readonly string[]).includes(suffix) ? (suffix as Instrument) : 'lyre';
};

// --- the composer -----------------------------------------------------------------------------

interface Stream {
  source: string;
  nextAt: number;
  weight: number;
  make: Maker;
  /** Phrase starts snap to this grid: bars for the bed and tune, beats for culture stems. */
  grid: 'bar' | 'beat';
}

export class Composer {
  private readonly streams = new Map<string, Stream>();
  private scene: ComposerScene | null = null;
  private origin = 0;
  private tempoKey = '';

  constructor(private readonly rand: Rand) {}

  get activeStreams(): string[] {
    return [...this.streams.keys()];
  }

  /** Seconds per beat in the current scene. */
  get beat(): number {
    if (!this.scene) return 60 / TEMPO.ancient;
    return 60 / (TEMPO[this.scene.age] * (this.scene.crisis ? 0.85 : 1));
  }

  chordAt(t: number): Chord {
    const s = this.scene;
    const prog = !s ? PROGRESSIONS.ancient : s.crisis ? CRISIS_PROGRESSION : PROGRESSIONS[s.age];
    const bar = this.beat * 4;
    const i = Math.floor((t - this.origin) / bar + 1e-6);
    return at(prog, ((i % prog.length) + prog.length) % prog.length);
  }

  private snap(t: number, grid: 'bar' | 'beat'): number {
    const g = this.beat * (grid === 'bar' ? 4 : 1);
    return this.origin + Math.ceil((t - this.origin) / g - 1e-6) * g;
  }

  setScene(scene: ComposerScene, now: number): void {
    const key = `${scene.age}|${scene.crisis}`;
    this.scene = scene;
    if (key !== this.tempoKey) {
      // New tempo or progression: restart the grid (and the progression) just after now.
      this.tempoKey = key;
      this.origin = now + 0.1;
    }
    const wanted = new Map<string, Omit<Stream, 'nextAt'>>();
    for (const [id, source, make] of BASE_STREAMS[scene.age]) wanted.set(`base:${id}`, { source, weight: 1, make, grid: 'bar' });
    for (const c of scene.cultures) {
      if (c.weight >= CULTURE_THRESHOLD) wanted.set(`culture:${c.id}`, { source: c.id, weight: c.weight, make: CULTURE_MAKERS[c.instrument], grid: 'beat' });
    }
    for (const id of [...this.streams.keys()]) if (!wanted.has(id)) this.streams.delete(id);
    for (const [id, w] of wanted) {
      const s = this.streams.get(id);
      if (s) {
        Object.assign(s, w);
        if (s.nextAt < now) s.nextAt = now;
      } else {
        // The bed starts at once; the tune and culture stems come in a little later.
        const delay = w.source === 'bed' ? 0 : w.source === 'base' ? range(this.rand, 1, 4) * this.beat : range(this.rand, 2, 8) * this.beat;
        this.streams.set(id, { ...w, nextAt: now + delay });
      }
    }
  }

  reset(): void {
    this.streams.clear();
    this.scene = null;
    this.tempoKey = '';
  }

  /** All notes of phrases starting before `until`, sorted by time. */
  generate(until: number): NoteEvent[] {
    const scene = this.scene;
    if (!scene) return [];
    const out: NoteEvent[] = [];
    const beat = this.beat;
    for (const s of this.streams.values()) {
      for (;;) {
        const start = this.snap(s.nextAt, s.grid);
        if (start >= until) break;
        const clock: Clock = { beat, bar: beat * 4, start, chordAt: (t) => this.chordAt(t) };
        // Lightly-held cultures sometimes sit a phrase out.
        const play = s.source === 'bed' || s.source === 'base' || this.rand() < 0.4 + 0.6 * Math.min(1, s.weight);
        const p = s.make(this.rand, scene, s.weight, clock);
        if (play) for (const n of p.notes) out.push({ ...n, t: start + Math.max(0, n.at), source: s.source });
        s.nextAt = start + Math.max(beat * 0.5, p.length + p.rest);
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }
}
