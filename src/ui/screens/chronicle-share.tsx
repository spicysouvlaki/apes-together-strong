/**
 * Share the Chronicle: the whole story as text (Web Share, else the clipboard), and the header
 * card as an image. The image is drawn on a canvas from the SVG already on screen (banner,
 * portraits) plus canvas text in the game's typefaces; no DOM screenshot library. Preparing it
 * is async, so a second tap hands it over (iPhone Safari blocks a share after an async step).
 */
import { useState } from 'preact/hooks';
import { pushToast } from '../store';
import { Icon } from '../art/Icon';
import { shareText } from '../shell/share-file';
import { cap, openingLine, shareSummary, type StoryInput } from './shared/chronicle-story';

type ImgState = { stage: 'idle' } | { stage: 'making' } | { stage: 'ready'; blob: Blob; name: string } | { stage: 'failed' };

const W = 1080;
const H = 1350;

const svgImage = (svg: SVGSVGElement, w: number, h: number): Promise<HTMLImageElement> => {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = url;
  });
};

const wrap = (ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
};

/** Draw the header card. Returns a PNG blob. */
export const makeCard = async (story: StoryInput): Promise<Blob> => {
  await document.fonts?.ready;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas');
  // Vellum, darkened margins, a double rule.
  ctx.fillStyle = '#efe3c8';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.4, W * 0.3, W / 2, H * 0.45, W * 0.95);
  g.addColorStop(0, 'rgba(248,240,220,0)');
  g.addColorStop(1, 'rgba(150,105,45,0.32)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(60,42,22,0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(44, 44, W - 88, H - 88);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(56, 56, W - 112, H - 112);

  let y = 110;
  const banner = document.querySelector<SVGSVGElement>('.scr-chron-banner svg');
  if (banner) {
    const vb = banner.viewBox.baseVal;
    const bw = 230;
    const bh = vb && vb.width ? (bw * vb.height) / vb.width : 300;
    const img = await svgImage(banner, bw, bh);
    ctx.drawImage(img, (W - bw) / 2, y, bw, bh);
    y += bh + 40;
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#9b3426';
  ctx.font = "600 34px 'Fraunces', Georgia, serif";
  ctx.fillText('T H E   C H R O N I C L E   O F', W / 2, y);
  y += 96;
  ctx.fillStyle = '#2b2118';
  ctx.font = "650 88px 'Fraunces', Georgia, serif";
  for (const line of wrap(ctx, cap(story.view.civName), W - 200)) {
    ctx.fillText(line, W / 2, y);
    y += 96;
  }
  if (story.view.dream) {
    ctx.font = "italic 500 40px 'Fraunces', Georgia, serif";
    ctx.fillStyle = '#6b5a44';
    ctx.fillText(`${story.view.dream.native} · “${story.view.dream.meaning}”`, W / 2, y);
    y += 70;
  }
  ctx.font = "400 38px 'Source Serif 4', Georgia, serif";
  ctx.fillStyle = '#2b2118';
  for (const line of wrap(ctx, openingLine(story), W - 240)) {
    ctx.fillText(line, W / 2, y);
    y += 54;
  }
  y += 30;
  // Up to eight medallions of the people who served them.
  const faces = [...document.querySelectorAll<SVGSVGElement>('.chron-medals .portrait svg')].slice(0, 8);
  if (faces.length) {
    const size = 104;
    const gap = 14;
    const total = faces.length * size + (faces.length - 1) * gap;
    let x = (W - total) / 2;
    for (const f of faces) {
      try {
        ctx.drawImage(await svgImage(f, size, size), x, Math.min(y, H - 260), size, size);
      } catch {
        /* skip a face that does not draw */
      }
      x += size + gap;
    }
  }
  ctx.font = "600 30px 'Fraunces', Georgia, serif";
  ctx.fillStyle = '#9b8767';
  ctx.fillText('Apes Together Strong', W / 2, H - 92);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
};

export function ShareButtons({ story, ended, turn }: { story: StoryInput; ended: boolean; turn: number }) {
  const [img, setImg] = useState<ImgState>({ stage: 'idle' });
  const name = `chronicle-${story.view.civName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'people'}.png`;

  const shareStory = (): void => {
    void shareText(`The Chronicle of ${cap(story.view.civName)}`, shareSummary(story, ended, turn)).then((r) => {
      if (r === 'copied') pushToast('The chronicle is copied: paste it anywhere.', 'good');
      else if (r === 'failed') pushToast('Sharing is not available in this browser.', 'bad');
    });
  };

  const image = (): void => {
    if (img.stage === 'ready') {
      void handOffBlob(img.blob, img.name).then((ok) => {
        setImg({ stage: 'idle' });
        if (ok === 'downloaded') pushToast(`Saved ${img.name}. On iPhone it lands in Files > Downloads.`, 'good');
      });
      return;
    }
    setImg({ stage: 'making' });
    makeCard(story).then(
      (blob) => setImg({ stage: 'ready', blob, name }),
      () => {
        setImg({ stage: 'failed' });
        pushToast('The image could not be drawn here. Share the text instead.', 'bad');
      },
    );
  };

  return (
    <>
      <button class="btn" onClick={shareStory} aria-label="Share the chronicle as text">
        <Icon name="share" /> Share
      </button>
      {img.stage !== 'failed' && (
        <button class={`btn${img.stage === 'ready' ? ' btn-primary' : ''}`} disabled={img.stage === 'making'} onClick={image} aria-label="Save the chronicle's title card as an image">
          <Icon name="image" /> {img.stage === 'making' ? 'Drawing…' : img.stage === 'ready' ? 'Save image' : 'Image'}
        </button>
      )}
    </>
  );
}

/** Share or download a PNG (inside a tap). */
const handOffBlob = async (blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> => {
  const file = new File([blob], name, { type: 'image/png' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
};

