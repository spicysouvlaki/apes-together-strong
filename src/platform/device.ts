/**
 * Device capability checks (main thread). All guarded so they return a safe answer in Node.
 */

export const hasWebGL2 = (): boolean => {
  try {
    if (typeof document !== 'undefined') return !!document.createElement('canvas').getContext('webgl2');
    if (typeof OffscreenCanvas !== 'undefined') return !!new OffscreenCanvas(1, 1).getContext('webgl2');
  } catch {
    // fall through
  }
  return false;
};

/** Launched from the Home Screen (iOS `navigator.standalone`) or as an installed PWA elsewhere. */
export const isStandalone = (): boolean => {
  try {
    if (typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    return typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
};

export const isIOS = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS reports a Mac UA; touch points give it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
};

export interface StorageInfo {
  usage: number;
  quota: number;
  persisted: boolean;
}

export const storageEstimate = async (): Promise<StorageInfo | null> => {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    return { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted };
  } catch {
    return null;
  }
};

export interface DeviceReport {
  webgl2: boolean;
  standalone: boolean;
  ios: boolean;
  storage: StorageInfo | null;
}

export const deviceReport = async (): Promise<DeviceReport> => ({
  webgl2: hasWebGL2(),
  standalone: isStandalone(),
  ios: isIOS(),
  storage: await storageEstimate(),
});
