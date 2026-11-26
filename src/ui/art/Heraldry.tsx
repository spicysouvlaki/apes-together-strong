/**
 * Culture crests (heater shields with one motif) and the player's fabric banner. Specs come
 * from src/ui/art/heraldry-spec.ts; this file only draws them.
 */
import { useId } from 'preact/hooks';
import { iconMarkup } from './icons-data';
import { GOLD, INK, PAPER_HI, mix } from './palette';
import type { BannerSpec, CrestSpec, Motif } from './heraldry-spec';

/** Motifs on a 24-unit grid, solid fills in currentColor (woodcut silhouettes). */
export const MOTIF_SVG: Record<Motif, string> = {
  lotus:
    '<path d="M12 4.5c1.8 2.4 2.6 5.4 2.2 9.4L12 17l-2.2-3.1c-.4-4 .4-7 2.2-9.4z"/><path d="M5 8.6c2.8.6 5 2.6 6.2 6.6L11 17.4c-3.4-.8-5.6-3-6.4-6.4zM19 8.6c-2.8.6-5 2.6-6.2 6.6l.2 2.2c3.4-.8 5.6-3 6.4-6.4z"/><path d="M11.2 17.4h1.6v4.2h-1.6zM7 21.6h10v1.4H7z"/>',
  amphora:
    '<path d="M9.6 2.6h4.8v1.6h-1v2.2c3.4 1.4 5.2 4.6 4.8 8.6-.3 3.4-2.4 6-5 7.6l.4 1H10.4l.4-1c-2.6-1.6-4.7-4.2-5-7.6-.4-4 1.4-7.2 4.8-8.6V4.2h-1z"/><path fill="none" stroke="currentColor" stroke-width="1.4" d="M9.8 6.8C6.6 6.6 5.6 9 6.6 11.4M14.2 6.8c3.2-.2 4.2 2.2 3.2 4.6"/>',
  ding:
    '<path d="M3.5 7.2h17v2.2c0 4.6-3.6 8-8.5 8s-8.5-3.4-8.5-8z"/><path d="M6.4 3.4h2v4h-2zM15.6 3.4h2v4h-2zM6.4 16l1.8.8-1 5.6H5.6zM17.6 16l-1.8.8 1 5.6h1.6zM11.1 17.4h1.8v5h-1.8z"/>',
  palm:
    '<path d="M11.2 10h1.6l1 12.6h-3.6z"/><path d="M12 10c-1.6-3.6-4.6-5-8.6-4 2.4.2 4.6 1.4 5.8 3.2-2.6-.6-5 .2-6.6 2.6 2.6-1.4 5.6-1.4 9.4-1.8zM12 10c1.6-3.6 4.6-5 8.6-4-2.4.2-4.6 1.4-5.8 3.2 2.6-.6 5 .2 6.6 2.6-2.6-1.4-5.6-1.4-9.4-1.8zM12 10c-.6-3 .4-5.6 3-7.2-1.2 1.8-1.4 4.2-.6 7.2z"/>',
  longship:
    '<path d="M2 14.4h20c-.6 3.2-3 5.6-6.4 5.6H8.4c-3.4 0-5.8-2.4-6.4-5.6z"/><path d="M2 14.4c-.8-2.4-.4-4.8 1.6-6.4l1 .8c-1.2 1.4-1.4 3.2-.6 5.6zM22 14.4c.8-2.4.4-4.8-1.6-6.4l-1 .8c1.2 1.4 1.4 3.2.6 5.6z"/><path d="M11.3 2.6h1.4v11.8h-1.4z"/><path d="M6.4 4.4h11.2v7.4H6.4z" opacity=".85"/>',
  inuksuk:
    '<path d="M9.6 2.6h4.8v3.6H9.6zM8 7h8v2.6H8zM3.4 10.4h17.2v2.8H3.4zM8.6 14h6.8v2.4H8.6zM8.2 17.2h3v5.2h-3zM12.8 17.2h3v5.2h-3z"/>',
  ger:
    '<path d="M3 13.6C5.6 9 8.6 6.6 12 6s6.4 3 9 7.6z"/><path d="M4 14.4h16v7.6H4z"/><path d="M10.4 2.6h3.2V6h-3.2z"/><path fill="#000" fill-opacity=".35" d="M10 16.6h4V22h-4z"/>',
  tower:
    '<path d="M5 6.4h2.6V4h2.6v2.4h3.6V4h2.6v2.4H19V22H5z"/><path fill="#000" fill-opacity=".35" d="M10 15.4a2 2 0 0 1 4 0V22h-4zM8 9.4h1.6v2.6H8zM14.4 9.4H16v2.6h-1.6z"/>',
  star: '<path d="M12 2.6l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z"/>',
};

const SHIELD = 'M3 3h26v11c0 7.6-5.6 12.6-13 15.4C8.6 26.6 3 21.6 3 14z';

export function Crest({ spec, size = 22, label }: { spec: CrestSpec; size?: number; label?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const clip = `cc${uid}`;
  const t = spec.tones;
  return (
    <svg class="crest" width={size} height={size * (32 / 32)} viewBox="0 0 32 32" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
      <defs>
        <clipPath id={clip}>
          <path d={SHIELD} />
        </clipPath>
      </defs>
      <path d={SHIELD} fill={t.base} />
      <g clip-path={`url(#${clip})`}>
        {spec.field === 'chief' && <path d="M0 0h32v8.4H0z" fill={t.deep} />}
        {spec.field === 'pale' && <path d="M12 0h8v32h-8z" fill={t.deep} opacity=".55" />}
        {spec.field === 'bordure' && <path d={SHIELD} fill="none" stroke={t.light} stroke-width="3.2" />}
        <path d="M3 3h26v4H3z" fill="#fff" opacity=".12" />
      </g>
      <g transform="translate(7 6.4) scale(.75)" style={{ color: spec.charge }} fill="currentColor" dangerouslySetInnerHTML={{ __html: MOTIF_SVG[spec.motif] }} />
      <path d={SHIELD} fill="none" stroke={GOLD} stroke-width="1.4" />
      <path d={SHIELD} fill="none" stroke={INK} stroke-opacity=".7" stroke-width=".6" />
    </svg>
  );
}

/**
 * A hanging swallowtail banner from a cross-bar: primary field, secondary border and emblem,
 * embroidered culture motifs on the tail, and cloth shading that ripples. 60x96 grid.
 */
export function BannerArt({ spec, width = 60, label, wave = false }: { spec: BannerSpec; width?: number; label?: string; wave?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const shade = `bs${uid}`;
  const r = spec.ripple;
  const cloth = `M8 10h44v62l-22 ${14 + r * 4}-22-${14 + r * 4}z`;
  const inner = `M12 14h36v55.6l-18 ${11.4 + r * 3.2}-18-${11.4 + r * 3.2}z`;
  const motifs = spec.motifs;
  return (
    <svg
      class={`banner-art${wave ? ' banner-wave' : ''}`}
      width={width}
      height={width * (96 / 60)}
      viewBox="0 0 60 96"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      <defs>
        <linearGradient id={shade} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#000" stop-opacity=".22" />
          <stop offset={0.22 + r * 0.1} stop-color="#fff" stop-opacity=".14" />
          <stop offset=".5" stop-color="#000" stop-opacity=".08" />
          <stop offset={0.74 - r * 0.08} stop-color="#fff" stop-opacity=".12" />
          <stop offset="1" stop-color="#000" stop-opacity=".26" />
        </linearGradient>
      </defs>
      {/* Pole and finials */}
      <path d="M3 8.6h54" stroke={mix(GOLD, INK, 0.35)} stroke-width="2.4" stroke-linecap="round" />
      <circle cx="3" cy="8.6" r="2.6" fill={GOLD} stroke={INK} stroke-opacity=".5" stroke-width=".6" />
      <circle cx="57" cy="8.6" r="2.6" fill={GOLD} stroke={INK} stroke-opacity=".5" stroke-width=".6" />
      <path d="M30 8.6V2.4" stroke={mix(GOLD, INK, 0.35)} stroke-width="1.4" />
      <g class="banner-cloth">
        <path d={cloth} fill={spec.primary} stroke={INK} stroke-opacity=".55" stroke-width=".8" />
        <path d={inner} fill="none" stroke={spec.secondary} stroke-width="1.8" />
        <path d="M8 10h44v4H8z" fill={spec.secondary} />
        <g
          transform="translate(17 22) scale(1.08)"
          style={{ color: spec.secondary }}
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          dangerouslySetInnerHTML={{ __html: iconMarkup(spec.emblem) }}
        />
        {motifs.map((m, i) => {
          const n = motifs.length;
          const x = 30 + (i - (n - 1) / 2) * 11 - 4.5;
          return <g transform={`translate(${x} 53) scale(.375)`} style={{ color: spec.secondary }} fill="currentColor" dangerouslySetInnerHTML={{ __html: MOTIF_SVG[m] }} />;
        })}
        <path d={cloth} fill={`url(#${shade})`} />
      </g>
      <path d="M8 10.4h44" stroke={PAPER_HI} stroke-opacity=".25" stroke-width=".6" />
    </svg>
  );
}
