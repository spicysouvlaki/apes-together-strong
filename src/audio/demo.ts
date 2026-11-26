/**
 * Dev-only audio harness (audio-demo.html): audition every Sfx and ambience scene, simulate
 * event batches, and run the OfflineAudioContext self-check with waveform/spectrum thumbnails.
 */
import type { SimEvent } from '@contracts/sim-api';
import { audio, audioStats, SFX_LIST, setAudioPlanOptions, type Sfx } from './index';
import { planEvents } from './planner';
import { RECIPES } from './recipes';
import { runSelfCheck, selfCheckJobs, type CheckResult } from './selfcheck';
import type { AmbienceScene } from './types';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const k of kids) el.append(k);
  return el;
};

const settings = { sfxVolume: 80, musicVolume: 50, muted: false };
const scene: Required<AmbienceScene> = { age: null, cultures: {}, crisis: false };
const CULTURES = ['egyptian', 'greek', 'chinese', 'arab', 'norse', 'inuit', 'mongol', 'spanish'];

const gesture = (): void => audio.unlock();
document.addEventListener('pointerdown', gesture, { passive: true });

// --- sfx buttons ---
const grid = $('#sfx');
for (const sfx of SFX_LIST) {
  const r = RECIPES[sfx];
  grid.append(h('button', { textContent: sfx, title: `${r.tier}, ${Math.round(r.dur * 1000)} ms`, className: `tier-${r.tier}`, onclick: () => audio.play(sfx) }));
}

// --- event batches ---
const ME = 'p1';
const RIVAL = 'p2';
const batches: Record<string, SimEvent[]> = {
  'busy turn start': [
    { type: 'turnStarted', turn: 12 },
    ...Array.from({ length: 6 }, (_, i): SimEvent => ({ type: 'settlementGrew', settlement: `s${i}`, population: 3 })),
    { type: 'productionCompleted', settlement: 's0', item: 'warrior', player: ME },
    { type: 'productionCompleted', settlement: 's1', item: 'granary', player: ME },
    { type: 'researchCompleted', player: ME, tree: 'tech', id: 'bronze' },
    { type: 'cultureHint', player: ME, culture: 'greek', text: '…' },
    { type: 'wonderBuilt', wonder: 'pyramids', player: RIVAL, settlement: 'x' },
  ],
  'offer → recruit': [{ type: 'offerCreated', offer: 'o1', player: ME }],
  'war on me': [{ type: 'warDeclared', by: RIVAL, on: ME }, { type: 'turnStarted', turn: 30 }],
  'age transition': [{ type: 'ageEnded', age: 'ancient' }, { type: 'transitionStarted', from: 'ancient', to: 'classical' }, { type: 'ageStarted', age: 'classical' }],
  'battle (ranged + loss)': [
    { type: 'combat', attacker: 'u1', attackerOwner: ME, defenderOwner: RIVAL, defender: 'u2', at: { q: 0, r: 0 }, damageToAttacker: 0, damageToDefender: 30, attackerDied: false, defenderDied: false },
    { type: 'combat', attacker: 'u3', attackerOwner: RIVAL, defenderOwner: ME, defender: 'u4', at: { q: 0, r: 0 }, damageToAttacker: 10, damageToDefender: 60, attackerDied: false, defenderDied: true },
  ],
};
setAudioPlanOptions({ settlementOwner: () => ME });
const ev = $('#events');
const planOut = $('#plan');
for (const [name, events] of Object.entries(batches)) {
  ev.append(h('button', {
    textContent: name,
    onclick: () => {
      audio.playEvents(events, ME);
      if (name === 'offer → recruit') setTimeout(() => audio.play('recruit'), 2200);
      planOut.textContent = planEvents(events, ME, { settlementOwner: () => ME }).map((p) => `${p.delayMs}ms ${p.sfx} ×${p.gain.toFixed(2)}${p.distant ? ' (distant)' : ''}`).join('  ·  ');
    },
  }));
}

// --- settings ---
const slider = (label: string, value: number, on: (v: number) => void): HTMLElement => {
  const out = h('output', { textContent: String(value) });
  const input = h('input', { type: 'range', min: '0', max: '100', value: String(value) });
  input.oninput = () => {
    out.textContent = input.value;
    on(Number(input.value));
  };
  return h('label', {}, label, input, out);
};
const set = $('#settings');
set.append(
  slider('SFX', settings.sfxVolume, (v) => audio.setSettings({ ...settings, sfxVolume: (settings.sfxVolume = v) })),
  slider('Music', settings.musicVolume, (v) => audio.setSettings({ ...settings, musicVolume: (settings.musicVolume = v) })),
);
const mute = h('input', { type: 'checkbox' });
mute.onchange = () => audio.setSettings({ ...settings, muted: (settings.muted = mute.checked) });
set.append(h('label', {}, 'Muted ', mute));
audio.setSettings(settings);

// --- ambience ---
const amb = $('#ambience');
const age = h('select');
for (const a of ['off', 'ancient', 'classical', 'exploration', 'modern']) age.append(h('option', { value: a, textContent: a }));
const crisis = h('input', { type: 'checkbox' });
const push = (): void => audio.setAmbience({ ...scene });
age.onchange = () => {
  scene.age = age.value === 'off' ? null : (age.value as AmbienceScene['age']);
  push();
};
crisis.onchange = () => {
  scene.crisis = crisis.checked;
  push();
};
amb.append(h('label', {}, 'Age ', age), h('label', {}, 'Crisis ', crisis));
for (const c of CULTURES) {
  amb.append(slider(c, 0, (v) => {
    scene.cultures[c] = v / 100;
    push();
  }));
}

setInterval(() => {
  const s = audioStats();
  $('#stats').textContent = `context ${s.state} · sfx voices ${s.sfxVoices} · ambience voices ${s.ambienceVoices} · pluck buffers ${s.plucksCached}`;
}, 250);

// --- self-check ---
const draw = (r: CheckResult): HTMLCanvasElement => {
  const c = h('canvas', { width: 240, height: 48 });
  const g = c.getContext('2d');
  if (!g) return c;
  const ink = getComputedStyle(document.body).getPropertyValue('--ink').trim() || '#3a2f25';
  const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#a0522d';
  // Waveform (left 140 px): min/max per column.
  const W = 140;
  const step = Math.max(1, Math.floor(r.wave.length / W));
  g.fillStyle = accent;
  for (let x = 0; x < W; x++) {
    let lo = 0, hi = 0;
    for (let i = x * step; i < Math.min(r.wave.length, (x + 1) * step); i++) {
      const v = r.wave[i] ?? 0;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    g.fillRect(x, 24 - hi * 24, 1, Math.max(1, (hi - lo) * 24));
  }
  // Spectrum (right 96 px): log frequency 50 Hz–16 kHz, dB magnitude.
  g.fillStyle = ink;
  const n = r.mags.length;
  let max = 0;
  for (let k = 1; k < n; k++) max = Math.max(max, r.mags[k] ?? 0);
  for (let x = 0; x < 96; x++) {
    const f0 = 50 * Math.pow(320, x / 96);
    const f1 = 50 * Math.pow(320, (x + 1) / 96);
    const k0 = Math.max(1, Math.floor((f0 / 24000) * n));
    const k1 = Math.max(k0 + 1, Math.floor((f1 / 24000) * n));
    let m = 0;
    for (let k = k0; k < Math.min(n, k1); k++) m = Math.max(m, r.mags[k] ?? 0);
    const db = 20 * Math.log10((m || 1e-9) / (max || 1));
    const hgt = Math.max(0, (db + 60) / 60) * 46;
    g.fillRect(144 + x, 47 - hgt, 1, hgt);
  }
  return c;
};

const table = $('#results');
const summary = $('#summary');
const fmt = (x: number): string => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(1) : x.toFixed(4)) : String(x));
const results: CheckResult[] = [];
const addRow = (r: CheckResult): void => {
  results.push(r);
  const failed = r.metrics.filter((x) => !x.ok);
  const sfxName = r.kind === 'sfx' ? r.name.split(' ')[0] : null;
  const name = h('td', {}, h('b', { textContent: r.name }));
  if (sfxName) name.append(h('button', { textContent: '▶', className: 'mini', onclick: () => audio.play(sfxName as Sfx) }));
  table.append(h('tr', { className: r.pass ? 'pass' : 'fail' },
    name,
    h('td', { textContent: r.pass ? 'PASS' : 'FAIL' }),
    h('td', {}, draw(r)),
    h('td', { className: 'metrics', textContent: r.metrics.map((x) => `${x.ok ? '' : '✗ '}${x.name} ${fmt(x.value)}${x.unit ? ' ' + x.unit : ''}`).join(' · ') }),
  ));
  summary.textContent = `${results.filter((x) => x.pass).length}/${results.length} pass${failed.length ? '' : ''}`;
};
$('#run').onclick = () => {
  table.replaceChildren();
  results.length = 0;
  void runSelfCheck(addRow);
};

type Compact = { name: string; pass: boolean; metrics: { name: string; value: number; ok: boolean; limit: string }[] };
declare global {
  interface Window {
    /** Runs the self-check (optionally only some jobs); results also persist in localStorage. */
    __audioCheck?: (jobs?: string[]) => Promise<Compact[]>;
    __audioJobs?: () => string[];
  }
}
const KEY = 'audio.selfcheck';
window.__audioJobs = () => selfCheckJobs();
window.__audioCheck = async (jobs) => {
  table.replaceChildren();
  results.length = 0;
  const rs = await runSelfCheck((r) => {
    addRow(r);
    try {
      const prev = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Compact>;
      prev[r.name] = { name: r.name, pass: r.pass, metrics: r.metrics.map(({ name, value, ok, limit }) => ({ name, value: Math.round(value * 10000) / 10000, ok, limit })) };
      localStorage.setItem(KEY, JSON.stringify(prev));
    } catch {
      /* storage blocked: results stay on the page only */
    }
  }, jobs ?? selfCheckJobs());
  return rs.map((r) => ({ name: r.name, pass: r.pass, metrics: r.metrics.map(({ name, value, ok, limit }) => ({ name, value: Math.round(value * 10000) / 10000, ok, limit })) }));
};
