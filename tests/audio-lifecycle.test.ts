/**
 * Audio lifecycle in Node: node accounting, voice release, scene transitions, the single
 * scheduler across suspend/resume, mute, and the stalled-clock guard (GDD §11 "Audio").
 * A small fake AudioContext stands in for Web Audio: sources end when the fake clock passes
 * their stop time, and a fake host owns the wall clock and the intervals.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeLedger, instrumentContext, type CountedSource } from '../src/audio/accounting';
import { LOOKAHEAD, PUMP_MS, STALL_MS, WebAudioEngine, type EngineHost } from '../src/audio/engine';
import { busGains, MAX_SFX_VOICES } from '../src/audio/levels';
import { SFX_LIST } from '../src/audio/recipes';
import { PluckCache, PLUCK_CACHE_BYTES } from '../src/audio/synth';

// --- fakes -----------------------------------------------------------------------------------

class FakeParam {
  value = 0;
  setValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number): this {
    this.value = v;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  [k: string]: unknown;
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  readonly Q = new FakeParam();
  readonly pan = new FakeParam();
  readonly playbackRate = new FakeParam();
  readonly threshold = new FakeParam();
  readonly knee = new FakeParam();
  readonly ratio = new FakeParam();
  readonly attack = new FakeParam();
  readonly release = new FakeParam();
  outputs = 0;
  constructor(readonly ctx: FakeContext) {}
  connect(): void {
    this.outputs += 1;
  }
  disconnect(): void {
    this.outputs = 0;
  }
}

class FakeSource extends FakeNode {
  startAt: number | null = null;
  stopAt = Infinity;
  ended = false;
  buffer: { duration: number } | null = null;
  loop = false;
  onended: (() => void) | null = null;
  private readonly listeners: (() => void)[] = [];
  start(when = 0): void {
    this.startAt = when;
    this.ctx.sources.add(this);
  }
  stop(when = 0): void {
    this.stopAt = when;
  }
  addEventListener(_t: 'ended', fn: () => void): void {
    this.listeners.push(fn);
  }
  fire(): void {
    this.ended = true;
    for (const fn of this.listeners) fn();
    this.onended?.();
  }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 8000;
  state: 'suspended' | 'running' | 'closed' | 'interrupted' = 'suspended';
  readonly destination = new FakeNode(this);
  readonly sources = new Set<FakeSource>();
  onstatechange: (() => void) | null = null;
  suspendCalls = 0;
  resumeCalls = 0;
  static last: FakeContext | null = null;
  constructor() {
    FakeContext.last = this;
  }
  private setState(s: FakeContext['state']): void {
    this.state = s;
    this.onstatechange?.();
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.setState('running');
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspendCalls += 1;
    this.setState('suspended');
    return Promise.resolve();
  }
  interrupt(): void {
    this.setState('interrupted');
  }
  createGain(): FakeNode {
    return new FakeNode(this);
  }
  createBiquadFilter(): FakeNode {
    return new FakeNode(this);
  }
  createStereoPanner(): FakeNode {
    return new FakeNode(this);
  }
  createDynamicsCompressor(): FakeNode {
    return new FakeNode(this);
  }
  createWaveShaper(): FakeNode {
    return new FakeNode(this);
  }
  createConvolver(): FakeNode {
    return new FakeNode(this);
  }
  createOscillator(): FakeSource {
    return new FakeSource(this);
  }
  createBufferSource(): FakeSource {
    return new FakeSource(this);
  }
  createBuffer(channels: number, length: number, sampleRate: number): object {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (i: number) => data[i] };
  }
  /** Advance the audio clock (only while running) and end the sources it passes. */
  advance(seconds: number): void {
    if (this.state !== 'running') return;
    this.currentTime += seconds;
    for (const s of [...this.sources]) {
      const natural = s.buffer && !s.loop && s.startAt !== null ? s.startAt + s.buffer.duration : Infinity;
      if (!s.ended && Math.min(s.stopAt, natural) <= this.currentTime) {
        this.sources.delete(s);
        s.fire();
      }
    }
  }
}

class FakeHost implements EngineHost {
  wall = 0;
  private nextId = 1;
  readonly intervals = new Map<number, () => void>();
  now(): number {
    return this.wall;
  }
  setInterval(fn: () => void): unknown {
    const id = this.nextId++;
    this.intervals.set(id, fn);
    return id;
  }
  clearInterval(id: unknown): void {
    this.intervals.delete(id as number);
  }
  fire(): void {
    for (const fn of [...this.intervals.values()]) fn();
  }
}

/** Minimal document: visibility and listeners. */
class FakeDocument {
  visibilityState: 'visible' | 'hidden' = 'visible';
  private readonly ls = new Map<string, (() => void)[]>();
  addEventListener(t: string, fn: () => void): void {
    this.ls.set(t, [...(this.ls.get(t) ?? []), fn]);
  }
  dispatch(t: string): void {
    for (const fn of this.ls.get(t) ?? []) fn();
  }
}

let doc: FakeDocument;
let host: FakeHost;
const g = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  doc = new FakeDocument();
  host = new FakeHost();
  g.window = { AudioContext: FakeContext };
  g.document = doc;
});
afterEach(() => {
  delete g.window;
  delete g.document;
});

/** An unlocked engine on a running fake context. */
const boot = (): { e: WebAudioEngine; ctx: FakeContext } => {
  const e = new WebAudioEngine(host);
  e.unlock();
  const ctx = FakeContext.last;
  if (!ctx) throw new Error('no context');
  return { e, ctx };
};

/** Run `seconds` of session: scheduler ticks every PUMP_MS of wall and audio time. */
const run = (ctx: FakeContext, seconds: number): void => {
  const steps = Math.round((seconds * 1000) / PUMP_MS);
  for (let i = 0; i < steps; i++) {
    host.wall += PUMP_MS;
    ctx.advance(PUMP_MS / 1000);
    host.fire();
  }
};

// --- accounting -------------------------------------------------------------------------------

describe('node ledger', () => {
  it('counts a node until its first full disconnect; partial disconnects keep it alive', () => {
    const l = new NodeLedger();
    const ctx = new FakeContext();
    const a = l.node(ctx.createGain(), 'gain');
    const b = l.node(ctx.createGain(), 'gain');
    expect(l.liveNodes).toBe(2);
    (a.disconnect as (d?: unknown) => void)(b);
    expect(l.liveNodes).toBe(2);
    a.disconnect();
    a.disconnect();
    expect(l.liveNodes).toBe(1);
    expect(l.snapshot()).toMatchObject({ created: 2, released: 1, liveByKind: { gain: 1 } });
  });

  it('counts sources from start to ended, tracks the peak and the latest stop time', () => {
    const l = new NodeLedger();
    const ctx = new FakeContext();
    ctx.state = 'running';
    const s1 = l.source(ctx.createOscillator() as unknown as CountedSource, 'oscillator');
    const s2 = l.source(ctx.createOscillator() as unknown as CountedSource, 'oscillator');
    l.source(ctx.createOscillator() as unknown as CountedSource, 'oscillator'); // never started
    s1.start(0);
    s1.stop(1);
    s2.start(0.5);
    s2.stop(2);
    expect(l.snapshot()).toMatchObject({ liveSources: 2, peakSources: 2, latestEnd: 2 });
    ctx.advance(1.2);
    expect(l.snapshot()).toMatchObject({ liveSources: 1, peakSources: 2, latestEnd: 2 });
    ctx.advance(1);
    expect(l.liveSources).toBe(0);
    l.resetPeak();
    expect(l.snapshot().peakSources).toBe(0);
  });

  it('instruments a context once, whatever the factory', () => {
    const l = new NodeLedger();
    const ctx = new FakeContext();
    instrumentContext(ctx as unknown as BaseAudioContext, l);
    instrumentContext(ctx as unknown as BaseAudioContext, new NodeLedger());
    ctx.createGain();
    ctx.createConvolver();
    ctx.createBufferSource();
    expect(l.liveNodes).toBe(3);
  });

  it('the pluck cache is bounded in bytes as well as entries', () => {
    const ctx = new FakeContext();
    ctx.sampleRate = 48000;
    const cache = new PluckCache(ctx as unknown as BaseAudioContext, 40);
    for (let m = 0; m < 60; m++) cache.get(110 * Math.pow(2, m / 12), 0.5, 1, 3);
    expect(cache.size).toBeLessThanOrEqual(40);
    expect(cache.bytes).toBeLessThanOrEqual(PLUCK_CACHE_BYTES);
    const before = cache.misses;
    cache.get(110 * Math.pow(2, 59 / 12), 0.5, 1, 2.8); // same 0.5 s length bucket: a hit
    expect(cache.misses).toBe(before);
  });
});

// --- voices -----------------------------------------------------------------------------------

describe('sfx voices', () => {
  it('free every node when they end: live nodes return to the baseline', () => {
    const { e, ctx } = boot();
    const base = e.stats().baselineNodes;
    expect(base).toBeGreaterThan(0);
    for (const sfx of SFX_LIST) e.play(sfx);
    expect(e.stats().sfxVoices).toBeGreaterThan(0);
    expect(e.stats().liveNodes).toBeGreaterThan(base);
    run(ctx, 4);
    const s = e.stats();
    expect(s.sfxVoices).toBe(0);
    expect(s.liveSources).toBe(0);
    expect(s.liveNodes).toBe(base);
  });

  it('never hold more than MAX_SFX_VOICES sounding at once (oldest stolen)', () => {
    const { e, ctx } = boot();
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      e.play(SFX_LIST[i % SFX_LIST.length] ?? 'tap');
      peak = Math.max(peak, e.stats().sfxSounding);
      host.wall += 10;
      ctx.advance(0.01);
    }
    expect(peak).toBeLessThanOrEqual(MAX_SFX_VOICES);
    run(ctx, 4);
    expect(e.stats().liveNodes).toBe(e.stats().baselineNodes);
  });

  it('queues nothing while the context is hidden, user-suspended or stalled', () => {
    const { e, ctx } = boot();
    e.suspend();
    e.play('wonder');
    expect(e.stats().sfxVoices).toBe(0);
    e.resume();
    // Stalled: 'running' but the clock does not move for longer than STALL_MS.
    e.play('tap');
    host.wall += STALL_MS + 100;
    e.play('tap');
    expect(e.stats().clockStalled).toBe(true);
    const created = e.stats().created;
    e.play('wonder');
    expect(e.stats().created).toBe(created);
    // A tap restarts the device (suspend + resume) and sounds come back.
    const s0 = ctx.suspendCalls;
    doc.dispatch('pointerdown');
    expect(ctx.suspendCalls).toBe(s0 + 1);
    expect(e.stats().clockStalled).toBe(false);
  });
});

// --- ambience -------------------------------------------------------------------------------

describe('ambience scenes', () => {
  it('free the old scene within ~4 s of an age change; one drone remains', () => {
    const { e, ctx } = boot();
    e.setAmbience({ age: 'ancient', cultures: { greek: 1, arab: 0.6 } });
    run(ctx, 10);
    const steady = e.stats();
    expect(steady.drones).toBe(1);
    e.setAmbience({ age: 'classical', cultures: { mongol: 1 }, crisis: false });
    expect(e.stats().drones).toBe(2);
    expect(e.stats().ambienceQueued).toBe(0); // the old scene's look-ahead was cancelled
    run(ctx, 4);
    const s = e.stats();
    expect(s.drones).toBe(1);
    run(ctx, 1);
    // Culture buses no longer wanted (greek, arab) are disconnected once silent.
    expect(e.stats().ambienceBuses).toBeLessThanOrEqual(4);
  });

  it('rapid scene changes (5 in 2 s) never stack drones', () => {
    const { e, ctx } = boot();
    const ages = ['ancient', 'classical', 'exploration', 'modern', 'ancient'] as const;
    let peak = 0;
    for (const [i, age] of ages.entries()) {
      e.setAmbience({ age, crisis: i % 2 === 1, cultures: { norse: 0.5 } });
      peak = Math.max(peak, e.stats().drones);
      run(ctx, 0.4);
      peak = Math.max(peak, e.stats().drones);
    }
    expect(peak).toBeLessThanOrEqual(3);
    run(ctx, 4);
    expect(e.stats().drones).toBe(1);
  });

  it('a scene holds a bounded number of nodes over a long session', () => {
    const { e, ctx } = boot();
    e.setAmbience({ age: 'classical', cultures: { greek: 1, chinese: 0.8, inuit: 0.6, mongol: 0.4 } });
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      run(ctx, 1);
      peak = Math.max(peak, e.stats().liveNodes);
    }
    // Long-lived per scene <= ~33 (documented on AmbiencePlayer) + the notes in the look-ahead.
    expect(peak).toBeLessThan(e.stats().baselineNodes + 400);
    expect(e.stats().ambienceBuses).toBeLessThanOrEqual(7);
  });

  it('turning the ambience off returns to the idle baseline and stops the scheduler', () => {
    const { e, ctx } = boot();
    e.setAmbience({ age: 'modern', cultures: { spanish: 1 }, crisis: true });
    run(ctx, 8);
    e.setAmbience({ age: null });
    run(ctx, 5);
    const s = e.stats();
    expect(s.liveNodes).toBe(s.baselineNodes);
    expect(s.ambienceVoices).toBe(0);
    expect(s.scheduler.running).toBe(false);
    expect(host.intervals.size).toBe(0);
  });
});

// --- scheduler, suspend and resume ------------------------------------------------------------

describe('scheduler', () => {
  it('runs exactly one interval through any order of suspend, resume, visibility and interruptions', () => {
    const { e, ctx } = boot();
    e.setAmbience({ age: 'ancient' });
    for (let i = 0; i < 10; i++) {
      // The UI's own visibility handler calls suspend/resume, and the engine listens too.
      doc.visibilityState = 'hidden';
      doc.dispatch('visibilitychange');
      e.suspend();
      expect(host.intervals.size).toBe(0);
      doc.visibilityState = 'visible';
      e.resume();
      doc.dispatch('visibilitychange');
      e.resume();
      e.setAmbience({ age: 'ancient', cultures: { greek: i / 10 } });
      expect(host.intervals.size).toBe(1);
      ctx.interrupt();
      expect(ctx.state).toBe('running'); // came straight back while visible
      doc.dispatch('pointerdown');
      expect(host.intervals.size).toBe(1);
      run(ctx, 0.5);
    }
    expect(e.stats().scheduler.running).toBe(true);
    expect(e.stats().drones).toBe(1);
  });

  it('music and sfx both work again after a background round trip', () => {
    const { e, ctx } = boot();
    e.setAmbience({ age: 'classical' });
    run(ctx, 3);
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    e.suspend();
    const t = ctx.currentTime;
    host.wall += 60_000;
    run(ctx, 2); // suspended: the clock does not move, nothing is scheduled
    expect(ctx.currentTime).toBe(t);
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    e.resume();
    const created = e.stats().created;
    run(ctx, 3);
    expect(e.stats().created).toBeGreaterThan(created); // music notes again
    e.play('recruit');
    expect(e.stats().sfxVoices).toBe(1);
    expect(e.stats().clockStalled).toBe(false);
  });

  it('look-ahead stays within LOOKAHEAD of the clock', () => {
    const { e, ctx } = boot();
    e.setAmbience({ age: 'classical', cultures: { inuit: 1 } });
    let sawPending = false;
    for (let i = 0; i < 50; i++) {
      run(ctx, 0.3);
      const s = e.stats();
      expect(s.ambienceQueued + s.ambienceSounding).toBeLessThanOrEqual(s.ambienceVoices);
      // Only notes inside the look-ahead window hold nodes; the rest wait as plain data.
      expect(s.ambienceQueued).toBeLessThanOrEqual(40);
      sawPending ||= s.ambiencePending > 0;
    }
    expect(sawPending).toBe(true);
    expect(LOOKAHEAD).toBeLessThanOrEqual(0.5);
  });
});

// --- mute and volume ----------------------------------------------------------------------

describe('mute and volume', () => {
  it('reports bus gains and stops scheduling music while muted or at 0, then resumes', () => {
    const { e, ctx } = boot();
    e.setSettings({ sfxVolume: 80, musicVolume: 50, muted: false });
    e.setAmbience({ age: 'exploration', cultures: { norse: 1 } });
    run(ctx, 4);
    expect(e.stats().gains.musicTarget).toBeGreaterThan(0);
    expect(e.stats().gains.sfxTarget).toBeCloseTo(busGains({ sfxVolume: 80, musicVolume: 50, muted: false }).sfx);

    e.setSettings({ sfxVolume: 80, musicVolume: 50, muted: true });
    expect(e.stats().gains).toMatchObject({ sfx: 0, music: 0, sfxTarget: 0, musicTarget: 0 });
    run(ctx, 5);
    const muted = e.stats();
    expect(muted.liveNodes).toBe(muted.baselineNodes);
    expect(muted.scheduler.running).toBe(false);
    const created = muted.created;
    e.play('tap');
    run(ctx, 5);
    expect(e.stats().created).toBe(created); // no notes, no sfx: no CPU

    e.setSettings({ sfxVolume: 80, musicVolume: 0, muted: false });
    run(ctx, 2);
    expect(e.stats().scheduler.running).toBe(false);
    e.play('tap');
    expect(e.stats().sfxVoices).toBe(1);

    e.setSettings({ sfxVolume: 80, musicVolume: 50, muted: false });
    expect(e.stats().scheduler.running).toBe(true);
    run(ctx, 4);
    expect(e.stats().drones).toBe(1);
    expect(e.stats().ambienceVoices).toBeGreaterThan(0);
  });
});
