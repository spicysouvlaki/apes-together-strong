/**
 * DEV ONLY art sheet: every icon, crest, banner and figure portrait on one page, for art
 * review in the dev server. Not imported by the game; load it from the browser console with
 * `(await import('/src/ui/art/dev-gallery.tsx')).showGallery()`. Options:
 * `showGallery({ culture: 'greek', size: 'lg', portraitsOnly: true })`.
 */
import { render } from 'preact';
import { content } from '../store';
import { Icon } from './Icon';
import { ICON_NAMES } from './icons-data';
import { CultureCrest, FigurePortrait, SetupBanner, figurePortraitSpec } from './game-art';
import '../styles/base.css';
import '../styles/fonts';

type Size = 'xs' | 'sm' | 'md' | 'lg';
interface GalleryOptions {
  culture?: string;
  size?: Size;
  portraitsOnly?: boolean;
}

const WIDTH: Record<Size, number> = { xs: 40, sm: 56, md: 80, lg: 104 };

function Gallery({ culture, size = 'md', portraitsOnly }: GalleryOptions) {
  const cultures = content.cultures.filter((c) => !culture || c.id === culture);
  return (
    <div style={{ padding: '12px', overflow: 'auto', height: '100%', position: 'fixed', inset: 0, zIndex: 999, background: 'var(--paper)' }}>
      {!portraitsOnly && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '22px' }}>
            {ICON_NAMES.map((n) => (
              <span title={n} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', width: '40px' }}>
                <Icon name={n} />
                <span style={{ fontSize: '7px' }}>{n}</span>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px', margin: '12px 0' }}>
            {content.cultures.map((c) => (
              <CultureCrest culture={c.id} size={36} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <SetupBanner primary="#0072b2" secondary="#ffffff" leader="sage" />
            <SetupBanner primary="#d55e00" secondary="#000000" leader="conqueror" />
            <SetupBanner primary="#009e73" secondary="#f0e442" leader="merchant" />
          </div>
        </div>
      )}
      {cultures.map((c) => (
        <section id={`gallery-${c.id}`} style={{ marginTop: '14px' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: '14px' }}>{c.name}</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {content.figures
              .filter((f) => f.culture === c.id)
              .map((f) => {
                const s = figurePortraitSpec(f.id);
                return (
                  <figure style={{ margin: 0, width: `${WIDTH[size]}px`, textAlign: 'center' }} title={s ? `${s.view} ${s.face} ${s.age} ${s.hair}/${s.hairTone} beard:${s.beard} ${s.headwear} ${s.garment} ${s.prop}` : f.id}>
                    <FigurePortrait figure={f.id} size={size} />
                    <figcaption style={{ fontSize: '9px', lineHeight: 1.15 }}>
                      {f.name.replace(/\s*\(.*\)$/, '')}
                      <br />
                      <span style={{ opacity: 0.6 }}>
                        {f.kind} · {f.age}
                      </span>
                    </figcaption>
                  </figure>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}

export const showGallery = (opts?: GalleryOptions | string): void => {
  let el = document.getElementById('dev-gallery');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dev-gallery';
    document.body.appendChild(el);
  }
  render(<Gallery {...(typeof opts === 'string' ? { culture: opts } : (opts ?? {}))} />, el);
};
