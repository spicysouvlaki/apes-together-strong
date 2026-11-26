/**
 * Service worker registration (main thread). The service worker precaches the whole build so
 * the game runs offline after the first visit (GDD §12).
 *
 * Updates use the 'prompt' strategy (vite.config.ts): a new version waits until the UI calls
 * `applyUpdate()`, so a deploy never reloads the page in the middle of a game. The worker keeps
 * 'auto:0' equal to the latest state (src/worker/host.ts), so reloading is safe at any time;
 * the UI applies an update on the title screen at once, in a game at the next turn start.
 *
 * How a new deploy reaches a player (GitHub Pages, served from /apes-together-strong/):
 * - The browser re-fetches sw.js on every page load, bypassing the HTTP cache (Pages sends
 *   max-age=600, but service worker scripts ignore it by default), and we also check once an
 *   hour while the app stays open (a Home Screen app can stay open for days).
 * - A changed sw.js installs, precaches the new build next to the old one and waits. The old
 *   index.html keeps being served until then, which is what keeps the old JS chunks working.
 * - `onNeedRefresh` fires (also on the next launch if a version is already waiting), the UI shows
 *   "Update ready" and calls applyUpdate(): skipWaiting, then a reload onto the new build.
 *   Nothing can pin a player to an old build: every launch re-checks and the title screen applies
 *   at once.
 *
 * Forcing a refresh (testers): open the game with `?reset-sw` appended
 * (…/apes-together-strong/?reset-sw). That unregisters the service worker and deletes its caches
 * (saves live in IndexedDB and are kept), then reloads the clean URL. On desktop, DevTools >
 * Application > Service workers > "Update on reload" does the same.
 */

export interface PwaHandlers {
  /** A new version is downloaded and waiting. */
  onUpdateReady?: () => void;
  /** Everything is cached; the game now works offline. */
  onOfflineReady?: () => void;
}

const UPDATE_CHECK_MS = 60 * 60 * 1000;

let update: ((reload?: boolean) => Promise<void>) | null = null;

/** `?reset-sw`: drop the service worker and its caches (not the saves), then reload clean. */
const resetIfAsked = async (): Promise<boolean> => {
  const url = new URL(location.href);
  if (!url.searchParams.has('reset-sw')) return false;
  try {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    if ('caches' in globalThis) for (const k of await caches.keys()) await caches.delete(k);
  } catch (err) {
    console.warn('Service worker reset failed', err);
  }
  url.searchParams.delete('reset-sw');
  location.replace(url.toString());
  return true;
};

export const registerServiceWorker = async (handlers: PwaHandlers = {}): Promise<boolean> => {
  // Dev server and Vitest: no service worker (it would cache stale modules).
  if (import.meta.env?.DEV || import.meta.env?.MODE === 'test') return false;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    if (await resetIfAsked()) return false;
    const { registerSW } = await import('virtual:pwa-register');
    update = registerSW({
      immediate: true,
      onNeedRefresh: () => handlers.onUpdateReady?.(),
      onOfflineReady: () => handlers.onOfflineReady?.(),
      onRegisteredSW: (_url, registration) => {
        if (!registration) return;
        setInterval(() => {
          if (navigator.onLine === false || registration.installing) return;
          registration.update().catch(() => undefined); // offline or Pages hiccup: try next hour
        }, UPDATE_CHECK_MS);
      },
    });
    return true;
  } catch (err) {
    console.warn('Service worker registration failed', err);
    return false;
  }
};

/** Activate the waiting version and reload. Call at a safe point (title screen or turn start). */
export const applyUpdate = async (): Promise<void> => {
  await update?.(true);
};
