/**
 * Main-thread client for the sim worker. Framework-free: the UI wraps it in signals.
 *
 *   const client = createSimClient();
 *   const off = client.onMessage((m) => { if (m.type === 'state') gameState.value = m.state; });
 *   client.newGame(setup);
 *   client.command('p1', { type: 'endTurn' });
 *
 * Every request is fire-and-forget; answers arrive as FromWorker messages:
 * newGame/command/load -> 'thinking'* then 'state' (or 'error'); save/deleteSave/listSaves -> 'saves'.
 * Autosaves also post 'saves'.
 */
import type { Command, FromWorker, GameSetup, PlayerId, ToWorker } from '@contracts/sim-api';

/** The subset of Worker we use; lets tests pass a fake. */
export interface WorkerLike {
  postMessage(msg: ToWorker): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

// Must stay a literal `new Worker(new URL(...), ...)` so Vite bundles the worker chunk.
const spawnWorker = (): WorkerLike =>
  new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

export class SimClient {
  private readonly listeners = new Set<(msg: FromWorker) => void>();
  private disposed = false;

  constructor(private readonly worker: WorkerLike = spawnWorker()) {
    worker.onmessage = (e) => this.emit(e.data);
    worker.onerror = (e) => this.emit({ type: 'error', message: `Sim worker crashed: ${e.message || 'unknown error'}` });
  }

  private emit(msg: FromWorker): void {
    for (const cb of this.listeners) cb(msg);
  }

  send(msg: ToWorker): void {
    if (this.disposed) throw new Error('SimClient is disposed');
    this.worker.postMessage(msg);
  }

  /** Subscribe to every worker message; returns an unsubscribe function. */
  onMessage(cb: (msg: FromWorker) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  newGame(setup: GameSetup): void {
    this.send({ type: 'newGame', setup });
  }

  command(player: PlayerId, command: Command): void {
    this.send({ type: 'command', player, command });
  }

  /** `slot` is 'slot:0'..'slot:9'. */
  save(slot: string): void {
    this.send({ type: 'save', slot });
  }

  /** `slot` is 'slot:0'..'slot:9' or 'auto:0' (newest autosave)..'auto:4'. */
  load(slot: string): void {
    this.send({ type: 'load', slot });
  }

  deleteSave(slot: string): void {
    this.send({ type: 'deleteSave', slot });
  }

  listSaves(): void {
    this.send({ type: 'listSaves' });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
  }
}

export const createSimClient = (): SimClient => new SimClient();
