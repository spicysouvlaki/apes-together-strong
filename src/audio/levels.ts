/**
 * Settings -> bus gains. Sliders are 0–100; loudness is perceived roughly logarithmically, so
 * a squared curve makes the slider feel even (50 is about -12 dB, not -6 dB). Pure.
 */
import type { AudioSettings } from './types';

/**
 * Music bus level at slider 100. At the default 50 (-12 dB) the bed sits around -32 dBFS RMS:
 * clearly audible, ~10 dB under event sounds.
 */
export const AMBIENCE_LEVEL = 0.9;
export const SFX_LEVEL = 1;
/** Seconds for setSettings ramps (a slider drag never zips). */
export const SETTINGS_RAMP = 0.08;
/** Max simultaneous SFX voices; the oldest is stolen beyond this. */
export const MAX_SFX_VOICES = 12;

export const volumeToGain = (v: number): number => {
  if (!Number.isFinite(v)) return 0;
  const x = Math.min(100, Math.max(0, v)) / 100;
  return x * x;
};

export const busGains = (s: AudioSettings): { sfx: number; music: number } =>
  s.muted ? { sfx: 0, music: 0 } : { sfx: volumeToGain(s.sfxVolume) * SFX_LEVEL, music: volumeToGain(s.musicVolume) * AMBIENCE_LEVEL };

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { sfxVolume: 80, musicVolume: 50, muted: false };
