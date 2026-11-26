/**
 * Title screen: New game, Continue (newest autosave), Load, Settings. A layered paper diorama
 * (hills, a hex island with a little town, drifting clouds and birds) behind an atlas-style
 * logo lockup. All SVG/CSS; motion is CSS and stops under reduce motion.
 */
import { loadGame, openModal, route, saves } from '../store';
import { Icon } from '../art/Icon';
import { continueSave } from './saves-logic';
import { loading } from './shell-state';
import { endedOf, titleActions } from './ended-saves';

const HEX = (cx: number, cy: number, r: number): string => {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r * 0.58).toFixed(1)}`);
  }
  return pts.join(' ');
};

/** One diorama tile: top face plus a soil "cake slice" side. */
const Tile = ({ x, y, top, side = '#8a6a44', h = 7 }: { x: number; y: number; top: string; side?: string; h?: number }) => (
  <g>
    <polygon points={HEX(x, y + h, 22)} fill={side} />
    <path d={`M${x - 19} ${y + 6.4}v${h}l19 ${6.4}l19 -${6.4}v-${h}z`} fill={side} />
    <polygon points={HEX(x, y, 22)} fill={top} stroke="#5b4428" stroke-opacity=".35" stroke-width=".8" />
  </g>
);

function TitleScene() {
  const tiles: { x: number; y: number; top: string }[] = [
    { x: 150, y: 228, top: '#9fb07a' },
    { x: 188, y: 228, top: '#b9b77d' },
    { x: 226, y: 228, top: '#8fa46e' },
    { x: 131, y: 241, top: '#c7b98a' },
    { x: 169, y: 241, top: '#a5b27c' },
    { x: 207, y: 241, top: '#7fa0a6' },
    { x: 245, y: 241, top: '#7fa0a6' },
    { x: 150, y: 254, top: '#9db078' },
    { x: 188, y: 254, top: '#b3b37d' },
    { x: 226, y: 254, top: '#7fa0a6' },
  ];
  return (
    <svg class="title-scene" viewBox="0 0 375 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="ts-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#f4e6c4" />
          <stop offset=".6" stop-color="#f0d9aa" />
          <stop offset="1" stop-color="#e9cf9b" />
        </linearGradient>
        <radialGradient id="ts-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#fbeec6" />
          <stop offset=".6" stop-color="#f3d68c" stop-opacity=".9" />
          <stop offset="1" stop-color="#f3d68c" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="375" height="420" fill="url(#ts-sky)" />
      <circle cx="268" cy="150" r="78" fill="url(#ts-sun)" />
      <circle cx="268" cy="150" r="26" fill="#f7e2a6" stroke="#c99a46" stroke-opacity=".5" />
      {/* Engraved sun rays */}
      <g stroke="#b88a3a" stroke-opacity=".28" stroke-width="1">
        {Array.from({ length: 18 }, (_, i) => {
          const a = (i / 18) * Math.PI * 2;
          return <path d={`M${268 + Math.cos(a) * 34} ${150 + Math.sin(a) * 34}L${268 + Math.cos(a) * 62} ${150 + Math.sin(a) * 62}`} />;
        })}
      </g>
      <g class="title-clouds" fill="#fbf3de" stroke="#9a7a4a" stroke-opacity=".35" stroke-width=".8">
        <path d="M40 120c4-10 18-12 24-4 6-6 18-4 20 4 8-1 12 6 8 10H36c-6-2-4-10 4-10z" />
        <path d="M250 78c3-8 14-9 19-3 5-5 14-3 16 3 6-1 9 5 6 8h-45c-5-2-3-8 4-8z" />
      </g>
      <g class="title-birds" fill="none" stroke="#5b4428" stroke-width="1.2" stroke-linecap="round">
        <path d="M96 168q4-4 8 0q4-4 8 0" />
        <path d="M118 158q3-3 6 0q3-3 6 0" />
      </g>
      {/* Far hills: three paper layers */}
      <path d="M0 250C40 214 80 206 120 222s70 6 110-14 90-18 145 18V420H0z" fill="#dcc79c" />
      <path d="M0 272c34-22 70-28 110-16s80 10 120-8 96-12 145 14V420H0z" fill="#cbb382" />
      <g stroke="#7a5e36" stroke-opacity=".3" stroke-width=".8" fill="none">
        <path d="M30 250c10-6 22-8 34-6M180 232c14-8 30-10 44-6M290 236c12-4 24-4 36 2" />
      </g>
      {/* The diorama island */}
      <g class="title-island" transform="translate(188 250) scale(1.4) translate(-188 -250)">
        <ellipse cx="190" cy="272" rx="72" ry="8" fill="#6a5030" opacity=".18" />
        {tiles.map((t) => (
          <Tile {...t} />
        ))}
        {/* Town on the centre tile */}
        <g stroke="#4a3520" stroke-width=".8" stroke-linejoin="round">
          <path d="M160 236l7-6 7 6v8h-14z" fill="#efe0c0" />
          <path d="M158 236l9-8 9 8" fill="#a8503c" />
          <path d="M174 240l5-4 5 4v6h-10z" fill="#e7d4ad" />
          <path d="M172.5 240l6.5-5.5 6.5 5.5" fill="#8f4434" />
          <path d="M183 229h5v15h-5z" fill="#efe0c0" />
          <path d="M182 229l3.5-4 3.5 4z" fill="#a8503c" />
        </g>
        {/* Trees */}
        <g fill="#6f8a4e" stroke="#3f4f2a" stroke-width=".7">
          <path d="M138 240l5-12 5 12z" />
          <path d="M146 245l4-10 4 10z" />
          <path d="M226 222l5-13 5 13z" />
          <path d="M235 227l4-10 4 10z" />
          <circle cx="196" cy="252" r="4.6" />
          <circle cx="204" cy="249" r="4" />
        </g>
        {/* A tiny banner on the tower */}
        <path d="M185.5 225v-10" stroke="#4a3520" stroke-width=".9" />
        <path class="title-flag" d="M185.5 215h9l-2.4 2.6 2.4 2.6h-9z" fill="#9b3426" />
        {/* Boat on the water */}
        <g class="title-boat">
          <path d="M240 260h14l-3 4h-8z" fill="#5b4428" />
          <path d="M247 260v-10l6 9z" fill="#f6ead0" stroke="#5b4428" stroke-width=".7" />
        </g>
      </g>
      {/* Near ground fading into the page */}
      <path d="M0 336c50-12 110-14 180-6s130 6 195-8V420H0z" fill="#e8d6ae" />
    </svg>
  );
}

export function Title() {
  const list = saves.value;
  const auto = continueSave(list);
  const busy = loading.value;
  const acts = titleActions(auto, endedOf(auto));
  const newBtn = (
    <button class={`btn${acts.primary === 'new' ? ' btn-primary title-hero' : ''}`} disabled={!!busy} onClick={() => (route.value = 'setup')}>
      <Icon name="found" /> New game
    </button>
  );
  return (
    <main class="title-screen">
      <TitleScene />
      <div class="title-lockup">
        <div class="title-eyebrow">A chronicle of nations yet to be</div>
        <h1 class="title-name">
          <span class="title-apes">Apes</span>
          <span class="title-rest">Together Strong</span>
        </h1>
        <div class="fleuron" aria-hidden="true">
          <Icon name="legend" size="sm" />
        </div>
        <p class="title-tag">Build a civilization from the people your play attracts.</p>
      </div>
      <div class="title-buttons">
        {acts.newFirst && newBtn}
        {auto && acts.saveLabel && (
          <button
            class={`btn${acts.primary === 'continue' ? ' btn-primary title-hero' : ''}`}
            disabled={!!busy}
            onClick={() => {
              loading.value = acts.primary === 'continue' ? 'Loading…' : 'Opening the chronicle…';
              loadGame(auto.slot);
            }}
          >
            <Icon name={acts.primary === 'continue' ? 'play' : 'chronicle'} /> {acts.saveLabel}
          </button>
        )}
        {!acts.newFirst && newBtn}
        <div class="title-row">
          <button class="btn" disabled={!!busy || list.length === 0} onClick={() => openModal({ kind: 'saves' })}>
            <Icon name="load" /> Load
          </button>
          <button class="btn" onClick={() => openModal({ kind: 'settings' })}>
            <Icon name="settings" /> Settings
          </button>
        </div>
      </div>
      {busy && (
        <p class="title-busy" role="status">
          {busy}
        </p>
      )}
    </main>
  );
}
