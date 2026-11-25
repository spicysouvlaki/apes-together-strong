/**
 * DEV ONLY: scripted real games for the screens demo (screens-demo.html) and the screens tests.
 * Plays a tiny deterministic bot for every player through the real sim, and nudges a few
 * counters between commands (points pools, age meter) so interesting states come quickly.
 * Never imported by the game itself.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { Command, GameSetup, GameState, PlayerId } from '@contracts/sim-api';
import { applyCommand, createGame, queries as q } from '../../sim';

export type DemoStage = 'start' | 'offer' | 'court' | 'crisis' | 'transition' | 'classical' | 'ended';
export const DEMO_STAGES: DemoStage[] = ['start', 'offer', 'court', 'crisis', 'transition', 'classical', 'ended'];

export const HUMAN: PlayerId = 'p1';

export const demoSetup = (content: ContentBundle, seed = 7): GameSetup => {
  const colors = [
    { primary: '#2e6f8e', secondary: '#e9c46a' },
    { primary: '#a8483c', secondary: '#f3ede1' },
    { primary: '#4f7f4e', secondary: '#2f2a24' },
  ];
  return {
    seed,
    mapSize: 'small',
    speed: 'quick',
    players: colors.map((c, i) => ({
      id: `p${i + 1}`,
      isHuman: i === 0,
      leader: content.leaders[(i * 2) % content.leaders.length]?.id ?? '',
      dream: content.dreams[(i * 3 + 1) % content.dreams.length]?.id ?? '',
      colors: c,
      skinTone: i,
    })),
  };
};

interface Runner {
  state: GameState;
  content: ContentBundle;
  errors: string[];
}

const tryCmd = (r: Runner, player: PlayerId, cmd: Command): boolean => {
  const res = applyCommand(r.state, player, cmd, r.content);
  if (!res.ok) {
    r.errors.push(`${player} ${cmd.type}: ${res.error}`);
    return false;
  }
  r.state = res.state;
  return true;
};

interface BotOpts {
  /** Leave the human's offers open (the offer screen needs one). */
  keepHumanOffers: boolean;
  /** Leave the human's crisis response open. */
  keepHumanCrisis: boolean;
}

/** One bot turn: answer decisions, keep research and production busy, seat figures, end turn. */
const botTurn = (r: Runner, pid: PlayerId, o: BotOpts): void => {
  const c = r.content;
  const human = pid === HUMAN;
  for (const u of Object.values(r.state.units)) {
    if (u.owner === pid && q.canFound(r.state, u.id, c)) tryCmd(r, pid, { type: 'foundSettlement', unit: u.id });
  }
  if (!(human && o.keepHumanOffers)) {
    for (const off of r.state.offers.filter((x) => x.player === pid)) {
      tryCmd(r, pid, { type: 'chooseOffer', offer: off.id, figure: off.candidates[0] ?? null });
    }
  }
  const crisis = r.state.crisis;
  if (crisis?.awaiting.includes(pid) && !(human && o.keepHumanCrisis)) {
    const def = c.crises.find((x) => x.id === crisis.id);
    const opt = def?.stages[crisis.stage - 1]?.options[r.state.turn % 2];
    if (opt) tryCmd(r, pid, { type: 'chooseCrisisResponse', option: opt.id });
  }
  const p = r.state.players[pid];
  if (!p) return;
  if (p.government === null) {
    const g = q.governmentOptions(r.state, pid, c)[0];
    if (g) tryCmd(r, pid, { type: 'setGovernment', government: g });
  }
  for (const tree of ['tech', 'civic'] as const) {
    if (r.state.players[pid]?.research[tree].current === null) {
      const opt = q.researchOptions(r.state, pid, tree, c)[0];
      if (opt) tryCmd(r, pid, { type: 'setResearch', tree, id: opt.id });
    }
  }
  for (const s of Object.values(r.state.settlements)) {
    if (s.owner !== pid || s.kind !== 'city' || s.production.item !== null) continue;
    const opts = q.productionOptions(r.state, s.id, c);
    const pick = opts.find((x) => x.kind === 'wonder') ?? opts.find((x) => x.kind === 'building') ?? opts[0];
    if (pick) tryCmd(r, pid, { type: 'setProduction', settlement: s.id, item: pick.item });
  }
  // Seat whoever fits a free seat.
  for (const fs of Object.values(r.state.figures)) {
    if (fs.owner !== pid || fs.location.state !== 'based') continue;
    const key = q.figureActions(r.state, fs.id, c).seat[0];
    if (key) tryCmd(r, pid, { type: 'seatFigure', figure: fs.id, slot: key });
  }
  if (r.state.phase === 'playing' && r.state.currentPlayer === pid) tryCmd(r, pid, { type: 'endTurn' });
};

const botTransition = (r: Runner, pid: PlayerId): void => {
  const t = r.state.transition;
  if (!t || t.recap[pid]?.done) return;
  for (let i = 0; i < 4; i++) {
    const opt = q.refinementOptions(r.state, pid, r.content).find((x) => x.available);
    if (!opt) break;
    tryCmd(r, pid, opt.kind === 'tradition' ? { type: 'adoptTradition', tradition: opt.id } : { type: 'adoptHybrid', hybrid: opt.id });
  }
  const name = t.recap[pid]?.nameOptions[0];
  if (name) tryCmd(r, pid, { type: 'nameCiv', name });
  tryCmd(r, pid, { type: 'finishTransition' });
};

/** Play whole rounds until `until` holds (checked before each player's turn) or `maxTurns` pass. */
const play = (r: Runner, maxTurns: number, o: BotOpts, until: (s: GameState) => boolean): void => {
  const stopTurn = r.state.turn + maxTurns;
  for (let guard = 0; guard < 2000; guard++) {
    if (until(r.state) || r.state.phase === 'ended' || r.state.turn >= stopTurn) return;
    if (r.state.phase === 'transition') {
      for (const pid of r.state.playerOrder) botTransition(r, pid);
      continue;
    }
    const before = `${r.state.turn}:${r.state.currentPlayer}`;
    botTurn(r, r.state.currentPlayer, o);
    if (`${r.state.turn}:${r.state.currentPlayer}` === before) return; // stuck (e.g. kept decision)
  }
};

/** Fill a points pool so the next start of turn makes an offer (demo shortcut). */
const primePool = (r: Runner, pid: PlayerId, pool: 'thought' | 'military' | 'statesman' | 'building' | 'faith' | 'exploration'): void => {
  const p = r.state.players[pid];
  if (p) p.gp[pool] = p.gpThreshold[pool];
};

const setMeter = (r: Runner, value: number): void => {
  r.state.ageProgress = value;
};

const RELAXED: BotOpts = { keepHumanOffers: false, keepHumanCrisis: false };

/** Build a real game in the requested stage. Deterministic for a given seed. */
export const buildScenario = (stage: DemoStage, content: ContentBundle, seed = 7): { state: GameState; errors: string[] } => {
  const r: Runner = { state: createGame(demoSetup(content, seed), content).state, content, errors: [] };
  if (stage === 'start') {
    play(r, 3, RELAXED, () => false);
    return { state: r.state, errors: r.errors };
  }
  // A few early turns, then a court of figures recruited through real offers.
  play(r, 4, RELAXED, () => false);
  for (const pool of ['thought', 'military', 'statesman', 'building', 'faith', 'exploration'] as const) {
    for (const pid of r.state.playerOrder) primePool(r, pid, pool);
    play(r, 2, RELAXED, () => false);
  }
  play(r, 3, RELAXED, () => false);
  if (stage === 'court') return { state: r.state, errors: r.errors };

  if (stage === 'offer') {
    for (const pid of r.state.playerOrder) {
      primePool(r, pid, 'thought');
      primePool(r, pid, 'exploration');
    }
    play(r, 3, { keepHumanOffers: true, keepHumanCrisis: false }, (s) => s.offers.some((x) => x.player === HUMAN) && s.currentPlayer === HUMAN);
    return { state: r.state, errors: r.errors };
  }

  setMeter(r, 69.5);
  play(r, 6, { keepHumanOffers: false, keepHumanCrisis: true }, (s) => !!s.crisis?.awaiting.includes(HUMAN) && s.currentPlayer === HUMAN);
  if (stage === 'crisis') return { state: r.state, errors: r.errors };

  // Answer the crisis, then run the meter to the end of the age.
  play(r, 3, RELAXED, () => false);
  setMeter(r, 99.5);
  play(r, 4, RELAXED, (s) => s.phase === 'transition');
  if (stage === 'transition') return { state: r.state, errors: r.errors };

  for (const pid of r.state.playerOrder) botTransition(r, pid);
  play(r, 6, RELAXED, () => false);
  for (const pid of r.state.playerOrder) primePool(r, pid, 'thought');
  play(r, 3, RELAXED, () => false);
  if (stage === 'classical') return { state: r.state, errors: r.errors };

  setMeter(r, 99.5);
  play(r, 4, RELAXED, (s) => s.phase === 'ended');
  return { state: r.state, errors: r.errors };
};

/** Affinity stripped, as the worker posts snapshots (GDD §4 "Hidden affinity"). */
export const stripAffinity = (state: GameState): GameState => {
  const players: GameState['players'] = {};
  for (const [id, p] of Object.entries(state.players)) players[id] = { ...p, affinity: {} };
  return { ...state, players };
};

/** After a human command: let the bots play until it is the human's turn again (or a transition waits on them). */
export const advanceBots = (state: GameState, content: ContentBundle): { state: GameState; errors: string[] } => {
  const r: Runner = { state, content, errors: [] };
  for (let guard = 0; guard < 50; guard++) {
    if (r.state.phase === 'ended') break;
    if (r.state.phase === 'transition') {
      for (const pid of r.state.playerOrder) if (pid !== HUMAN) botTransition(r, pid);
      break;
    }
    if (r.state.currentPlayer === HUMAN) break;
    const before = `${r.state.turn}:${r.state.currentPlayer}`;
    botTurn(r, r.state.currentPlayer, RELAXED);
    if (`${r.state.turn}:${r.state.currentPlayer}` === before) break;
  }
  return { state: r.state, errors: r.errors };
};
