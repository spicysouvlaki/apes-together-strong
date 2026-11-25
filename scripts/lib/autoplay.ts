/**
 * Headless AI-only game runner used by scripts/autoplay.ts (and its test). Node-only timing via
 * performance.now(); the sim itself never sees a clock.
 */
import { performance } from 'node:perf_hooks';
import type { Age, ContentBundle } from '../../src/contracts/content-schemas';
import type { Command, GameSetup, GameSpeed, GameState, MapSize, PlayerId, Sim, SimEvent } from '../../src/contracts/sim-api';

export type RunAiTurn = (state: GameState, player: PlayerId, content: ContentBundle, sim: Sim) => { state: GameState; events: SimEvent[] };

export interface Options {
  games: number;
  seed: number;
  turns: number;
  size: MapSize;
  speed: GameSpeed;
  players: number;
  maxSeconds: number;
  json: string | null;
  verify: boolean;
}

export const AI_TURN_BUDGET_MS = 3000;
export const COLORS = ['#c0392b', '#2e86c1', '#28b463', '#d4ac0d', '#8e44ad', '#ca6f1e', '#17a589', '#7f8c8d'];

export interface PlayerReport {
  leader: string;
  dream: string;
  civName: string | null;
  alive: boolean;
  settlements: number;
  score: number;
  figuresByCulture: Record<string, number>;
  traditions: string[];
  hybrids: string[];
}

export interface GameReport {
  seed: number;
  status: 'ended' | 'turnCap' | 'timeCap' | 'stuck' | 'error';
  note: string | null;
  turns: number;
  finalAge: Age;
  turnsPerAge: Partial<Record<Age, number>>;
  offersPerAge: Partial<Record<Age, number>>;
  players: Record<PlayerId, PlayerReport>;
  result: GameState['result'];
  aiTurns: number;
  avgAiMs: number;
  worstAiMs: number;
  slowTurns: number;
  wallSeconds: number;
  /** Final state JSON, only kept for --verify. */
  finalJson?: string;
}

export class NotImplemented extends Error {}

export const isNotImplemented = (err: unknown): boolean => err instanceof Error && /not implemented|TODO\(/i.test(err.message);

export const setupFor = (seed: number, o: Options, content: ContentBundle): GameSetup => {
  const leaders = content.leaders.map((l) => l.id);
  const dreams = content.dreams.map((d) => d.id);
  if (leaders.length === 0 || dreams.length === 0) throw new Error('content has no leaders or dreams');
  return {
    seed,
    mapSize: o.size,
    speed: o.speed,
    players: Array.from({ length: o.players }, (_, i) => ({
      id: `p${i + 1}`,
      isHuman: false,
      leader: leaders[(seed + i) % leaders.length] ?? leaders[0] ?? '',
      dream: dreams[(seed * 7 + i) % dreams.length] ?? dreams[0] ?? '',
      colors: { primary: COLORS[i] ?? '#888888', secondary: '#f3ede1' },
      skinTone: i % 6,
    })),
  };
};

export const playGame = (seed: number, o: Options, sim: Sim, runAiTurn: RunAiTurn, content: ContentBundle, keepJson: boolean): GameReport => {
  const started = performance.now();
  let created: { state: GameState; events: SimEvent[] };
  try {
    created = sim.createGame(setupFor(seed, o, content), content);
  } catch (err) {
    if (isNotImplemented(err)) throw new NotImplemented(err instanceof Error ? err.message : String(err));
    throw err;
  }
  let state = created.state;
  const turnsPerAge: Partial<Record<Age, number>> = {};
  const offersPerAge: Partial<Record<Age, number>> = {};
  const tally = (events: SimEvent[]): void => {
    for (const e of events) {
      if (e.type === 'turnStarted') turnsPerAge[state.age] = (turnsPerAge[state.age] ?? 0) + 1;
      if (e.type === 'offerCreated') offersPerAge[state.age] = (offersPerAge[state.age] ?? 0) + 1;
    }
  };
  tally(created.events);

  const times: number[] = [];
  let status: GameReport['status'] = 'ended';
  let note: string | null = null;

  const force = (player: PlayerId, command: Command): boolean => {
    const r = sim.applyCommand(state, player, command, content);
    if (!r.ok) {
      if (isNotImplemented(new Error(r.error))) throw new NotImplemented(r.error);
      note = `${player}: ${command.type} rejected (${r.error})`;
      return false;
    }
    state = r.state;
    tally(r.events);
    return true;
  };
  const aiTurn = (player: PlayerId): void => {
    const t0 = performance.now();
    const r = runAiTurn(state, player, content, sim);
    times.push(performance.now() - t0);
    state = r.state;
    tally(r.events);
  };

  try {
    for (;;) {
      if (state.phase === 'ended') break;
      if (state.turn > o.turns) {
        status = 'turnCap';
        break;
      }
      if ((performance.now() - started) / 1000 > o.maxSeconds) {
        status = 'timeCap';
        break;
      }
      if (state.phase === 'playing') {
        const player = state.currentPlayer;
        const before = `${state.turn}|${state.currentPlayer}|${state.phase}`;
        aiTurn(player);
        if (`${state.turn}|${state.currentPlayer}|${state.phase}` === before && !force(player, { type: 'endTurn' })) {
          status = 'stuck';
          break;
        }
      } else {
        const pending = state.playerOrder.filter((id) => state.players[id]?.alive && state.transition?.recap[id] && !state.transition.recap[id].done);
        if (pending.length === 0) {
          status = 'stuck';
          note = 'transition with no pending players';
          break;
        }
        let ok = true;
        for (const id of pending) {
          if (state.phase !== 'transition') break;
          aiTurn(id);
          if (state.phase === 'transition' && !state.transition?.recap[id]?.done && !force(id, { type: 'finishTransition' })) {
            ok = false;
            break;
          }
        }
        if (!ok) {
          status = 'stuck';
          break;
        }
      }
    }
  } catch (err) {
    if (err instanceof NotImplemented) throw err;
    if (isNotImplemented(err)) throw new NotImplemented(err instanceof Error ? err.message : String(err));
    status = 'error';
    note = err instanceof Error ? err.message : String(err);
  }

  const figureCulture = new Map(content.figures.map((f) => [f.id, f.culture]));
  const players: Record<PlayerId, PlayerReport> = {};
  for (const id of state.playerOrder) {
    const p = state.players[id];
    if (!p) continue;
    const figuresByCulture: Record<string, number> = {};
    for (const f of Object.values(state.figures)) {
      if (f.owner !== id) continue;
      const c = figureCulture.get(f.id) ?? '?';
      figuresByCulture[c] = (figuresByCulture[c] ?? 0) + 1;
    }
    players[id] = {
      leader: p.leader,
      dream: p.dream,
      civName: p.civName,
      alive: p.alive,
      settlements: Object.values(state.settlements).filter((s) => s.owner === id).length,
      score: state.result?.scores[id] ?? p.score,
      figuresByCulture,
      traditions: [...p.traditions],
      hybrids: [...p.hybrids],
    };
  }
  const total = times.reduce((a, b) => a + b, 0);
  return {
    seed,
    status,
    note,
    turns: state.turn,
    finalAge: state.age,
    turnsPerAge,
    offersPerAge,
    players,
    result: state.result,
    aiTurns: times.length,
    avgAiMs: times.length ? total / times.length : 0,
    worstAiMs: times.length ? Math.max(...times) : 0,
    slowTurns: times.filter((t) => t > AI_TURN_BUDGET_MS).length,
    wallSeconds: (performance.now() - started) / 1000,
    ...(keepJson ? { finalJson: JSON.stringify(state) } : {}),
  };
};

