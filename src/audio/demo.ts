/**
 * Dev-only audition page (audio-demo.html): every Sfx with what it is for, the offer→recruit
 * pair, real turn starts from autoplay logs, age scenes with culture sliders and crisis, a
 * master mute, live engine counters, and the offline checks (mix review, soak, self-check).
 */
import { audio, audioEngine, audioStats, SFX_LIST, type Sfx } from './index';
import { SFX_GROUPS, SFX_INFO } from './catalog';
import { MIX_SCENES, MIX_TARGETS, runMixReview, type MixReport } from './mixreview';
import { planEvents } from './planner';
import { RECIPES } from './recipes';
import { runSelfCheck, selfCheckJobs, type CheckResult } from './selfcheck';
import { runSoak, type SoakReport } from './soak';
import { TURN_LOG } from './turnlog';
import type { AmbienceScene } from './types';
import type { SimEvent } from '@contracts/sim-api';

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
const scene: { age: AmbienceScene['age']; cultures: Record<string, number>; crisis: boolean } = { age: null, cultures: {}, crisis: false };
const CULTURES = ['egyptian', 'greek', 'chinese', 'arab', 'norse', 'inuit', 'mongol', 'spanish'];
const INSTRUMENT: Record<string, string> = { egyptian: 'arghul', greek: 'lyre', chinese: 'guzheng', arab: 'oud', norse: 'hardingfele', inuit: 'katajjaq', mongol: 'morin khuur', spanish: 'guitar' };

document.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
document.addEventListener('keydown', () => audio.unlock());

// --- master mute and volume ---------------------------------------------------------------------
const apply = (): void => audio.setSettings({ ...settings });
const mute = $<HTMLButtonElement>('#mute');
mute.onclick = () => {
  settings.muted = !settings.muted;
  mute.setAttribute('aria-pressed', String(settings.muted));
  mute.textContent = settings.muted ? 'Muted' : 'Mute';
  apply();
};
const slider = (label: string | Node, value: number, on: (v: number) => void): HTMLElement => {
  const out = h('output', { textContent: String(value) });
  const input = h('input', { type: 'range', min: '0', max: '100', value: String(value) });
  input.oninput = () => {
    out.textContent = input.value;
    on(Number(input.value));
  };
  return h('label', { className: 'slider' }, label, input, out);
};
$('#settings').append(
  slider('Effects', settings.sfxVolume, (v) => {
    settings.sfxVolume = v;
    apply();
  }),
  slider('Music', settings.musicVolume, (v) => {
    settings.musicVolume = v;
    apply();
  }),
);
apply();

// --- signature and turns -----------------------------------------------------------------------
const ME = 'p1';
const timers: number[] = [];
const later = (ms: number, fn: () => void): void => {
  timers.push(window.setTimeout(fn, ms));
};
const planOut = $('#plan');
const showPlan = (label: string, events: readonly SimEvent[]): void => {
  const p = planEvents(events, ME, { settlementOwner: () => ME });
  planOut.textContent = `${label}: ` + (p.map((s) => `${(s.delayMs / 1000).toFixed(2)}s ${s.sfx}${s.gain < 1 ? ` ×${s.gain.toFixed(2)}` : ''}${s.distant ? ' (far)' : ''}`).join(' · ') || 'silent');
};
const byPlanSize = (n: number): SimEvent[] => {
  const sized = TURN_LOG.map((b) => ({ b, n: planEvents(b.events, ME, { settlementOwner: () => ME }).length }));
  const pick = sized.filter((x) => x.n === n).sort((a, b) => b.b.total - a.b.total)[0] ?? sized[0];
  return pick ? [...pick.b.events] : [];
};
const BUSY = byPlanSize(5);
const TYPICAL = byPlanSize(3);
const TURN_UI: readonly (readonly [number, Sfx])[] = [[1.6, 'select'], [2.3, 'move'], [3.2, 'tap'], [3.8, 'open'], [5.0, 'close'], [5.6, 'select'], [6.2, 'move'], [7.4, 'endTurn']];

const turns: [string, string, () => void][] = [
  ['Offer → recruit', 'the signature pair', () => {
    audio.play('offer');
    later(2200, () => audio.play('recruit'));
    planOut.textContent = 'offer, then recruit 2.2 s later (the player taps Welcome)';
  }],
  ['Busy turn start', 'a real batch of 5 sounds', () => {
    audio.playEvents(BUSY, ME);
    showPlan('busy turn start', BUSY);
  }],
  ['Typical turn', 'turn start + 8 s of play', () => {
    audio.playEvents(TYPICAL, ME);
    showPlan('typical turn start, then select, move, tap, open, close, select, move, end turn', TYPICAL);
    for (const [t, sfx] of TURN_UI) later(t * 1000, () => audio.play(sfx));
  }],
  ['Age change', 'IV → i cadence', () => {
    const ev: SimEvent[] = [{ type: 'ageEnded', age: 'ancient' }, { type: 'transitionStarted', from: 'ancient', to: 'classical' }, { type: 'ageStarted', age: 'classical' }];
    audio.playEvents(ev, ME);
    showPlan('age change', ev);
  }],
  ['War on you', '', () => {
    const ev: SimEvent[] = [{ type: 'warDeclared', by: 'p2', on: ME }, { type: 'turnStarted', turn: 30 }];
    audio.playEvents(ev, ME);
    showPlan('war on you', ev);
  }],
];
for (const [name, sub, fn] of turns) {
  $('#turns').append(h('button', { className: name === 'Offer → recruit' ? 'primary big' : 'big', onclick: fn, title: sub }, name));
}

// --- music ------------------------------------------------------------------------------------
const push = (): void => audio.setAmbience({ age: scene.age, cultures: { ...scene.cultures }, crisis: scene.crisis });
const ageButtons: HTMLButtonElement[] = [];
const cultureInputs = new Map<string, HTMLInputElement>();
const setAge = (age: AmbienceScene['age']): void => {
  scene.age = age;
  for (const b of ageButtons) b.setAttribute('aria-pressed', String(b.dataset.age === String(age)));
  push();
};
for (const a of ['off', 'ancient', 'classical', 'exploration', 'modern'] as const) {
  const b = h('button', { textContent: a === 'off' ? 'Off' : a[0]?.toUpperCase() + a.slice(1), onclick: () => setAge(a === 'off' ? null : a) });
  b.dataset.age = a === 'off' ? 'null' : a;
  b.setAttribute('aria-pressed', String(a === 'off'));
  ageButtons.push(b);
  $('#ages').append(b);
}
const crisis = h('button', { textContent: 'Crisis', onclick: () => {
  scene.crisis = !scene.crisis;
  crisis.setAttribute('aria-pressed', String(scene.crisis));
  push();
} });
crisis.setAttribute('aria-pressed', 'false');
$('#ages').append(crisis);
const presets = $('#presets');
presets.append(h('span', { className: 'note', textContent: 'Typical mixes: ' }));
for (const [age, sc] of Object.entries(MIX_SCENES)) {
  const label = Object.entries(sc.cultures ?? {}).map(([c, w]) => `${c} ${Math.round(w * 100)}`).join(', ');
  presets.append(h('button', { textContent: `${age}: ${label}`, onclick: () => {
    scene.cultures = { ...sc.cultures };
    for (const [c, input] of cultureInputs) {
      input.value = String(Math.round((scene.cultures[c] ?? 0) * 100));
      input.dispatchEvent(new Event('input'));
    }
    setAge(sc.age);
  } }));
}
for (const c of CULTURES) {
  const el = slider(h('span', {}, c, h('small', { textContent: INSTRUMENT[c] ?? '' })), 0, (v) => {
    scene.cultures[c] = v / 100;
    push();
  });
  const input = el.querySelector('input');
  if (input) cultureInputs.set(c, input);
  $('#cultures').append(el);
}

// --- effects ----------------------------------------------------------------------------------
const sfxRoot = $('#sfx');
for (const group of SFX_GROUPS) {
  const grid = h('div', { className: 'grid' });
  for (const sfx of SFX_LIST.filter((s) => SFX_INFO[s].group === group)) {
    const r = RECIPES[sfx];
    const info = SFX_INFO[sfx];
    grid.append(h('button', { className: 'sfx', onclick: () => audio.play(sfx) },
      h('b', { textContent: sfx }),
      h('span', { className: 'when', textContent: info.when }),
      h('span', { className: 'what', textContent: info.sound }),
      h('span', { className: 'tier', textContent: `${r.tier} · ${Math.round(r.dur * 1000)} ms${r.trimDb ? ` · trim ${r.trimDb > 0 ? '+' : ''}${r.trimDb} dB` : ''}` }),
    ));
  }
  sfxRoot.append(h('h3', { textContent: group }), grid);
}

// --- live stats -------------------------------------------------------------------------------
const statePill = $('#state');
const stats = $('#stats');
const kv = (k: string, v: string | number): HTMLElement => h('div', {}, `${k} `, h('b', { textContent: String(v) }));
const db = (g: number): string => (g > 0 ? `${(20 * Math.log10(g)).toFixed(1)} dB` : 'off');
setInterval(() => {
  const s = audioStats();
  const ok = s.state === 'running' && !s.clockStalled;
  statePill.textContent = s.state === 'locked' ? 'tap to start' : s.clockStalled ? 'stalled: tap' : s.state;
  statePill.className = `pill ${s.state === 'locked' ? '' : ok ? 'on' : 'off'}`;
  stats.replaceChildren(
    kv('context', `${s.state} @ ${s.now.toFixed(1)} s`),
    kv('live nodes', `${s.liveNodes} (idle ${s.baselineNodes})`),
    kv('sources', `${s.liveSources} (peak ${s.peakSources})`),
    kv('sfx voices', `${s.sfxVoices} (${s.sfxSounding} sounding)`),
    kv('music notes', `${s.ambienceSounding} + ${s.ambienceQueued} queued`),
    kv('composer pending', s.ambiencePending),
    kv('drones / buses', `${s.drones} / ${s.ambienceBuses}`),
    kv('sfx bus', `${db(s.gains.sfx)} → ${db(s.gains.sfxTarget)}`),
    kv('music bus', `${db(s.gains.music)} → ${db(s.gains.musicTarget)}`),
    kv('scheduler', `${s.scheduler.running ? 'on' : 'off'}, ${s.scheduler.starts} starts`),
    kv('buffers', `${(s.bufferBytes / 1048576).toFixed(1)} MB (${s.plucksCached} plucks)`),
  );
}, 250);

// --- checks -----------------------------------------------------------------------------------
const progress = $('#progress');
const fmt = (x: number, d = 1): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const cell = (text: string, ok?: boolean): HTMLTableCellElement => h('td', { textContent: text, ...(ok === undefined ? {} : { className: ok ? 'ok' : 'bad' }) });

const showMix = (r: MixReport): void => {
  const T = MIX_TARGETS;
  const ages = h('table', {}, h('tr', {}, ...['age', 'mix LUFS', 'music LUFS', 'music short-term', 'peak dBFS', '2–5 kHz'].map((t) => h('th', { textContent: t }))));
  for (const a of r.ages) {
    ages.append(h('tr', {},
      cell(a.age),
      cell(fmt(a.integrated), a.integrated >= T.integrated[0] && a.integrated <= T.integrated[1]),
      cell(fmt(a.bed)),
      cell(fmt(a.bedShortTerm)),
      cell(fmt(a.peakDb), a.peakDb <= T.peakDb),
      cell(`${Math.round(a.harsh2to5k * 100)}%`, a.harsh2to5k <= T.harsh2to5k),
    ));
  }
  const sfx = h('table', {}, h('tr', {}, ...['effect', 'tier', 'dB over music', '> 300 Hz', 'peak dBFS'].map((t) => h('th', { textContent: t }))));
  for (const s of r.sfx) {
    const need = SFX_INFO[s.sfx].group === 'Interface' ? T.overBedInterface : T.overBed;
    sfx.append(h('tr', {}, cell(s.sfx), cell(s.tier), cell(fmt(s.overBed), s.overBed >= need), cell(`${Math.round(s.above300 * 100)}%`, s.above300 >= T.above300), cell(fmt(s.peakDb), s.peakDb <= T.sfxPeakDb)));
  }
  $('#mix').replaceChildren(
    h('h3', { textContent: `Mix review: ${r.failures.length ? `${r.failures.length} issue(s)` : 'all targets met'} · ages within ${fmt(r.ageSpread)} dB` }),
    h('p', { className: 'note', textContent: r.failures.join(' · ') || `Targets: mix ${T.integrated.join('…')} LUFS, ages within ${T.ageSpread} dB, effects ≥ ${T.overBed} dB over the music (interface ≥ ${T.overBedInterface}), ≥ ${T.above300 * 100}% of energy above 300 Hz, no peak over ${T.peakDb} dBFS.` }),
    ages, sfx,
  );
};
$('#run-mix').onclick = async () => {
  const r = await runMixReview(undefined, (m) => (progress.textContent = m));
  progress.textContent = '';
  showMix(r);
};

const showSoak = (r: SoakReport): void => {
  const t = h('table', {}, h('tr', {}, ...['check', 'value', 'limit'].map((x) => h('th', { textContent: x }))));
  for (const c of r.checks) t.append(h('tr', {}, cell(c.name), cell(String(c.value), c.ok), cell(c.limit)));
  $('#soak').replaceChildren(
    h('h3', { textContent: `Soak: ${r.played} sounds, ${r.scenes} scene changes over ${r.samples[r.samples.length - 1]?.t ?? 0} s simulated (${Math.round(r.renderMs)} ms)` }),
    t,
    h('p', { className: 'note', textContent: `Live nodes over time: ${r.samples.filter((_, i) => i % 10 === 0).map((s) => s.liveNodes).join(' ')} → ${r.final.liveNodes} (idle ${r.baseline}).` }),
  );
};
$('#run-soak').onclick = async () => {
  progress.textContent = 'soak running…';
  const r = await runSoak();
  progress.textContent = '';
  showSoak(r);
};

// Self-check: waveform and spectrum thumbnails per sound.
const draw = (r: CheckResult): HTMLCanvasElement => {
  const c = h('canvas', { width: 240, height: 48 });
  const g = c.getContext('2d');
  if (!g) return c;
  const ink = getComputedStyle(document.body).getPropertyValue('--ink').trim() || '#3a2f25';
  const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#a0522d';
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
    const dbv = 20 * Math.log10((m || 1e-9) / (max || 1));
    const hgt = Math.max(0, (dbv + 60) / 60) * 46;
    g.fillRect(144 + x, 47 - hgt, 1, hgt);
  }
  return c;
};
const table = $('#results');
const summary = $('#summary');
const results: CheckResult[] = [];
const addRow = (r: CheckResult): void => {
  results.push(r);
  const sfxName = r.kind === 'sfx' ? r.name.split(' ')[0] : null;
  const name = h('td', {}, h('b', { textContent: r.name }));
  if (sfxName) name.append(' ', h('button', { textContent: '▶', onclick: () => audio.play(sfxName as Sfx) }));
  table.append(h('tr', { className: r.pass ? 'pass' : 'fail' },
    name,
    h('td', { className: 'v', textContent: r.pass ? 'PASS' : 'FAIL' }),
    h('td', {}, draw(r)),
    h('td', { className: 'metrics', textContent: r.metrics.map((x) => `${x.ok ? '' : '✗ '}${x.name} ${fmt(x.value, Math.abs(x.value) >= 1 ? 1 : 4)}${x.unit ? ' ' + x.unit : ''}`).join(' · ') }),
  ));
  summary.textContent = `${results.filter((x) => x.pass).length}/${results.length} pass`;
};
$('#run-check').onclick = () => {
  table.replaceChildren();
  results.length = 0;
  void runSelfCheck(addRow);
};

// --- console hooks (automation) ---------------------------------------------------------------
type Compact = { name: string; pass: boolean; metrics: { name: string; value: number; ok: boolean; limit: string }[] };
declare global {
  interface Window {
    /** Runs the self-check (optionally only some jobs). */
    __audioCheck?: (jobs?: string[]) => Promise<Compact[]>;
    __audioJobs?: () => string[];
    __audioSoak?: typeof runSoak;
    __audioMix?: typeof runMixReview;
    __audio?: { audio: typeof audio; engine: typeof audioEngine; stats: typeof audioStats };
  }
}
window.__audioJobs = () => selfCheckJobs();
window.__audioCheck = async (jobs) => {
  table.replaceChildren();
  results.length = 0;
  const rs = await runSelfCheck(addRow, jobs ?? selfCheckJobs());
  return rs.map((r) => ({ name: r.name, pass: r.pass, metrics: r.metrics.map(({ name, value, ok, limit }) => ({ name, value: Math.round(value * 10000) / 10000, ok, limit })) }));
};
window.__audioSoak = runSoak;
window.__audioMix = runMixReview;
window.__audio = { audio, engine: audioEngine, stats: audioStats };

