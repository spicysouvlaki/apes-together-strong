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
      }
      if (e.type === 'notice' && (e.player === HUMAN || e.player === null)) {
        r.notices.push(`t${state.turn}: ${e.text}`);
        if (e.text.includes(': “')) r.voiceNotices++;
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
        const res = runAiTurn(state, player, content, sim);
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
  void content;
  return L.join('\n');
};
