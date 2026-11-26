/**
 * The one shared key: D dorian (D E F G A B C). Every pitched sound and the ambience use it,
 * so overlapping one-shots and the bed always harmonise. Dorian keeps the warmth of minor
 * with the bright raised sixth (B) that gives the IV chord (G major) its lift; we lean on
 * that for the age-end cadence (IV -> i). Pure; safe in Node.
 */

export const TONIC_PC = 2; // D
export const DORIAN_STEPS = [0, 2, 3, 5, 7, 9, 10] as const;
export const KEY_PCS: readonly number[] = DORIAN_STEPS.map((s) => (TONIC_PC + s) % 12);

/** Pitch class of a MIDI note. */
export const pc = (midi: number): number => ((Math.round(midi) % 12) + 12) % 12;

/** True for an integer MIDI note in D dorian. */
export const inKey = (midi: number): boolean => Number.isInteger(midi) && KEY_PCS.includes(pc(midi));

export const mtof = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'D4' -> 62. Accepts b/# accidentals; throws on a malformed name. */
export const note = (name: string): number => {
  const m = /^([A-G])([b#]?)(-?\d)$/.exec(name);
  const letter = m?.[1];
  const oct = m?.[3];
  if (!m || letter === undefined || oct === undefined) throw new Error(`bad note name: ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(oct) + 1) + (LETTER[letter] ?? 0) + acc;
};

/** Dorian scale degree (0 = D at `base`) to MIDI; negative degrees go down. */
export const degree = (d: number, base = 62): number => {
  const oct = Math.floor(d / 7);
  const i = d - oct * 7;
  return base + 12 * oct + (DORIAN_STEPS[i] ?? 0);
};

/** Nearest in-key MIDI note (ties go down). */
export const quantize = (midi: number): number => {
  const r = Math.round(midi);
  for (let k = 0; k <= 2; k++) {
    if (inKey(r - k)) return r - k;
    if (inKey(r + k)) return r + k;
  }
  return r;
};

/** In-key notes between lo and hi inclusive. */
export const keyNotes = (lo: number, hi: number, pcs: readonly number[] = KEY_PCS): number[] => {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(pc(m))) out.push(m);
  return out;
};

/** D "shang" pentatonic inside the key: D E G A C — no semitones, consonant with anything. */
export const PENTA_PCS: readonly number[] = [2, 4, 7, 9, 0];
/** Crisis colour: drop the bright B and lean on F/C (the minor side of the mode). */
export const DARK_PCS: readonly number[] = [2, 4, 5, 7, 9, 0];

// Named notes used throughout the recipes (all in key).
export const N = {
  D2: 38, E2: 40, F2: 41, G2: 43, A2: 45, B2: 47, C3: 48,
  D3: 50, E3: 52, F3: 53, G3: 55, A3: 57, B3: 59, C4: 60,
  D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71, C5: 72,
  D5: 74, E5: 76, F5: 77, G5: 79, A5: 81, B5: 83, C6: 84,
  D6: 86, E6: 88, G6: 91, A6: 93, D7: 98,
} as const;
