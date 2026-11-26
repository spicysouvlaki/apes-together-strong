/**
 * The mixing graph, built once per context (live or offline):
 *
 *   sfx voices ─► sfxDry ─┐                     ┌─► compressor ─► soft clip (-1 dBFS) ─► out
 *             └─► sfxWet ─┼─► reverb ─► return ─┤
 *   ambience ──► ambDry ──┤                     │
 *            └─► ambWet ──┘        master ──────┘
 *
 * Dry and wet buses of a category share the same volume, so the reverb follows the sliders.
 */
import { noiseSamples, reverbImpulse, softClipCurve, type NoiseColor } from './dsp';
import { liveRand, type Rand } from './random';
import { PluckCache, type Rig } from './synth';

export interface Graph extends Rig {
  master: GainNode;
  sfxDry: GainNode;
  sfxWet: GainNode;
  ambDry: GainNode;
  ambWet: GainNode;
  /** Everything allocated here, for teardown. */
  nodes: AudioNode[];
}

export interface GraphOptions {
  /** Skip compressor and soft clip (self-check headroom measurement). */
  limiter?: boolean;
  /** Skip the reverb (self-check dry render). */
  reverb?: boolean;
  rand?: Rand;
}

/** Reverb return level. */
export const REVERB_RETURN = 0.5;
const NOISE_SECONDS = 2;
const IR_SECONDS = 1.8;

const bufferFrom = (ctx: BaseAudioContext, chans: readonly Float32Array[]): AudioBuffer => {
  const len = chans[0]?.length ?? 1;
  const buf = ctx.createBuffer(chans.length, len, ctx.sampleRate);
  chans.forEach((d, i) => buf.getChannelData(i).set(d));
  return buf;
};

export const buildGraph = (ctx: BaseAudioContext, opts: GraphOptions = {}): Graph => {
  const rand = opts.rand ?? liveRand;
  const nodes: AudioNode[] = [];
  const gain = (v: number): GainNode => {
    const g = ctx.createGain();
    g.gain.value = v;
    nodes.push(g);
    return g;
  };
  const master = gain(1);
  if (opts.limiter === false) master.connect(ctx.destination);
  else {
    // Gentle glue compression, then a soft clip that can never exceed -1 dBFS.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.knee.value = 8;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    const pre = gain(0.5); // WaveShaper input is [-1, 1]; the curve maps back with range 2
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve(2049, 2) as Float32Array<ArrayBuffer>;
    master.connect(comp);
    comp.connect(pre);
    pre.connect(clip);
    clip.connect(ctx.destination);
    nodes.push(comp, clip);
  }

  const sfxDry = gain(1);
  const sfxWet = gain(1);
  const ambDry = gain(0);
  const ambWet = gain(0);
  sfxDry.connect(master);
  ambDry.connect(master);
  if (opts.reverb !== false) {
    const conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = bufferFrom(ctx, reverbImpulse(ctx.sampleRate, IR_SECONDS, rand));
    const ret = gain(REVERB_RETURN);
    sfxWet.connect(conv);
    ambWet.connect(conv);
    conv.connect(ret);
    ret.connect(master);
    nodes.push(conv);
  }

  const noise = {} as Record<NoiseColor, AudioBuffer>;
  for (const color of ['white', 'pink', 'brown'] as const) {
    noise[color] = bufferFrom(ctx, [noiseSamples(color, Math.floor(NOISE_SECONDS * ctx.sampleRate), rand)]);
  }
  return { ctx, master, sfxDry, sfxWet, ambDry, ambWet, noise, plucks: new PluckCache(ctx, 40, rand), nodes };
};
