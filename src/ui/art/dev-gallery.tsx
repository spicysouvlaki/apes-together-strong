/**
 * DEV ONLY art sheet: every icon, crest, banner and figure portrait on one page, for art
 * review in the dev server. Not imported by the game; load it from the browser console with
 * `(await import('/src/ui/art/dev-gallery.tsx')).showGallery()`.
 */
import { render } from 'preact';
import { content } from '../store';
import { Icon } from './Icon';
import { ICON_NAMES } from './icons-data';
import { CultureCrest, FigurePortrait, SetupBanner } from './game-art';
import '../styles/base.css';
import '../styles/fonts';

function Gallery({ filter }: { filter?: string }) {
  const figs = content.figures.filter((f) => !filter || f.culture === filter);
  return (
    <div style={{ padding: '12px', overflow: 'auto', height: '100%', position: 'fixed', inset: 0, zIndex: 999, background: 'var(--paper)' }}>
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '12px' }}>
        {figs.map((f) => (
          <span title={f.name}>
            <FigurePortrait figure={f.id} size="md" />
          </span>
        ))}
      </div>
    </div>
  );
}

export const showGallery = (filter?: string): void => {
  let el = document.getElementById('dev-gallery');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dev-gallery';
    document.body.appendChild(el);
  }
  render(<Gallery filter={filter} />, el);
};
