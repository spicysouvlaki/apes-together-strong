/**
 * UI-only preferences that are not part of the platform Settings (src/platform/settings.ts is
 * not the UI's to change). Stored in localStorage; every access is guarded and sanitized.
 */
import { signal } from '@preact/signals';

export interface UiPrefs {
  /** Show the combat preview sheet before every attack (default on). Off: tap once to preview, again to attack. */
  confirmAttacks: boolean;
}

const KEY = 'apes.uiprefs.v1';

export const defaultUiPrefs = (): UiPrefs => ({ confirmAttacks: true });

export const sanitizeUiPrefs = (v: unknown): UiPrefs => {
  const d = defaultUiPrefs();
  if (!v || typeof v !== 'object') return d;
  const o = v as Record<string, unknown>;
  return { confirmAttacks: typeof o.confirmAttacks === 'boolean' ? o.confirmAttacks : d.confirmAttacks };
};

const load = (): UiPrefs => {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    return sanitizeUiPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultUiPrefs();
  }
};

export const uiPrefs = signal<UiPrefs>(load());

export const patchUiPrefs = (patch: Partial<UiPrefs>): void => {
  uiPrefs.value = sanitizeUiPrefs({ ...uiPrefs.value, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(uiPrefs.value));
  } catch {
    // Storage blocked: the choice lasts for this session.
  }
};
