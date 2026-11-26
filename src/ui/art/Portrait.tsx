/**
 * Draws a PortraitSpec (src/ui/art/portrait-spec.ts) as a coin/cameo medallion: a paper-light
 * profile bust on the culture's pigment, a beaded rim, and a kind badge. 64-unit grid,
 * profile facing right (mirrored for 'left'). Every shape is a flat fill or an ink line, so
 * it reads at 32px and prints cleanly at 96px.
 */
import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import { iconMarkup } from './icons-data';
import { GOLD, INK, PAPER, PAPER_HI, mix } from './palette';
import type { Headwear, PortraitSpec } from './portrait-spec';

const HEAD =
  'M30 14.2c6.6-.6 11.3 3.6 11.6 9l-.1 1.3 2.2 3.9c.2.4 0 .8-.4.9l-1.6.4.4 1.5-.7.6.5 1.3c.1.5-.2 1-.7 1.1l-.6.1-.3 1.5c-.3 1.4-1.6 2.3-3 2.1l-3-.4.4 5.2-8.4 1c.1-3.1-.6-5.2-2.6-7.4-3.6-4-3.4-17.6 6.3-22.1z';
const BUST = 'M7 66c.8-10.5 7.3-17.4 17-20.4l3.4-1.2 7.6-.9 3.2.9c9.4 2.7 15.8 9.8 17.4 21.6z';
const EYE = 'M36.9 24.7c.9-.6 1.9-.6 2.6 0';

const HAIR_SHORT =
  'M29.5 13.6c-6.5.8-10 6.5-8.6 13.5.4 2 1.3 3.6 2.6 4.7l1-3.2c.8-.4 1.7-.2 2.3.4l.3-4.5c2.5-1 5.4-2.8 6.6-5.4 2.2 1.8 5.2 2.4 8.3 1.9-1.5-5-6.6-8.2-12.5-7.4z';
const HAIR_LONG =
  'M29.5 13.6c-7 .8-11 7.2-9.7 15.3.6 4.2 1 8.6-.4 13.4l6.8-.8c-.2-3-.8-5-2.1-6.8l1.5-1.2c.7-.3 1.6-.1 2.1.5l.4-4.6c2.5-1 5.4-2.8 6.6-5.4 2.2 1.8 5.2 2.4 8.3 1.9-1.5-5-6.6-8.2-12.5-7.4z';

const metal = mix(PAPER, INK, 0.32);
const madder = '#8f2a21';

interface Layer {
  back?: ComponentChildren;
  front?: ComponentChildren;
}

/** Headwear: `back` is drawn behind the head (and hair), `front` over it. */
const headwear = (h: Headwear, t: PortraitSpec['tones']): Layer => {
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
          </g>
        ),
      };
    case 'wig':
      return {
        front: (
          <g>
            <path
              fill={t.deep}
              d="M29 13.4c-6.8.6-10.8 6-10.2 13.6.3 4.2 1.4 8 3.6 10.6l9.4-.4-1-6.2c-.2-1.2.6-2.2 1.8-2.3l1.2-.1-.8-6.4c3-.4 6.2-.2 8.8.6-1-5.6-6.4-10-12.8-9.4z"
            />
            <path stroke={t.base} stroke-width=".8" fill="none" d="M20.6 24h9M20.2 27.4h9.6M20.8 30.8h9.4M22 34.2h8.6" />
            <path stroke={GOLD} stroke-width="1.6" fill="none" d="M21.4 20.4c6-1.8 13-2 19.6-.6" />
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
          </g>
        ),
      };
    case 'laurel':
      return {
        front: (
          <g>
            <path stroke={GOLD} stroke-width="1.2" fill="none" d="M21.8 22.6c3.4-5.6 12.6-7.8 19.4-3.4" />
            <g fill={GOLD}>
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
            <path
              fill={GOLD}
              d="M21.4 28c-1.6-8.4 3-14.6 10.4-15 6-.3 10.4 3.4 10.6 9.6l-.4 2.6h-3.4l-.4 2.2 1.6 5.6c.2.8-.3 1.6-1.1 1.8l-4.8 1.2c-3.4.7-6-.6-7.6-3.2l-1.4 1.6c-1.6-.8-2.8-2.6-3.5-6.4z"
            />
            <path stroke={mix(GOLD, INK, 0.5)} stroke-width="1.1" fill="none" d="M33 24.6c2.2-.6 4.4-.6 6.4.2M38.6 24.6l.2 3.6M22.8 21.2c4.6-1.8 11-2.2 18.8-.4" />
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
    case 'futou':
      return {
        back: <path stroke={INK} stroke-width="1.8" fill="none" d="M23.4 17.4l-9.4-3.6M23.6 19.6l-9.2 1.6" />,
        front: <path fill={INK} d="M21.8 21.6c-.8-6 3.6-9.6 9.6-9.6 5.6 0 9.2 2.8 9.8 7l-.2 1.4c-6.4-.8-13.2-.6-19.2 1.2z" />,
      };
    case 'turban':
      return {
        front: (
          <g>
            <path fill={PAPER_HI} d="M21.2 23c-1.8-7.2 2.8-11.6 10.4-12.2 6.4-.4 10.6 2.6 10.8 7.4l-.8 3.4c-6.8-1.6-14.2-1.4-20.4 1.4z" />
            <path stroke={t.deep} stroke-width=".9" fill="none" d="M22.4 20.4c5.2-3.6 12.4-4.4 19.4-2.2M22.2 16.8c4.8-3 12-3.6 18.4-1.4M27.4 11.6c3.4 2.2 5.4 5.4 6 10" />
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
            <path
              fill={PAPER_HI}
              d="M22 22.4c.6-5.6 4.4-9.2 9.8-9.4 6-.2 9.8 2.8 10.4 7.6l-.6 1.6c-6.4-1.4-13-1.2-19.6.2z"
            />
            <path stroke={t.base} stroke-width=".7" stroke-dasharray="1.2 1.2" fill="none" d="M21 30h9M20.6 34h9.8M21 38h10.6M22.8 18.4c5.4-2 11.6-2.2 17.4-.4" />
            <path stroke={INK} stroke-width="1.6" fill="none" d="M22.6 20.6c6-2.2 12.4-2.4 18.4-.8M22.8 22.6c6-2 12-2.2 18-.8" />
          </g>
        ),
      };
    case 'veil':
      return {
        back: (
          <path
            fill={t.light}
            d="M18.8 44c1-6.4.6-11.6-.4-16-1.6-9.2 4-15.6 12.2-15.8 6.8-.2 11 3.8 11.2 9.6l-2 1.2c-3-1-6-1-8.4.2l-1.2 8.8 2.6 11.2z"
          />
        ),
        front: (
          <g>
            <path fill={t.light} d="M21.6 23.6c0-6.6 4.2-10.4 10-10.6 6-.2 9.8 3.2 10.2 8.2l-1.4 1.4c-6-1.4-12.6-1-18.8 1z" />
            <path stroke={t.base} stroke-width=".8" fill="none" d="M22.6 21.6c5.6-2.2 12.2-2.6 18.2-.8" />
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
            <path stroke={INK} stroke-width=".6" stroke-dasharray=".8 1" fill="none" d="M23 27h6M23.4 30h6M24.4 33h5.2" />
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
    case 'hood':
      return {
        back: (
          <path
            fill={t.deep}
            d="M19.2 43c.6-5 .4-9.4-.6-13.8-2-9.6 3.6-16.6 12.2-16.8 7-.2 11.4 4.2 11.4 10l-2.6.4c-3 .4-5.6 2.6-6.2 5.6l-1.2 7 1.6 7.6z"
          />
        ),
        front: <path fill={t.deep} d="M22 23.6c-.2-6.6 4-10.4 9.8-10.6 6-.2 10 3.2 10.4 8.4l-1.6 1.2c-6-1.4-12.4-1-18.6 1z" />,
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
        back: <path stroke={t.deep} stroke-width="1.6" fill="none" d="M23.6 19.6c-3 2.2-4.8 5.2-5.4 9.4M24.6 20.2c-2 2.6-3 5.6-3 9" />,
        front: (
          <g>
            <path fill={madder} d="M25.2 16c.6-5.2 3.6-9.2 7.8-10.8 3.4 2 5.6 6 6 10.6z" />
            <circle cx="33" cy="4.6" r="1.4" fill={GOLD} />
            <path
              fill={mix(GOLD, PAPER, 0.15)}
              d="M22 21c-.8-2.6 0-5 2.2-5.6 5.4-1.4 11.4-1.2 16.4.8 1.6.8 1.8 3 .8 4.6-6.4-1.4-13.4-1.4-19.4.2z"
            />
            <path stroke={mix(GOLD, INK, 0.45)} stroke-width=".7" fill="none" d="M24 16.2l.4 3.6M27 15.4l.2 3.6M30 15l.1 3.6M33 15l-.1 3.6M36 15.4l-.2 3.6M39 16.2l-.4 3.4" />
          </g>
        ),
      };
    case 'cap':
      return { front: <path fill={t.deep} d="M21.6 21c-.6-5.4 3.6-9.4 9.8-9.6 5.6-.2 9.2 2.8 9.8 7.4-6.6-1.2-13.4-1-19.6 2.2z" /> };
  }
};

const hairShape = (spec: PortraitSpec, color: string): ComponentChildren => {
  switch (spec.hair) {
    case 'none':
      return null;
    case 'short':
      return <path fill={color} d={HAIR_SHORT} />;
    case 'long':
      return <path fill={color} d={HAIR_LONG} />;
    case 'bun':
      return (
        <g fill={color}>
          <path d={HAIR_SHORT} />
          <circle cx={spec.headwear === 'topknot' || spec.headwear === 'guan' ? 30.6 : 21.4} cy={spec.headwear === 'topknot' || spec.headwear === 'guan' ? 11 : 17.4} r="3.6" />
        </g>
      );
    case 'braid':
      return (
        <g fill={color}>
          <path d={HAIR_SHORT} />
          {[0, 1, 2, 3, 4].map((i) => (
            <ellipse cx={23.6 + i * 0.3} cy={31.5 + i * 3.4} rx="1.9" ry="2" />
          ))}
        </g>
      );
  }
};

const garment = (spec: PortraitSpec): ComponentChildren => {
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
  }
};

/** Concentric engraved rings behind an archetype's emblem. */
const emblemField = (spec: PortraitSpec): ComponentChildren => (
  <g>
    {[23, 18.5, 14].map((r) => (
      <circle cx="32" cy="32" r={r} fill="none" stroke={spec.tones.light} stroke-opacity=".38" stroke-width=".8" />
    ))}
    {Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return (
        <path
          stroke={spec.tones.light}
          stroke-opacity=".38"
          stroke-width=".8"
          d={`M${32 + Math.cos(a) * 15.5} ${32 + Math.sin(a) * 15.5}L${32 + Math.cos(a) * 22} ${32 + Math.sin(a) * 22}`}
        />
      );
    })}
    <g
      transform="translate(18.5 18.5) scale(1.125)"
      style={{ color: PAPER_HI }}
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      dangerouslySetInnerHTML={{ __html: iconMarkup(spec.kindIcon) }}
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
  const grad = `pg${uid}`;
  const t = spec.tones;
  const legend = spec.frame === 'legend';
  const ringR = legend ? 27.2 : 29.2;
  const fieldR = ringR - 2.6;
  const hw = spec.mode === 'bust' ? headwear(spec.headwear, t) : {};
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
        {spec.mode === 'emblem' ? (
          emblemField(spec)
        ) : (
          <g transform={flip}>
            {garment(spec)}
            {spec.armour && (
              <g>
                <path fill={metal} stroke={INK} stroke-width=".7" d="M36.6 45.2c6.6-1.4 12.4 1.8 15 7.8l-4.2 1.6c-2-3.6-5.4-5.6-10-5.6z" />
                <path stroke={INK} stroke-width=".6" fill="none" d="M39 47.6c3.8-.2 6.8 1.6 8.6 4.6" />
              </g>
            )}
            <g transform={`rotate(${spec.tilt} 31 40)`}>
              {hw.back}
              {hairShape(spec, t.deep)}
              <path fill={PAPER_HI} d={HEAD} />
              <path stroke={mix(t.base, INK, 0.3)} stroke-width=".8" fill="none" stroke-linecap="round" d={EYE} />
              {spec.earring && <circle cx="31.6" cy="30.6" r="1" fill={GOLD} />}
              {hw.front}
            </g>
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
