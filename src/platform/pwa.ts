/**
 * Service worker registration (main thread). The service worker precaches the whole build so
 * the game runs offline after the first visit (GDD §12).
 *
 * Updates use the 'prompt' strategy (vite.config.ts): a new version waits until the UI calls
 * `applyUpdate()`, so a deploy never reloads the page in the middle of a game. Autosaves make
 * reloading safe at a turn boundary; the UI should offer "Update ready" there.
 */

export interface PwaHandlers {
  /** A new version is downloaded and waiting. */
  onUpdateReady?: () => void;
  /** Everything is cached; the game now works offline. */
  onOfflineReady?: () => void;
}

let update: ((reload?: boolean) => Promise<void>) | null = null;

export const registerServiceWorker = async (handlers: PwaHandlers = {}): Promise<boolean> => {
  // Dev server and Vitest: no service worker (it would cache stale modules).
  if (import.meta.env?.DEV || import.meta.env?.MODE === 'test') return false;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    update = registerSW({
      immediate: true,
      onNeedRefresh: () => handlers.onUpdateReady?.(),
      onOfflineReady: () => handlers.onOfflineReady?.(),
    });
    return true;
  } catch (err) {
    console.warn('Service worker registration failed', err);
    return false;
  }
};

/** Activate the waiting version and reload. Call at a safe point (after an autosave). */
export const applyUpdate = async (): Promise<void> => {
  await update?.(true);
};
