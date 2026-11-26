/**
 * Transport-free sim host: everything the worker does, minus `self.onmessage`.
 * Owns the authoritative GameState, runs rival turns, autosaves and manual saves, and posts
 * FromWorker messages. sim.worker.ts wires it to postMessage; tests drive it directly.
 *
 * Saving (GDD §5 "Saves"), decided here because the protocol is frozen:
 * - Turn-start autosave ring (5) as before, written before the next message is handled.
 * - Rolling RESUME save after every other accepted command, newGame and load. It never blocks
 *   the message queue: at most one write is in flight, newer states replace a pending one
 *   (latest wins), and a write starts immediately when the writer is idle, so the stored state
 *   trails what the UI shows by at most two writes (~10-50 ms each for a late-game state).
 *   Saves lists it as 'auto:0' while it is the newest, so Continue ('auto:0', or the UI's
 *   newest-of auto:0/slot:9) restores mid-turn moves after a reload or an iOS tab kill.
 *   A turn-start autosave first drops the pending resume and waits for the in-flight one, so
 *   the ring write is always the newest (higher seq) and the stale resume gets hidden.
 *   Measured (scripts/measure-save.ts, Node): standard map turn 80 = 527 KB, structuredClone
 *   4 ms; large map turn 121 = 804 KB, 6 ms. iPhone is ~2-4x slower; still well under a frame
 *   budget on the worker thread, so no throttling is needed.
 * - Ownership (src/platform/tab-guard.ts): newGame/load claim the autosaves for this tab; when
 *   another tab claims them, this tab stops autosaving and says so once (and again at each of
 *   its turn starts) through the `error` channel. Manual saves are always allowed.
 * - Storage failures (quota, private mode) are reported once until a save succeeds again; the
 *   game continues in memory.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { Command, FromWorker, GameState, PlayerId, Sim, SimEvent, ToWorker } from '@contracts/sim-api';
import { SAVE_SIZE_LIMIT, SaveOwnershipError, describeStorageError, saveSize, type Saves, type SkippedSave } from '../platform/saves';
import type { TabChannel } from '../platform/tab-guard';

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
  /** Cross-tab notifier (BroadcastChannel in the worker); optional, the IDB check is authoritative. */
  tabs?: TabChannel | null;
}

export const OWNERSHIP_LOST_MESSAGE =
  'This game was opened in another tab or window, so this tab has stopped saving. Close this tab, or reload it to continue here instead.';
export const NOT_SAVING_MESSAGE = 'Not saved: this game is open in another tab or window. Reload to continue here.';

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

const describeSkipped = (skipped: SkippedSave[]): string => {
  const version = skipped.filter((s) => s.reason === 'version').length;
  const damaged = skipped.length - version;
  const parts: string[] = [];
  if (damaged > 0) parts.push(`${damaged} damaged save${damaged === 1 ? '' : 's'}`);
  if (version > 0) parts.push(`${version} save${version === 1 ? '' : 's'} from an incompatible version`);
  return parts.join(' and ');
};

export class SimHost {
  private state: GameState | null = null;
  /** `${turn}:${player}` of the last human turn start we autosaved (or loaded). */
  private lastTurnStart: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private contentCache: ContentBundle | null = null;
  private readonly maxAiSteps: number;
  /** Latest state waiting for the resume writer; replaced by newer states (latest wins). */
  private resumePending: GameState | null = null;
  private resumeWriting: Promise<void> | null = null;
  /** False until this tab claims the saves, and after another tab claims them. */
  private ownsSaves = false;
  /** A storage failure was reported and no save has succeeded since (report once). */
  private saveFailing = false;
  /** Damaged/incompatible save keys already reported (report each once). */
  private readonly reportedSkips = new Set<string>();

  constructor(private readonly opts: HostOptions) {
    this.maxAiSteps = opts.maxAiSteps ?? 2000;
    opts.tabs?.onClaim((owner) => {
      if (owner !== opts.saves.owner) this.loseOwnership();
    });
  }

  /** Resolves when no resume write is pending or in flight (tests; listSaves). */
  async flush(): Promise<void> {
    while (this.resumeWriting) await this.resumeWriting;
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
    const { saves, skipped } = await this.opts.saves.listDetailed();
    this.post({ type: 'saves', saves });
    const fresh = skipped.filter((s) => !this.reportedSkips.has(`${s.key}:${s.reason}`));
    if (fresh.length > 0) {
      for (const s of fresh) this.reportedSkips.add(`${s.key}:${s.reason}`);
      this.post({ type: 'error', message: `Skipped ${describeSkipped(fresh)} in the save list.` });
    }
  }

  // --- Saving -------------------------------------------------------------------------------

  /** Claims the autosaves for this tab (newGame/load). A storage failure is reported, not fatal. */
  private async claimSaves(): Promise<void> {
    this.ownsSaves = true;
    try {
      await this.opts.saves.claim();
      this.opts.tabs?.announce(this.opts.saves.owner);
    } catch (err) {
      this.reportSaveFailure(err);
    }
  }

  private loseOwnership(): void {
    this.resumePending = null;
    if (!this.ownsSaves) return;
    this.ownsSaves = false;
    if (this.state) this.post({ type: 'error', message: OWNERSHIP_LOST_MESSAGE });
  }

  private reportSaveFailure(err: unknown): void {
    if (err instanceof SaveOwnershipError) {
      this.loseOwnership();
      return;
    }
    if (this.saveFailing) return;
    this.saveFailing = true;
    this.post({ type: 'error', message: describeStorageError(err) });
  }

  /** Runs an autosave/resume write if this tab owns the saves; never throws. */
  private async ownedWrite(write: () => Promise<void>): Promise<boolean> {
    if (!this.ownsSaves) return false;
    try {
      await write();
      this.saveFailing = false;
      return true;
    } catch (err) {
      this.reportSaveFailure(err);
      return false;
    }
  }

  /** Queue the latest state for the resume save; starts writing at once if idle. */
  private scheduleResume(state: GameState): void {
    if (!this.ownsSaves) return;
    this.resumePending = state; // the sim never mutates a state it returned, so no copy is needed
    this.resumeWriting ??= this.drainResume();
  }

  private async drainResume(): Promise<void> {
    try {
      while (this.resumePending) {
        const s = this.resumePending;
        this.resumePending = null;
        await this.ownedWrite(() => this.opts.saves.saveResume(s));
      }
    } finally {
      this.resumeWriting = null;
    }
  }

  private async handle(msg: ToWorker): Promise<void> {
    try {
      switch (msg.type) {
        case 'newGame': {
          const { state, events } = this.opts.sim.createGame(msg.setup, this.content);
          this.state = state;
          this.lastTurnStart = null;
          await this.claimSaves();
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
          try {
            await this.opts.saves.save(msg.slot, this.state);
          } catch (err) {
            // Our own errors (bad slot, version) pass through; storage errors get player text.
            // An explicit save always reports, even while autosave failures are muted.
            throw err instanceof Error && (err.name === 'Error' || err.name === 'SaveVersionError') ? err : new Error(describeStorageError(err));
          }
          await this.postSaves();
          return;
        }
        case 'load': {
          const { state, skipped } = await this.opts.saves.loadDetailed(msg.slot);
          if (skipped.length > 0) {
            this.post({ type: 'error', message: `The newest autosave could not be read (${describeSkipped(skipped)}), so an older one was loaded.` });
          }
          this.state = state;
          // Don't immediately autosave over the ring with the turn we just loaded.
          this.lastTurnStart = this.turnStartKey(state);
          await this.claimSaves();
          await this.advance([]);
          return;
        }
        case 'deleteSave':
          await this.opts.saves.delete(msg.slot);
          await this.postSaves();
          return;
        case 'listSaves':
          // So a list asked for right after a move (quit to title) already shows that move.
          await this.flush();
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

  /**
   * Runs rivals until a human must act, posts one state with every event, then saves: a
   * turn-start autosave (awaited) at a new human turn, else the rolling resume save (not awaited).
   */
  private async advance(events: SimEvent[]): Promise<void> {
    this.runAi(events);
    this.postState(events);
    const s = this.state;
    if (!s) return;
    const key = this.turnStartKey(s);
    if (key && key !== this.lastTurnStart) {
      this.lastTurnStart = key;
      if (!this.ownsSaves) {
        this.post({ type: 'error', message: NOT_SAVING_MESSAGE });
        return;
      }
      // The ring write must land after (and so rank newer than) any older resume write.
      this.resumePending = null;
      await this.flush();
      this.warnIfLarge(s);
      if (await this.ownedWrite(() => this.opts.saves.autosave(s))) {
        try {
          await this.postSaves();
        } catch (err) {
          this.reportSaveFailure(err);
        }
      }
      return;
    }
    this.scheduleResume(s);
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
