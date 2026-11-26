/**
 * Node and voice accounting (GDD §11 "Audio"; performance budgets in CLAUDE.md). We cannot
 * listen, and Web Audio gives no way to ask "how many nodes are alive", so the engine counts
 * them itself: every node a context creates is counted on creation and released on its first
 * full `disconnect()`; every scheduled source is counted from `start()` until its 'ended'
 * event. A leak then shows up as a live count that never returns to the idle baseline.
 *
 * `NodeLedger` is pure bookkeeping (testable in Node with fake nodes); `instrumentContext`
 * patches one context's factory methods so everything created through it is counted.
 */

/** What the ledger needs from a node: a full `disconnect()` releases it. */
export interface CountedNode {
  disconnect(...args: never[]): void;
}

/** What the ledger needs from a source: start/stop times and an 'ended' event. */
export interface CountedSource extends CountedNode {
  start(when?: number, ...rest: never[]): void;
  stop(when?: number): void;
  addEventListener(type: 'ended', fn: () => void): void;
}

export interface LedgerSnapshot {
  /** Nodes created and not yet fully disconnected. */
  liveNodes: number;
  /** Live nodes per factory ('gain', 'oscillator', …). */
  liveByKind: Record<string, number>;
  created: number;
  released: number;
  /** Sources started and not yet ended (what the audio thread is computing). */
  liveSources: number;
  /** Most sources alive at once since the last `resetPeak()`. */
  peakSources: number;
  /** Latest stop time of any live source (context seconds); 0 when none. */
  latestEnd: number;
}

export class NodeLedger {
  private created = 0;
  private released = 0;
  private readonly byKind: Record<string, number> = {};
  private liveSourcesN = 0;
  private peak = 0;
  /** Live sources -> scheduled stop time (Infinity until stop() is called). */
  private readonly ends = new Map<object, number>();

  /** Count `node`; its first argument-less `disconnect()` releases it. Returns the node. */
  node<T extends CountedNode>(node: T, kind: string): T {
    this.created += 1;
    this.byKind[kind] = (this.byKind[kind] ?? 0) + 1;
    let released = false;
    const orig = node.disconnect;
    const ledger = this;
    // A partial disconnect (with a destination) leaves the node alive; only the full one counts.
    (node as unknown as { disconnect: (...a: unknown[]) => void }).disconnect = function (this: unknown, ...args: unknown[]): void {
      if (args.length === 0 && !released) {
        released = true;
        ledger.released += 1;
        ledger.byKind[kind] = (ledger.byKind[kind] ?? 1) - 1;
      }
      (orig as (...a: unknown[]) => void).apply(node, args);
    };
    return node;
  }

  /** Count a scheduled source: live from start() until its 'ended' event. */
  source<T extends CountedSource>(src: T, kind: string): T {
    this.node(src, kind);
    let started = false;
    let ended = false;
    const origStart = src.start;
    const origStop = src.stop;
    const ledger = this;
    (src as unknown as { start: (...a: unknown[]) => void }).start = function (...args: unknown[]): void {
      (origStart as (...a: unknown[]) => void).apply(src, args);
      if (started) return;
      started = true;
      if (ended) return;
      ledger.liveSourcesN += 1;
      ledger.peak = Math.max(ledger.peak, ledger.liveSourcesN);
      if (!ledger.ends.has(src)) ledger.ends.set(src, Infinity);
    };
    (src as unknown as { stop: (...a: unknown[]) => void }).stop = function (...args: unknown[]): void {
      (origStop as (...a: unknown[]) => void).apply(src, args);
      const when = typeof args[0] === 'number' ? args[0] : 0;
      if (started && !ended) ledger.ends.set(src, when);
    };
    src.addEventListener('ended', () => {
      if (ended) return;
      ended = true;
      if (!started) return;
      ledger.liveSourcesN -= 1;
      ledger.ends.delete(src);
    });
    return src;
  }

  resetPeak(): void {
    this.peak = this.liveSourcesN;
  }

  get liveNodes(): number {
    return this.created - this.released;
  }

  get liveSources(): number {
    return this.liveSourcesN;
  }

  snapshot(): LedgerSnapshot {
    let latestEnd = 0;
    for (const t of this.ends.values()) latestEnd = Math.max(latestEnd, t);
    const liveByKind: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.byKind)) if (v) liveByKind[k] = v;
    return {
      liveNodes: this.liveNodes,
      liveByKind,
      created: this.created,
      released: this.released,
      liveSources: this.liveSourcesN,
      peakSources: this.peak,
      latestEnd,
    };
  }
}

const NODE_FACTORIES = ['createGain', 'createBiquadFilter', 'createStereoPanner', 'createDynamicsCompressor', 'createWaveShaper', 'createConvolver'] as const;
const SOURCE_FACTORIES = ['createOscillator', 'createBufferSource'] as const;

const kindOf = (factory: string): string => {
  const k = factory.slice('create'.length);
  return k.charAt(0).toLowerCase() + k.slice(1);
};

/**
 * Route one context's node factories through `ledger`. Idempotent per context. Works on any
 * BaseAudioContext (live or offline), so the soak test measures exactly what the game creates.
 */
export const instrumentContext = (ctx: BaseAudioContext, ledger: NodeLedger): void => {
  const c = ctx as unknown as Record<string, unknown> & { __ledger?: NodeLedger };
  if (c.__ledger) return;
  c.__ledger = ledger;
  for (const name of NODE_FACTORIES) {
    const orig = c[name];
    if (typeof orig !== 'function') continue;
    const kind = kindOf(name);
    c[name] = (...args: unknown[]) => ledger.node((orig as (...a: unknown[]) => CountedNode).apply(ctx, args), kind);
  }
  for (const name of SOURCE_FACTORIES) {
    const orig = c[name];
    if (typeof orig !== 'function') continue;
    const kind = kindOf(name);
    c[name] = (...args: unknown[]) => ledger.source((orig as (...a: unknown[]) => CountedSource).apply(ctx, args), kind);
  }
};

/** Bytes held by a set of AudioBuffers (float32 samples). */
export const bufferBytes = (buffers: Iterable<{ length: number; numberOfChannels: number }>): number => {
  let n = 0;
  for (const b of buffers) n += b.length * b.numberOfChannels * 4;
  return n;
};
