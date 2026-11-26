import { describe, expect, it } from 'vitest';
import { audio } from '../src/audio';
import { audioContextCtor, toPlayerScene, WebAudioEngine } from '../src/audio/engine';
import { busGains, volumeToGain, AMBIENCE_LEVEL } from '../src/audio/levels';
import { envAt, envPoints, withGrains } from '../src/audio/envelope';
import { karplusStrong, noiseSamples, reverbImpulse, softClip, softClipCurve } from '../src/audio/dsp';
import { mulberry32 } from '../src/audio/random';
import { activeRange, dbfs, dcOffset, maxJump, peak, quietJump, rms, spectrum } from '../src/audio/analysis';
import { mtof, note, inKey, quantize, degree } from '../src/audio/theory';

describe('audio engine without Web Audio', () => {
  it('has no AudioContext constructor in Node', () => {
    expect(audioContextCtor()).toBeNull();
  });

  it('every public method is a safe no-op before and after unlock', () => {
    expect(() => {
      audio.play('tap');
      audio.playEvents([{ type: 'turnStarted', turn: 1 }], 'p1');
      audio.setAmbience({ age: 'ancient', cultures: { greek: 1 }, crisis: true });
      audio.setSettings({ sfxVolume: 50, musicVolume: 50, muted: false });
      audio.suspend();
      audio.resume();
      audio.unlock();
      audio.play('wonder');
      audio.setAmbience({ age: null });
    }).not.toThrow();
  });

  it('reports a locked state with no voices', () => {
    const e = new WebAudioEngine();
    e.unlock();
    expect(e.stats()).toEqual({ state: 'locked', sfxVoices: 0, ambienceVoices: 0, plucksCached: 0 });
  });
});

describe('settings mapping', () => {
  it('maps 0–100 perceptually and clamps', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(100)).toBe(1);
    expect(volumeToGain(50)).toBeCloseTo(0.25);
    expect(volumeToGain(-10)).toBe(0);
    expect(volumeToGain(150)).toBe(1);
    expect(volumeToGain(Number.NaN)).toBe(0);
    for (let v = 1; v <= 100; v++) expect(volumeToGain(v)).toBeGreaterThan(volumeToGain(v - 1));
  });

  it('mute silences both buses; ambience sits under the effects', () => {
    expect(busGains({ sfxVolume: 80, musicVolume: 80, muted: true })).toEqual({ sfx: 0, music: 0 });
    const g = busGains({ sfxVolume: 100, musicVolume: 100, muted: false });
    expect(g.sfx).toBe(1);
    expect(g.music).toBeCloseTo(AMBIENCE_LEVEL);
    expect(g.music).toBeLessThan(g.sfx);
  });
});

describe('ambience scene mapping', () => {
  it('maps culture ids to instruments from content and drops unknown or faint ones', () => {
    const s = toPlayerScene({ age: 'classical', cultures: { greek: 0.7, arab: 0.3, atlantis: 1, inuit: 0.01 }, crisis: true });
    expect(s).toEqual({
      age: 'classical',
      crisis: true,
      cultures: [
        { id: 'greek', instrument: 'lyre', weight: 0.7 },
        { id: 'arab', instrument: 'oud', weight: 0.3 },
      ],
    });
    expect(toPlayerScene({ age: null })).toBeNull();
  });

  it('knows every playable culture', () => {
    const ids = ['egyptian', 'greek', 'chinese', 'arab', 'norse', 'inuit', 'mongol', 'spanish'];
    const s = toPlayerScene({ age: 'ancient', cultures: Object.fromEntries(ids.map((id) => [id, 1])) });
    expect(new Set(s?.cultures.map((c) => c.instrument)).size).toBe(4); // capped at four stems
    for (const id of ids) expect(toPlayerScene({ age: 'ancient', cultures: { [id]: 1 } })?.cultures).toHaveLength(1);
  });
});

describe('theory', () => {
  it('names notes and checks D dorian', () => {
    expect(note('D4')).toBe(62);
    expect(note('A4')).toBe(69);
    expect(mtof(69)).toBeCloseTo(440);
    expect(['D', 'E', 'F', 'G', 'A', 'B', 'C'].every((l) => inKey(note(`${l}4`)))).toBe(true);
    expect(inKey(note('F#4'))).toBe(false);
    expect(inKey(note('Bb3'))).toBe(false);
    expect(quantize(66)).toBe(65);
    expect(degree(0)).toBe(62);
    expect(degree(7)).toBe(74);
    expect(degree(-1)).toBe(60);
  });
});

describe('envelopes', () => {
  it('always start and end at exactly zero and peak at the gain', () => {
    for (const shape of [
      { kind: 'perc', attack: 0.002 } as const,
      { kind: 'adsr', attack: 0.3, decay: 0.2, sustain: 0.6, release: 0.4 } as const,
    ]) {
      for (const dur of [0.05, 0.3, 2]) {
        const pts = envPoints(shape, dur, 0.7);
        expect(pts[0]).toEqual([0, 0]);
        expect(pts[pts.length - 1]?.[1]).toBe(0);
        expect(pts[pts.length - 1]?.[0]).toBeCloseTo(dur);
        expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(0.7);
        for (let i = 1; i < pts.length; i++) expect(pts[i]![0]).toBeGreaterThanOrEqual(pts[i - 1]![0]);
      }
    }
  });

  it('grains add crackle without breaking the zero ends', () => {
    const base = envPoints({ kind: 'adsr', attack: 0.05, decay: 0.05, sustain: 0.6, release: 0.1 }, 0.3, 0.5);
    const pts = withGrains(base, [[0.1, 1], [0.15, 0.5]], 0.5);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]?.[1]).toBe(0);
    expect(envAt(pts, 0.1)).toBeGreaterThan(envAt(base, 0.1));
    for (let i = 1; i < pts.length; i++) expect(pts[i]![0]).toBeGreaterThanOrEqual(pts[i - 1]![0]);
  });
});

describe('dsp', () => {
  it('noise is zero-mean, normalised and loops without a seam', () => {
    for (const color of ['white', 'pink', 'brown'] as const) {
      const x = noiseSamples(color, 48000, mulberry32(3));
      expect(Math.abs(dcOffset([x]))).toBeLessThan(1e-4);
      expect(peak([x])).toBeCloseTo(0.9);
      // The loop seam is no bigger than an ordinary step inside the buffer.
      const seam = Math.abs((x[0] ?? 0) - (x[x.length - 1] ?? 0));
      expect(seam).toBeLessThanOrEqual(maxJump(x) + 1e-6);
    }
  });

  it('Karplus-Strong strings start at 0, decay, and are on pitch', () => {
    for (const f of [mtof(50), mtof(69), mtof(86)]) {
      const sr = 48000;
      const ks = karplusStrong(sr, f, 1, 0.5, 0.8, mulberry32(1));
      expect(Math.abs(ks.data[0] ?? 1)).toBe(0);
      expect(Math.abs(ks.data[ks.data.length - 1] ?? 1)).toBe(0);
      expect(peak([ks.data])).toBeCloseTo(1);
      expect(rms([ks.data], sr * 0.7)).toBeLessThan(rms([ks.data], 0, sr * 0.2));
      // Generated period N + 0.5 times the playback rate gives exactly f.
      const n = Math.floor(sr / f - 0.5);
      expect((sr / (n + 0.5)) * ks.rate).toBeCloseTo(f, 6);
      expect(Math.abs(ks.rate - 1)).toBeLessThan(0.02);
    }
  });

  it('soft clip is linear below the knee and never exceeds -1 dBFS', () => {
    expect(softClip(0.3)).toBe(0.3);
    expect(softClip(-0.5)).toBe(-0.5);
    expect(softClip(10)).toBeLessThanOrEqual(0.891);
    expect(dbfs(softClip(100))).toBeLessThanOrEqual(-1);
    const c = softClipCurve(513, 2);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!);
    expect(Math.max(...c)).toBeLessThanOrEqual(0.891);
  });

  it('reverb impulse decays and is zero-mean', () => {
    const [l, r] = reverbImpulse(8000, 1.8, mulberry32(2));
    expect(l.length).toBe(14400);
    expect(rms([l], 12000)).toBeLessThan(rms([l], 0, 2000) / 20);
    expect(Math.abs(dcOffset([l, r]))).toBeLessThan(1e-3);
  });
});

describe('analysis', () => {
  const sr = 8000;
  const sine = (f: number, n: number, a = 0.5): Float32Array => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / sr));

  it('measures peak, rms and range', () => {
    const x = sine(440, sr);
    expect(peak([x])).toBeCloseTo(0.5, 2);
    expect(rms([x])).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(activeRange([new Float32Array(10)], 0.001)).toBeNull();
  });

  it('finds the spectral centroid of a sine', () => {
    expect(spectrum(sine(1000, sr), sr).centroid).toBeGreaterThan(900);
    expect(spectrum(sine(1000, sr), sr).centroid).toBeLessThan(1100);
  });

  it('detects a click in silence but not a smooth tone', () => {
    const x = new Float32Array(sr);
    expect(quietJump(x, sr)).toBe(0);
    x[4000] = 0.3;
    expect(quietJump(x, sr)).toBeGreaterThan(0.2);
    expect(maxJump(sine(100, sr, 0.1))).toBeLessThan(0.01);
  });
});
