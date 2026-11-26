/**
 * Settings -> bus gains. Sliders are 0–100; loudness is perceived roughly logarithmically, so
 * a squared curve makes the slider feel even (50 is about -12 dB, not -6 dB). Pure.
 */
import type { AudioSettings } from './types';

/**
 * Music bus level at slider 100. At the default 50 (-12 dB) the bed sits around -32 LUFS
 * short-term (mix review, mixreview.ts): clearly there, with every effect at least 8 dB over it
 * (interface clicks at least 4 dB). Too loud or too quiet overall: change this first.
 */
export const AMBIENCE_LEVEL = 0.4;
/** Effects bus level at slider 100 (default 80 = 0.8). Per-sound balance: `trimDb` in recipes.ts. */
export const SFX_LEVEL = 1.25;
/** Seconds for setSettings ramps (a slider drag never zips). */
export const SETTINGS_RAMP = 0.08;
/** Max simultaneous SFX voices; the oldest is stolen beyond this. A planned batch is at most 5, plus taps; 8 keeps the worst-case SFX source count near 150 (CPU). */
export const MAX_SFX_VOICES = 8;

export const volumeToGain = (v: number): number => {
  if (!Number.isFinite(v)) return 0;
  const x = Math.min(100, Math.max(0, v)) / 100;
  return x * x;
};

export const busGains = (s: AudioSettings): { sfx: number; music: number } =>
  s.muted ? { sfx: 0, music: 0 } : { sfx: volumeToGain(s.sfxVolume) * SFX_LEVEL, music: volumeToGain(s.musicVolume) * AMBIENCE_LEVEL };

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { sfxVolume: 80, musicVolume: 50, muted: false };
