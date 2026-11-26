/**
 * Handing a file or a text to the player (save export, Chronicle share). iPhone Safari blocks a
 * download or share started after an async step (the tap's user activation has expired), so:
 * use the Web Share sheet with a file when the browser can share files, else a download link;
 * when the tap is no longer "fresh", the caller shows a second button so the next tap is.
 */

export type HandOff = 'share' | 'download';

export interface ShareCaps {
  share?: ((data: ShareData) => Promise<void>) | undefined;
  canShare?: ((data?: ShareData) => boolean) | undefined;
}

/** How a file can be handed over on this browser (pure; `caps` is `navigator`). */
export const fileHandOff = (caps: ShareCaps, file: File | null): HandOff => {
  if (!file || typeof caps.share !== 'function' || typeof caps.canShare !== 'function') return 'download';
  try {
    return caps.canShare({ files: [file] }) ? 'share' : 'download';
  } catch {
    return 'download';
  }
};

/** Is the current tap still allowed to open a share sheet / start a download? */
export const tapStillFresh = (): boolean => {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  // Without the API we cannot know: assume not, and ask for one more tap.
  return !!ua?.isActive;
};

export type HandOffResult = { kind: 'shared' } | { kind: 'cancelled' } | { kind: 'downloaded' } | { kind: 'failed'; message: string };

/** Offers `text` as a download (iOS shows its "Save to Files" sheet). */
export const downloadText = (fileName: string, text: string, type = 'application/json'): void => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari needs the URL alive until the download sheet has read it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/** Share the file through the share sheet, or download it. Must run inside a tap. */
export const handOffFile = async (fileName: string, text: string, title: string, type = 'application/json'): Promise<HandOffResult> => {
  const file = typeof File === 'function' ? new File([text], fileName, { type }) : null;
  if (fileHandOff(navigator, file) === 'share' && file) {
    try {
      await navigator.share({ files: [file], title });
      return { kind: 'shared' };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return { kind: 'cancelled' };
      // NotAllowedError (activation expired) or no share target: fall back to the download.
    }
  }
  try {
    downloadText(fileName, text, type);
    return { kind: 'downloaded' };
  } catch (err) {
    return { kind: 'failed', message: err instanceof Error ? err.message : String(err) };
  }
};

/** Share a plain text (Chronicle). Falls back to the clipboard. Must run inside a tap. */
export const shareText = async (title: string, text: string): Promise<'shared' | 'cancelled' | 'copied' | 'failed'> => {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
};

/** What to tell the player after a hand-off. */
export const handOffMessage = (r: HandOffResult, fileName: string): { text: string; tone: 'good' | 'info' | 'bad' } => {
  switch (r.kind) {
    case 'shared':
      return { text: `Shared ${fileName}. Choose "Save to Files" to keep it safe.`, tone: 'good' };
    case 'cancelled':
      return { text: 'Export cancelled. Nothing was saved.', tone: 'info' };
    case 'downloaded':
      return { text: `Downloading ${fileName}. On iPhone it lands in Files > Downloads.`, tone: 'good' };
    case 'failed':
      return { text: `Export failed: ${r.message}`, tone: 'bad' };
  }
};
