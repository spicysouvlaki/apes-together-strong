/**
 * The Web Audio engine behind `audio` (GDD §11). Main thread only.
 *
 * - Lazy: no AudioContext until `unlock()` (iOS needs a user gesture); every method is a safe
 *   no-op before that, in Node, in workers and without Web Audio.
 * - iOS Safari: handles `webkitAudioContext`, the 'interrupted' state (calls, Siri), resume on
 *   tab return, and asks for the 'ambient' audio session so the ring/silent switch is honoured.
 * - Voices: at most MAX_SFX_VOICES one-shots (oldest stolen with a 10 ms fade), per-sound
 *   minimum gaps so spammy events never stack; every node is disconnected when its voice ends,
 *   and a voice leaves the accounting only then (not when its nominal end time passes).
 * - One scheduler: a single interval (never two, whatever the suspend/resume order) runs while
 *   music is audible or while the ambience still has something to free; muted or music at 0 it
 *   stops scheduling notes entirely.
 * - Accounting: every node the context creates is counted (accounting.ts), so `stats()` can
 *   prove that live nodes return to the idle baseline.
 * - Stalled clock: a context can report 'running' while its clock does not advance (no output
 *   device, some iOS interruptions). Nothing would play, so new sounds are not queued (they
 *   would all fire at once later); the next tap suspends and resumes the context to restart it.
 */
import cultures from '@content/cultures.json';
import type { PlayerId, SimEvent } from '@contracts/sim-api';
import { bufferBytes, instrumentContext, NodeLedger, type LedgerSnapshot } from './accounting';
import { AmbiencePlayer, type PlayerScene } from './ambience';
import { CULTURE_THRESHOLD, instrumentForStem, type Instrument } from './composer';
import { buildGraph, type Graph } from './graph';
import { busGains, DEFAULT_AUDIO_SETTINGS, MAX_SFX_VOICES, SETTINGS_RAMP } from './levels';
import { planEvents, type PlanOptions } from './planner';
import { liveRand } from './random';
import { RECIPES } from './recipes';
import { spawnSfx, type SfxVoice } from './sfxvoice';
import { finalizeVoice, stealVoice } from './synth';
import type { AmbienceScene, AudioEngine, AudioSettings, Sfx } from './types';

type Ctor = new (opts?: AudioContextOptions) => AudioContext;

/** The AudioContext constructor if this environment has one (not Node, not a worker). */
export const audioContextCtor = (): Ctor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
};

const INSTRUMENT_OF: Record<string, Instrument> = Object.fromEntries(
  (cultures as readonly { id: string; musicStem: string }[]).map((c) => [c.id, instrumentForStem(c.musicStem)]),
);

/** Scene from the public API -> what the ambience player needs (known cultures only). */
export const toPlayerScene = (scene: AmbienceScene): PlayerScene | null => {
  if (!scene.age) return null;
  const list: PlayerScene['cultures'][number][] = [];
  for (const [id, w] of Object.entries(scene.cultures ?? {})) {
    const instrument = INSTRUMENT_OF[id];
    const weight = Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0;
    if (instrument && weight >= CULTURE_THRESHOLD) list.push({ id, instrument, weight });
  }
  // Strongest first; at most four stems at once keeps the bed (and the CPU) light.
  list.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  return { age: scene.age, crisis: !!scene.crisis, cultures: list.slice(0, 4) };
};

/** Scheduler period (ms) and look-ahead (s). */
export const PUMP_MS = 100;
export const LOOKAHEAD = 0.5;
/** A 'running' clock that has not moved for this long (wall ms) is stalled. */
export const STALL_MS = 1200;
/** The same Sfx at the start of a batch right after it ended the previous one is moved back. */
export const REPEAT_WINDOW = 1.5;

/** Wall clock and timers, injectable so tests can drive the engine with a fake clock. */
export interface EngineHost {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

const defaultHost = (): EngineHost => ({
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
});

export interface EngineStats extends LedgerSnapshot {
  state: string;
  /** Context clock (s). */
  now: number;
  /** True when the context says 'running' but its clock has not advanced for STALL_MS. */
  clockStalled: boolean;
  /** SFX voices still holding nodes (sounding, queued or in their last few ms). */
  sfxVoices: number;
  sfxSounding: number;
  /** Ambience notes holding nodes, and of those sounding now / scheduled ahead. */
  ambienceVoices: number;
  ambienceSounding: number;
  ambienceQueued: number;
  /** Composer notes waiting for the look-ahead window (hold no nodes). */
  ambiencePending: number;
  drones: number;
  ambienceBuses: number;
  plucksCached: number;
  pluckBytes: number;
  /** All cached sample data: plucks, noise, reverb impulse. */
  bufferBytes: number;
  /** Live nodes right after the graph and ambience player were built (the idle floor). */
  baselineNodes: number;
  /** Bus gains now and the values they are heading to (mute and slider check). */
  gains: { sfx: number; music: number; sfxTarget: number; musicTarget: number };
  scheduler: { running: boolean; starts: number; ticks: number };
}

export class WebAudioEngine implements AudioEngine {
  private ctx: BaseAudioContext | null = null;
  /** The live context (null for an attached offline one): only it can suspend/resume. */
  private live: AudioContext | null = null;
  private graph: Graph | null = null;
  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private userSuspended = false;
  private readonly voices = new Set<SfxVoice>();
  private readonly lastStart = new Map<Sfx, number>();
  private lastSfx: { sfx: Sfx; at: number } | null = null;
  private scene: AmbienceScene = { age: null };
  private ambience: AmbiencePlayer | null = null;
  private timer: unknown = null;
  private timerStarts = 0;
  private ticks = 0;
  private planOptions: PlanOptions = {};
  private listening = false;
  private clockSeen = { t: -1, wall: 0 };
  private stalled = false;
  private irBytes = 0;
  readonly ledger = new NodeLedger();
  private baseline = 0;

  constructor(private readonly host: EngineHost = defaultHost()) {}

  /** For the UI to give the planner a settlement-owner lookup (enables growth ticks). */
  setPlanOptions(o: PlanOptions): void {
    this.planOptions = o;
  }

  get context(): BaseAudioContext | null {
    return this.ctx;
  }

  /** Live counts for the demo page, the soak test and playtests. */
  stats(): EngineStats {
    const ctx = this.ctx;
    const now = ctx?.currentTime ?? 0;
    let sfxSounding = 0;
    for (const v of this.voices) if (!v.stolen && v.start <= now && v.end > now) sfxSounding += 1;
    const amb = this.ambience?.voiceCounts(now) ?? { sounding: 0, queued: 0, latestEnd: 0 };
    const g = this.graph;
    const target = busGains(this.settings);
    const noise = g ? bufferBytes(Object.values(g.noise)) : 0;
    return {
      ...this.ledger.snapshot(),
      state: ctx?.state ?? 'locked',
      now,
      clockStalled: this.stalled,
      sfxVoices: this.voices.size,
      sfxSounding,
      ambienceVoices: this.ambience?.activeVoices ?? 0,
      ambienceSounding: amb.sounding,
      ambienceQueued: amb.queued,
      ambiencePending: this.ambience?.pendingNotes ?? 0,
      drones: this.ambience?.droneCount ?? 0,
      ambienceBuses: this.ambience?.busCount ?? 0,
      plucksCached: g?.plucks.size ?? 0,
      pluckBytes: g?.plucks.bytes ?? 0,
      bufferBytes: (g?.plucks.bytes ?? 0) + noise + this.irBytes,
      baselineNodes: this.baseline,
      gains: {
        sfx: g?.sfxDry.gain.value ?? 0,
        music: g?.ambDry.gain.value ?? 0,
        sfxTarget: g ? target.sfx : 0,
        musicTarget: g ? target.music : 0,
      },
      scheduler: { running: this.timer !== null, starts: this.timerStarts, ticks: this.ticks },
    };
  }

  unlock(): void {
    try {
      if (!this.ctx) {
        const C = audioContextCtor();
        if (!C) return;
        // Respect the iPhone ring/silent switch like a polite game (Safari 16.4+).
        const nav = typeof navigator !== 'undefined' ? (navigator as unknown as { audioSession?: { type: string } }) : null;
        if (nav?.audioSession) nav.audioSession.type = 'ambient';
        let ctx: AudioContext;
        try {
          ctx = new C({ latencyHint: 'interactive' });
        } catch {
          ctx = new C();
        }
        this.live = ctx;
        this.setup(ctx);
        // Old iOS only unlocks once a buffer has played inside the gesture.
        const b = ctx.createBufferSource();
        b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        b.connect(ctx.destination);
        b.onended = () => b.disconnect();
        b.start(0);
        ctx.onstatechange = () => this.onStateChange();
        this.listen();
        this.refreshAmbience();
      }
      this.kick();
    } catch {
      // No sound is better than a crash.
    }
  }

  /**
   * Run the engine on a context you created (an OfflineAudioContext for the soak test and the
   * mix review, or a fake one in unit tests). No listeners; drive the scheduler with `tick()`.
   */
  attach(ctx: BaseAudioContext): void {
    if (this.ctx) throw new Error('engine already has a context');
    this.setup(ctx);
    this.refreshAmbience();
  }

  private setup(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    instrumentContext(ctx, this.ledger);
    const g = buildGraph(ctx);
    this.graph = g;
    // The ambience player is permanent (one compressor); creating it now keeps it in the baseline.
    this.ambience = new AmbiencePlayer(g, g.ambDry, g.ambWet, liveRand);
    this.irBytes = 2 * Math.ceil(1.8 * ctx.sampleRate) * 4;
    this.baseline = this.ledger.liveNodes;
    this.applySettings(0);
  }

  play(sfx: Sfx): void {
    this.playAt(sfx, 0, 1, false);
  }

  playEvents(events: readonly SimEvent[], viewer: PlayerId | null): void {
    if (!this.audible('sfx')) return;
    const now = this.ctx?.currentTime ?? 0;
    const recent = this.lastSfx && now - this.lastSfx.at < REPEAT_WINDOW ? this.lastSfx.sfx : undefined;
    const plan = planEvents(events, viewer, { ...this.planOptions, ...(recent ? { avoidFirst: recent } : {}) });
    for (const p of plan) this.playAt(p.sfx, p.delayMs / 1000, p.gain, p.distant);
  }

  setAmbience(scene: AmbienceScene): void {
    this.scene = { age: scene.age, ...(scene.cultures ? { cultures: { ...scene.cultures } } : {}), crisis: !!scene.crisis };
    this.refreshAmbience();
  }

  setSettings(settings: AudioSettings): void {
    this.settings = { sfxVolume: settings.sfxVolume, musicVolume: settings.musicVolume, muted: !!settings.muted };
    this.applySettings(SETTINGS_RAMP);
    this.refreshAmbience();
  }

  suspend(): void {
    this.userSuspended = true;
    this.stopTimer();
    if (this.live && this.live.state === 'running') void this.live.suspend().catch(() => {});
  }

  resume(): void {
    this.userSuspended = false;
    this.kick();
    this.refreshAmbience();
  }

  /**
   * One scheduler step: pump the ambience and free what it no longer needs. Called by the
   * interval; tests and offline renders call it directly.
   */
  tick(): void {
    const ctx = this.ctx;
    const amb = this.ambience;
    if (!ctx || !amb) return;
    this.ticks += 1;
    if (!this.clockUsable()) return;
    amb.pump(ctx.currentTime, LOOKAHEAD);
    // Nothing left to schedule or free: the interval stops (CPU) until something needs it.
    if (!amb.busy) this.stopTimer();
  }

  // --- internals --------------------------------------------------------------------------------

  private audible(kind: 'sfx' | 'music'): boolean {
    const g = busGains(this.settings);
    return !!this.ctx && !!this.graph && (kind === 'sfx' ? g.sfx : g.music) > 0;
  }

  /**
   * True when the context clock can be trusted to play what we schedule now. An offline
   * context is suspended between render steps and is fine; a live one must be running (or
   * still resuming from unlock while visible) and its clock must be moving.
   */
  private clockUsable(): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (!this.live) return true;
    if (ctx.state !== 'running') {
      this.clockSeen = { t: -1, wall: 0 };
      return ctx.state === 'suspended' && !this.userSuspended && this.visible();
    }
    const wall = this.host.now();
    if (ctx.currentTime !== this.clockSeen.t) {
      this.clockSeen = { t: ctx.currentTime, wall };
      this.stalled = false;
    } else if (wall - this.clockSeen.wall > STALL_MS) this.stalled = true;
    return !this.stalled;
  }

  private applySettings(ramp: number): void {
    const g = this.graph;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    const { sfx, music } = busGains(this.settings);
    const now = ctx.currentTime;
    for (const [bus, v] of [[g.sfxDry, sfx], [g.sfxWet, sfx], [g.ambDry, music], [g.ambWet, music]] as const) {
      bus.gain.cancelScheduledValues(now);
      if (ramp <= 0) bus.gain.setValueAtTime(v, now);
      else bus.gain.setTargetAtTime(v, now, ramp / 3);
    }
  }

  private playAt(sfx: Sfx, delay: number, gain: number, distant: boolean): void {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g || !this.audible('sfx')) return;
    // A context still resuming from unlock() plays this as soon as it runs; a hidden,
    // user-suspended, interrupted or stalled one must not queue up a pile of sounds.
    if (!this.clockUsable()) return;
    try {
      const recipe = RECIPES[sfx];
      const start = ctx.currentTime + 0.005 + Math.max(0, delay);
      const last = this.lastStart.get(sfx);
      if (last !== undefined && Math.abs(start - last) * 1000 < recipe.minGapMs) return;
      this.lastStart.set(sfx, start);
      if (!this.lastSfx || start >= this.lastSfx.at) this.lastSfx = { sfx, at: start };

      const now = ctx.currentTime;
      // Cap what is sounding or queued; voices already stolen are on their way out.
      const active = [...this.voices].filter((v) => v.end > now && !v.stolen).sort((a, b) => a.start - b.start);
      for (let i = 0; i <= active.length - MAX_SFX_VOICES; i++) {
        const oldest = active[i];
        if (!oldest) continue;
        oldest.stolen = true;
        stealVoice(oldest, oldest.gain, now);
        oldest.end = Math.min(oldest.end, now + 0.05);
      }

      const voice = spawnSfx(g, sfx, recipe.build(liveRand), start, gain, distant);
      this.voices.add(voice);
      finalizeVoice(voice, () => this.voices.delete(voice));
    } catch {
      // A failed sound must never break the game.
    }
  }

  private refreshAmbience(): void {
    const ctx = this.ctx;
    const amb = this.ambience;
    if (!ctx || !amb) return;
    const scene = toPlayerScene(this.scene);
    const now = ctx.currentTime;
    if (!scene || !this.audible('music')) amb.stop(now);
    else amb.setScene(scene, now);
    // The interval keeps running only while there is music to schedule or a fade to clean up.
    if (amb.busy && !this.userSuspended) this.startTimer();
    else if (!amb.busy) this.stopTimer();
  }

  private startTimer(): void {
    if (this.timer !== null || !this.live) return;
    this.timerStarts += 1;
    this.timer = this.host.setInterval(() => this.tick(), PUMP_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) this.host.clearInterval(this.timer);
    this.timer = null;
  }

  /** Try to (re)start a live context: after unlock, a tab return, an interruption or a stall. */
  private kick(): void {
    const ctx = this.live;
    if (!ctx || this.userSuspended || !this.visible()) return;
    if (ctx.state === 'running' && this.stalled) {
      // A stuck clock: a suspend/resume pair from a gesture restarts the audio device.
      this.stalled = false;
      this.clockSeen = { t: -1, wall: 0 };
      void ctx.suspend().then(() => ctx.resume()).catch(() => {});
      return;
    }
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
  }

  private onStateChange(): void {
    const ctx = this.live;
    if (!ctx) return;
    this.clockSeen = { t: -1, wall: 0 };
    // iOS 'interrupted' (a call, Siri) or a system suspend: try to come back when we may.
    if (ctx.state !== 'running') this.kick();
  }

  private visible(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }

  private listen(): void {
    if (this.listening || typeof document === 'undefined') return;
    this.listening = true;
    document.addEventListener('visibilitychange', () => {
      const ctx = this.live;
      if (!ctx) return;
      if (!this.visible()) {
        this.stopTimer();
        if (ctx.state === 'running') void ctx.suspend().catch(() => {});
      } else if (!this.userSuspended) {
        this.kick();
        this.refreshAmbience();
      }
    });
    // iOS may refuse a resume outside a gesture after an interruption; the next tap fixes it.
    const kick = (): void => this.kick();
    document.addEventListener('pointerdown', kick, { passive: true });
    document.addEventListener('touchend', kick, { passive: true });
  }
}
