/**
 * The Web Audio engine behind `audio` (GDD §11). Main thread only.
 *
 * - Lazy: no AudioContext until `unlock()` (iOS needs a user gesture); every method is a safe
 *   no-op before that, in Node, in workers and without Web Audio.
 * - iOS Safari: handles `webkitAudioContext`, the 'interrupted' state (calls, Siri), resume on
 *   tab return, and asks for the 'ambient' audio session so the ring/silent switch is honoured.
 * - Voices: at most MAX_SFX_VOICES one-shots (oldest stolen with a 10 ms fade), per-sound
 *   minimum gaps so spammy events never stack; every node is disconnected when its voice ends.
 */
import cultures from '@content/cultures.json';
import type { PlayerId, SimEvent } from '@contracts/sim-api';
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

const PUMP_MS = 100;

export class WebAudioEngine implements AudioEngine {
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private userSuspended = false;
  private voices: SfxVoice[] = [];
  private readonly lastStart = new Map<Sfx, number>();
  private scene: AmbienceScene = { age: null };
  private ambience: AmbiencePlayer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private planOptions: PlanOptions = {};
  private listening = false;

  /** For the UI to give the planner a settlement-owner lookup (enables growth ticks). */
  setPlanOptions(o: PlanOptions): void {
    this.planOptions = o;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Live counts for the demo page / debugging. */
  stats(): { state: string; sfxVoices: number; ambienceVoices: number; plucksCached: number } {
    const now = this.ctx?.currentTime ?? 0;
    return {
      state: this.ctx?.state ?? 'locked',
      sfxVoices: this.voices.filter((v) => v.end > now).length,
      ambienceVoices: this.ambience?.activeVoices ?? 0,
      plucksCached: this.graph?.plucks.size ?? 0,
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
        this.ctx = ctx;
        this.graph = buildGraph(ctx);
        this.applySettings(0);
        // Old iOS only unlocks once a buffer has played inside the gesture.
        const b = ctx.createBufferSource();
        b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        b.connect(ctx.destination);
        b.start(0);
        ctx.onstatechange = () => this.onStateChange();
        this.listen();
        this.refreshAmbience();
      }
      if (!this.userSuspended && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
    } catch {
      // No sound is better than a crash.
    }
  }

  play(sfx: Sfx): void {
    this.playAt(sfx, 0, 1, false);
  }

  playEvents(events: readonly SimEvent[], viewer: PlayerId | null): void {
    if (!this.audible('sfx')) return;
    for (const p of planEvents(events, viewer, this.planOptions)) this.playAt(p.sfx, p.delayMs / 1000, p.gain, p.distant);
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
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => {});
  }

  resume(): void {
    this.userSuspended = false;
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
    this.refreshAmbience();
  }

  // --- internals --------------------------------------------------------------------------------

  private audible(kind: 'sfx' | 'music'): boolean {
    const g = busGains(this.settings);
    return !!this.ctx && !!this.graph && (kind === 'sfx' ? g.sfx : g.music) > 0;
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
    // A context still resuming from unlock() will play this as soon as it runs; a hidden,
    // user-suspended or interrupted one must not queue up a pile of sounds.
    const resuming = ctx.state === 'suspended' && !this.userSuspended && this.visible();
    if (ctx.state !== 'running' && !resuming) return;
    try {
      const recipe = RECIPES[sfx];
      const start = ctx.currentTime + 0.005 + Math.max(0, delay);
      const last = this.lastStart.get(sfx);
      if (last !== undefined && Math.abs(start - last) * 1000 < recipe.minGapMs) return;
      this.lastStart.set(sfx, start);

      const now = ctx.currentTime;
      this.voices = this.voices.filter((v) => v.end > now);
      while (this.voices.length >= MAX_SFX_VOICES) {
        const oldest = this.voices.shift();
        if (oldest) stealVoice(oldest, oldest.gain, now);
      }

      const voice = spawnSfx(g, sfx, recipe.build(liveRand), start, gain, distant);
      this.voices.push(voice);
      finalizeVoice(voice);
    } catch {
      // A failed sound must never break the game.
    }
  }

  private refreshAmbience(): void {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;
    const scene = toPlayerScene(this.scene);
    const now = ctx.currentTime;
    if (!scene || !this.audible('music')) {
      this.ambience?.stop(now);
      this.stopTimer();
      return;
    }
    if (!this.ambience) this.ambience = new AmbiencePlayer(g, g.ambDry, g.ambWet, liveRand);
    this.ambience.setScene(scene, now);
    if (!this.userSuspended) this.startTimer();
  }

  private startTimer(): void {
    if (this.timer !== null || typeof setInterval === 'undefined') return;
    this.timer = setInterval(() => {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running' || !this.ambience) return;
      this.ambience.pump(ctx.currentTime, 0.5);
    }, PUMP_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private onStateChange(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // iOS 'interrupted' (a call, Siri) or a system suspend: try to come back when we may.
    if (ctx.state !== 'running' && !this.userSuspended && this.visible()) void ctx.resume().catch(() => {});
  }

  private visible(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }

  private listen(): void {
    if (this.listening || typeof document === 'undefined') return;
    this.listening = true;
    document.addEventListener('visibilitychange', () => {
      const ctx = this.ctx;
      if (!ctx) return;
      if (!this.visible()) {
        this.stopTimer();
        if (ctx.state === 'running') void ctx.suspend().catch(() => {});
      } else if (!this.userSuspended) {
        void ctx.resume().catch(() => {});
        this.refreshAmbience();
      }
    });
    // iOS may refuse a resume outside a gesture after an interruption; the next tap fixes it.
    const kick = (): void => {
      if (this.ctx && this.ctx.state !== 'running' && !this.userSuspended) void this.ctx.resume().catch(() => {});
    };
    document.addEventListener('pointerdown', kick, { passive: true });
    document.addEventListener('touchend', kick, { passive: true });
  }
}
