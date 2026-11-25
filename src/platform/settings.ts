/**
 * Player settings in localStorage (main thread). Every read is sanitized and every storage
 * access is guarded: private mode, a full quota or corrupt JSON fall back to defaults.
 */
import type { GameSetup } from '@contracts/sim-api';

export interface Settings {
  /** UI text scale in percent, 85–150 (GDD §11 accessibility). */
  textScale: number;
  reduceMotion: boolean;
  /** Patterns in addition to colors on borders, units and charts. */
  colorblindPatterns: boolean;
  /** Sound-effect and ambience volumes, 0–100; `muted` silences both. */
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  /** The last game setup, to prefill the setup screen. */
  lastSetup: GameSetup | null;
}

export const TEXT_SCALE_MIN = 85;
export const TEXT_SCALE_MAX = 150;
const KEY = 'apes.settings.v1';

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const prefersReducedMotion = (): boolean => {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export const defaultSettings = (): Settings => ({
  textScale: 100,
  reduceMotion: prefersReducedMotion(),
  colorblindPatterns: false,
  sfxVolume: 80,
  musicVolume: 50,
  muted: false,
  lastSetup: null,
});

/** localStorage if usable, else null (Node, workers, blocked storage). */
export const browserStorage = (): KeyValueStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const isSetup = (v: unknown): v is GameSetup => {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<GameSetup>;
  return typeof s.seed === 'number' && typeof s.mapSize === 'string' && typeof s.speed === 'string' && Array.isArray(s.players);
};

/** Coerce anything into valid Settings, keeping each valid field. */
export const sanitizeSettings = (value: unknown): Settings => {
  const d = defaultSettings();
  if (!value || typeof value !== 'object') return d;
  const v = value as Record<string, unknown>;
  const vol = (x: unknown, fallback: number): number =>
    typeof x === 'number' && Number.isFinite(x) ? Math.min(100, Math.max(0, Math.round(x))) : fallback;
  const scale = typeof v.textScale === 'number' && Number.isFinite(v.textScale) ? Math.round(v.textScale) : d.textScale;
  return {
    textScale: Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, scale)),
    reduceMotion: typeof v.reduceMotion === 'boolean' ? v.reduceMotion : d.reduceMotion,
    colorblindPatterns: typeof v.colorblindPatterns === 'boolean' ? v.colorblindPatterns : d.colorblindPatterns,
    sfxVolume: vol(v.sfxVolume, d.sfxVolume),
    musicVolume: vol(v.musicVolume, d.musicVolume),
    muted: typeof v.muted === 'boolean' ? v.muted : d.muted,
    lastSetup: isSetup(v.lastSetup) ? v.lastSetup : null,
  };
};

export const loadSettings = (storage: KeyValueStorage | null = browserStorage()): Settings => {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : defaultSettings();
  } catch {
    return defaultSettings();
  }
};

/** Returns the sanitized settings that were (attempted to be) stored. */
export const saveSettings = (settings: Settings, storage: KeyValueStorage | null = browserStorage()): Settings => {
  const clean = sanitizeSettings(settings);
  try {
    storage?.setItem(KEY, JSON.stringify(clean));
  } catch {
    // Quota or private mode: settings simply don't persist this session.
  }
  return clean;
};

export const updateSettings = (patch: Partial<Settings>, storage: KeyValueStorage | null = browserStorage()): Settings =>
  saveSettings({ ...loadSettings(storage), ...patch }, storage);
