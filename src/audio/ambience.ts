/**
 * The ambience player: a long-lived drone per scene plus short voices scheduled ahead from the
 * composer. Scenes crossfade (drones ~3 s, culture buses ramp by weight), and everything is
 * driven by `pump(now)` so the live engine (a 100 ms interval) and the offline self-check
 * (one big pump before rendering) use the same code.
 *
 * Lifecycle (see the budget on AmbiencePlayer): a scene change fades the old drone out over
 * SCENE_FADE and frees it, cancels the old scene's look-ahead notes, and culture buses no longer
 * wanted are disconnected once silent; stop() (music off, muted) does the same, so nothing from
 * an old scene outlives it by more than ~4 s.
 */
import type { Age } from '@contracts/content-schemas';
import { Composer, type ComposerScene, type Instrument, type NoteEvent } from './composer';
import type { Rand } from './random';
import { finalizeVoice, newVoice, renderLayers, type Rig, type Voice } from './synth';
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

/** How fast an older, still-fading drone is cut when yet another scene arrives (rapid changes). */
export const DRONE_KILL_FADE = 0.12;

class Drone {
  private readonly out: GainNode;
  private readonly oscs: OscillatorNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private stopAt = Infinity;
  /** Context time it was released (Infinity while it is the current drone). */
  releasedAt = Infinity;
  freed = false;

  constructor(rig: Rig, dest: AudioNode, readonly spec: DroneSpec, now: number, fade: number, private readonly onFreed: (d: Drone) => void) {
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
    // Free every node once all oscillators have stopped (they all stop together).
    let left = this.oscs.length;
    for (const o of this.oscs) {
      o.onended = () => {
        left -= 1;
        if (left === 0) this.free();
      };
    }
  }

  /** Nodes this drone holds (for the documented per-scene budget). */
  get nodeCount(): number {
    return this.oscs.length + this.nodes.length;
  }

  /**
   * Fade out over ~`fade` s and stop. Calling again with a shorter fade cuts it sooner (a drone
   * still fading when yet another scene arrives), never later.
   */
  release(now: number, fade: number): void {
    const stopAt = now + fade + 0.05;
    if (stopAt >= this.stopAt) return;
    this.stopAt = stopAt;
    if (this.releasedAt === Infinity) this.releasedAt = now;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    // Linear to exactly 0 (Safari-safe, no endless exponential tail), then stop.
    g.linearRampToValueAtTime(0, now + fade);
    for (const o of this.oscs) {
      try {
        o.stop(stopAt);
      } catch {
        /* already stopped */
      }
    }
  }

  private free(): void {
    if (this.freed) return;
    this.freed = true;
    for (const n of [...this.oscs, ...this.nodes]) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.onFreed(this);
  }
}

export interface PlayerScene {
  age: Age;
  crisis: boolean;
  cultures: readonly { id: string; instrument: Instrument; weight: number }[];
}

/** A scheduled ambience note still holding nodes. */
interface LiveNote {
  voice: Voice;
  source: string;
}

/** Culture buses idle (gain ~0, no notes) this long are disconnected and dropped. */
export const BUS_IDLE_PRUNE = SCENE_FADE * 1.5;
/** Notes starting later than now + this are cancelled on a scene change, stop or mute. */
const CANCEL_MARGIN = 0.03;

interface Bus {
  gain: GainNode;
  nodes: AudioNode[];
  /** Context time the bus was asked to fade to 0 (Infinity while wanted). */
  idleSince: number;
}

/**
 * Long-lived nodes per scene (documented budget, checked in tests/audio-lifecycle.test.ts):
 *   drone        2 oscillators per drone note + LFO + filter, depth, mix, out   = 9–11
 *   buses        3 gains (level, trim, reverb send) x (drone, bed, base, <= 4 cultures) <= 21
 *   compressor   1 (created once per player)
 * so at most ~33 nodes, plus one fading drone (~11) for SCENE_FADE s after a change. Rapid
 * changes never stack drones: a second change cuts the previous fading drone in 0.12 s (so
 * for that instant three exist: current, fading, and one being cut).
 * Notes are short one-shots that free themselves when their sources end.
 */
export class AmbiencePlayer {
  private readonly composer: Composer;
  private drone: Drone | null = null;
  private readonly fading = new Set<Drone>();
  private droneKey = '';
  private readonly buses = new Map<string, Bus>();
  private scheduledUntil = 0;
  private live = false;
  private readonly notes = new Set<LiveNote>();
  /**
   * Composer notes not yet turned into nodes. The composer writes whole phrases (a katajjaq
   * phrase is ~40 notes over 3 s); only notes inside the look-ahead window get nodes, so a scene
   * holds few nodes and a scene change can simply drop what the old scene had not played.
   */
  private pending: NoteEvent[] = [];

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

  /** Notes holding nodes (sounding or scheduled ahead). */
  get activeVoices(): number {
    return this.notes.size;
  }

  /** Notes sounding at `now` / scheduled to start after `now`. */
  voiceCounts(now: number): { sounding: number; queued: number; latestEnd: number } {
    let sounding = 0;
    let queued = 0;
    let latestEnd = 0;
    for (const n of this.notes) {
      if (n.voice.end <= now) continue; // ending or cancelled
      if (n.voice.start > now) queued += 1;
      else if (n.voice.end > now) sounding += 1;
      latestEnd = Math.max(latestEnd, n.voice.end);
    }
    return { sounding, queued, latestEnd };
  }

  /** Current drone plus drones still fading out. */
  get droneCount(): number {
    return (this.drone ? 1 : 0) + this.fading.size;
  }

  get busCount(): number {
    return this.buses.size;
  }

  /** Anything left to free (fading drones, idle buses) — the engine keeps ticking until done. */
  get busy(): boolean {
    return this.live || this.fading.size > 0 || this.buses.size > 0 || this.notes.size > 0;
  }

  /** Composer notes waiting for the look-ahead window (no nodes yet). */
  get pendingNotes(): number {
    return this.pending.length;
  }

  private bus(source: string, now: number, initial: number): GainNode {
    let b = this.buses.get(source);
    if (!b) {
      const { ctx } = this.rig;
      const level = ctx.createGain();
      level.gain.setValueAtTime(0, now);
      level.gain.setTargetAtTime(initial, now, SCENE_FADE / 4);
      const trim = ctx.createGain();
      trim.gain.value = source === 'drone' ? 1 : NOTE_TRIM;
      const send = ctx.createGain();
      send.gain.value = 0.45;
      level.connect(trim);
      trim.connect(this.dry);
      trim.connect(send);
      send.connect(this.wet);
      b = { gain: level, nodes: [level, trim, send], idleSince: Infinity };
      this.buses.set(source, b);
    }
    return b.gain;
  }

  private setBus(source: string, now: number, target: number): void {
    const g = this.bus(source, now, target);
    const b = this.buses.get(source);
    if (b) b.idleSince = target > 0 ? Infinity : Math.min(b.idleSince, now);
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(target, now, SCENE_FADE / 4);
  }

  private fadeBus(b: Bus, now: number, tau: number): void {
    if (b.idleSince !== Infinity) return;
    b.idleSince = now;
    b.gain.gain.cancelScheduledValues(now);
    b.gain.gain.setTargetAtTime(0, now, tau);
  }

  /** Cancel notes that have not started yet (they belong to a scene we are leaving). */
  private cancelQueued(now: number): void {
    this.pending = [];
    for (const n of this.notes) {
      if (n.voice.start <= now + CANCEL_MARGIN) continue;
      for (const s of n.voice.sources) {
        try {
          s.stop(now);
        } catch {
          /* already stopped */
        }
      }
      // Never sounds now: its end is effectively now (stats and pruning).
      n.voice.end = now;
    }
  }

  private releaseDrone(now: number, fade: number): void {
    // A drone still fading from an earlier change is cut quickly: at most two ever sound.
    for (const d of this.fading) d.release(now, DRONE_KILL_FADE);
    if (this.drone) {
      this.drone.release(now, fade);
      if (!this.drone.freed) this.fading.add(this.drone);
    }
    this.drone = null;
    this.droneKey = '';
  }

  setScene(scene: PlayerScene, now: number): void {
    const spec = droneFor(scene.age, scene.crisis);
    const key = `${scene.age}|${scene.crisis}`;
    const changed = key !== this.droneKey || !this.drone;
    if (changed) {
      this.releaseDrone(now, SCENE_FADE);
      this.setBus('drone', now, 1);
      this.drone = new Drone(this.rig, this.bus('drone', now, 1), spec, now, SCENE_FADE, (d) => this.fading.delete(d));
      this.droneKey = key;
      // The old scene's look-ahead must not play over the new one: drop its queued notes and
      // let the composer start the new scene from now.
      if (this.live) {
        this.cancelQueued(now);
        this.scheduledUntil = now;
      }
    }
    const composerScene: ComposerScene = { age: scene.age, crisis: scene.crisis, cultures: scene.cultures };
    this.composer.setScene(composerScene, Math.max(now, this.scheduledUntil));
    const sum = scene.cultures.reduce((s, c) => s + c.weight, 0);
    this.setBus('bed', now, 1);
    this.setBus('base', now, baseBusGain(sum));
    const present = new Set(scene.cultures.map((c) => c.id));
    for (const c of scene.cultures) this.setBus(c.id, now, cultureBusGain(c.weight));
    for (const [id, b] of this.buses) if (id !== 'base' && id !== 'bed' && id !== 'drone' && !present.has(id)) this.fadeBus(b, now, SCENE_FADE / 4);
    if (!this.live) this.scheduledUntil = now;
    this.live = true;
  }

  /** Schedule every composer note up to now + horizon; free idle buses. */
  pump(now: number, horizon = 0.5): void {
    this.housekeep(now);
    if (!this.live) return;
    const until = now + horizon;
    if (until <= this.scheduledUntil) return;
    const fresh = this.composer.generate(until);
    if (fresh.length) this.pending = [...this.pending, ...fresh].sort((a, b) => a.t - b.t);
    let take = 0;
    while (take < this.pending.length && (this.pending[take]?.t ?? Infinity) < until) take += 1;
    const due = this.pending.slice(0, take);
    this.pending = this.pending.slice(take);
    for (const ev of due) {
      if (ev.t < now) continue; // we fell behind (tab throttled): drop, never cram
      // Every stream's bus exists from setScene; a missing one (never expected) stays silent.
      const out = this.bus(ev.source, now, 0);
      const voice = newVoice(ev.t);
      renderLayers(this.rig, voiceLayers(ev, this.rand), ev.t, out, voice);
      const note: LiveNote = { voice, source: ev.source };
      this.notes.add(note);
      finalizeVoice(voice, () => this.notes.delete(note));
    }
    this.scheduledUntil = until;
  }

  /** Disconnect buses that have been silent and unused for BUS_IDLE_PRUNE seconds. */
  housekeep(now: number): void {
    if (!this.buses.size) return;
    const inUse = new Set<string>();
    for (const n of this.notes) inUse.add(n.source);
    for (const [id, b] of this.buses) {
      if (b.idleSince === Infinity || now - b.idleSince < BUS_IDLE_PRUNE || inUse.has(id)) continue;
      if (id === 'drone' && (this.drone || this.fading.size)) continue;
      for (const n of b.nodes) {
        try {
          n.disconnect();
        } catch {
          /* already disconnected */
        }
      }
      this.buses.delete(id);
    }
  }

  stop(now: number, fade = 2): void {
    if (!this.live) return;
    this.live = false;
    this.releaseDrone(now, fade);
    this.cancelQueued(now);
    for (const b of this.buses.values()) this.fadeBus(b, now, fade / 4);
    // Phrases start fresh when the ambience comes back.
    this.composer.reset();
  }
}
