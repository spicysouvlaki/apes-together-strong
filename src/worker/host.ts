/**
 * Transport-free sim host: everything the worker does, minus `self.onmessage`.
 * Owns the authoritative GameState, runs rival turns, autosaves and manual saves, and posts
 * FromWorker messages. sim.worker.ts wires it to postMessage; tests drive it directly.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { Command, FromWorker, GameState, PlayerId, Sim, SimEvent, ToWorker } from '@contracts/sim-api';
import { SAVE_SIZE_LIMIT, saveSize, type Saves } from '../platform/saves';

export type RunAiTurn = (
  state: GameState,
  player: PlayerId,
  content: ContentBundle,
  sim: Sim,
) => { state: GameState; events: SimEvent[] };

export interface HostOptions {
  sim: Sim;
  runAiTurn: RunAiTurn;
  /** A thunk so a content error surfaces as an `error` message instead of killing the worker. */
  content: ContentBundle | (() => ContentBundle);
  saves: Saves;
  post: (msg: FromWorker) => void;
  /** Hard cap on AI steps per human action (a step = one AI turn or one forced command). */
  maxAiSteps?: number;
}

/**
 * Snapshot for the main thread: every player's affinity emptied (GDD §4 "Hidden affinity").
 * Shallow copies only; the worker's state is untouched.
 */
export const stripHidden = (state: GameState): GameState => {
  const players: GameState['players'] = {};
  for (const [id, p] of Object.entries(state.players)) players[id] = { ...p, affinity: {} };
  return { ...state, players };
};

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class SimHost {
  private state: GameState | null = null;
  /** `${turn}:${player}` of the last human turn start we autosaved (or loaded). */
  private lastTurnStart: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private contentCache: ContentBundle | null = null;
  private readonly maxAiSteps: number;

  constructor(private readonly opts: HostOptions) {
    this.maxAiSteps = opts.maxAiSteps ?? 2000;
  }

  /** The authoritative state (unstripped). For tests and tooling. */
  get current(): GameState | null {
    return this.state;
  }

  private get content(): ContentBundle {
    if (!this.contentCache) {
      const c = this.opts.content;
      this.contentCache = typeof c === 'function' ? c() : c;
    }
    return this.contentCache;
  }

  /** Messages are handled strictly in order, even though saves are async. */
  receive(msg: ToWorker): Promise<void> {
    this.queue = this.queue.then(() => this.handle(msg));
    return this.queue;
  }

  private post(msg: FromWorker): void {
    this.opts.post(msg);
  }

  private postState(events: SimEvent[]): void {
    if (this.state) this.post({ type: 'state', state: stripHidden(this.state), events });
  }

  private async postSaves(): Promise<void> {
    this.post({ type: 'saves', saves: await this.opts.saves.list() });
  }

  private async handle(msg: ToWorker): Promise<void> {
    try {
      switch (msg.type) {
        case 'newGame': {
          const { state, events } = this.opts.sim.createGame(msg.setup, this.content);
          this.state = state;
          this.lastTurnStart = null;
          await this.advance(events);
          return;
        }
        case 'command': {
          if (!this.state) throw new Error('No game in progress.');
          const res = this.opts.sim.applyCommand(this.state, msg.player, msg.command, this.content);
          if (!res.ok) {
            this.post({ type: 'error', message: res.error });
            return;
          }
          this.state = res.state;
          await this.advance([...res.events]);
          return;
        }
        case 'save': {
          if (!this.state) throw new Error('No game in progress to save.');
          this.warnIfLarge(this.state);
          await this.opts.saves.save(msg.slot, this.state);
          await this.postSaves();
          return;
        }
        case 'load': {
          const state = await this.opts.saves.load(msg.slot);
          this.state = state;
          // Don't immediately autosave over the ring with the turn we just loaded.
          this.lastTurnStart = this.turnStartKey(state);
          await this.advance([]);
          return;
        }
        case 'deleteSave':
          await this.opts.saves.delete(msg.slot);
          await this.postSaves();
          return;
        case 'listSaves':
          await this.postSaves();
          return;
        default: {
          const never: never = msg;
          throw new Error(`Unknown message ${JSON.stringify(never)}`);
        }
      }
    } catch (err) {
      this.post({ type: 'error', message: errorMessage(err) });
    }
  }

  /** Runs rivals until a human must act, posts one state with every event, then autosaves. */
  private async advance(events: SimEvent[]): Promise<void> {
    this.runAi(events);
    this.postState(events);
    const s = this.state;
    const key = s ? this.turnStartKey(s) : null;
    if (s && key && key !== this.lastTurnStart) {
      this.lastTurnStart = key;
      try {
        this.warnIfLarge(s);
        await this.opts.saves.autosave(s);
        await this.postSaves();
      } catch (err) {
        this.post({ type: 'error', message: `Autosave failed: ${errorMessage(err)}` });
      }
    }
  }

  /** Non-null when a human player's turn is in progress. */
  private turnStartKey(s: GameState): string | null {
    if (s.phase !== 'playing' || !s.players[s.currentPlayer]?.isHuman) return null;
    return `${s.turn}:${s.currentPlayer}`;
  }

  private warnIfLarge(s: GameState): void {
    const size = saveSize(s);
    if (size > SAVE_SIZE_LIMIT) console.warn(`Save is ${(size / 1024 / 1024).toFixed(2)} MB, over the 2 MB budget.`);
  }

  /** Apply a command for a stuck AI; true if accepted. */
  private force(player: PlayerId, command: Command, events: SimEvent[]): boolean {
    if (!this.state) return false;
    const res = this.opts.sim.applyCommand(this.state, player, command, this.content);
    if (!res.ok) return false;
    this.state = res.state;
    events.push(...res.events);
    return true;
  }

  private tryAiTurn(player: PlayerId, events: SimEvent[]): void {
    if (!this.state) return;
    try {
      const r = this.opts.runAiTurn(this.state, player, this.content, this.opts.sim);
      this.state = r.state;
      events.push(...r.events);
    } catch (err) {
      // A broken AI must never stall the game; the caller forces progress next.
      this.post({ type: 'error', message: `AI error for ${player}: ${errorMessage(err)}` });
    }
  }

  private runAi(events: SimEvent[]): void {
    for (let steps = 0; steps < this.maxAiSteps; steps++) {
      const s = this.state;
      if (!s) return;
      if (s.phase === 'playing') {
        const player = s.currentPlayer;
        if (s.players[player]?.isHuman ?? true) return;
        this.post({ type: 'thinking', player });
        const before = `${s.phase}|${s.turn}|${s.currentPlayer}`;
        this.tryAiTurn(player, events);
        const after = this.state;
        if (after && `${after.phase}|${after.turn}|${after.currentPlayer}` === before) {
          if (!this.force(player, { type: 'endTurn' }, events)) {
            this.post({ type: 'error', message: `Rival ${player} is stuck: endTurn was rejected.` });
            return;
          }
        }
      } else if (s.phase === 'transition') {
        const recap = s.transition?.recap ?? {};
        const pending = s.playerOrder.filter((id) => {
          const p = s.players[id];
          return p && !p.isHuman && p.alive && recap[id] && !recap[id].done;
        });
        if (pending.length === 0) return;
        for (const id of pending) {
          if (this.state?.phase !== 'transition') break;
          this.post({ type: 'thinking', player: id });
          this.tryAiTurn(id, events);
          const now = this.state;
          if (now?.phase === 'transition' && !now.transition?.recap[id]?.done) {
            if (!this.force(id, { type: 'finishTransition' }, events)) {
              this.post({ type: 'error', message: `Rival ${id} is stuck: finishTransition was rejected.` });
              return;
            }
          }
          steps++;
        }
      } else {
        return; // 'ended'
      }
    }
    this.post({ type: 'error', message: `Rival turns stopped after ${this.maxAiSteps} steps (loop guard).` });
  }
}
