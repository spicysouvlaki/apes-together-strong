/**
 * Draws a PortraitSpec (src/ui/art/portrait-spec.ts) as a woodcut coin/cameo medallion: a
 * paper-light bust on the culture's pigment, a beaded rim, and a kind badge. 64-unit grid,
 * head facing right (mirrored for 'left'). Every shape is a flat fill or an ink line, so it
 * reads at 32px and prints cleanly at 96px.
 *
 * Heads are built from a point list (FACE_SHAPE nudges brow, nose, lips, chin and jaw) through a
 * smooth closed curve, so facial structure varies without caricature. Hair and beards are
 * separate shapes in a hair tone; age adds a few ink lines. Archetypes get a role emblem on an
 * ornament ring in their culture's pattern instead of a face.
 */
import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import { iconMarkup } from './icons-data';
import { GOLD, INK, PAPER, PAPER_HI, mix } from './palette';
import type { Beard, Emblem, Face, HairTone, Headwear, Ornament, PortraitSpec, Prop } from './portrait-spec';

type Pt = readonly [number, number];

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

/** Closed Catmull-Rom curve through the points (passes through every point). */
const smooth = (pts: readonly Pt[]): string => {
  const n = pts.length;
  const at = (i: number): Pt => pts[((i % n) + n) % n] as Pt;
  const p0 = at(0);
  let d = `M${fmt(p0[0])} ${fmt(p0[1])}`;
  for (let i = 0; i < n; i++) {
    const a = at(i - 1);
    const b = at(i);
    const c = at(i + 1);
    const e = at(i + 2);
    d += `C${fmt(b[0] + (c[0] - a[0]) / 6)} ${fmt(b[1] + (c[1] - a[1]) / 6)} ${fmt(c[0] - (e[0] - b[0]) / 6)} ${fmt(c[1] - (e[1] - b[1]) / 6)} ${fmt(c[0])} ${fmt(c[1])}`;
  }
  return `${d}Z`;
};

interface FaceShape {
  brow: number;
  bridge: number;
  nose: number;
  noseDrop: number;
  lip: number;
  chin: number;
  jaw: number;
  skull: number;
}

/** Abstract facial structure, in grid units off the classic profile. */
const FACE_SHAPE: Record<Face, FaceShape> = {
  classic: { brow: 0, bridge: 0, nose: 0, noseDrop: 0, lip: 0, chin: 0, jaw: 0, skull: 0 },
  aquiline: { brow: 0.3, bridge: 0.9, nose: 0.5, noseDrop: 0.5, lip: -0.2, chin: 0.2, jaw: 0.2, skull: 0 },
  strong: { brow: 0.7, bridge: 0.2, nose: 0.3, noseDrop: 0.2, lip: 0, chin: 0.8, jaw: 1, skull: 0.3 },
  soft: { brow: -0.4, bridge: -0.3, nose: -0.6, noseDrop: -0.2, lip: 0.3, chin: -0.5, jaw: -0.6, skull: -0.2 },
  round: { brow: -0.2, bridge: -0.4, nose: -0.9, noseDrop: -0.3, lip: 0.1, chin: -0.2, jaw: 0.4, skull: 0.5 },
};

const profileHead = (f: FaceShape): string =>
  smooth([
    [25.8, 48],
    [24.8, 39.4],
    [21.2, 33.4],
    [19.8 - f.skull * 0.6, 26],
    [22.6, 17.4],
    [30, 13.4 - f.skull * 0.3],
    [37.8, 14.8],
    [41.2, 19.4],
    [42.1 + f.brow, 23.2],
    [41.5 + f.bridge * 0.3, 25.2],
    [42.6 + f.bridge * 0.6, 26.9],
    [44.6 + f.nose, 29.6 + f.noseDrop],
    [42.4, 30.9],
    [42.9 + f.lip, 32.3],
    [42.1, 33.3],
    [42.6 + f.lip, 34.2],
    [41.6, 35.4],
    [42.2 + f.chin, 37.4],
    [40.6 + f.chin * 0.5, 39.4 + f.jaw * 0.4],
    [37.2, 40.2 + f.jaw * 0.6],
    [36.2, 42.2],
    [36.4, 48],
  ]);

const threeQuarterHead = (f: FaceShape): string =>
  smooth([
    [27.4, 48],
    [27.2, 41],
    [24.2 - f.jaw * 0.4, 36.2],
    [21.8 - f.skull * 0.3, 30],
    [21.2 - f.skull * 0.4, 22],
    [24.4, 15.6],
    [31, 12.8 - f.skull * 0.3],
    [37.6, 14.6],
    [41, 19.6],
    [41.6 + f.brow * 0.4, 23.4],
    [41, 26.6],
    [41.6 + f.nose * 0.5 + f.bridge * 0.3, 29.2],
    [40.6, 31.2],
    [40 + f.chin * 0.3 + f.jaw * 0.3, 35.2],
    [36.8 + f.chin * 0.4, 39.4 + f.jaw * 0.3],
    [34.4, 40.4],
    [35.6, 42.6],
    [36, 48],
  ]);

const HAIR_COLOR: Record<HairTone, string> = {
  black: '#2a221d',
  umber: '#4d3324',
  auburn: '#7d3d22',
  flaxen: '#b8944c',
  grey: '#8c877f',
  silver: '#c9c3b6',
};

const metal = mix(PAPER, INK, 0.32);
const madder = '#8f2a21';
const wood = mix(GOLD, INK, 0.5);

interface Layer {
  back?: ComponentChildren;
  front?: ComponentChildren;
}

const at = <T,>(list: readonly T[], i: number): T => list[i % list.length] as T;

/** Headwear: `back` is drawn behind the head (and hair), `front` over it. */
const headwear = (h: Headwear, t: PortraitSpec['tones'], accent: number, female: boolean): Layer => {
  const veil = at([t.light, PAPER_HI, mix(t.deep, PAPER_HI, 0.15), mix(madder, PAPER_HI, 0.25)], accent);
  const cloth = at([t.deep, mix(madder, INK, 0.2), mix(GOLD, INK, 0.35), mix('#2f4f86', INK, 0.2)], accent);
  const wrap = at([PAPER_HI, t.light, mix(GOLD, PAPER_HI, 0.45), PAPER_HI], accent);
  const crown = at([madder, t.deep, '#2f4f86', mix(GOLD, INK, 0.3)], accent);
  switch (h) {
    case 'bare':
      return {};
    case 'nemes':
      return {
        front: (
          <g>
            <path
              fill={GOLD}
              d="M23.6 16.2c4.2-4.4 13.2-4.6 17.2.4 1 1.5 1.4 3.6 1.2 5.3l-11.3.4c-.8 0-1.4.6-1.4 1.4v8.5l3.4 10.6-11.4.6c.8-4.4-.2-7.2-1.6-9.6-2.2-3.6-1.8-12.6 3.9-17.6z"
            />
            <path
              stroke={t.deep}
              stroke-width="1.3"
              fill="none"
              d="M24.2 17.6c4.6-2.4 11.6-2.8 16.6-.6M22 21.4c5.4-1.4 11.4-1.6 16.8-.6M21.2 25.4h8.2M21.6 29.4h7.8M22.6 33.4h7.4M23.6 37.4h7.6M24.4 41.2h7.4"
            />
            <path stroke={t.deep} stroke-width="1.6" fill="none" d="M40.6 21.9c-5.2-.4-9.6-.2-11.4.4" />
            <path fill={GOLD} stroke={mix(GOLD, INK, 0.5)} stroke-width=".5" d="M40.4 17.4c1-2 2.6-2.2 3-.6.2.8-.4 1.4-1.2 1.4z" />
          </g>
        ),
      };
    case 'wig':
    case 'vultureCrown':
      return {
        front: (
          <g>
            <path
              fill={t.deep}
              d="M29 13.4c-6.8.6-10.8 6-10.2 13.6.3 4.2 1.4 8 3.6 10.6l9.4-.4-1-6.2c-.2-1.2.6-2.2 1.8-2.3l1.2-.1-.8-6.4c3-.4 6.2-.2 8.8.6-1-5.6-6.4-10-12.8-9.4z"
            />
            <path stroke={mix(t.deep, PAPER_HI, 0.25)} stroke-width=".7" fill="none" d="M20.6 24h9M20.2 27.4h9.6M20.8 30.8h9.4M22 34.2h8.6" />
            {female && (
              <g>
                <path fill={t.deep} d="M29.8 30.4c.9 4.8.9 9.8.1 14.8 1.2.6 2.4.7 3.6.4.6-5.2.4-10.4-.6-15.6z" />
                <path stroke={mix(t.deep, PAPER_HI, 0.25)} stroke-width=".6" fill="none" d="M30.2 33.6h3.2M30.4 37h3.2M30.4 40.4h3.2M30.2 43.6h3.2" />
              </g>
            )}
            {h === 'wig' ? (
              <path stroke={GOLD} stroke-width="1.6" fill="none" d="M21.4 20.4c6-1.8 13-2 19.6-.6" />
            ) : (
              <g>
                <path fill={GOLD} d="M27.4 13.2h9.4l-.8-3.6h-7.8z" />
                <path fill={GOLD} stroke={mix(GOLD, INK, 0.5)} stroke-width=".5" d="M40.6 19c-5-3-12.4-2.8-18 1.2l1.4 4.4c2-1.8 4-2.4 5.6-2.2l.6 5.6 2.4-.4.2-5.4c2.6-.6 5.4-.4 7.8.4z" />
                <path stroke={mix(GOLD, INK, 0.5)} stroke-width=".5" fill="none" d="M24.6 21.4l1 2.4M27 20.4l.8 2.2M29.6 19.8l.4 2.2M32.4 19.4l.2 2.2M35.2 19.4v2.2" />
                <path fill={GOLD} d="M41 18.8c.6-1.8 2-2.4 2.6-1.2.4.8 0 1.6-.8 1.8z" />
              </g>
            )}
          </g>
        ),
      };
    case 'khepresh':
      return {
        front: (
          <g>
            <path fill="#2f4f86" d="M25.6 15c1-4.6 5-7.8 9.6-7.2 4 .5 6.6 3.6 6.6 8.2l.1 5.8-11.6.6-.8 5.6-3.9.4c-1.6-4.4-1.6-9.2 0-13.4z" />
            <g fill={GOLD}>
              {[
                [30, 11],
                [34, 10.4],
                [38, 11.6],
                [28.6, 15],
                [32.6, 14.4],
                [36.6, 14.6],
                [40, 16.4],
                [27.6, 19],
                [31.6, 18.4],
                [35.6, 18.4],
              ].map(([x, y]) => (
                <circle cx={x} cy={y} r=".75" />
              ))}
            </g>
            <path stroke={GOLD} stroke-width="1.4" fill="none" d="M26 22c5-1 10.6-1 15.8-.4" />
            <path fill={GOLD} d="M41.2 20.4c.6-1.8 2-2.4 2.6-1.2.4.8 0 1.6-.8 1.8z" />
          </g>
        ),
      };
    case 'laurel':
      return {
        front: (
          <g>
            <path stroke={GOLD} stroke-width="1.2" fill="none" d="M21.8 22.6c3.4-5.6 12.6-7.8 19.4-3.4" />
            <g fill={GOLD} stroke={mix(GOLD, INK, 0.45)} stroke-width=".3">
              {[
                [23, 20.2, -60],
                [25.4, 17.6, -40],
                [28.4, 15.9, -20],
                [31.8, 15.2, 0],
                [35.2, 15.5, 15],
                [38.4, 16.8, 30],
              ].map(([x, y, r]) => (
                <ellipse cx={x} cy={y} rx="2.4" ry="1.1" transform={`rotate(${r} ${x} ${y})`} />
              ))}
            </g>
          </g>
        ),
      };
    case 'fillet':
      return { front: <path stroke={t.light} stroke-width="1.7" fill="none" d="M21.6 21.8c5.8-3.8 13.6-4.4 19.6-1.6" /> };
    case 'diadem':
      return {
        back: <path stroke={PAPER_HI} stroke-width="1.3" stroke-linecap="round" fill="none" d="M21.6 21.4c-1.8 3-2.8 7-2.4 11.4M21.8 21.8c-.4 3.6.2 7.4 1.6 11" />,
        front: (
          <g>
            <path stroke={mix(PAPER_HI, INK, 0.35)} stroke-width="2.6" fill="none" d="M21.6 21.6c6-3.2 13.4-3.8 19.6-1.4" />
            <path stroke={PAPER_HI} stroke-width="1.6" fill="none" d="M21.6 21.6c6-3.2 13.4-3.8 19.6-1.4" />
          </g>
        ),
      };
    case 'crestedHelm':
      return {
        back: (
          <g>
            <path fill={madder} d="M18 18.6c.6-8.6 9-13.8 17.2-11.8 3.8 1 6.4 3.4 7.6 6.6-5.4-3.4-12.8-3.6-17.8-.8-3 1.6-5.4 3.6-7 6z" />
            <path stroke={mix(madder, INK, 0.4)} stroke-width=".7" fill="none" d="M21 12.6l2 2.2M24 10l1.6 2.6M27.6 8.4l1 2.8M31.4 7.6l.4 2.8M35.2 7.8l-.2 2.8M38.6 9l-.8 2.6" />
          </g>
        ),
        front: (
          <g>
            <path fill={GOLD} d="M21.4 22.4c-.8-6.2 3.6-10.2 10.4-10.4 6-.2 10 2.8 10.4 7.6l-.2 1.4c-6.8-1.4-14-1.2-20.6 1.4z" />
            <path stroke={mix(GOLD, INK, 0.5)} stroke-width="1.1" fill="none" d="M22.8 19.6c4.6-1.8 11-2.2 18.8-.4" />
          </g>
        ),
      };
    case 'petasos':
      return {
        front: (
          <g>
            <path fill={mix(GOLD, PAPER, 0.25)} d="M25.6 17.6c.8-5 4.4-7 7.8-7 3.6 0 6.4 2.4 7 6.6z" />
            <ellipse cx="32.6" cy="18.2" rx="15" ry="2.6" transform="rotate(-6 32.6 18.2)" fill={mix(GOLD, INK, 0.2)} />
          </g>
        ),
      };
    case 'pilos':
      return {
        front: (
          <g>
            <path fill={t.light} stroke={mix(t.light, INK, 0.5)} stroke-width=".6" d="M22.8 19.8L31 5.8l10.4 13.4c-6-1.8-12.4-1.6-18.6.6z" />
            <path stroke={mix(t.light, INK, 0.45)} stroke-width="1.4" fill="none" d="M22.8 19.6c6.2-2 12.6-2.2 18.6-.4" />
          </g>
        ),
      };
    case 'guan':
      return {
        front: (
          <g>
            <path fill={INK} d="M26.4 9.2h8.6l1.2 6.6H25.4z" />
            <path stroke={GOLD} stroke-width="1.3" d="M22.8 12h16.4" />
          </g>
        ),
      };
    case 'topknot':
      return { front: <path stroke={GOLD} stroke-width="1.3" d="M25.4 11.4l10.4-1.6" /> };
    case 'hairpins':
      return {
        front: (
          <g>
            <path stroke={GOLD} stroke-width="1" stroke-linecap="round" d="M24.4 13.2l12.4-5M26.6 7.4l8 7" />
            <circle cx="37.2" cy="8" r="1.6" fill={madder} stroke={GOLD} stroke-width=".5" />
            <path stroke={GOLD} stroke-width=".6" d="M37.2 9.6v3.4" />
            <circle cx="37.2" cy="13.4" r=".6" fill={GOLD} />
          </g>
        ),
      };
    case 'futou':
      return {
        back: <path stroke={INK} stroke-width="1.8" fill="none" d="M23.4 17.4l-9.4-3.6M23.6 19.6l-9.2 1.6" />,
        front: <path fill={INK} d="M21.8 21.6c-.8-6 3.6-9.6 9.6-9.6 5.6 0 9.2 2.8 9.8 7l-.2 1.4c-6.4-.8-13.2-.6-19.2 1.2z" />,
      };
    case 'turban':
      return {
        front: (
          <g>
            <path fill={wrap} stroke={mix(wrap, INK, 0.4)} stroke-width=".5" d="M21.2 23c-1.8-7.2 2.8-11.6 10.4-12.2 6.4-.4 10.6 2.6 10.8 7.4l-.8 3.4c-6.8-1.6-14.2-1.4-20.4 1.4z" />
            <path stroke={t.deep} stroke-width=".9" fill="none" d="M22.4 20.4c5.2-3.6 12.4-4.4 19.4-2.2M22.2 16.8c4.8-3 12-3.6 18.4-1.4M27.4 11.6c3.4 2.2 5.4 5.4 6 10" />
          </g>
        ),
      };
    case 'kalansuwa':
      return {
        front: (
          <g>
            <path fill={mix(cloth, INK, 0.3)} d="M26.4 15.4l1.8-10.8c2.4-1.4 5.4-1.4 7.6 0l1.4 10.6z" />
            <path fill={PAPER_HI} stroke={mix(PAPER_HI, INK, 0.4)} stroke-width=".5" d="M21.4 23c-1.2-5.4 2.8-8.6 10.2-9 6.4-.4 10.4 2.2 10.6 6.4l-.8 2.4c-6.8-1.6-14-1.4-20 .2z" />
            <path stroke={t.deep} stroke-width=".8" fill="none" d="M22.2 20c5.4-2.6 12.6-3 19.6-1M23 17c5-2.2 11.4-2.6 17.6-1" />
          </g>
        ),
      };
    case 'keffiyeh':
      return {
        back: (
          <path
            fill={PAPER_HI}
            d="M19.6 41.6c1-6.6.4-10.8-.4-15.4-1.2-8.8 4-14.2 12-14.4 6.8-.2 10.8 3.4 11 9.2l-1.2 1.4c-2.6-1.4-6-2-9.6-1.4l-1.4 9.4 2.2 10.6z"
          />
        ),
        front: (
          <g>
            <path fill={PAPER_HI} d="M22 22.4c.6-5.6 4.4-9.2 9.8-9.4 6-.2 9.8 2.8 10.4 7.6l-.6 1.6c-6.4-1.4-13-1.2-19.6.2z" />
            <path fill={PAPER_HI} d="M20 28c1-3 2.6-4.6 5-5.4l7-.6-1 9.6 2 10.4-12.8.4c.8-5 .6-9.6-.2-14.4z" />
            <path stroke={at([t.base, madder, INK, t.base], accent)} stroke-width=".7" stroke-dasharray="1.2 1.2" fill="none" d="M21 30h9M20.6 34h9.8M21 38h10.6M22.8 18.4c5.4-2 11.6-2.2 17.4-.4" />
            <path stroke={INK} stroke-width="1.6" fill="none" d="M22.6 20.6c6-2.2 12.4-2.4 18.4-.8M22.8 22.6c6-2 12-2.2 18-.8" />
          </g>
        ),
      };
    case 'veil':
    case 'wimple':
      return {
        back: (
          <path
            fill={h === 'wimple' ? cloth : veil}
            d="M18.8 46c1-6.4.6-13.6-.4-18-1.6-9.2 4-15.6 12.2-15.8 6.8-.2 11 3.8 11.2 9.6l-2 1.2c-3-1-6-1-8.4.2l-1.2 8.8 2.6 13.2z"
          />
        ),
        front: (
          <g>
            <path fill={h === 'wimple' ? cloth : veil} d="M21.6 23.6c0-6.6 4.2-10.4 10-10.6 6-.2 9.8 3.2 10.2 8.2l-1.4 1.4c-6-1.4-12.6-1-18.8 1z" />
            <path fill={h === 'wimple' ? cloth : veil} d="M20.4 27c1.2-2.6 3.4-4 6.4-4.6l4.4-.2-1.4 9.4 2.4 14.4-12.2.6c.6-6.6.8-13.2.4-19.6z" />
            <path stroke={mix(h === 'wimple' ? cloth : veil, INK, 0.35)} stroke-width=".8" fill="none" d="M22.6 21.6c5.6-2.2 12.2-2.6 18.2-.8M24.6 28c-.6 5-.4 10.4.6 16" />
            {h === 'veil' && accent % 4 === 1 && <path stroke={GOLD} stroke-width="1.1" fill="none" d="M22.4 22.4c5.8-2.4 12.4-2.8 18.4-1M25 27.4c-.8 5.6-.6 11.6.6 17.6" />}
            {h === 'veil' && accent % 4 === 2 && (
              <g fill={GOLD} stroke={mix(GOLD, INK, 0.5)} stroke-width=".25">
                {[23.6, 26.4, 29.2, 32, 34.8, 37.6, 40.2].map((x, i) => (
                  <circle cx={x} cy={21.9 - Math.sin((i / 6) * Math.PI) * 1.4 + i * 0.12} r=".8" />
                ))}
              </g>
            )}
            {h === 'veil' && accent % 4 === 3 && <path stroke={mix(GOLD, PAPER_HI, 0.2)} stroke-width="1.6" stroke-dasharray="1 .8" fill="none" d="M22.4 22.4c5.8-2.4 12.4-2.8 18.4-1" />}
            {h === 'wimple' && (
              <g fill={PAPER_HI} stroke={mix(PAPER_HI, INK, 0.45)} stroke-width=".5">
                <path d="M32.4 22.6c-.8 4-.6 8 .8 11.2 1.4 3 3.6 5 6.6 5.4 1.2 0 2.2-.4 2.8-1.2l1 8-12 1.4c-.6-8.2-1.2-16.6-1-24.8z" />
                <path d="M22.2 21.2c6-2.4 12.8-2.8 19-1l-.4 1.8c-6-1.4-12.4-1.2-18.2.8z" />
              </g>
            )}
          </g>
        ),
      };
    case 'spangenhelm':
      return {
        back: <path fill={metal} d="M22 24.6c-.6 4.4.6 9 3.2 12.2l4.6-.8-.6-11.2z" />,
        front: (
          <g>
            <path fill={metal} d="M22.4 24.8c-.8-7.2 3.4-12.6 9.8-13.6l.6-1.6.8 1.6c5.8.6 9.2 4.6 9.4 9.8l-.2 2.6z" />
            <path stroke={INK} stroke-width=".9" fill="none" d="M22.6 22.6c6.6-1.8 13.6-1.8 20 .2M32.8 11.4v11M27.4 12.8l1.6 9.6M38.4 13.4l-1.2 9" />
            <path stroke={metal} stroke-width="2.2" stroke-linecap="round" d="M40.6 22.8l1.4 6" />
          </g>
        ),
      };
    case 'circlet':
      return {
        front: (
          <g>
            <path stroke={GOLD} stroke-width="2" fill="none" d="M21.8 20.8c6-2.6 13.2-3 19.4-1" />
            <path fill={GOLD} d="M27.2 18.6l1.2-3 1.2 3zM32 17.8l1.3-3.4 1.3 3.4zM36.8 18.2l1.2-3 1.2 3z" />
            <circle cx="33.3" cy="19.4" r=".9" fill={madder} />
          </g>
        ),
      };
    case 'crown':
      return {
        front: (
          <g>
            <path
              fill={GOLD}
              stroke={mix(GOLD, INK, 0.5)}
              stroke-width=".5"
              d="M22 21.6c6.2-2.6 13-3 19.4-1.2l-.6-4.4-2.4 1.6-1.4-4-2 3.4-2.6-4-1.8 3.8-2.8-3.4-1.2 4.2-2.6-1.6z"
            />
            <circle cx="27.8" cy="19.6" r=".8" fill={madder} />
            <circle cx="32.6" cy="19" r=".8" fill="#2f4f86" />
            <circle cx="37.4" cy="19.2" r=".8" fill={madder} />
          </g>
        ),
      };
    case 'hood':
      return {
        back: (
          <path
            fill={cloth}
            d="M19.2 46c.6-5 .4-12.4-.6-16.8-2-9.6 3.6-16.6 12.2-16.8 7-.2 11.4 4.2 11.4 10l-2.6.4c-3 .4-5.6 2.6-6.2 5.6l-1.2 7 1.6 10.6z"
          />
        ),
        front: (
          <g>
            <path fill={cloth} d="M22 23.6c-.2-6.6 4-10.4 9.8-10.6 6-.2 10 3.2 10.4 8.4l-1.6 1.2c-6-1.4-12.4-1-18.6 1z" />
            <path fill={cloth} d="M20.2 27.2c1.4-2.8 3.6-4.2 6.6-4.6l5.2-.4-1.8 9 1.6 13.2-12 .8c.8-6 .8-12 .4-18z" />
            <path stroke={mix(cloth, PAPER_HI, 0.3)} stroke-width=".7" fill="none" d="M23 22.6c5.6-2.2 12-2.6 18-1M25 28c-.6 5.4-.4 11 .6 16.6" />
          </g>
        ),
      };
    case 'parka':
      return {
        back: (
          <path
            fill={mix(GOLD, PAPER, 0.35)}
            d="M17 45c-1.4-6.2-2-11.8-1-17.6C17.6 15.2 24.6 9 33 9.2c7.4.2 12.8 5.2 13.4 12.8.4 4.8-.6 10-2.8 14.4l-4.2-1z"
          />
        ),
        front: (
          <path
            stroke={PAPER_HI}
            stroke-width="3.6"
            stroke-dasharray=".6 1.4"
            stroke-linecap="round"
            fill="none"
            d="M33 11.4c5.6-.2 9.6 3.4 10.6 8.8.8 4.6.2 10-2.2 14.8"
          />
        ),
      };
    case 'furHat':
      return {
        front: (
          <g>
            <path fill={crown} d="M25.2 16c.6-5.2 3.6-9.2 7.8-10.8 3.4 2 5.6 6 6 10.6z" />
            <circle cx="33" cy="4.6" r="1.4" fill={GOLD} />
            <path fill={mix(GOLD, PAPER, 0.15)} d="M22 21c-.8-2.6 0-5 2.2-5.6 5.4-1.4 11.4-1.2 16.4.8 1.6.8 1.8 3 .8 4.6-6.4-1.4-13.4-1.4-19.4.2z" />
            <path stroke={mix(GOLD, INK, 0.45)} stroke-width=".7" fill="none" d="M24 16.2l.4 3.6M27 15.4l.2 3.6M30 15l.1 3.6M33 15l-.1 3.6M36 15.4l-.2 3.6M39 16.2l-.4 3.4" />
          </g>
        ),
      };
    case 'boqta':
      return {
        front: (
          <g>
            <path fill={t.deep} d="M26.6 15.2L22.6 1h7.4l2.4 13.6z" />
            <path stroke={GOLD} stroke-width="1" fill="none" d="M23.4 4.4h6.8M24.4 8.4h6.6M25.4 12.2h6.4" />
            <path stroke={GOLD} stroke-width="1" stroke-linecap="round" fill="none" d="M22.8 1.2c-1.6-1.4-3.4-1.2-4.6.2M24.6 1c-.8-1.8-2.2-2.4-3.6-2" />
            <path fill={madder} d="M21.8 22.2c-.6-5.4 3.4-9 9.4-9.2 5.4-.2 9 2.6 9.6 7l-.4 1.2c-6.4-1.4-12.6-1.2-18.6 1z" />
            <path fill={madder} d="M21 26.4c.8-2.6 2.6-3.8 5-4.2l3.4-.2-.4 9.6c-1.6 2.4-4 3.4-7 3 .2-2.8-.2-5.6-1-8.2z" />
            <path stroke={GOLD} stroke-width=".9" fill="none" d="M22 21.2c6-2 12.2-2.2 18.6-.8" />
            <g fill={GOLD}>
              <circle cx="23" cy="29" r=".7" />
              <circle cx="23.4" cy="31.8" r=".7" />
              <circle cx="23.8" cy="34.6" r=".7" />
            </g>
          </g>
        ),
      };
    case 'cap':
      return { front: <path fill={cloth} d="M21.6 21c-.6-5.4 3.6-9.4 9.8-9.6 5.6-.2 9.2 2.8 9.8 7.4-6.6-1.2-13.4-1-19.6 2.2z" /> };
  }
};

/** Headwear that hides the ear (and sides of the head). */
const COVERS_EAR: ReadonlySet<Headwear> = new Set(['nemes', 'wig', 'vultureCrown', 'keffiyeh', 'veil', 'wimple', 'hood', 'parka', 'boqta', 'spangenhelm']);

// Hair caps, profile (head faces right). Inner edge runs hairline → sideburn → behind the ear.
const P_SHORT: readonly Pt[] = [
  [40.8, 17.4],
  [38, 13.6],
  [30, 12.4],
  [22, 15.8],
  [18.9, 24.6],
  [20.4, 32.6],
  [24.8, 37.4],
  [27.2, 35.2],
  [28.6, 31.4],
  [32.4, 30.4],
  [33, 25.4],
  [35.8, 21.4],
  [39.4, 19.6],
];
const P_LONG: readonly Pt[] = [
  [40.8, 17.4],
  [38, 13.6],
  [30, 12.4],
  [22, 15.8],
  [18.4, 25],
  [18.2, 35],
  [19.4, 46.4],
  [27.4, 46.4],
  [27.6, 38],
  [29.4, 31.6],
  [32.6, 30.4],
  [33.2, 25.4],
  [35.8, 21.4],
  [39.4, 19.6],
];
const P_RECEDING: readonly Pt[] = [
  [31.8, 13.2],
  [25.4, 13.8],
  [20.6, 19.4],
  [19.2, 26.4],
  [20.8, 33],
  [24.8, 37.4],
  [27.2, 35.2],
  [28.6, 31.4],
  [31.8, 30.2],
  [31.6, 25.4],
  [28.6, 21],
  [29.6, 16.2],
];
// Three-quarter (face turned right): hairline across the brow, ear on the left.
const Q_SHORT: readonly Pt[] = [
  [21.4, 26],
  [20.8, 18.6],
  [24.2, 13.4],
  [31, 11.8],
  [38, 13.4],
  [41.8, 18.6],
  [41.8, 21.6],
  [39.6, 18.8],
  [35.4, 17.6],
  [30.4, 18.2],
  [26.6, 19.8],
  [24.8, 23],
  [24.6, 27.4],
  [22.6, 28.2],
];
const Q_LONG: readonly Pt[] = [
  [21, 26],
  [20.6, 18.6],
  [24.2, 13.4],
  [31, 11.6],
  [38.2, 13.4],
  [42.2, 18.8],
  [42.4, 25.4],
  [40.8, 23.6],
  [39.8, 19.4],
  [35.4, 17.6],
  [30.4, 18.2],
  [26.6, 19.8],
  [24.8, 23.4],
  [25, 30.6],
  [26.6, 38.4],
  [24.6, 45.6],
  [19.6, 44],
  [19.8, 34],
];
const Q_RECEDING: readonly Pt[] = [
  [21.4, 28],
  [20.8, 20],
  [23.4, 15.2],
  [27.6, 13.4],
  [25.6, 16.8],
  [24.6, 21],
  [24.8, 27.4],
  [22.8, 29.2],
];

const hairShape = (spec: PortraitSpec, color: string): ComponentChildren => {
  const q = spec.view === 'threeQuarter';
  const edge = mix(color, INK, 0.55);
  const strands = mix(color, spec.hairTone === 'black' ? PAPER_HI : INK, 0.42);
  const short = smooth(q ? Q_SHORT : P_SHORT);
  const cap = (d: string, opacity = 1): ComponentChildren => <path fill={color} fill-opacity={opacity} stroke={edge} stroke-opacity=".6" stroke-width=".45" d={d} />;
  const lines = q ? 'M25.6 16c3-1.6 7-2 10.6-1.2M23.4 20c1.6-2.6 4-4 7-4.6' : 'M38.2 15.6c-4-1.8-10-1.4-14 2.4M37 18.4c-3.6-1.2-8-.4-11 2.4M23.2 22.6c-1 3-1 6 .2 9';
  const strandPath = <path stroke={strands} stroke-width=".45" fill="none" d={lines} />;
  const topBun = spec.headwear === 'topknot' || spec.headwear === 'guan' || spec.headwear === 'hairpins';
  switch (spec.hair) {
    case 'none':
      return null;
    case 'short':
      return (
        <g>
          {cap(short)}
          {strandPath}
        </g>
      );
    case 'cropped':
      return cap(short, 0.85);
    case 'shaved':
      return cap(short, 0.22);
    case 'curly': {
      const pts: Pt[] = q
        ? [
            [21.6, 22],
            [22.6, 17],
            [25.6, 13.8],
            [29.6, 12.2],
            [33.8, 12.4],
            [37.6, 13.8],
            [40.4, 16.6],
          ]
        : [
            [38.6, 14.6],
            [34.6, 12.4],
            [30, 12],
            [25.4, 13.2],
            [21.8, 16.4],
            [19.6, 20.8],
            [19.2, 25.6],
            [20, 30.4],
            [22.2, 34.4],
          ];
      return (
        <g>
          {cap(short)}
          <g fill={color} stroke={edge} stroke-opacity=".5" stroke-width=".4">
            {pts.map(([x, y]) => (
              <circle cx={x} cy={y} r="1.9" />
            ))}
          </g>
          <g fill="none" stroke={strands} stroke-width=".45">
            {pts.map(([x, y]) => (
              <path d={`M${fmt(x - 0.8)} ${fmt(y + 0.2)}a.9 .9 0 1 1 1.4 .8`} />
            ))}
          </g>
        </g>
      );
    }
    case 'long':
      return (
        <g>
          {cap(smooth(q ? Q_LONG : P_LONG))}
          <path stroke={strands} stroke-width=".45" fill="none" d={q ? 'M22.4 26c-.2 6 .6 12 2 17M25.6 16c3-1.6 7-2 10.6-1.2' : 'M21 26c-.6 6-.4 12 .4 18.6M24 28.6c-.2 5.4.2 10.8 1.2 16.4M37 15.6c-4-1.6-9-1-13 2'} />
        </g>
      );
    case 'bun':
      return (
        <g>
          {cap(short)}
          {strandPath}
          <circle cx={topBun ? 30.6 : q ? 22.4 : 20.2} cy={topBun ? 10.6 : q ? 15 : 19.4} r="3.6" fill={color} stroke={edge} stroke-opacity=".6" stroke-width=".45" />
        </g>
      );
    case 'braid': {
      const x0 = q ? 21.6 : 23.4;
      return (
        <g>
          {cap(short)}
          {strandPath}
          <g fill={color} stroke={edge} stroke-opacity=".6" stroke-width=".45">
            {[0, 1, 2, 3, 4].map((i) => (
              <ellipse cx={x0 + i * (q ? -0.2 : 0.3)} cy={31.6 + i * 3.4} rx="1.9" ry="2" />
            ))}
          </g>
        </g>
      );
    }
    case 'tied':
      return (
        <g>
          {cap(short)}
          {strandPath}
          <path fill={color} stroke={edge} stroke-opacity=".6" stroke-width=".45" d={q ? 'M21.6 21c-2.4 2-3.4 6-3 11.6l1.6.2c.2-4 .8-7.6 2.4-10z' : 'M20.4 27.2c-2.6 2.2-3.6 6.4-3 12.4l1.8.2c0-4.4.8-8.2 2.6-11z'} />
          <circle cx={q ? 21.2 : 20.2} cy={q ? 21.6 : 27.8} r="1" fill={madder} />
        </g>
      );
    case 'receding':
      return (
        <g>
          {cap(smooth(q ? Q_RECEDING : P_RECEDING))}
          {!q && <path stroke={strands} stroke-width=".45" fill="none" d="M22.4 22c-1 3-1 6.4.4 9.6M25.6 18c-1.2 1.6-1.8 3.6-1.8 5.6" />}
        </g>
      );
  }
};

/** Beards (with moustache unless 'goatee'-only); profile shapes depend on the chin. */
const beardShape = (beard: Beard, q: boolean, f: FaceShape, color: string): ComponentChildren => {
  if (beard === 'none') return null;
  const edge = mix(color, INK, 0.55);
  const strands = mix(color, color === HAIR_COLOR.black ? PAPER_HI : INK, 0.42);
  const c = f.chin;
  const moustache = q ? (
    <path fill={color} stroke={edge} stroke-opacity=".5" stroke-width=".35" d="M30.8 34c1.2-1.6 3.2-2.2 5-1.5 1.4-.6 2.8-.3 3.6.9-1.2-.3-2.4-.1-3.6.6-1.6-.6-3.4-.6-5 0z" />
  ) : (
    <path stroke={color} stroke-width="1.3" stroke-linecap="round" fill="none" d="M42.6 31.6c-1.2.1-2.6.6-3.6 1.8" />
  );
  const shape = (pts: readonly Pt[], lines?: string): ComponentChildren => (
    <g>
      <path fill={color} stroke={edge} stroke-opacity=".6" stroke-width=".45" d={smooth(pts)} />
      {lines && <path stroke={strands} stroke-width=".45" fill="none" d={lines} />}
      {moustache}
    </g>
  );
  if (beard === 'moustache') return moustache;
  if (q) {
    const inner: Pt[] = [
      [39.4, 33.6],
      [37.2, 35.8],
      [34.4, 35.2],
      [31.6, 35.4],
      [28.6, 35.8],
      [25.6, 31.6],
      [24.6, 27.4],
    ];
    switch (beard) {
      case 'short':
        return shape([[22.8, 28.4], [24.2, 35], [28.4, 39.4], [33.6, 41.2], [37.6, 40], [40.6, 35.6], [40.8, 31.8], ...inner]);
      case 'full':
        return shape([[22.4, 28], [23.2, 36], [27.6, 42.4], [33.6, 44.8], [38.8, 42.6], [41.4, 36.4], [41.4, 31], ...inner], 'M29 38c1.2 2 2.4 3.4 4 4.4M34.6 37.6c.4 2 .4 3.8-.2 5.6');
      case 'long':
        return shape(
          [[23, 29], [24.2, 36], [28.6, 41.4], [32.2, 49.6], [35, 49.8], [38.4, 42], [40.8, 36.4], [41, 31.4], ...inner],
          'M30.4 38.8c1 3 2.2 6 3.2 9M35 38.2c0 3.2-.4 6.4-.8 9.4',
        );
      case 'goatee':
        return (
          <g>
            <path fill={color} stroke={edge} stroke-opacity=".6" stroke-width=".45" d={smooth([[32, 35.6], [36.8, 35.4], [37.4, 38.6], [35, 42], [32.6, 41], [31.4, 38]])} />
            {moustache}
          </g>
        );
    }
  }
  const inner: Pt[] = [
    [37.4, 31.4],
    [40.4, 32.8],
    [41.2, 34.8],
  ];
  switch (beard) {
    case 'short':
      return shape([[31.2, 30.2], [33.2, 30.6], ...inner, [42.8 + c, 36.8], [42.6 + c, 39.6], [40, 41], [36.6, 41.4], [32.6, 38.6], [30.6, 34]]);
    case 'full':
      return shape([[31, 29.4], [33.4, 29.6], ...inner, [43.4 + c, 36.8], [43.8 + c, 40.8], [41.8, 43.6], [37, 44.4], [32.6, 41.4], [30.2, 35]], 'M33.6 34.6c1.6 2.6 3.4 4.8 5.6 6.4M37.4 34c1.2 2.6 2.8 5 4.6 6.8');
    case 'long':
      return shape(
        [[31.4, 30.4], [33.4, 30.6], ...inner, [43 + c, 37], [42.8 + c, 42], [41.2, 49.6], [39.6, 48.6], [37.8, 44.2], [34.6, 40.4], [31.4, 35.4]],
        'M36 35c1.2 3.4 2.4 7 3.8 10.6M39.4 35.4c.6 3.4 1.2 7 1.4 10.4',
      );
    case 'goatee':
      return (
        <g>
          <path fill={color} stroke={edge} stroke-opacity=".6" stroke-width=".45" d={smooth([[40.6, 34.8], [42.4 + c, 35.8], [43.2 + c, 38.4], [42.2 + c, 41.8], [40.4, 41], [40, 37]])} />
          {moustache}
        </g>
      );
  }
};

/** Ink line work for features and age (abstract: brow, eye, nostril, mouth, ear). */
const features = (spec: PortraitSpec, ink: string, showEar: boolean): ComponentChildren => {
  const q = spec.view === 'threeQuarter';
  const heavy = spec.face === 'strong' || spec.face === 'aquiline';
  const bw = heavy ? 1.05 : spec.presentation === 'f' ? 0.7 : 0.85;
  const elder = spec.age === 'elder';
  const mature = spec.age === 'mature';
  if (q) {
    return (
      <g stroke={ink} fill="none" stroke-linecap="round">
        <path stroke-width={bw} stroke-opacity=".75" d="M29.4 22.4c1.4-.6 3-.7 4.4-.2M36.6 22.3c1.2-.5 2.4-.5 3.4 0" />
        <path stroke-width=".75" d="M29.9 25.6c.9-.8 2.2-.9 3.2-.1M36.9 25.5c.7-.6 1.6-.7 2.3-.1" />
        <circle cx="31.6" cy="25.9" r=".62" fill={ink} stroke="none" />
        <circle cx="38.1" cy="25.8" r=".5" fill={ink} stroke="none" />
        <path stroke-width=".6" stroke-opacity=".6" d="M36.4 26c.5 1.2 1.1 2.3 1.8 3.2" />
        <path stroke-width=".7" d="M38.4 29.7c-.7.6-1.6.8-2.6.5" />
        <path stroke-width=".75" d={spec.presentation === 'f' ? 'M34 33.7c1.2.3 2.4.3 3.4-.1' : 'M33.8 33.7h3.8'} />
        {showEar && <path stroke-width=".7" d="M23.8 26.4c-1.6 0-2.4 1.6-2 3.2.3 1.2 1.2 1.8 2.2 1.8" />}
        {(elder || mature) && <path stroke-width=".45" stroke-opacity=".6" d="M33 30c-.6.8-.9 1.6-.8 2.4" />}
        {elder && <path stroke-width=".45" stroke-opacity=".55" d="M28.4 26.6l-.9.4M39.4 30.2c.2.9.1 1.6-.2 2.2M31.4 20c1.8-.4 3.8-.4 5.6 0" />}
      </g>
    );
  }
  return (
    <g stroke={ink} fill="none" stroke-linecap="round">
      <path stroke-width={bw} stroke-opacity=".75" d={heavy ? 'M36 22.8c1.8-.8 3.8-.9 5.4-.3' : 'M36.2 22.9c1.6-.8 3.4-.9 5-.4'} />
      <path stroke-width=".75" d="M37 25.4c.9-.7 2-.8 2.8-.1" />
      <circle cx="38.9" cy="25.75" r=".58" fill={ink} stroke="none" />
      {spec.presentation === 'f' && <path stroke-width=".6" d="M39.6 25.3l.8-.4" />}
      <path stroke-width=".6" d="M41.2 30.1c.5.5 1.2.6 1.6.2" />
      <path stroke-width=".7" d="M42.2 33.3h-1.6" />
      {showEar && <path stroke-width=".7" d="M29.4 27.6c1.4-1 3.2-.2 3.2 1.8 0 1.6-1.2 2.6-2.4 2.8M30.4 29c.6-.2 1 .2 1 .8" />}
      {(elder || mature) && <path stroke-width=".45" stroke-opacity=".6" d="M40.2 31c-.9 1-1.2 2.1-1 3.2" />}
      {elder && <path stroke-width=".45" stroke-opacity=".55" d="M36.2 26.2l-1 .5M38.8 18.8c.8.4 1.4.9 1.9 1.5" />}
    </g>
  );
};

/** Props held behind the back shoulder (drawn before the bust) or in front of the chest. */
const propLayer = (prop: Prop, t: PortraitSpec['tones']): Layer => {
  const pole = (top: Pt, w = 1.4, color = wood): ComponentChildren => <path stroke={color} stroke-width={w} stroke-linecap="round" d={`M12.6 66L${fmt(top[0])} ${fmt(top[1])}`} />;
  switch (prop) {
    case 'none':
      return {};
    case 'staff':
      return {
        back: (
          <g>
            {pole([17.4, 11])}
            <circle cx="17.5" cy="10.4" r="1.6" fill={GOLD} stroke={INK} stroke-width=".4" />
          </g>
        ),
      };
    case 'oar':
      return {
        back: (
          <g>
            {pole([18.6, 14], 1.3)}
            <path fill={mix(GOLD, PAPER, 0.3)} stroke={INK} stroke-width=".5" d="M18.6 15.4c-1.8-2.6-2-7-.4-11 2.2 3.4 2.6 7.6 1.4 11.2z" />
          </g>
        ),
      };
    case 'spade':
      return {
        back: (
          <g>
            {pole([18, 14])}
            <path fill={metal} stroke={INK} stroke-width=".5" d="M15.4 14.6l5.6.4.4-6.4c-2-1.6-4.2-1.8-6.2-.4z" />
          </g>
        ),
      };
    case 'sceptre':
      return {
        back: (
          <g>
            {pole([18, 10.6], 1.3, GOLD)}
            <circle cx="18.1" cy="9.4" r="2.2" fill={GOLD} stroke={mix(GOLD, INK, 0.5)} stroke-width=".5" />
            <path fill={GOLD} d="M17.2 7.6l.9-3.4 .9 3.4z" />
          </g>
        ),
      };
    case 'spear':
      return {
        back: (
          <g>
            {pole([18.4, 9.2], 1.2)}
            <path fill={metal} stroke={INK} stroke-width=".5" d="M18.8 2.4c1.6 2.6 1.6 5 .2 7.6-1.8-2.4-1.8-4.8-.2-7.6z" />
          </g>
        ),
      };
    case 'axe':
      return {
        back: (
          <g>
            {pole([18, 9.6], 1.4)}
            <path fill={metal} stroke={INK} stroke-width=".5" d="M17.6 11.6c2.4-1.6 4.8-1.4 6.6.2-1.2 2-1.2 4.4 0 6.6-2.6 1-4.6.6-6.2-.8z" />
          </g>
        ),
      };
    case 'sword':
      return {
        back: (
          <g>
            <path fill={metal} stroke={INK} stroke-width=".5" d="M17.6 7.4l1.4 2.2-2.6 40.2h-2z" />
            <path stroke={GOLD} stroke-width="1.6" stroke-linecap="round" d="M11.4 49.6l7.6.6" />
            <path stroke={wood} stroke-width="1.6" d="M15.2 50.2l-.4 6" />
            <circle cx="14.7" cy="57.2" r="1.2" fill={GOLD} />
          </g>
        ),
      };
    case 'scroll':
      return {
        front: (
          <g transform="rotate(-14 31 55)">
            <rect x="24.4" y="52.6" width="13.6" height="4.8" rx=".5" fill={PAPER_HI} stroke={INK} stroke-width=".6" />
            <path stroke={INK} stroke-opacity=".6" stroke-width=".45" d="M26.6 54.2h9M26.6 55.8h6.6" />
            <ellipse cx="24.4" cy="55" rx="1.2" ry="2.8" fill={PAPER} stroke={INK} stroke-width=".6" />
            <ellipse cx="38" cy="55" rx="1.2" ry="2.8" fill={PAPER} stroke={INK} stroke-width=".6" />
          </g>
        ),
      };
    case 'book':
      return {
        front: (
          <g transform="rotate(-8 31 55)">
            <rect x="25" y="50.2" width="12" height="9.2" rx=".6" fill={madder} stroke={INK} stroke-width=".6" />
            <rect x="26.2" y="51.4" width="9.6" height="6.8" fill="none" stroke={GOLD} stroke-width=".55" />
            <circle cx="31" cy="54.8" r="1.2" fill={GOLD} />
          </g>
        ),
      };
    case 'stylus':
      return {
        front: (
          <g>
            <rect x="24.6" y="50.6" width="11.4" height="8.4" rx=".6" fill={mix(GOLD, INK, 0.3)} stroke={INK} stroke-width=".6" />
            <rect x="25.8" y="51.8" width="9" height="6" fill={mix(t.deep, INK, 0.3)} />
            <path stroke={PAPER} stroke-opacity=".6" stroke-width=".4" d="M26.8 53.4h6.4M26.8 55h5M26.8 56.6h6" />
            <path stroke={INK} stroke-width="1" stroke-linecap="round" d="M35 61l5.4-12" />
          </g>
        ),
      };
    case 'compass':
      return {
        front: (
          <g>
            <path stroke={INK} stroke-width="1.1" stroke-linecap="round" d="M32 48.6l-5 12.6M32 48.6l5 12.6" />
            <circle cx="32" cy="48.6" r="1.4" fill={GOLD} stroke={INK} stroke-width=".4" />
            <path stroke={INK} stroke-width=".5" stroke-dasharray="1 .8" fill="none" d="M27.6 58.6c2.8 1.4 6 1.4 8.8 0" />
          </g>
        ),
      };
    case 'setSquare':
      return {
        front: (
          <g>
            <path stroke={mix(GOLD, INK, 0.15)} stroke-width="2.4" fill="none" d="M25.6 48.6v11.6h11.6" />
            <path stroke={INK} stroke-width=".4" d="M25 51h1.2M25 53.4h1.2M25 55.8h1.2M28.6 59.6v1.2M31 59.6v1.2M33.4 59.6v1.2" />
          </g>
        ),
      };
    case 'mallet':
      return {
        front: (
          <g>
            <path stroke={wood} stroke-width="1.4" stroke-linecap="round" d="M26.4 61.6l8.4-9" />
            <rect x="32.6" y="47.6" width="5.2" height="7.6" rx=".8" fill={mix(GOLD, INK, 0.25)} stroke={INK} stroke-width=".5" transform="rotate(43 35.2 51.4)" />
          </g>
        ),
      };
    case 'lamp':
      return {
        front: (
          <g>
            <path fill={GOLD} stroke={INK} stroke-width=".5" d="M24.4 56.4h11l2-1.4h2.2c-.6 3.2-3.6 5.2-7.6 5.2-3.6 0-6.4-1.6-7.6-3.8z" />
            <path fill="#e8b04a" stroke={mix('#e8b04a', INK, 0.4)} stroke-width=".3" d="M39.4 54.2c-1.1-.9-1.1-2.3 0-3.8 1.1 1.5 1.1 2.9 0 3.8z" />
          </g>
        ),
      };
    case 'beads':
      return {
        front: (
          <g>
            {Array.from({ length: 11 }, (_, i) => {
              const a = (i / 10) * Math.PI;
              return <circle cx={fmt(31 - Math.cos(a) * 8.6)} cy={fmt(48.6 + Math.sin(a) * 7.4)} r=".95" fill={i % 2 === 0 ? mix(GOLD, INK, 0.2) : madder} stroke={INK} stroke-width=".25" />;
            })}
            <path stroke={madder} stroke-width=".8" d="M31 56v4M30 60.4h2" />
          </g>
        ),
      };
    case 'seal':
      return {
        front: (
          <g>
            <path stroke={madder} stroke-width=".8" fill="none" d="M26.6 46.6c1.6 3 3 5.2 4.4 6.4 1.4-1.2 2.8-3.4 4.4-6.4" />
            <circle cx="31" cy="55.6" r="3" fill={GOLD} stroke={INK} stroke-width=".5" />
            <circle cx="31" cy="55.6" r="1.6" fill="none" stroke={mix(GOLD, INK, 0.5)} stroke-width=".5" />
          </g>
        ),
      };
    case 'sphere':
      return {
        front: (
          <g fill="none" stroke={GOLD} stroke-width=".9">
            <circle cx="31" cy="54" r="4.6" stroke={mix(GOLD, INK, 0.3)} />
            <ellipse cx="31" cy="54" rx="4.6" ry="1.6" transform="rotate(-20 31 54)" />
            <ellipse cx="31" cy="54" rx="1.7" ry="4.6" />
            <path stroke={wood} stroke-width="1.2" d="M31 58.6v2.6M28 61.4h6" />
          </g>
        ),
      };
  }
};

const BUST = 'M7 66c.8-10.5 7.3-17.4 17-20.4l3.4-1.2 7.6-.9 3.2.9c9.4 2.7 15.8 9.8 17.4 21.6z';

const garment = (spec: PortraitSpec, bustClip: string): ComponentChildren => {
  const t = spec.tones;
  switch (spec.garment) {
    case 'collar':
      return (
        <g>
          <path fill={PAPER_HI} d={BUST} />
          <path stroke={GOLD} stroke-width="2.4" fill="none" d="M21 46.4c6 6.6 16 7 23.6-.4" />
          <path stroke={t.deep} stroke-width="2" fill="none" d="M18.6 48.6c7.4 8.2 19.8 8.6 28.6-.4" />
          <path stroke={GOLD} stroke-width="2.2" stroke-dasharray=".6 1.6" stroke-linecap="round" fill="none" d="M16.6 51.4c8.6 9.4 23.2 9.8 33-.4" />
        </g>
      );
    case 'himation':
      return (
        <g>
          <path fill={PAPER_HI} d={BUST} />
          <path fill={t.light} d="M25 45l9.8-1.4C30 52 27.6 59 27 66H12.6c2-8.8 6.4-16.6 12.4-21z" />
          <path stroke={t.deep} stroke-width=".9" fill="none" d="M17.4 58c4-5 8.4-8.6 13.2-11M20.4 64c3.2-6 7-10.6 11.6-14M44 52c-2 4-3 8-3.2 13" />
        </g>
      );
    case 'crossrobe':
      return (
        <g>
          <path fill={t.deep} d={BUST} />
          <path stroke={PAPER_HI} stroke-width="2.6" fill="none" d="M26.6 44.6L36.4 58M37.2 43.8l-4 7" />
          <path stroke={t.light} stroke-width=".9" fill="none" d="M14 58c2-4 5-7 8.6-9.4M48 56c-1.4-3.4-3.6-6-6.4-8" />
        </g>
      );
    case 'cloak':
      return (
        <g>
          <path fill={t.deep} d={BUST} />
          <path fill={PAPER_HI} d="M28.6 44.4l7.6-.9c.6 7.4-.2 15-2 22.5h-3.4c-.4-7.6-1-14.6-2.2-21.6z" />
          <path stroke={GOLD} stroke-width="1.4" fill="none" d="M28.4 44.6c1.4 7 2 14 2.2 21.4M36.4 43.6c.4 7.6-.4 15-2.2 22.4" />
        </g>
      );
    case 'brooch':
      return (
        <g>
          <path fill={t.light} d={BUST} />
          <path stroke={t.deep} stroke-width=".9" fill="none" d="M18 54c3-3 6-5 9.6-6.4M44 49c3 3.4 5 7.6 5.8 12.4M30 52c4 3 6 7.6 6.6 13" />
          <circle cx="40" cy="49.4" r="3.4" fill={GOLD} />
          <circle cx="40" cy="49.4" r="1.6" fill="none" stroke={mix(GOLD, INK, 0.5)} stroke-width=".8" />
        </g>
      );
    case 'parka':
      return (
        <g>
          <path fill={mix(GOLD, PAPER, 0.35)} d={BUST} />
          <path stroke={t.deep} stroke-width="2.6" stroke-dasharray="1.4 1.2" fill="none" d="M12 56.6c12 3 30 3 42 0" />
          <path stroke={t.deep} stroke-width="1.2" fill="none" d="M32.2 46v20" />
        </g>
      );
    case 'deel':
      return (
        <g>
          <path fill={t.light} d={BUST} />
          <path stroke={t.deep} stroke-width="2.6" fill="none" d="M28 44.6c4 3.6 8.6 6.4 14 7.4" />
          <g fill={GOLD}>
            <circle cx="36" cy="49.6" r="1" />
            <circle cx="40" cy="51.2" r="1" />
          </g>
          <path stroke={t.deep} stroke-width=".9" fill="none" d="M42 52c1.6 4 2.2 8.6 2.2 14" />
        </g>
      );
    case 'mantle':
      return (
        <g>
          <path fill={t.deep} d={BUST} />
          <path fill={PAPER_HI} d="M27.4 44.4l8-1c.4 2.6.2 5-.6 7.4l-6.6.6c-.6-2.4-.8-4.6-.8-7z" />
          <path stroke={GOLD} stroke-width="1.3" fill="none" d="M18 51.6c6.4 3.6 17.4 3.8 26.4-.4" />
          <circle cx="18.4" cy="51.6" r="1.6" fill={GOLD} />
          <circle cx="44.2" cy="51.2" r="1.6" fill={GOLD} />
        </g>
      );
    case 'drape':
      return (
        <g>
          <path fill={t.light} d={BUST} />
          <path stroke={t.deep} stroke-width=".9" fill="none" d="M18 56c4-4 8.6-7 13.6-8.6M24 64c3-6 7-10.4 12-13" />
        </g>
      );
    case 'tunic':
      return (
        <g>
          <path fill={t.light} d={BUST} />
          <path fill={PAPER_HI} d="M27.6 44.6l4.4 7 4.2-7.8z" />
          <path stroke={t.deep} stroke-width="1.3" fill="none" d="M27.4 44.4l4.6 7.4 4.4-8.2" />
          <path stroke={t.deep} stroke-width=".8" fill="none" d="M16 60c2-3.6 4.6-6.4 8-8.4M47.6 58c-1.6-3.2-3.8-5.6-6.6-7.4" />
        </g>
      );
    case 'stole':
      return (
        <g>
          <path fill={t.light} d={BUST} />
          <path fill={t.deep} d="M24 45.6c1.4 6 1.4 13 .4 20.4h4c.6-7.2.2-14-1.4-20.8zM38.4 44.4c-1 7-1 14.2.2 21.6h4c-1.6-7.4-2-14.6-1-21.8z" />
          <path stroke={GOLD} stroke-width=".9" d="M24.6 58h3.6M39 58.4h3.6M25.6 56v4M40.6 56.4v4" />
        </g>
      );
    case 'furTrim':
      return (
        <g>
          <path fill={t.deep} d={BUST} />
          <path stroke={mix(GOLD, PAPER, 0.45)} stroke-width="5" stroke-linecap="round" fill="none" d="M19 49.6c8 6.2 21 6.2 28.6-.8" />
          <path stroke={mix(GOLD, INK, 0.35)} stroke-width=".5" fill="none" d="M21 49l-.6 2.6M24 51.4l-.4 2.6M27.4 53l-.2 2.6M31 53.8v2.6M34.6 53.6l.2 2.6M38.2 52.6l.4 2.6M41.6 51l.6 2.4M44.6 48.8l.8 2.2" />
        </g>
      );
    case 'lamellar': {
      const rows: string[] = [];
      for (let y = 47; y < 66; y += 2.6) for (let x = 8 + ((y * 10) % 3); x < 56; x += 3) rows.push(`M${fmt(x)} ${fmt(y)}q1.5 1.8 3 0`);
      return (
        <g>
          <path fill={metal} d={BUST} />
          <g clip-path={`url(#${bustClip})`}>
            <path stroke={INK} stroke-opacity=".55" stroke-width=".45" fill="none" d={rows.join('')} />
          </g>
          <path stroke={madder} stroke-width="1.6" fill="none" d="M24.6 46c4.4 2.6 9 2.6 13.8-.6" />
        </g>
      );
    }
  }
};

/** Culture ornament ring on archetype medallions (between rim and emblem). */
const ornamentRing = (o: Ornament, color: string): ComponentChildren => {
  const P = (r: number, a: number): string => `${fmt(32 + Math.cos(a) * r)} ${fmt(32 + Math.sin(a) * r)}`;
  const TAU = Math.PI * 2;
  const ring = (n: number, draw: (a: number, i: number) => string): string => Array.from({ length: n }, (_, i) => draw((i / n) * TAU, i)).join('');
  let d = '';
  let fillD = '';
  switch (o) {
    case 'lotus':
      fillD = ring(16, (a) => `M${P(21, a)}Q${P(23.6, a - 0.12)} ${P(25.2, a)}Q${P(23.6, a + 0.12)} ${P(21, a)}Z`);
      break;
    case 'meander': {
      const n = 40;
      d = `M${P(21.4, 0)}`;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU;
        const a1 = ((i + 0.5) / n) * TAU;
        const a2 = ((i + 1) / n) * TAU;
        d += i % 2 === 0 ? `L${P(24.8, a0)}L${P(24.8, a1)}L${P(21.4, a1)}L${P(21.4, a2)}` : `L${P(21.4, a2)}`;
      }
      break;
    }
    case 'cloud':
      d = ring(14, (a) => `M${P(22.6, a)}a1.5 1.5 0 1 1 ${fmt(Math.cos(a + 1.6) * 1.6)} ${fmt(Math.sin(a + 1.6) * 1.6)}`);
      break;
    case 'star':
      fillD = ring(12, (a) => {
        const c = P(23.2, a);
        const [cx, cy] = c.split(' ').map(Number) as [number, number];
        return `M${fmt(cx)} ${fmt(cy - 1.8)}L${fmt(cx + 0.5)} ${fmt(cy - 0.5)}L${fmt(cx + 1.8)} ${fmt(cy)}L${fmt(cx + 0.5)} ${fmt(cy + 0.5)}L${fmt(cx)} ${fmt(cy + 1.8)}L${fmt(cx - 0.5)} ${fmt(cy + 0.5)}L${fmt(cx - 1.8)} ${fmt(cy)}L${fmt(cx - 0.5)} ${fmt(cy - 0.5)}Z`;
      });
      break;
    case 'knot': {
      const n = 28;
      let a1 = `M${P(21.4, 0)}`;
      let a2 = `M${P(24.8, 0)}`;
      for (let i = 1; i <= n; i++) {
        const a = (i / n) * TAU;
        a1 += `L${P(i % 2 ? 24.8 : 21.4, a)}`;
        a2 += `L${P(i % 2 ? 21.4 : 24.8, a)}`;
      }
      d = a1 + a2;
      break;
    }
    case 'beadwork':
      fillD = ring(24, (a, i) => (i % 2 === 0 ? `M${P(23.1, a)}m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0Z` : `M${P(21.8, a)}L${P(24.4, a)}L${P(24.4, a + 0.04)}L${P(21.8, a + 0.04)}Z`));
      break;
    case 'scrolls':
      d = ring(12, (a) => `M${P(21.4, a)}Q${P(25.6, a + 0.12)} ${P(23.2, a + 0.3)}`);
      break;
    case 'chevron': {
      const n = 32;
      d = `M${P(21.6, 0)}`;
      for (let i = 1; i <= n; i++) d += `L${P(i % 2 ? 24.6 : 21.6, (i / n) * TAU)}`;
      break;
    }
    case 'ticks':
      d = ring(16, (a) => `M${P(21.4, a)}L${P(24.8, a)}`);
      break;
  }
  return (
    <g>
      <circle cx="32" cy="32" r="20.2" fill="none" stroke={color} stroke-opacity=".55" stroke-width=".7" />
      <circle cx="32" cy="32" r="25.8" fill="none" stroke={color} stroke-opacity=".55" stroke-width=".7" />
      {d && <path d={d} fill="none" stroke={color} stroke-opacity=".75" stroke-width=".8" stroke-linejoin="round" />}
      {fillD && <path d={fillD} fill={color} fill-opacity=".75" />}
    </g>
  );
};

const F = 'fill="currentColor"';
/** Role emblems on a 24-unit grid, stroked like the icon set. */
const EMBLEM_ART: Record<Emblem, string> = {
  boat: `<path ${F} d="M2.6 15h18.8l-3.2 4.6H5.8z"/><path d="M12 15V3.6"/><path ${F} d="M12.6 4.4l6.4 9H12.6z"/><path stroke-width="1" d="M1.6 22c2-1.2 4-1.2 6.2 0s4.2 1.2 6.2 0 4.2-1.2 6.4 0"/>`,
  sled: `<path d="M2.6 17.6h15.8c2 0 3.4-1.2 3.4-3"/><path d="M5 17.6v-4M15.4 17.6v-4"/><path ${F} d="M4 9.6h13.6v4H4z"/><path stroke-width="1" d="M6.4 9.6l1-3.4h7l1 3.4"/>`,
  horse: `<path ${F} d="M6.4 21.6c.4-4.4 1.4-7.8 3.6-10.4l-2-2.6c1.4-.8 2.8-.6 4 .2l1.2-3.2 1.2 3.4c2.6 1.4 4.6 3.8 5.4 6.6l-1.8 1.4-3.6-1.6c-.6 2.4-.2 4.4.8 6.2z"/><path stroke-width="1" d="M10.6 11.2c-1.6 1.4-2.8 3.2-3.4 5.4"/>`,
  hammer: `<path ${F} d="M3 15.4h13.4c-.2 1.8-1.8 2.8-3.6 3V21H7.4v-2.6C5.4 18 3.6 17 3 15.4z"/><path stroke-width="2" d="M7.6 12.4l8.6-8.6"/><path ${F} d="M13.4 3.2l2.6-2.6 4.8 4.8-2.6 2.6z"/>`,
  chisel: `<path d="M3 21.4V12.6h10.6v8.8z"/><path stroke-width="1" d="M5.6 17c.6-2 2.4-2.6 3.6-1.6.8.8.2 2-.8 1.8"/><path stroke-width="2" d="M12.6 11l6.6-6.6"/><path ${F} d="M11.2 12.4l1.4 1.4-2.8 1.2z"/><path ${F} d="M18 2.4l3.6 3.6-2.4 2.4-3.6-3.6z"/>`,
  scroll: `<path d="M6 6.4h12v11.2H6z"/><rect ${F} x="3.4" y="3.6" width="17.2" height="3.2" rx="1.6"/><rect ${F} x="3.4" y="17.2" width="17.2" height="3.2" rx="1.6"/><path stroke-width="1" d="M8.6 9.6h6.8M8.6 12h6.8M8.6 14.4h4.6"/>`,
  sun: `<circle ${F} cx="12" cy="12" r="4.2"/><path d="M12 2v3.4M12 18.6V22M2 12h3.4M18.6 12H22M4.9 4.9l2.4 2.4M16.7 16.7l2.4 2.4M4.9 19.1l2.4-2.4M16.7 7.3l2.4-2.4"/>`,
  iglu: `<path d="M2.6 19.4a9.4 9.4 0 0 1 18.8 0z"/><path stroke-width="1" d="M3.6 15.4h16.8M5.6 11.6h12.8M9 8.4h6M8 19.4v-4M14 15.4v-3.8M11 11.6V8.4M16.4 19.4v-4"/><path ${F} d="M9.4 19.4v-1.6a2.6 2.6 0 0 1 5.2 0v1.6z"/>`,
  house: `<path stroke-width="1.8" d="M2 19.6c1.8-7.4 18.2-7.4 20 0"/><path stroke-width="1" d="M6.2 19.6c1.4-4.6 10.2-4.6 11.6 0"/><path ${F} d="M9.6 19.6v-1.8a2.4 2.4 0 0 1 4.8 0v1.8z"/><path d="M1.2 21.6h21.6"/>`,
  wall: `<path d="M3 20.4V8.6h18v11.8z"/><path stroke-width="1" d="M3 12.6h18M3 16.6h18M9 8.6v4M15 8.6v4M6 12.6v4M12 12.6v4M18 12.6v4M9 16.6v3.8M15 16.6v3.8"/><path d="M3 8.6V6h3v2.6M10.5 8.6V6h3v2.6M18 8.6V6h3v2.6"/>`,
  bow: `<path d="M7.4 2.6c7.4 4.4 7.4 14.4 0 18.8"/><path stroke-width="1" d="M7.4 2.6v18.8"/><path d="M2.4 12h18.4"/><path ${F} d="M21.8 12l-3.4-2v4z"/>`,
  caravan: `<path d="M1.6 20c3.4-3.6 7.4-3.6 10.4-.4 3-3.2 7-3.2 10.4.4"/><path ${F} d="M16.4 3.4l.9 2.4 2.5.2-1.9 1.6.6 2.4-2.1-1.3-2.1 1.3.6-2.4-1.9-1.6 2.5-.2z"/><circle ${F} cx="5" cy="13.6" r=".9"/><circle ${F} cx="8" cy="12" r=".9"/><circle ${F} cx="11.2" cy="11" r=".9"/>`,
  scales: `<path d="M12 3.4v16.4M5 7h14M8 20.4h8"/><path stroke-width="1" d="M5 7l-2.2 6M5 7l2.2 6M19 7l-2.2 6M19 7l2.2 6"/><path ${F} d="M2.4 13h5.2a2.6 2.6 0 0 1-5.2 0zM16.4 13h5.2a2.6 2.6 0 0 1-5.2 0z"/>`,
  drum: `<ellipse cx="10.4" cy="10.6" rx="7.2" ry="7.8" stroke-width="1.8"/><ellipse cx="10.4" cy="10.6" rx="4.6" ry="5.2" stroke-width=".7"/><path stroke-width="1.8" d="M10.4 18.4v3.6"/><path d="M17.6 4.4c2 1.8 3 4.2 3 7"/><circle ${F} cx="20.6" cy="12.2" r="1.3"/>`,
  stones: `<path ${F} d="M3.6 20.6v-8.6c0-2 3.2-2.4 3.4-.2l.6 8.8zM9.8 20.6l.2-13.4c.2-2.6 4-2.6 4.2 0l.2 13.4zM16.6 20.6l.4-6.6c.2-2 3.4-1.8 3.4.2v6.4z"/><path d="M1.6 21.2h20.8"/>`,
  inukshuk: `<path ${F} d="M6.4 21.6v-5.2h4v5.2zM13.6 21.6v-5.2h4v5.2zM5.6 15.6v-3.8h12.8v3.8zM2.4 11h19.2V8.4H2.4zM9.6 7.6V3.6h4.8v4z"/>`,
  ice: `<path ${F} d="M3.6 13.6l3.6-6h8.4l4.8 6z"/><path stroke-width="1" d="M9 9.6l1.4 2M14 9.4l-.8 2.2"/><path d="M1.6 17.4c2-1.2 4-1.2 6.2 0s4.2 1.2 6.2 0 4.2-1.2 6.4 0M3.4 21c2-1.2 4-1.2 6 0s4 1.2 6 0 4-1.2 6 0"/>`,
  tent: `<path d="M2.4 20.4L12 4.4l9.6 16z"/><path ${F} d="M10 20.4l2-5.4 2 5.4z"/><path d="M10 2.4l2 2 2-2"/><path stroke-width="1" d="M6.2 14h3M14.8 14h3"/>`,
  ger: `<path d="M2.6 20.6v-6.2l9.4-6 9.4 6v6.2z"/><path ${F} d="M10 20.6v-4.4h4v4.4z"/><path stroke-width="1" d="M2.6 14.4h18.8M4.6 16.6l2.6 3.4M7.2 16.6l-2.6 3.4M19.4 16.6l-2.6 3.4M16.8 16.6l2.6 3.4"/><circle ${F} cx="12" cy="8" r="1.4"/>`,
  tripod: `<path ${F} d="M4.6 9.2h14.8c0 3-3.2 5.2-7.4 5.2S4.6 12.2 4.6 9.2z"/><path d="M7.4 13.4l-2 8.2M16.6 13.4l2 8.2M12 14.4v7.2"/><path stroke-width="1" d="M9.4 7c-1-1.6 0-3.2 1-4.4M13.6 7c-1-1.6 0-3.2 1-4.4"/>`,
  brush: `<path d="M3.4 3.4h11.2v13.2H3.4z"/><path stroke-width="1" d="M5.6 13.6c1.6-2.4 3.6-4 6.6-4.6M5.6 7.6h4"/><path stroke-width="1.6" d="M12.6 21.6l6.4-8.4"/><path ${F} d="M19 13.2l1.6-3.4.8.6-1.4 3.6z"/>`,
  oracle: `<path d="M5.4 3.6h12.4c2.2 4.4 2 12.2-1.2 16.8H7c-3-4.4-3.6-12.4-1.6-16.8z"/><path stroke-width="1" d="M9 7.4v3.6l2 1M14.6 12.4v3.4l-2 1.2M9.6 15.6l1.6.8"/><circle ${F} cx="14" cy="7.4" r=".9"/><circle ${F} cx="9" cy="17.6" r=".9"/>`,
  herb: `<path d="M12 21.6V5"/><path ${F} d="M12 8.4c-3.6-.4-5.6-2.6-5.4-5.4 3.4.2 5.4 2.4 5.4 5.4zM12 12.6c3.6-.4 5.6-2.6 5.4-5.4-3.4.2-5.4 2.4-5.4 5.4zM12 16.6c-3.6-.4-5.6-2.6-5.4-5.4 3.4.2 5.4 2.4 5.4 5.4z"/><path d="M6.4 21.6h11.2"/>`,
  shield: `<circle cx="12" cy="12" r="8.4" stroke-width="1.8"/><circle cx="12" cy="12" r="5" stroke-width=".8"/><circle ${F} cx="12" cy="12" r="2"/><path ${F} d="M10.4 3.6h3.2L12 7.4z"/>`,
  staff: `<path d="M12 2.4v19.6"/><path ${F} d="M9.4 5.6h5.2l-.8 3.4h-3.6zM9.4 10.6h5.2l-.8 3.4h-3.6zM9.4 15.6h5.2l-.8 3.4h-3.6z"/>`,
  star: `<path ${F} d="M12 2l2.4 7.2H22l-6.2 4.6 2.4 7.4L12 16.6l-6.2 4.6 2.4-7.4L2 9.2h7.6z"/>`,
  cairn: `<path ${F} d="M6 17.6c.4-4.6 3-7.2 6-7.2s5.6 2.6 6 7.2z"/><path stroke-width="1" d="M10.4 10.6l1.6-2 1.6 2"/>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<circle ${F} cx="${(12 + Math.cos((i / 10) * 6.283) * 10).toFixed(1)}" cy="${(17.6 + Math.sin((i / 10) * 6.283) * 3.4).toFixed(1)}" r=".9"/>`).join('')}`,
  rider: `<path ${F} d="M5.4 21.6c.4-4 1.2-7 3.2-9.4L7.2 9.6c1.2-.8 2.6-.6 3.6.2l1.2-3 1 3.2c2.4 1.4 4.2 3.6 4.8 6.2l-1.6 1.4-3.2-1.6c-.6 2.4-.2 4.2.8 5.6z"/><path d="M19 22V2.4"/><path ${F} d="M19 2.6l-5.6 2 5.6 2.2z"/>`,
  needle: `<path stroke-width="1.8" d="M5 19L18.6 5.4"/><ellipse cx="19.4" cy="4.6" rx="1.6" ry="1" transform="rotate(-45 19.4 4.6)" stroke-width=".9"/><path stroke-width="1" d="M20.4 3.6c2 3.4-1.4 6-4.4 7.4s-8 2.6-9 6.4 3.2 4.4 6 3.4"/>`,
  whale: `<path ${F} d="M12 14.6c-1.2-3.4-4.2-5.6-7.8-5.8 1.4 1.8 1.8 4 1.2 6 2.4-.6 4.6 0 6.6 1.4zM12 14.6c1.2-3.4 4.2-5.6 7.8-5.8-1.4 1.8-1.8 4-1.2 6-2.4-.6-4.6 0-6.6 1.4z"/><path stroke-width="2" d="M12 14.4v4"/><path d="M1.6 19.6c2-1.2 4-1.2 6.2 0s4.2 1.2 6.2 0 4.2-1.2 6.4 0M3.4 22.6c2-1 4-1 6 0s4 1 6 0 4-1 6 0"/>`,
  wolf: `<path ${F} d="M5.6 21.6c-.4-3.6.2-6.6 2-9.2L6.4 7.4 8.6 9l1.6-5.4 1.4 4.4c2.4.6 4 2 4.8 4.2l3.4 1.8-.4 1.4-3.2-.4c-.4 2.6-1.8 4.6-3.6 6l.6 2.6z"/><path stroke-width="1" d="M18.6 3.4a3.2 3.2 0 1 0 2.4 4.6 2.6 2.6 0 1 1-2.4-4.6z"/>`,
};

/** Archetype medallion field: ornament ring in the culture's pattern around a role emblem. */
const emblemField = (spec: PortraitSpec): ComponentChildren => (
  <g>
    {ornamentRing(spec.ornament, spec.tones.light)}
    <circle cx="32" cy="32" r="16.4" fill={mix(spec.tones.base, INK, 0.25)} fill-opacity=".5" />
    <g
      transform="translate(20 20)"
      style={{ color: PAPER_HI }}
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      dangerouslySetInnerHTML={{ __html: EMBLEM_ART[spec.emblem] }}
    />
  </g>
);

const legendRays = (): ComponentChildren => {
  const pts: string[] = [];
  const n = 24;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 32 : 29.4;
    pts.push(`${(32 + Math.cos(a) * r).toFixed(2)},${(32 + Math.sin(a) * r).toFixed(2)}`);
  }
  return <polygon points={pts.join(' ')} fill={GOLD} stroke={mix(GOLD, INK, 0.45)} stroke-width=".5" />;
};

export function PortraitArt({ spec, size = 56, label, badge = true }: { spec: PortraitSpec; size?: number; label?: string; badge?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const clip = `pc${uid}`;
  const bustClip = `pb${uid}`;
  const grad = `pg${uid}`;
  const t = spec.tones;
  const legend = spec.frame === 'legend';
  const ringR = legend ? 27.2 : 29.2;
  const fieldR = ringR - 2.6;
  const bust = spec.mode === 'bust';
  const hw = bust ? headwear(spec.headwear, t, spec.accent, spec.presentation === 'f') : {};
  const prop = bust ? propLayer(spec.prop, t) : {};
  const face = FACE_SHAPE[spec.face];
  const q = spec.view === 'threeQuarter';
  const hairColor = HAIR_COLOR[spec.hairTone];
  const showEar = !COVERS_EAR.has(spec.headwear) && spec.hair !== 'long';
  const flip = spec.facing === 'left' ? 'translate(64 0) scale(-1 1)' : undefined;
  const beads = Array.from({ length: spec.beads }, (_, i) => {
    const a = (i / spec.beads) * Math.PI * 2;
    return <circle cx={32 + Math.cos(a) * (ringR - 1.3)} cy={32 + Math.sin(a) * (ringR - 1.3)} r=".75" />;
  });
  return (
    <svg
      class="portrait-art"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      <defs>
        <clipPath id={clip}>
          <circle cx="32" cy="32" r={fieldR} />
        </clipPath>
        <clipPath id={bustClip}>
          <path d={BUST} />
        </clipPath>
        <radialGradient id={grad} cx="42%" cy="36%" r="70%">
          <stop offset="0" stop-color={mix(t.base, PAPER_HI, 0.18)} />
          <stop offset="1" stop-color={mix(t.base, INK, 0.25)} />
        </radialGradient>
      </defs>
      {legend && legendRays()}
      {/* Rim: paper ring with an ink edge and coin beads. */}
      <circle cx="32" cy="32" r={ringR} fill={legend ? mix(GOLD, PAPER_HI, 0.35) : PAPER} stroke={INK} stroke-opacity=".55" stroke-width=".9" />
      <g fill={legend ? mix(GOLD, INK, 0.4) : mix(t.base, INK, 0.2)}>{beads}</g>
      <circle cx="32" cy="32" r={fieldR} fill={`url(#${grad})`} stroke={INK} stroke-opacity=".6" stroke-width=".8" />
      <g clip-path={`url(#${clip})`}>
        {!bust ? (
          emblemField(spec)
        ) : (
          <g transform={flip}>
            {prop.back}
            {garment(spec, bustClip)}
            {spec.armour && spec.garment !== 'lamellar' && (
              <g>
                <path fill={metal} stroke={INK} stroke-width=".7" d="M36.6 45.2c6.6-1.4 12.4 1.8 15 7.8l-4.2 1.6c-2-3.6-5.4-5.6-10-5.6z" />
                <path stroke={INK} stroke-width=".6" fill="none" d="M39 47.6c3.8-.2 6.8 1.6 8.6 4.6" />
              </g>
            )}
            <g transform={`rotate(${spec.tilt} 31 40)`}>
              {hw.back}
              <path fill={PAPER_HI} stroke={INK} stroke-opacity=".35" stroke-width=".5" d={q ? threeQuarterHead(face) : profileHead(face)} />
              {hairShape(spec, hairColor)}
              {features(spec, mix(t.base, INK, 0.45), showEar)}
              {beardShape(spec.beard, q, face, hairColor)}
              {spec.earring && showEar && <circle cx={q ? 22.8 : 30.8} cy={q ? 32.4 : 32.6} r="1" fill={GOLD} />}
              {hw.front}
            </g>
            {prop.front}
          </g>
        )}
      </g>
      {badge && (
        <g>
          <circle cx="53.4" cy="53.4" r="8.4" fill={PAPER_HI} stroke={INK} stroke-opacity=".6" stroke-width=".9" />
          <g
            transform="translate(47.4 47.4) scale(.5)"
            style={{ color: INK }}
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            dangerouslySetInnerHTML={{ __html: iconMarkup(spec.kindIcon) }}
          />
        </g>
      )}
    </svg>
  );
}
