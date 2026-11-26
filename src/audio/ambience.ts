/**
 * The ambience player: a long-lived drone per scene plus short voices scheduled ahead from the
 * composer. Scenes crossfade (drones ~3 s, culture buses ramp by weight), and everything is
 * driven by `pump(now)` so the live engine (a 100 ms interval) and the offline self-check
 * (one big pump before rendering) use the same code.
 *
 * Node budget: a drone is ~2 oscillators per note + filter + LFO (about 10 nodes); one gain bus
 * per active culture; voices are short one-shots that disconnect themselves when done.
 */
import type { Age } from '@contracts/content-schemas';
import { Composer, type ComposerScene, type Instrument } from './composer';
import type { Rand } from './random';
import { finalizeVoice, newVoice, renderLayers, type Rig } from './synth';
import { N, mtof } from './theory';
import { voiceLayers } from './voices';

export interface DroneSpec {
  notes: readonly number[];
  cutoff: number;
  level: number;
}

/** Drone per age; crisis is lower, darker (minor third in the drone, filter closed). */
export const droneFor = (age: Age, crisis: boolean): DroneSpec => {
  // The drone is a quiet floor under the music (pads carry the harmony), not the music itself.
  if (crisis) return { notes: [N.D2, N.A2, N.F3], cutoff: 380, level: 0.03 };
  switch (age) {
    case 'ancient':
      return { notes: [N.D2, N.A2], cutoff: 650, level: 0.025 };
    case 'classical':
      return { notes: [N.D2, N.A2, N.D3], cutoff: 700, level: 0.02 };
    case 'exploration':
      return { notes: [N.D2, N.A2], cutoff: 750, level: 0.018 };
    case 'modern':
      return { notes: [N.D2, N.A2], cutoff: 800, level: 0.015 };
  }
};

export const SCENE_FADE = 3;
/** Make-up gain from the voice layers (written with sfx-like headroom) up to music level. */
export const NOTE_TRIM = 6.3;
/** Base melody steps back as cultures come in. */
export const baseBusGain = (cultureWeightSum: number): number => 1 - 0.4 * Math.min(1, cultureWeightSum);
/** A culture stem's level for its weight (0..1): audible early, saturating. */
export const cultureBusGain = (w: number): number => Math.min(1, 0.35 + 0.75 * Math.min(1, w));

class Drone {
  private readonly out: GainNode;
  private readonly oscs: OscillatorNode[] = [];
  private readonly nodes: AudioNode[] = [];

  constructor(rig: Rig, dest: AudioNode, readonly spec: DroneSpec, now: number, fade: number) {
    const { ctx } = rig;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.linearRampToValueAtTime(spec.level, now + fade);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = spec.cutoff;
    lp.Q.value = 0.7;
    // Slow breathing of the filter so the drone is alive, not a held organ key.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const depth = ctx.createGain();
    depth.gain.value = spec.cutoff * 0.25;
    lfo.connect(depth);
    depth.connect(lp.frequency);
    const mix = ctx.createGain();
    mix.gain.value = 1 / Math.sqrt(spec.notes.length * 2);
    mix.connect(lp);
    lp.connect(this.out);
    this.out.connect(dest);
    this.nodes.push(lp, depth, mix, this.out);
    lfo.start(now);
    this.oscs.push(lfo);
    spec.notes.forEach((m, i) => {
      for (const [type, cents] of [['sawtooth', -4], ['triangle', 5]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = mtof(m);
        o.detune.value = cents + i * 1.5;
        o.connect(mix);
        o.start(now);
        this.oscs.push(o);
      }
    });
  }

  release(now: number, fade: number): void {
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(0, now, fade / 4);
    const stopAt = now + fade + 0.2;
    for (const o of this.oscs) o.stop(stopAt);
    const last = this.oscs[0];
    if (last) {
      last.onended = () => {
        for (const n of [...this.oscs, ...this.nodes]) {
          try {
            n.disconnect();
          } catch {
            /* already disconnected */
          }
        }
      };
    }
  }
}

export interface PlayerScene {
  age: Age;
  crisis: boolean;
  cultures: readonly { id: string; instrument: Instrument; weight: number }[];
}

export class AmbiencePlayer {
  private readonly composer: Composer;
  private drone: Drone | null = null;
  private droneKey = '';
  private readonly buses = new Map<string, GainNode>();
  private scheduledUntil = 0;
  private live = false;
  /** Short voices currently sounding (for the CPU report). */
  activeVoices = 0;

  /** Gentle bus compression: plucks and drums stay rounded, the bed stays even. */
  private readonly dry: AudioNode;

  constructor(
    private readonly rig: Rig,
    dryOut: AudioNode,
    private readonly wet: AudioNode,
    private readonly rand: Rand,
  ) {
    this.composer = new Composer(rand);
    const comp = rig.ctx.createDynamicsCompressor();
    comp.threshold.value = -26;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.006;
    comp.release.value = 0.3;
    comp.connect(dryOut);
    this.dry = comp;
  }

  get playing(): boolean {
    return this.live;
  }

  private bus(source: string, now: number, initial: number): GainNode {
    let b = this.buses.get(source);
    if (!b) {
      const { ctx } = this.rig;
      b = ctx.createGain();
      b.gain.setValueAtTime(0, now);
      b.gain.setTargetAtTime(initial, now, SCENE_FADE / 4);
      const trim = ctx.createGain();
      trim.gain.value = source === 'drone' ? 1 : NOTE_TRIM;
      const send = ctx.createGain();
      send.gain.value = 0.45;
      b.connect(trim);
      trim.connect(this.dry);
      trim.connect(send);
      send.connect(this.wet);
      this.buses.set(source, b);
    }
    return b;
  }

  setScene(scene: PlayerScene, now: number): void {
    const spec = droneFor(scene.age, scene.crisis);
    const key = `${scene.age}|${scene.crisis}`;
    if (key !== this.droneKey || !this.drone) {
      this.drone?.release(now, SCENE_FADE);
      const droneBus = this.bus('drone', now, 1);
      droneBus.gain.cancelScheduledValues(now);
      droneBus.gain.setTargetAtTime(1, now, 0.3);
      this.drone = new Drone(this.rig, droneBus, spec, now, SCENE_FADE);
      this.droneKey = key;
    }
    const composerScene: ComposerScene = { age: scene.age, crisis: scene.crisis, cultures: scene.cultures };
    this.composer.setScene(composerScene, Math.max(now, this.scheduledUntil));
    const sum = scene.cultures.reduce((s, c) => s + c.weight, 0);
    const base = this.bus('base', now, baseBusGain(sum));
    base.gain.setTargetAtTime(baseBusGain(sum), now, SCENE_FADE / 4);
    const present = new Set(scene.cultures.map((c) => c.id));
    for (const c of scene.cultures) this.bus(c.id, now, cultureBusGain(c.weight)).gain.setTargetAtTime(cultureBusGain(c.weight), now, SCENE_FADE / 4);
    for (const [id, b] of this.buses) if (id !== 'base' && id !== 'drone' && !present.has(id)) b.gain.setTargetAtTime(0, now, SCENE_FADE / 4);
    if (!this.live) this.scheduledUntil = now;
    this.live = true;
  }

  /** Schedule every composer note up to now + horizon. */
  pump(now: number, horizon = 0.5): void {
    if (!this.live) return;
    const until = now + horizon;
    if (until <= this.scheduledUntil) return;
    for (const ev of this.composer.generate(until)) {
      if (ev.t < now) continue; // we fell behind (tab throttled): drop, never cram
      const out = this.buses.get(ev.source) ?? this.bus(ev.source, now, 0);
      const voice = newVoice(ev.t);
      renderLayers(this.rig, voiceLayers(ev, this.rand), ev.t, out, voice);
      this.activeVoices += 1;
      finalizeVoice(voice, () => {
        this.activeVoices -= 1;
      });
    }
    this.scheduledUntil = until;
  }

  stop(now: number, fade = 2): void {
    if (!this.live) return;
    this.live = false;
    this.drone?.release(now, fade);
    this.drone = null;
    this.droneKey = '';
    for (const b of this.buses.values()) {
      b.gain.cancelScheduledValues(now);
      b.gain.setTargetAtTime(0, now, fade / 4);
    }
    // Buses are reused if the ambience comes back; phrases start fresh.
    this.composer.reset();
  }

  get busCount(): number {
    return this.buses.size;
  }
}

