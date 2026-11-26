/**
 * Turns layers (layers.ts) into short-lived Web Audio nodes. Works on any BaseAudioContext,
 * so the live engine and the OfflineAudioContext self-check render exactly the same graph.
 * Every voice disconnects all its nodes when its last source ends, so one-shots leave nothing
 * behind for the garbage collector to trip over.
 */
import { karplusStrong, type NoiseColor } from './dsp';
import { applyEnv, envPoints, withGrains } from './envelope';
import type { BellLayer, FilterSpec, Layer, PartialSet } from './layers';
import { liveRand, type Rand } from './random';
import { mtof } from './theory';

/** Shared per-context resources. */
export interface Rig {
  ctx: BaseAudioContext;
  noise: Record<NoiseColor, AudioBuffer>;
  plucks: PluckCache;
}

/** Everything one sound created, for stealing and cleanup. */
export interface Voice {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  start: number;
  end: number;
}

export const newVoice = (start: number): Voice => ({ sources: [], nodes: [], start, end: start });

/** Memory cap for cached pluck buffers (bytes). 40 x 3 s at 48 kHz would be 23 MB. */
export const PLUCK_CACHE_BYTES = 6 * 1024 * 1024;

/**
 * Karplus-Strong buffers, generated on first use per pitch and kept (LRU) for reuse, bounded
 * by entry count and by bytes. Lengths are bucketed to 0.5 s so notes of similar length share a
 * buffer (a miss costs a few ms of main-thread DSP).
 */
export class PluckCache {
  private readonly cache = new Map<string, { buffer: AudioBuffer; rate: number }>();
  private bytesHeld = 0;
  hits = 0;
  misses = 0;
  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly max = 40,
    private readonly rand: Rand = liveRand,
    private readonly maxBytes = PLUCK_CACHE_BYTES,
  ) {}

  get(freq: number, bright: number, decay: number, dur: number): { buffer: AudioBuffer; rate: number } {
    const sr = this.ctx.sampleRate;
    const n = Math.max(2, Math.floor(sr / freq - 0.5));
    // Quantise so near-identical requests share a buffer; length rounds up so it always covers.
    const b = Math.round(bright * 10) / 10;
    const d = Math.round(decay * 4) / 4;
    const len = Math.min(3, Math.ceil(dur * 2) / 2);
    const key = `${n}|${b}|${d}|${len}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.hits += 1;
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    this.misses += 1;
    const ks = karplusStrong(sr, freq, len, b, d, this.rand);
    const buffer = this.ctx.createBuffer(1, ks.data.length, sr);
    buffer.getChannelData(0).set(ks.data);
    const entry = { buffer, rate: ks.rate };
    this.cache.set(key, entry);
    this.bytesHeld += buffer.length * 4;
    while (this.cache.size > 1 && (this.cache.size > this.max || this.bytesHeld > this.maxBytes)) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      const e = this.cache.get(oldest);
      if (e) this.bytesHeld -= e.buffer.length * 4;
      this.cache.delete(oldest);
    }
    return entry;
  }

  get size(): number {
    return this.cache.size;
  }

  /** Bytes of sample data held. */
  get bytes(): number {
    return this.bytesHeld;
  }
}

/** Membrane modes [ratio, relative amp, relative decay] (circular membrane, lightly damped). */
export const DRUM_MODES: readonly (readonly [number, number, number])[] = [
  [1, 0.45, 1], [1.59, 0.4, 0.7], [2.14, 0.5, 0.5], [2.65, 0.45, 0.4], [3.16, 0.35, 0.3], [4.15, 0.2, 0.22],
];
/** Keeps the summed modes at the old drum's level. */
const DRUM_MODE_NORM = 0.42;

/** [ratio, relative amp, relative decay] per partial. */
const PARTIALS: Record<PartialSet, readonly (readonly [number, number, number])[]> = {
  bell: [[1, 1, 1], [2, 0.5, 0.7], [2.76, 0.4, 0.5], [5.4, 0.2, 0.3], [8.93, 0.1, 0.2]],
  glass: [[1, 1, 1], [2.32, 0.35, 0.6], [4.25, 0.18, 0.35], [6.63, 0.08, 0.25]],
  wood: [[1, 1, 1], [2.57, 0.5, 0.45], [4.21, 0.25, 0.3]],
  bowl: [[1, 1, 1], [2.71, 0.35, 0.75], [5.1, 0.12, 0.45]],
  coin: [[1, 1, 1], [2.43, 0.7, 0.8], [3.9, 0.5, 0.6], [6.1, 0.3, 0.4]],
};

const filter = (ctx: BaseAudioContext, f: FilterSpec, t0: number, dur: number): BiquadFilterNode => {
  const n = ctx.createBiquadFilter();
  n.type = f.type;
  n.Q.value = f.q ?? 0.707;
  n.frequency.setValueAtTime(f.freq, t0);
  if (f.to !== undefined) n.frequency.exponentialRampToValueAtTime(Math.max(20, f.to), t0 + dur);
  return n;
};

/** layer amp -> (panner) -> out */
const output = (rig: Rig, pan: number | undefined, out: AudioNode, voice: Voice): GainNode => {
  const amp = rig.ctx.createGain();
  amp.gain.value = 0;
  voice.nodes.push(amp);
  if (pan && typeof rig.ctx.createStereoPanner === 'function') {
    const p = rig.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    amp.connect(p);
    p.connect(out);
    voice.nodes.push(p);
  } else amp.connect(out);
  return amp;
};

const track = (voice: Voice, src: AudioScheduledSourceNode, start: number, stop: number): void => {
  src.start(start);
  src.stop(stop);
  voice.sources.push(src);
  voice.end = Math.max(voice.end, stop);
};

const bellLayer = (rig: Rig, l: BellLayer, t: number, out: AudioNode, voice: Voice): void => {
  const { ctx } = rig;
  const amp = output(rig, l.pan, out, voice);
  amp.gain.value = 1;
  const f0 = mtof(l.midi) * Math.pow(2, (l.cents ?? 0) / 1200);
  const set = PARTIALS[l.partials];
  const norm = 1 / set.reduce((s, p) => s + p[1], 0);
  for (const [ratio, a, d] of set) {
    const f = f0 * ratio;
    if (f > ctx.sampleRate * 0.45) continue;
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    const g = ctx.createGain();
    const dur = Math.max(0.02, l.dur * d);
    // Wood: a 3 ms attack and a fuller decay keep the knock's crest factor low, so it reads
    // as loud on a phone speaker without a sample spike that hits the limiter.
    const attack = l.partials === 'wood' ? 0.003 : 0.002;
    applyEnv(g.gain, envPoints({ kind: 'perc', attack, curve: l.partials === 'wood' ? 4 : 4.5 }, dur, l.gain * a * norm * 1.6), t);
    osc.connect(g);
    g.connect(amp);
    voice.nodes.push(g);
    track(voice, osc, t, t + dur + 0.01);
  }
};

export const renderLayer = (rig: Rig, l: Layer, t0: number, out: AudioNode, voice: Voice): void => {
  const { ctx } = rig;
  const t = t0 + l.at;
  const end = t + l.dur;
  switch (l.kind) {
    case 'bell':
      bellLayer(rig, l, t, out, voice);
      return;
    case 'pluck': {
      const amp = output(rig, l.pan, out, voice);
      const freq = mtof(l.midi);
      const { buffer, rate } = rig.plucks.get(freq, l.bright, l.decay, l.dur);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const r0 = rate * Math.pow(2, (l.cents ?? 0) / 1200);
      src.playbackRate.setValueAtTime(r0, t);
      if (l.bend) {
        src.playbackRate.setValueAtTime(r0, t + l.dur * 0.12);
        src.playbackRate.linearRampToValueAtTime(r0 * Math.pow(2, l.bend / 12), t + l.dur * 0.4);
      }
      // Body: a gentle low-pass so dark strings sound like gut or nylon, not wire.
      const body = filter(ctx, { type: 'lowpass', freq: 600 + 5000 * l.bright, q: 0.5 }, t, l.dur);
      applyEnv(amp.gain, envPoints({ kind: 'adsr', attack: 0.002, decay: 0, sustain: 1, release: Math.min(0.12, l.dur * 0.3) }, l.dur, l.gain), t);
      src.connect(body);
      body.connect(amp);
      voice.nodes.push(body);
      track(voice, src, t, end + 0.01);
      return;
    }
    case 'tone': {
      const amp = output(rig, l.pan, out, voice);
      applyEnv(amp.gain, envPoints(l.env, l.dur, l.gain), t);
      let into: AudioNode = amp;
      if (l.tremolo) {
        const trem = ctx.createGain();
        trem.gain.value = 1 - l.tremolo.depth;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = l.tremolo.rate;
        const depth = ctx.createGain();
        depth.gain.value = l.tremolo.depth;
        lfo.connect(depth);
        depth.connect(trem.gain);
        trem.connect(amp);
        voice.nodes.push(trem, depth);
        track(voice, lfo, t, end + 0.02);
        into = trem;
      }
      if (l.filter) {
        const f = filter(ctx, l.filter, t, l.dur);
        f.connect(into);
        voice.nodes.push(f);
        into = f;
      }
      const voices = Math.max(1, l.voices ?? 1);
      const count = l.midi.length * voices;
      const mix = ctx.createGain();
      mix.gain.value = 1 / Math.sqrt(count);
      mix.connect(into);
      voice.nodes.push(mix);
      let vib: GainNode | null = null;
      if (l.vibrato) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = l.vibrato.rate;
        vib = ctx.createGain();
        const delay = l.vibrato.delay ?? 0;
        vib.gain.setValueAtTime(0, t);
        vib.gain.setValueAtTime(0, t + delay);
        vib.gain.linearRampToValueAtTime(l.vibrato.cents, t + delay + 0.25);
        lfo.connect(vib);
        voice.nodes.push(vib);
        track(voice, lfo, t, end + 0.02);
      }
      const spread = l.spread ?? 0;
      for (const m of l.midi) {
        for (let v = 0; v < voices; v++) {
          const osc = ctx.createOscillator();
          osc.type = l.wave;
          const f = mtof(m);
          if (l.glide) {
            osc.frequency.setValueAtTime(mtof(m + l.glide), t);
            osc.frequency.exponentialRampToValueAtTime(f, t + (l.glideTime ?? 0.2));
          } else osc.frequency.setValueAtTime(f, t);
          const off = voices > 1 ? (v / (voices - 1) - 0.5) * spread : 0;
          osc.detune.value = (l.cents ?? 0) + off;
          if (vib) vib.connect(osc.detune);
          osc.connect(mix);
          track(voice, osc, t, end + 0.02);
        }
      }
      return;
    }
    case 'fm': {
      const amp = output(rig, l.pan, out, voice);
      applyEnv(amp.gain, envPoints(l.env, l.dur, l.gain), t);
      const f = mtof(l.midi) * Math.pow(2, (l.cents ?? 0) / 1200);
      const car = ctx.createOscillator();
      car.frequency.value = f;
      const mod = ctx.createOscillator();
      mod.frequency.value = f * l.ratio;
      const idx = ctx.createGain();
      idx.gain.setValueAtTime(l.index * f, t);
      idx.gain.exponentialRampToValueAtTime(Math.max(0.01, l.indexEnd) * f, end);
      mod.connect(idx);
      idx.connect(car.frequency);
      // An integer ratio puts a sideband at 0 Hz (ratio 1: f - f): block that DC.
      const dc = filter(ctx, { type: 'highpass', freq: 30, q: 0.7 }, t, l.dur);
      car.connect(dc);
      dc.connect(amp);
      voice.nodes.push(idx, dc);
      track(voice, mod, t, end + 0.02);
      track(voice, car, t, end + 0.02);
      return;
    }
    case 'noise': {
      const amp = output(rig, l.pan, out, voice);
      const base = envPoints(l.env, l.dur, l.gain);
      applyEnv(amp.gain, l.grains ? withGrains(base, l.grains, l.gain) : base, t);
      const src = ctx.createBufferSource();
      const buf = rig.noise[l.color];
      src.buffer = buf;
      src.loop = true;
      const f = filter(ctx, l.filter, t, l.dur);
      src.connect(f);
      f.connect(amp);
      voice.nodes.push(f);
      src.start(t, (l.offset ?? 0) * Math.max(0, buf.duration - l.dur - 0.05));
      src.stop(end + 0.01);
      voice.sources.push(src);
      voice.end = Math.max(voice.end, end + 0.01);
      return;
    }
    case 'drum': {
      const amp = output(rig, l.pan, out, voice);
      amp.gain.value = 1;
      const f = mtof(l.midi) * Math.pow(2, (l.cents ?? 0) / 1200);
      // Fundamental with a pitch drop, plus the upper inharmonic membrane modes. Phone speakers
      // reproduce nothing below ~300 Hz, so most of the energy sits in modes 3–6: the ear
      // infers the low pitch from them (missing fundamental) and the drum is heard everywhere.
      const modes = DRUM_MODES;
      for (const [ratio, a, d] of modes) {
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(f * ratio * Math.pow(2, l.drop / 12), t);
        osc.frequency.exponentialRampToValueAtTime(f * ratio, t + Math.min(0.08, l.dur * 0.3));
        const g = ctx.createGain();
        const dur = Math.max(0.03, l.dur * d);
        applyEnv(g.gain, envPoints({ kind: 'perc', attack: 0.002, curve: 5 }, dur, l.gain * a * DRUM_MODE_NORM), t);
        osc.connect(g);
        g.connect(amp);
        voice.nodes.push(g);
        track(voice, osc, t, t + dur + 0.01);
      }
      if (l.snap > 0) {
        const src = ctx.createBufferSource();
        src.buffer = rig.noise.pink;
        src.loop = true;
        const fl = filter(ctx, { type: 'bandpass', freq: 1500 + f * 3, q: 0.8 }, t, l.dur);
        const g = ctx.createGain();
        const dur = Math.min(0.08, l.dur);
        applyEnv(g.gain, envPoints({ kind: 'perc', attack: 0.001, curve: 6 }, dur, l.gain * l.snap * 0.7), t);
        src.connect(fl);
        fl.connect(g);
        g.connect(amp);
        voice.nodes.push(fl, g);
        src.start(t, Math.random() * 0.5);
        src.stop(t + dur + 0.01);
        voice.sources.push(src);
      }
      return;
    }
  }
};

export const renderLayers = (rig: Rig, layers: readonly Layer[], t0: number, out: AudioNode, voice: Voice): void => {
  for (const l of layers) renderLayer(rig, l, t0, out, voice);
};

/** Disconnect everything once the last source has ended. */
export const finalizeVoice = (voice: Voice, onDone?: () => void): void => {
  let left = voice.sources.length;
  const done = (): void => {
    for (const s of voice.sources) {
      s.onended = null;
      try {
        s.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    for (const n of voice.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    onDone?.();
  };
  if (left === 0) {
    done();
    return;
  }
  for (const s of voice.sources) {
    s.onended = () => {
      left -= 1;
      if (left === 0) done();
    };
  }
};

/** Fade a voice out fast (voice stealing). */
export const stealVoice = (voice: Voice, gain: GainNode, now: number): void => {
  gain.gain.cancelScheduledValues(now);
  gain.gain.setTargetAtTime(0, now, 0.008);
  for (const s of voice.sources) {
    try {
      s.stop(now + 0.05);
    } catch {
      /* not started or already stopped */
    }
  }
};
