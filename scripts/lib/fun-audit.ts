/**
 * Instrumented game runner for scripts/fun-audit.ts. Plays one seeded game (p1 = human seat,
 * driven by the AI) and records the player-experience metrics of the design checklist.
 * Tooling only: reads hidden state freely, never feeds anything back into the sim.
 */
import type { Age, ContentBundle } from '../../src/contracts/content-schemas';
import type { GameSetup, GameState, PlayerId, Sim, SimEvent, SimQueries } from '../../src/contracts/sim-api';
import { tileAt } from '../../src/sim/lookup';
import type { RunAiTurn } from './autoplay';

const HUMAN: PlayerId = 'p1';

export interface AuditReport {
  seed: number;
  status: string;
  turns: number;
  turnsPerAge: Partial<Record<Age, number>>;
  winner: string | null;
  // A
  decisionTurns: number[];
  decisionKinds: Record<string, number>;
  /** Longest run of turns without a real decision in turns 1–40. */
  maxGapEarly: number;
  /** Turns with no real decision / turns played (human). */
  noDecisionShare: number;
  /** Real decisions per turn in turns 80–110. */
  lateDecisionsPerTurn: number | null;
  /** City-turns where the city had no building or wonder to build (human). */
  idleBuildCityTurns: number;
  cityTurns: number;
  // B
  capitalTurn: number | null;
  firstBuildTurn: number | null;
  firstTechTurn: number | null;
  secondSettlementTurn: number | null;
  firstOfferTurn: number | null;
  offerTurns: number[];
  // C
  transition: null | {
    figures: number;
    top: number;
    second: number;
    topCulture: string | null;
    hybridAvailable: boolean;
    hybridByWeight: boolean;
  };
  // D
  offers: number;
  offersSameCulture: number;
  offersSameKindAsLast: number;
  unusableCandidates: number;
  candidates: number;
  distinctReasons: number;
  reasons: string[];
  // E
  rivalTopCulturesT30: (string | null)[];
  notices: string[];
  // F/H
  finalScores: Record<string, number>;
  spread: number | null;
  leadChanges: number;
  leaderAt60: string | null;
  // extras
  deeds: { deed: string; player: string; turn: number; age: Age; turnInAge: number }[];
  hintsWithoutFigures: number;
  ageOpeningOffers: { player: string; culture: string; reason: string }[];
  startClimate: Record<string, string>;
  polarShareT25: Record<string, number>;
  rank: Record<string, number>;
  navalBuilt: Record<string, number>;
  overseasSettlements: Record<string, number>;
  capturesPvp: number;
  capturesCs: number;
  eliminations: { player: string; age: Age }[];
  wars: number;
  /** Human total population at crisis start and at age end, per age with a crisis. */
  crisisPop: { age: Age; start: number; end: number; gold: number; goldEnd: number; lost: number; lostEnd: number }[];
  wonders: number;
  humanWonders: number;
  /** Rival postures (from src/sim/voice) and notice counts by kind of speaker. */
  voiceNotices: number;
  /** Per player: start climate, rank, figures, wonders, capital food/production at turn 30. */
  perPlayer: Record<string, { climate: string; rank: number; figures: number; wonders: number; capFood30: number; capProd30: number; settlements30: number }>;
  /** Wonders completed: who, turn, age; and races (2+ players building the same wonder at once). */
  wonderLog: { wonder: string; player: string; turn: number; age: Age }[];
  wonderRaces: number;
  /** (player, wonder) pairs ever in production, with the turn first seen. */
  wonderStarts: { player: string; wonder: string; turn: number }[];
  /** Crisis cost per player and age: units lost, population and gold change, pillages, choices. */
  crisisCost: { age: Age; player: string; units: number; pop: number; gold: number; pillaged: number; choices: string[]; settlementsLost: number }[];
  /** Culture hints: player, culture, turn, and the culture's affinity rank for that player then (1 = top). */
  hints: { player: string; culture: string; turn: number; rank: number }[];
  /** Human commands per turn by type (commands the sim accepted). */
  humanCommands: Record<number, Record<string, number>>;
}

const ageStart: Record<string, number> = {};

export const auditGame = (
  seed: number,
  setup: GameSetup,
  maxTurns: number,
  sim: Sim,
  runAiTurn: RunAiTurn,
  queries: SimQueries,
  content: ContentBundle,
): AuditReport => {
  const created = sim.createGame(setup, content);
  let state: GameState = created.state;
  const figDef = new Map(content.figures.map((f) => [f.id, f]));
  const unitDef = new Map(content.units.map((u) => [u.id, u]));
  const turnsPerAge: Partial<Record<Age, number>> = {};
  const decisionTurns = new Set<number>();
  const decisionKinds: Record<string, number> = {};
  const decisionsByTurn: Record<number, number> = {};
  const mark = (turn: number, kind: string): void => {
    decisionTurns.add(turn);
    decisionKinds[kind] = (decisionKinds[kind] ?? 0) + 1;
    decisionsByTurn[turn] = (decisionsByTurn[turn] ?? 0) + 1;
  };
  const r: AuditReport = {
    seed, status: 'ended', turns: 0, turnsPerAge, winner: null,
    decisionTurns: [], decisionKinds, maxGapEarly: 0, noDecisionShare: 0, lateDecisionsPerTurn: null,
    idleBuildCityTurns: 0, cityTurns: 0,
    capitalTurn: null, firstBuildTurn: null, firstTechTurn: null, secondSettlementTurn: null, firstOfferTurn: null, offerTurns: [],
    transition: null,
    offers: 0, offersSameCulture: 0, offersSameKindAsLast: 0, unusableCandidates: 0, candidates: 0, distinctReasons: 0, reasons: [],
    rivalTopCulturesT30: [], notices: [],
    finalScores: {}, spread: null, leadChanges: 0, leaderAt60: null,
    deeds: [], hintsWithoutFigures: 0, ageOpeningOffers: [], startClimate: {}, polarShareT25: {}, rank: {},
    navalBuilt: {}, overseasSettlements: {}, capturesPvp: 0, capturesCs: 0, eliminations: [], wars: 0,
    crisisPop: [], wonders: 0, humanWonders: 0, voiceNotices: 0,
    perPlayer: {}, wonderLog: [], wonderRaces: 0, wonderStarts: [], crisisCost: [], hints: [], humanCommands: {},
  };
  const racedWonders = new Set<string>();
  const crisisStart: Record<string, { units: number; pop: number; gold: number; settlements: number }> = {};
  const crisisPillage: Record<string, number> = {};
  const latestChoices: Record<string, string[]> = {};
  const latestChoicesAtEnd: Record<string, string[]> = {};
  const playerPop = (id: string): number => Object.values(state.settlements).filter((s) => s.owner === id).reduce((a, s) => a + s.population, 0);
  const playerSettlementCount = (id: string): number => Object.values(state.settlements).filter((s) => s.owner === id).length;
  // Record the human seat's accepted commands (tooling only; the sim never sees this wrapper).
  const recSim: Sim = {
    createGame: (st, ct) => sim.createGame(st, ct),
    applyCommand: (st, pl, cmd, ct) => {
      const res = sim.applyCommand(st, pl, cmd, ct);
      if (res.ok && pl === HUMAN && st.phase === 'playing') {
        const row = (r.humanCommands[st.turn] ??= {});
        row[cmd.type] = (row[cmd.type] ?? 0) + 1;
      }
      return res;
    },
  };
  const humanPop = (): number => Object.values(state.settlements).filter((s) => s.owner === HUMAN).reduce((a, s) => a + s.population, 0);
  ageStart.current = 1;
  let lastOfferSource: string | null = null;
  let settlementsFounded = 0;
  let leader: string | null = null;
  const reasons = new Set<string>();
  const isPlayer = (id: string): boolean => state.playerOrder.includes(id);
  const figuresInAge = (age: Age): Set<string> => new Set(content.figures.filter((f) => f.age === age && !f.deed).map((f) => f.culture));

  const seatAccepts = (kind: string): boolean => {
    const p = state.players[HUMAN];
    if (!p) return false;
    return Object.keys(p.cabinet).some((key) => content.cabinetSlots.find((s) => s.id === key.split('#')[0])?.accepts.includes(kind as never));
  };

  const tally = (events: SimEvent[], duringHumanTurn: boolean): void => {
    for (const e of events) {
      if (e.type === 'turnStarted') {
        turnsPerAge[state.age] = (turnsPerAge[state.age] ?? 0) + 1;
        // Lead changes (H)
        let best: string | null = null;
        let bestS = -Infinity;
        for (const id of state.playerOrder) {
          const p = state.players[id];
          if (p?.alive && p.score > bestS) {
            bestS = p.score;
            best = id;
          }
        }
        if (state.turn > 20 && best !== leader && leader !== null) r.leadChanges++;
        leader = best;
        if (state.turn === 60) r.leaderAt60 = best;
        if (state.turn === 30) {
          for (const id of state.playerOrder) {
            if (id === HUMAN) continue;
            const counts: Record<string, number> = {};
            for (const f of Object.values(state.figures)) if (f.owner === id) counts[figDef.get(f.id)?.culture ?? '?'] = (counts[figDef.get(f.id)?.culture ?? '?'] ?? 0) + 1;
            const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
            r.rivalTopCulturesT30.push(top ? top[0] : null);
          }
        }
        if (state.crisis) for (const id of state.playerOrder) {
          const ch = state.players[id]?.crisisChoices ?? [];
          if (ch.length > 0) latestChoices[id] = [...ch];
        }
        // Wonder races: two or more players building the same wonder at this turn start.
        const builders: Record<string, Set<string>> = {};
        for (const st of Object.values(state.settlements)) {
          const item = st.production.item;
          if (item && content.wonders.some((w) => w.id === item)) {
            (builders[item] ??= new Set()).add(st.owner);
            if (!r.wonderStarts.some((x) => x.player === st.owner && x.wonder === item)) r.wonderStarts.push({ player: st.owner, wonder: item, turn: state.turn });
          }
        }
        for (const [w, set] of Object.entries(builders)) if (set.size >= 2 && !racedWonders.has(w)) {
          racedWonders.add(w);
          r.wonderRaces++;
        }
        if (state.turn === 30) {
          for (const id of state.playerOrder) {
            const cap = Object.values(state.settlements).find((x) => x.owner === id && x.isCapital);
            const y = cap ? queries.settlementYields(state, cap.id, content) : null;
            const pp = (r.perPlayer[id] ??= { climate: '?', rank: 0, figures: 0, wonders: 0, capFood30: 0, capProd30: 0, settlements30: 0 });
            pp.capFood30 = y?.food ?? 0;
            pp.capProd30 = y?.production ?? 0;
            pp.settlements30 = playerSettlementCount(id);
          }
        }
        if (state.turn === 25) {
          for (const id of state.playerOrder) {
            const owned = state.map.tiles.filter((t) => t.owner === id);
            r.polarShareT25[id] = owned.length ? owned.filter((t) => t.climate === 'polar').length / owned.length : 0;
          }
        }
      }
      if (e.type === 'ageStarted') ageStart.current = state.turn;
      if (e.type === 'settlementFounded') {
        const s = state.settlements[e.settlement];
        if (e.player === HUMAN) {
          settlementsFounded++;
          if (settlementsFounded === 1) r.capitalTurn = state.turn;
          if (settlementsFounded === 2) r.secondSettlementTurn = state.turn;
          if (duringHumanTurn && settlementsFounded > 1) mark(state.turn, 'settle');
        }
        if (s && !s.isCapital) {
          const cap = Object.values(state.settlements).find((x) => x.owner === e.player && x.isCapital);
          const ct = cap ? tileAt(state.map, cap.at) : undefined;
          const st = tileAt(state.map, s.at);
          if (ct && st && ct.continent !== st.continent) r.overseasSettlements[e.player] = (r.overseasSettlements[e.player] ?? 0) + 1;
        }
        if (s?.isCapital) {
          const t = tileAt(state.map, s.at);
          r.startClimate[e.player] = t?.climate ?? '?';
        }
      }
      if (e.type === 'productionCompleted') {
        if (e.player === HUMAN && r.firstBuildTurn === null) r.firstBuildTurn = state.turn;
        if (unitDef.get(e.item)?.unitClass === 'naval') r.navalBuilt[e.player] = (r.navalBuilt[e.player] ?? 0) + 1;
        if (duringHumanTurn && e.player === HUMAN) mark(state.turn, 'buy');
      }
      if (e.type === 'researchCompleted' && e.player === HUMAN && r.firstTechTurn === null) r.firstTechTurn = state.turn;
      if (e.type === 'offerCreated') {
        const o = state.offers.find((x) => x.id === e.offer);
        if (o && o.candidates[0] && (o.reasons[o.candidates[0]] ?? '').startsWith('come at last')) {
          const c = figDef.get(o.candidates[0])?.culture ?? '?';
          r.ageOpeningOffers.push({ player: e.player, culture: c, reason: o.reasons[o.candidates[0]] ?? '' });
        }
        if (e.player === HUMAN && o) {
          if (r.firstOfferTurn === null) r.firstOfferTurn = state.turn;
          r.offerTurns.push(state.turn);
          r.offers++;
          const cultures = new Set(o.candidates.map((c) => figDef.get(c)?.culture));
          if (o.candidates.length > 1 && cultures.size === 1) r.offersSameCulture++;
          if (o.source !== 'deed' && o.source === lastOfferSource) r.offersSameKindAsLast++;
          if (o.source !== 'deed') lastOfferSource = o.source;
          for (const c of o.candidates) {
            const d = figDef.get(c);
            r.candidates++;
            if (d && d.uses.length === 1 && d.uses[0] === 'cabinet' && !seatAccepts(d.kind)) r.unusableCandidates++;
            const reason = o.reasons[c];
            if (reason) reasons.add(reason);
          }
        }
      }
      if (e.type === 'deedCompleted') r.deeds.push({ deed: e.deed, player: e.player, turn: state.turn, age: state.age, turnInAge: state.turn - (ageStart.current ?? 1) });
      if (e.type === 'cultureHint') {
        if (!figuresInAge(state.age).has(e.culture)) r.hintsWithoutFigures++;
        const aff = state.players[e.player]?.affinity ?? {};
        const mine = aff[e.culture] ?? 0;
        const rank = 1 + Object.values(aff).filter((v) => v > mine).length;
        r.hints.push({ player: e.player, culture: e.culture, turn: state.turn, rank });
      }
      if (e.type === 'notice' && e.player !== null && /pillag/i.test(e.text)) crisisPillage[e.player] = (crisisPillage[e.player] ?? 0) + 1;
      if (e.type === 'notice' && (e.player === HUMAN || e.player === null)) {
        r.notices.push(`t${state.turn}: ${e.text}`);
        if (e.text.includes(': “')) r.voiceNotices++;
      }
      if (e.type === 'crisisStarted') {
        for (const id of state.playerOrder) {
          const p = state.players[id];
          if (!p?.alive) continue;
          crisisStart[id] = { units: p.stats.unitsLost, pop: playerPop(id), gold: p.stock.gold, settlements: playerSettlementCount(id) };
          crisisPillage[id] = 0;
          delete latestChoices[id];
        }
      }
      if (e.type === 'ageEnded') {
        for (const id of Object.keys(crisisStart)) {
          const latest = latestChoices[id];
          latestChoicesAtEnd[id] = latest ?? [];
          const p = state.players[id];
          const c0 = crisisStart[id];
          if (!p || !c0) continue;
          r.crisisCost.push({ age: e.age, player: id, units: p.stats.unitsLost - c0.units, pop: playerPop(id) - c0.pop, gold: Math.round(p.stock.gold - c0.gold), pillaged: crisisPillage[id] ?? 0, choices: [...(latestChoicesAtEnd[id] ?? p.crisisChoices)], settlementsLost: Math.max(0, c0.settlements - playerSettlementCount(id)) });
          delete crisisStart[id];
        }
      }
      if (e.type === 'crisisStarted') r.crisisPop.push({ age: state.age, start: humanPop(), end: 0, gold: state.players[HUMAN]?.stock.gold ?? 0, goldEnd: 0, lost: state.players[HUMAN]?.stats.unitsLost ?? 0, lostEnd: 0 });
      if (e.type === 'ageEnded') {
        const c = r.crisisPop[r.crisisPop.length - 1];
        if (c && c.age === e.age) {
          c.end = humanPop();
          c.goldEnd = state.players[HUMAN]?.stock.gold ?? 0;
          c.lostEnd = state.players[HUMAN]?.stats.unitsLost ?? 0;
        }
      }
      if (e.type === 'wonderBuilt') {
        r.wonderLog.push({ wonder: e.wonder, player: e.player, turn: state.turn, age: state.age });
        r.wonders++;
        if (e.player === HUMAN) r.humanWonders++;
      }
      if (e.type === 'transitionStarted' && r.transition === null) {
        const counts: Record<string, number> = {};
        let n = 0;
        for (const f of Object.values(state.figures)) {
          if (f.owner !== HUMAN) continue;
          n++;
          const c = figDef.get(f.id)?.culture ?? '?';
          counts[c] = (counts[c] ?? 0) + 1;
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const opts = queries.refinementOptions(state, HUMAN, content).filter((x) => x.kind === 'hybrid');
        r.transition = {
          figures: n,
          top: sorted[0]?.[1] ?? 0,
          second: sorted[1]?.[1] ?? 0,
          topCulture: sorted[0]?.[0] ?? null,
          hybridAvailable: opts.some((x) => x.available),
          hybridByWeight: opts.some((x) => x.available || !(x.blocked ?? '').startsWith('Needs weight')),
        };
      }
      if (e.type === 'settlementCaptured') {
        if (isPlayer(e.from)) r.capturesPvp++;
        else r.capturesCs++;
      }
      if (e.type === 'playerEliminated') r.eliminations.push({ player: e.player, age: state.age });
      if (e.type === 'warDeclared' && isPlayer(e.on)) {
        r.wars++;
        if (duringHumanTurn && e.by === HUMAN) mark(state.turn, 'war');
      }
      if (duringHumanTurn && e.type === 'peaceMade') mark(state.turn, 'peace');
      if (duringHumanTurn && e.type === 'envoySent' && e.player === HUMAN) mark(state.turn, 'envoy');
    }
  };
  tally(created.events, false);

  const humanTurnStart = (): void => {
    const p = state.players[HUMAN];
    if (!p) return;
    const t = state.turn;
    if (state.offers.some((o) => o.player === HUMAN)) mark(t, 'offer');
    if (state.crisis?.awaiting.includes(HUMAN)) mark(t, 'crisis');
    const cities = Object.values(state.settlements).filter((s) => s.owner === HUMAN && s.kind === 'city');
    if (cities.some((s) => s.production.item === null)) mark(t, 'production');
    for (const tree of ['tech', 'civic'] as const) {
      if (p.research[tree].current === null && queries.researchOptions(state, HUMAN, tree, content).length > 0) mark(t, 'research');
    }
    for (const s of cities) {
      r.cityTurns++;
      const opts = queries.productionOptions(state, s.id, content);
      if (!opts.some((o) => o.kind !== 'unit')) r.idleBuildCityTurns++;
    }
  };
  const figureSnapshot = (): string =>
    JSON.stringify(Object.values(state.figures).filter((f) => f.owner === HUMAN).map((f) => [f.id, f.location.state]));
  const townSnapshot = (): string =>
    JSON.stringify(Object.values(state.settlements).filter((s) => s.owner === HUMAN).map((s) => s.kind));

  try {
    for (;;) {
      if (state.phase === 'ended') break;
      if (state.turn > maxTurns) {
        r.status = 'turnCap';
        break;
      }
      if (state.phase === 'playing') {
        const player = state.currentPlayer;
        const before = `${state.turn}|${state.currentPlayer}|${state.phase}`;
        const human = player === HUMAN;
        let figs = '';
        let towns = '';
        const turn = state.turn;
        if (human) {
          humanTurnStart();
          figs = figureSnapshot();
          towns = townSnapshot();
        }
        // Crisis responses: the human seat alternates options by seed and stage, so the audit can
        // compare the outcomes of both options of each stage (the AI would always pick its favourite).
        if (human && state.crisis?.awaiting.includes(HUMAN)) {
          const def = content.crises.find((c) => c.id === state.crisis?.id);
          const opts = def?.stages[state.crisis.stage - 1]?.options ?? [];
          // Stage k takes option bit k of the seed, so each stage's choice is independent of the others.
          const o = opts[(seed >> (state.crisis.stage - 1)) & 1];
          if (o) {
            const f = recSim.applyCommand(state, HUMAN, { type: 'chooseCrisisResponse', option: o.id }, content);
            if (f.ok) {
              state = f.state;
              tally(f.events, true);
            }
          }
        }
        const res = runAiTurn(state, player, content, recSim);
        // State during the human turn: evaluate per-event with the state after the turn.
        if (human) {
          const mid = res.state;
          const prev = state;
          state = mid;
          if (figureSnapshot() !== figs) mark(turn, 'figure');
          if (townSnapshot() !== towns) mark(turn, 'upgrade');
          state = prev;
        }
        // Split events: those before the turn advanced count as the human's own actions.
        const idx = res.events.findIndex((e) => e.type === 'turnStarted' || e.type === 'transitionStarted');
        const own = idx < 0 ? res.events : res.events.slice(0, idx);
        const rest = idx < 0 ? [] : res.events.slice(idx);
        state = res.state;
        tally(own, human);
        tally(rest, false);
        if (`${state.turn}|${state.currentPlayer}|${state.phase}` === before) {
          const f = sim.applyCommand(state, player, { type: 'endTurn' }, content);
          if (!f.ok) {
            r.status = `stuck: ${f.error}`;
            break;
          }
          state = f.state;
          tally(f.events, false);
        }
      } else {
        const pending = state.playerOrder.filter((id) => state.players[id]?.alive && state.transition?.recap[id] && !state.transition.recap[id].done);
        if (pending.length === 0) {
          r.status = 'stuck';
          break;
        }
        for (const id of pending) {
          if (state.phase !== 'transition') break;
          const res = runAiTurn(state, id, content, sim);
          state = res.state;
          tally(res.events, false);
          if (state.phase === 'transition' && !state.transition?.recap[id]?.done) {
            const f = sim.applyCommand(state, id, { type: 'finishTransition' }, content);
            if (f.ok) {
              state = f.state;
              tally(f.events, false);
            }
          }
        }
      }
    }
  } catch (err) {
    r.status = `error: ${err instanceof Error ? err.message : String(err)}`;
  }

  r.turns = state.turn;
  r.winner = state.result?.winner ?? null;
  const humanTurns = Math.min(state.turn, maxTurns);
  const dt = [...decisionTurns].sort((a, b) => a - b);
  r.decisionTurns = dt;
  let gap = 0;
  let maxGap = 0;
  for (let t = 1; t <= Math.min(40, humanTurns); t++) {
    if (decisionTurns.has(t)) gap = 0;
    else gap++;
    maxGap = Math.max(maxGap, gap);
  }
  r.maxGapEarly = maxGap;
  r.noDecisionShare = humanTurns ? (humanTurns - dt.length) / humanTurns : 0;
  if (state.turn >= 100) {
    let n = 0;
    let turns = 0;
    for (let t = 80; t <= Math.min(110, state.turn); t++) {
      turns++;
      n += decisionsByTurn[t] ?? 0;
    }
    r.lateDecisionsPerTurn = turns ? n / turns : null;
  }
  r.reasons = [...reasons];
  r.distinctReasons = reasons.size;
  for (const id of state.playerOrder) r.finalScores[id] = state.result?.scores[id] ?? state.players[id]?.score ?? 0;
  const living = state.playerOrder.filter((id) => state.players[id]?.alive).map((id) => r.finalScores[id] ?? 0);
  const max = Math.max(...living);
  r.spread = max > 0 ? Math.min(...living) / max : null;
  const order = [...state.playerOrder].sort((a, b) => (r.finalScores[b] ?? 0) - (r.finalScores[a] ?? 0));
  order.forEach((id, i) => (r.rank[id] = i + 1));
  for (const id of state.playerOrder) {
    const pp = (r.perPlayer[id] ??= { climate: '?', rank: 0, figures: 0, wonders: 0, capFood30: 0, capProd30: 0, settlements30: 0 });
    pp.climate = r.startClimate[id] ?? '?';
    pp.rank = r.rank[id] ?? 0;
    pp.figures = Object.values(state.figures).filter((f) => f.owner === id).length;
    pp.wonders = r.wonderLog.filter((w) => w.player === id).length;
  }
  return r;
};

const avg = (xs: number[]): string => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '-');
const med = (xs: number[]): string => {
  if (!xs.length) return '-';
  const s = [...xs].sort((a, b) => a - b);
  return String(s[Math.floor(s.length / 2)]);
};
const pct = (n: number, d: number): string => (d ? `${Math.round((100 * n) / d)}%` : '-');
const nn = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);

export const summarize = (rs: AuditReport[], content: ContentBundle): string => {
  const L: string[] = [];
  const n = rs.length;
  L.push(`\n=== FUN AUDIT (${n} games) ===`);
  L.push(`G turns: total avg ${avg(rs.map((r) => r.turns))}; per age ancient ${avg(nn(rs.map((r) => r.turnsPerAge.ancient ?? null)))}, classical ${avg(nn(rs.map((r) => r.turnsPerAge.classical ?? null)))}; statuses ${[...new Set(rs.map((r) => r.status))].join(',')}`);
  L.push(`A max gap t1-40: avg ${avg(rs.map((r) => r.maxGapEarly))}, worst ${Math.max(...rs.map((r) => r.maxGapEarly))}; no-decision turn share ${avg(rs.map((r) => r.noDecisionShare * 100))}%; late decisions/turn ${avg(nn(rs.map((r) => r.lateDecisionsPerTurn)))}; idle-build city-turns ${pct(rs.reduce((s, r) => s + r.idleBuildCityTurns, 0), rs.reduce((s, r) => s + r.cityTurns, 0))}`);
  const kinds: Record<string, number> = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.decisionKinds)) kinds[k] = (kinds[k] ?? 0) + v;
  L.push(`  decision kinds: ${Object.entries(kinds).map(([k, v]) => `${k} ${(v / n).toFixed(1)}`).join(', ')}`);
  const gaps: number[] = [];
  for (const r of rs) for (let i = 1; i < r.offerTurns.length; i++) gaps.push((r.offerTurns[i] ?? 0) - (r.offerTurns[i - 1] ?? 0));
  L.push(`  offers: avg ${avg(rs.map((r) => r.offers))} per game, median gap ${med(gaps)}, avg gap ${avg(gaps)}`);
  L.push(`B capital ${avg(nn(rs.map((r) => r.capitalTurn)))}, first build ${avg(nn(rs.map((r) => r.firstBuildTurn)))}, first tech ${avg(nn(rs.map((r) => r.firstTechTurn)))}, 2nd settlement ${avg(nn(rs.map((r) => r.secondSettlementTurn)))} (missing ${rs.filter((r) => r.secondSettlementTurn === null).length}), first offer ${avg(nn(rs.map((r) => r.firstOfferTurn)))}`);
  const tr = rs.map((r) => r.transition).filter((x): x is NonNullable<AuditReport['transition']> => x !== null);
  L.push(`C at first transition: figures ${avg(tr.map((t) => t.figures))}, top ${avg(tr.map((t) => t.top))} (≥4: ${pct(tr.filter((t) => t.top >= 4).length, tr.length)}), second ${avg(tr.map((t) => t.second))} (≥2: ${pct(tr.filter((t) => t.second >= 2).length, tr.length)}), hybrid purchasable ${pct(tr.filter((t) => t.hybridAvailable).length, tr.length)}, hybrid by weight ${pct(tr.filter((t) => t.hybridByWeight).length, tr.length)}; tops ${tr.map((t) => t.topCulture).join(',')}`);
  const offers = rs.reduce((s, r) => s + r.offers, 0);
  L.push(`D offers same-culture ${pct(rs.reduce((s, r) => s + r.offersSameCulture, 0), offers)}, same kind as last ${pct(rs.reduce((s, r) => s + r.offersSameKindAsLast, 0), offers)}, unusable candidates ${pct(rs.reduce((s, r) => s + r.unusableCandidates, 0), rs.reduce((s, r) => s + r.candidates, 0))}, distinct reasons/game ${avg(rs.map((r) => r.distinctReasons))}`);
  L.push(`  sample reasons: ${[...new Set(rs.flatMap((r) => r.reasons))].slice(0, 14).join(' | ')}`);
  const distinctTops = rs.map((r) => new Set(r.rivalTopCulturesT30.filter((x) => x !== null)).size / Math.max(1, r.rivalTopCulturesT30.length));
  L.push(`E rivals with distinct top culture at t30: ${avg(distinctTops.map((x) => x * 100))}%; notices to human per game ${avg(rs.map((r) => r.notices.length))}`);
  L.push(`  sample notices: ${[...new Set(rs.flatMap((r) => r.notices.map((x) => x.replace(/^t\d+: /, ''))))].slice(0, 12).join(' | ')}`);
  const cp = rs.flatMap((r) => r.crisisPop);
  for (const age of ['ancient', 'classical'] as const) {
    const xs = cp.filter((c) => c.age === age);
    L.push(`F crisis (${age}): human pop at crisis start ${avg(xs.map((c) => c.start))} → age end ${avg(xs.map((c) => c.end))}; games with a pop drop ${pct(xs.filter((c) => c.end < c.start).length, xs.length)}; units lost during crisis ${avg(xs.map((c) => c.lostEnd - c.lost))}; pillaged ${rs.reduce((s, r) => s + r.notices.filter((n) => n.includes('pillaged')).length, 0)}`);
  }
  L.push(`  wonders per game ${avg(rs.map((r) => r.wonders))} (human ${avg(rs.map((r) => r.humanWonders))}); rival voice notices per game ${avg(rs.map((r) => r.voiceNotices))}`);
  const spreads = nn(rs.map((r) => r.spread));
  L.push(`F spread last/first: avg ${avg(spreads.map((x) => x * 100))}%, games ≥60%: ${pct(spreads.filter((x) => x >= 0.6).length, spreads.length)}`);
  L.push(`H lead changes after t20: avg ${avg(rs.map((r) => r.leadChanges))}; leader at t60 = winner: ${pct(rs.filter((r) => r.leaderAt60 !== null && r.leaderAt60 === r.winner).length, rs.length)}; human won ${pct(rs.filter((r) => r.winner === 'p1').length, n)}`);
  const deeds = rs.flatMap((r) => r.deeds);
  L.push(`deeds: ${deeds.length} total; ${deeds.map((d) => `${d.deed}@${d.age}+${d.turnInAge}`).join(', ')}`);
  L.push(`1 hints for cultures without current-age figures: ${rs.reduce((s, r) => s + r.hintsWithoutFigures, 0)}; age-opening offers: ${rs.flatMap((r) => r.ageOpeningOffers).map((o) => `${o.player}:${o.culture}`).join(', ') || '-'}`);
  const polarRanks: number[] = [];
  let polarLast = 0;
  for (const r of rs) {
    const players = Object.keys(r.rank).length;
    for (const [id, share] of Object.entries(r.polarShareT25)) {
      const rank = r.rank[id];
      if (rank === undefined || share < 0.3) continue;
      polarRanks.push(rank);
      if (rank === players) polarLast++;
    }
  }
  L.push(`4 polar-heavy civs (≥30% polar tiles at t25): ${polarRanks.length}, avg rank ${avg(polarRanks)}, last ${pct(polarLast, polarRanks.length)}; start climates ${JSON.stringify(rs.flatMap((r) => Object.values(r.startClimate)).reduce<Record<string, number>>((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {}))}`);
  const naval = rs.map((r) => Object.entries(r.navalBuilt).filter(([id]) => id !== 'p1').reduce((s, [, v]) => s + v, 0));
  L.push(`3 AI naval units built per game ${avg(naval)}; overseas settlements per game ${avg(rs.map((r) => Object.values(r.overseasSettlements).reduce((a, b) => a + b, 0)))}; captures pvp ${avg(rs.map((r) => r.capturesPvp))} cs ${avg(rs.map((r) => r.capturesCs))}; wars ${avg(rs.map((r) => r.wars))}; eliminations ${rs.flatMap((r) => r.eliminations).map((e) => e.age).join(',') || '-'}`);
  // --- Second fun-and-fairness pass metrics -----------------------------------------------
  const byClimate: Record<string, { ranks: number[]; figs: number[]; food: number[]; prod: number[]; towns: number[] }> = {};
  for (const r of rs) for (const pp of Object.values(r.perPlayer ?? {})) {
    const c = (byClimate[pp.climate] ??= { ranks: [], figs: [], food: [], prod: [], towns: [] });
    c.ranks.push(pp.rank);
    c.figs.push(pp.figures);
    c.food.push(pp.capFood30);
    c.prod.push(pp.capProd30);
    c.towns.push(pp.settlements30);
  }
  const avg2 = (xs: number[]): string => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : '-');
  L.push(`1 start climate → avg rank / figures / capital food,prod at t30 / settlements at t30: ${Object.entries(byClimate).sort().map(([c, v]) => `${c}(${v.ranks.length}) rank ${avg2(v.ranks)}, figs ${avg(v.figs)}, cap ${avg(v.food)}f ${avg(v.prod)}p, towns ${avg(v.towns)}`).join(' | ')}`);
  const seats: Record<string, number[]> = {};
  for (const r of rs) for (const [id, k] of Object.entries(r.rank)) (seats[id] ??= []).push(k);
  L.push(`5 seat avg rank: ${Object.entries(seats).sort().map(([id, xs]) => `${id} ${avg2(xs)} (wins ${xs.filter((x) => x === 1).length})`).join(', ')}`);
  const wl = rs.flatMap((r) => r.wonderLog ?? []);
  const perAgePlayer: Record<string, number> = {};
  for (const r of rs) for (const w of r.wonderLog ?? []) perAgePlayer[`${r.seed}|${w.age}|${w.player}`] = (perAgePlayer[`${r.seed}|${w.age}|${w.player}`] ?? 0) + 1;
  const maxPer = Object.values(perAgePlayer);
  L.push(`2 wonders/game ${avg(rs.map((r) => r.wonders))} (ancient ${(wl.filter((w) => w.age === 'ancient').length / n).toFixed(1)}, classical ${(wl.filter((w) => w.age === 'classical').length / n).toFixed(1)}); games with 6–10: ${pct(rs.filter((r) => r.wonders >= 6 && r.wonders <= 10).length, n)}; best player-age ${maxPer.length ? Math.max(...maxPer) : 0}, player-ages with ≥2: ${maxPer.filter((x) => x >= 2).length}; races/game ${avg(rs.map((r) => r.wonderRaces ?? 0))}; wonder starts/game ${avg(rs.map((r) => (r.wonderStarts ?? []).length))}`);
  const cc = rs.flatMap((r) => r.crisisCost ?? []);
  for (const age of ['ancient', 'classical'] as const) {
    const xs = cc.filter((c) => c.age === age);
    const q = (f: (c: (typeof xs)[number]) => number): string => {
      const v = xs.map(f).sort((a, b) => a - b);
      return v.length ? `${v[0]}/${v[Math.floor(v.length / 2)]}/${v[v.length - 1]} avg ${avg(v)}` : '-';
    };
    L.push(`3 crisis ${age} per player (min/median/max): units lost ${q((c) => c.units)}; pop Δ ${q((c) => c.pop)}; gold Δ ${q((c) => c.gold)}; pillages ${q((c) => c.pillaged)}; settlements lost ${q((c) => c.settlementsLost)}; human pillaged ${q((c) => (c.player === 'p1' ? c.pillaged : 0))}`);
    const byChoice: Record<string, { n: number; units: number; pop: number; gold: number; pillaged: number }> = {};
    for (const c of xs.filter((x) => x.player === 'p1')) for (const ch of c.choices) {
      const b = (byChoice[ch] ??= { n: 0, units: 0, pop: 0, gold: 0, pillaged: 0 });
      b.n++;
      b.units += c.units;
      b.pop += c.pop;
      b.gold += c.gold;
      b.pillaged += c.pillaged;
    }
    L.push(`  ${age} human-seat outcomes by response (alternated by seed): ${Object.entries(byChoice).sort().map(([k, b]) => `${k} ×${b.n} units ${(b.units / b.n).toFixed(1)} pop ${(b.pop / b.n).toFixed(1)} gold ${(b.gold / b.n).toFixed(0)} pillaged ${(b.pillaged / b.n).toFixed(1)}`).join('; ')}`);
  }
  const hs = rs.flatMap((r) => r.hints ?? []);
  const playersN = rs.reduce((s2, r) => s2 + Object.keys(r.rank).length, 0);
  const inuit = hs.filter((h) => h.culture === 'inuit');
  L.push(`4 culture hints per player-game ${(hs.length / Math.max(1, playersN)).toFixed(1)}; outside top-2 ${pct(hs.filter((h) => h.rank > 2).length, hs.length)}, outside top-3 ${pct(hs.filter((h) => h.rank > 3).length, hs.length)}; inuit hints ${inuit.length} (to ${new Set(inuit.map((h) => h.player + h.turn)).size} player-turns), by culture ${JSON.stringify(hs.reduce<Record<string, number>>((m, h) => ((m[h.culture] = (m[h.culture] ?? 0) + 1), m), {}))}`);
  // Late game (turns 80–110): human commands per turn and distinct command types per 10 turns.
  const late: number[] = [];
  const kindsPer10: number[] = [];
  for (const r of rs) {
    const hc = r.humanCommands ?? {};
    for (let w = 80; w < 110; w += 10) {
      const kinds = new Set<string>();
      for (let t = w; t < w + 10; t++) {
        const row = hc[t] ?? {};
        late.push(Object.entries(row).filter(([k]) => k !== 'endTurn').reduce((a, [, v]) => a + v, 0));
        for (const k of Object.keys(row)) if (k !== 'endTurn') kinds.add(k);
      }
      if (r.turns > w) kindsPer10.push(kinds.size);
    }
  }
  const allKinds: Record<string, number> = {};
  for (const r of rs) for (const [t, row] of Object.entries(r.humanCommands ?? {})) if (Number(t) >= 80) for (const [k, v] of Object.entries(row)) allKinds[k] = (allKinds[k] ?? 0) + v;
  L.push(`8 late game t80–110: human commands/turn ${avg(late)}, distinct command types per 10 turns ${avg(kindsPer10)}; mix ${Object.entries(allKinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / n).toFixed(1)}`).join(', ')}`);
  void content;
  return L.join('\n');
};
