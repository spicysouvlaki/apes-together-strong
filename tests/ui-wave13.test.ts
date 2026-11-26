/**
 * Wave 13 (UI): standing during play, one-tap research and the research plan, the confirm policy,
 * keeping the old pick when production changes, moments guarded from stray taps, the offer's
 * "what they would do for you now", a longer aim on quiet turns, rate-not-stock science and
 * culture, Escape on the log, and rival leaders' words as their own slip.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameState, MilestoneProgress, Offer, SimEvent } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { queries as q } from '../src/sim/queries';
import { buildScenario, HUMAN } from '../src/ui/screens/demo-scenario';
import { biggestEdge, nearestGains, ordinal, scoreBreakdown, standingLine, standingOf, standingTag } from '../src/ui/shell/standing';
import { EMPTY_PLAN, nextPlanned, nowLine, parsePlan, PLAN_MAX, planPicks, prunePlan, readStoredPlan, storePlan, togglePlanned } from '../src/ui/shell/research-plan';
import { nodeAction, planWaits } from '../src/ui/shell/tree-actions';
import { ACTION_TRAITS, needsConfirm } from '../src/ui/shell/confirm-policy';
import { MAX_QUEUE, switchLine, switchPlan } from '../src/ui/shell/build-queue';
import { backdropMayDismiss, MOMENT_GUARD_MS, momentShowing } from '../src/ui/shell/moment-guard';
import { cultureLine, offerPitch, passLine, seatLine, type PitchInputs } from '../src/ui/screens/shared/offer-pitch';
import { nameLookup } from '../src/ui/screens/shared/describe';
import { chartedByDirection, pickAim, type AimInputs } from '../src/ui/shell/aims';
import { HUD_YIELDS, isRateYield } from '../src/ui/shell/format';
import { escapeHandler } from '../src/ui/shell/use-escape';
import { speakerPart, voicedNotice } from '../src/ui/shell/first-contact';
import { splitToasts, splitWhileAnswering } from '../src/ui/shell/ticker';
import { rankToasts, type ToastSpec } from '../src/ui/shell/event-toasts';
import { speakerName } from '../src/sim/voice';
import { SCORE_PER_FIGURE, SCORE_PER_HYBRID, SCORE_PER_TRADITION } from '../src/sim/ages/constants';

let content: ContentBundle;
let court: GameState;
beforeAll(() => {
  content = loadContent();
  court = buildScenario('court', content).state;
});

const BAD = /undefined|\[object|NaN|null/;

describe('standing during play', () => {
  const fake = (scores: Record<string, number>, alive: Record<string, boolean> = {}): GameState =>
    ({
      playerOrder: Object.keys(scores),
      players: Object.fromEntries(Object.keys(scores).map((id) => [id, { alive: alive[id] ?? true }])),
    }) as unknown as GameState;

  it('ranks living players and says how far behind the leader is, naming them only when met', () => {
    const g = fake({ p1: 380, p2: 545, p3: 420 });
    const s = standingOf(g, 'p1', (id) => ({ p1: 380, p2: 545, p3: 420 })[id] ?? 0, (id) => id === 'p2');
    expect(s?.rank).toBe(3);
    expect(s?.of).toBe(3);
    expect(s?.behind).toBe(165);
    expect(standingLine(s!, () => "the Navigator's people")).toBe("3rd of 3 · 165 behind the Navigator's people");
    const unmet = standingOf(g, 'p1', (id) => ({ p1: 380, p2: 545, p3: 420 })[id] ?? 0, () => false);
    expect(standingLine(unmet!, () => 'SECRET')).toBe('3rd of 3 · 165 behind a people you have not met');
    expect(standingTag(s!)).toEqual({ place: '3rd of 3', gap: '165 behind' });
  });

  it('says "ahead" when leading, "level" on a tie, and skips the fallen', () => {
    const g = fake({ p1: 100, p2: 60, p3: 900 }, { p3: false });
    const s = standingOf(g, 'p1', (id) => ({ p1: 100, p2: 60, p3: 900 })[id] ?? 0, () => true)!;
    expect(s.rank).toBe(1);
    expect(s.of).toBe(2);
    expect(standingTag(s)).toEqual({ place: '1st of 2', gap: '40 ahead' });
    const tie = standingOf(fake({ p1: 50, p2: 50 }), 'p1', () => 50, () => true)!;
    expect(tie.rank).toBe(1);
    expect(standingLine(tie, () => 'them')).toBe('1st of 2 · level with them');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(23)).toBe('23rd');
  });

  it('breaks the real score down term by term (the parts add up to SimQueries.score)', () => {
    for (const id of court.playerOrder) {
      const parts = scoreBreakdown(court, id, content);
      expect(parts.reduce((a, b) => a + b.points, 0)).toBe(q.score(court, id, content));
    }
    const mine = [{ key: 'figures' as const, label: 'Famous people kept', count: 1, points: SCORE_PER_FIGURE }];
    const theirs = [
      { key: 'figures' as const, label: 'Famous people kept', count: 4, points: 4 * SCORE_PER_FIGURE },
      { key: 'hybrids' as const, label: 'Hybrids', count: 1, points: SCORE_PER_HYBRID },
      { key: 'traditions' as const, label: 'Traditions', count: 1, points: SCORE_PER_TRADITION },
    ];
    expect(biggestEdge(mine, theirs)).toEqual({ label: 'Hybrids', diff: SCORE_PER_HYBRID });
  });

  it('lists the nearest gains, all game long, with their points', () => {
    const rows: MilestoneProgress[] = [
      { id: 'a', track: 'culture', description: 'Wonders built: {n}', value: 1, thresholds: [2, 4, 6], achieved: 0 },
      { id: 'b', track: 'science', description: 'Techs known: 8', value: 3, thresholds: [4, 8, 12], achieved: 1 },
      { id: 'c', track: 'military', description: 'Battles: 3', value: 9, thresholds: [1, 2, 3], achieved: 3 },
    ];
    const g = nearestGains(rows, 1, 5);
    expect(g.map((x) => x.left)).toEqual([1, 1, 5]);
    expect(g.some((x) => /culture milestone/.test(x.text) && x.points > 0)).toBe(true);
    expect(g.some((x) => /Seat the figure/.test(x.text))).toBe(true);
    for (const x of g) expect(x.text).not.toMatch(BAD);
  });
});

describe('research: one tap and a plan', () => {
  it('a card in an idle tree offers Research; a busy tree offers Plan, never on done nodes', () => {
    expect(nodeAction('available', false, -1, 0, 3).kind).toBe('research');
    expect(nodeAction('available', true, -1, 0, 3)).toEqual({ kind: 'plan', plan: 'open', order: 0 });
    expect(nodeAction('locked', false, 1, 2, 3)).toEqual({ kind: 'plan', plan: 'planned', order: 2 });
    expect(nodeAction('locked', false, -1, 3, 3)).toEqual({ kind: 'plan', plan: 'full', order: 0 });
    expect(nodeAction('done', false, -1, 0, 3).kind).toBe('none');
    expect(nodeAction('researching', true, -1, 0, 3).kind).toBe('none');
  });

  it('says what a stuck plan waits for', () => {
    const techs = [
      { id: 'craft', name: 'Craftsmanship', requires: [] },
      { id: 'mil', name: 'Military Tradition', requires: ['craft'] },
    ];
    expect(planWaits(['mil'], ['craft'], [], null, techs)).toBe(' Military Tradition still needs Craftsmanship: plan or study it first.');
    expect(planWaits(['mil'], [], [], 'craft', techs)).toBe('');
    expect(planWaits(['craft', 'mil'], ['craft'], [], null, techs)).toBe('');
  });

  it('plans up to three per tree, toggles off, and prunes what is done or under way', () => {
    let p = EMPTY_PLAN;
    for (const id of ['a', 'b', 'c', 'd']) p = togglePlanned(p, 'tech', id);
    expect(p.tech).toEqual(['a', 'b', 'c']);
    expect(PLAN_MAX).toBe(3);
    p = togglePlanned(p, 'tech', 'b');
    expect(p.tech).toEqual(['a', 'c']);
    p = togglePlanned(p, 'civic', 'x');
    expect(prunePlan(p, ['a'], { tech: 'c', civic: null })).toEqual({ tech: [], civic: ['x'] });
    expect(prunePlan(p, [], { tech: null, civic: null })).toBe(p);
  });

  it('at turn start picks the first planned node the sim offers, per idle tree only', () => {
    const plan = { tech: ['locked_one', 'pottery', 'writing'], civic: ['code'] };
    expect(nextPlanned(plan.tech, [{ id: 'writing' }, { id: 'pottery' }])).toBe('pottery');
    expect(nextPlanned(['locked_one'], [{ id: 'pottery' }])).toBeNull();
    expect(planPicks(plan, { tech: true, civic: false }, { tech: [{ id: 'writing' }], civic: [{ id: 'code' }] })).toEqual([{ tree: 'tech', id: 'writing' }]);
    expect(nowLine('tech', 'Writing')).toBe('Now researching Writing, as planned.');
  });

  it('starts a real planned tech through the sim at turn start', () => {
    const g = court;
    const p = g.players[HUMAN]!;
    const options = q.researchOptions(g, HUMAN, 'tech', content);
    if (options.length === 0) return;
    const idle = { tech: true, civic: false };
    const picks = planPicks({ tech: [options[0]!.id], civic: [] }, idle, { tech: options, civic: [] });
    expect(picks).toEqual([{ tree: 'tech', id: options[0]!.id }]);
    expect(p.techs).not.toContain(options[0]!.id);
  });

  it('keeps the plan per game seed in storage, like standing orders', () => {
    const raw = storePlan(null, 7, { tech: ['a'], civic: ['b'] });
    expect(readStoredPlan(raw, 7)).toEqual({ tech: ['a'], civic: ['b'] });
    expect(readStoredPlan(raw, 8)).toEqual({ tech: [], civic: [] });
    const two = storePlan(raw, 8, { tech: ['z'], civic: [] });
    expect(readStoredPlan(two, 7).tech).toEqual(['a']);
    expect(parsePlan({ tech: ['a', 3, 'b', 'c', 'd'], civic: 'nope' })).toEqual({ tech: ['a', 'b', 'c'], civic: [] });
    let many: unknown = null;
    for (let s = 0; s < 12; s++) many = storePlan(many, s, { tech: [`t${s}`], civic: [] });
    expect(Object.keys((many as { games: object }).games).length).toBe(8);
    expect(readStoredPlan(many, 11).tech).toEqual(['t11']);
  });
});

describe('confirm policy', () => {
  it('asks only for irreversible actions that cost more than their price', () => {
    expect(needsConfirm('adoptTradition')).toBe(false);
    expect(needsConfirm('adoptHybrid')).toBe(false);
    expect(needsConfirm('makePeace')).toBe(false);
    expect(needsConfirm('quitToTitle')).toBe(false);
    expect(needsConfirm('seat')).toBe(false);
    expect(needsConfirm('declareWar')).toBe(true);
    expect(needsConfirm('changeGovernment')).toBe(true);
    expect(needsConfirm('disband')).toBe(true);
    expect(needsConfirm('consume')).toBe(true);
    for (const t of Object.values(ACTION_TRAITS)) expect(t.why.length).toBeGreaterThan(8);
  });
});

describe('changing production keeps the old pick', () => {
  const oneOff = (x: string) => !['warrior', 'settler', 'scout'].includes(x);
  it('puts the old item first in the queue', () => {
    expect(switchPlan('warrior', ['granary'], 'monument', oneOff)).toEqual({ queue: ['warrior', 'granary'], keeps: true });
  });
  it('takes a one-off out of the queue when it is the new pick, which makes room', () => {
    expect(switchPlan('warrior', ['granary', 'walls', 'shrine'], 'walls', oneOff)).toEqual({ queue: ['warrior', 'granary', 'shrine'], keeps: true });
  });
  it('drops the old pick only when the queue is full, and says so', () => {
    const full = ['granary', 'walls', 'shrine'];
    expect(full.length).toBe(MAX_QUEUE);
    expect(switchPlan('warrior', full, 'settler', oneOff)).toEqual({ queue: full, keeps: false });
    expect(switchLine('Granary', 'Warrior', true)).toBe('Granary first, then back to Warrior');
    expect(switchLine('Settler', 'Warrior', false)).toMatch(/queue is full/);
  });
  it('re-picking the same item changes nothing', () => {
    expect(switchPlan('granary', ['walls'], 'granary', oneOff)).toEqual({ queue: ['walls'], keeps: false });
  });
});

describe('moments survive a stray tap', () => {
  it('ignores backdrop taps for the first 600 ms', () => {
    expect(MOMENT_GUARD_MS).toBeGreaterThanOrEqual(600);
    expect(backdropMayDismiss(1000, 1000 + MOMENT_GUARD_MS - 1)).toBe(false);
    expect(backdropMayDismiss(1000, 1000 + MOMENT_GUARD_MS)).toBe(true);
  });
  it('any moment up makes End Turn inert', () => {
    expect(momentShowing({ contacts: 1, reveal: false, recap: false })).toBe(true);
    expect(momentShowing({ contacts: 0, reveal: true, recap: false })).toBe(true);
    expect(momentShowing({ contacts: 0, reveal: false, recap: true })).toBe(true);
    expect(momentShowing({ contacts: 0, reveal: false, recap: false })).toBe(false);
  });
});

describe('the offer sells the choice', () => {
  const l = () => nameLookup(content);
  const inputs = (over: Partial<PitchInputs> = {}): PitchInputs | null => {
    const g = court;
    const def = content.figures.find((f) => f.uses.includes('cabinet') && f.age === g.age && !g.figures[f.id]);
    if (!def) return null;
    const offer: Offer = { id: 'o1', player: HUMAN, source: 'thought', candidates: [def.id], reasons: {}, deed: null, createdTurn: g.turn };
    return { state: g, me: HUMAN, offer, def, seats: q.cabinetSeats(g, HUMAN, content), weights: q.cultureWeights(g, HUMAN, content), content, l: l(), ...over };
  };

  it('three plain lines per candidate: what they do now, culture, and what passing keeps', () => {
    const x = inputs();
    if (!x) return;
    const lines = offerPitch(x);
    expect(lines.map((p) => p.kind)).toEqual([expect.stringMatching(/seat|field|deed/), 'culture', 'pass']);
    for (const p of lines) {
      expect(p.text).not.toMatch(BAD);
      expect(p.text.length).toBeLessThan(170);
    }
  });

  it('a free fitting seat is named; a full cabinet says they would wait', () => {
    const x = inputs();
    if (!x) return;
    const kindSlot = content.cabinetSlots.find((s) => s.accepts.includes(x.def.kind));
    if (!kindSlot) return;
    const free = seatLine({ ...x, seats: [{ key: `${kindSlot.id}#0`, slot: kindSlot.id, figure: null, availableTurn: 0 }] });
    expect(free.text).toMatch(new RegExp(`empty ${kindSlot.name} seat`));
    expect(free.strong).toBe(true);
    const other = content.figures.find((f) => f.id !== x.def.id)!;
    const taken = seatLine({ ...x, seats: [{ key: `${kindSlot.id}#0`, slot: kindSlot.id, figure: other.id, availableTurn: 0 }] });
    expect(taken.text).toMatch(/wait at home/);
    const noGov = seatLine({ ...x, state: { ...x.state, players: { ...x.state.players, [HUMAN]: { ...x.state.players[HUMAN]!, government: null } } } });
    expect(noGov.text).toMatch(/No government yet/);
  });

  it('culture: the first figure of a culture opens its customs; weights move by one', () => {
    const x = inputs();
    if (!x) return;
    const first = cultureLine({ ...x, weights: { ...x.weights, [x.def.culture]: 0 } });
    expect(first.text).toMatch(/^Your first /);
    const two = cultureLine({ ...x, weights: { ...x.weights, [x.def.culture]: 2 } });
    expect(two.text).toMatch(/weight 2 to 3/);
  });

  it('passing: the refund in points for a points offer; nothing for a deed', () => {
    const x = inputs();
    if (!x) return;
    const pts = passLine(x);
    expect(pts.text).toMatch(/Passing (banks \+\d+|keeps)/);
    const deed = passLine({ ...x, offer: { ...x.offer, source: 'deed', deed: 'd' } });
    expect(deed.text).toMatch(/for good/);
  });
});

describe('a longer aim on quiet turns', () => {
  const base: AimInputs = { influence: 0, cityStates: [], goals: [], wonders: [], uncharted: null, explorer: null };
  it('an affordable envoy first, then a milestone one step away, a wonder, an uncharted direction', () => {
    const cs = { id: 'kanesh', name: 'Kanesh', cost: 10, suzerainIsMe: false, mine: 0, lead: 3 };
    expect(pickAim({ ...base, influence: 12, cityStates: [cs] })?.id).toBe('envoy');
    expect(pickAim({ ...base, influence: 12, cityStates: [cs] })?.text).toMatch(/Send an envoy to Kanesh \(10 influence, you have 12\)/);
    expect(pickAim({ ...base, influence: 5, cityStates: [cs] })).toBeNull();
    const goal = { id: 'w', track: 'culture', label: 'Wonders', value: 1, next: 2, left: 1, text: '1 more for a culture milestone (wonders 1/2)' };
    expect(pickAim({ ...base, goals: [goal] })?.action).toEqual({ kind: 'modal', modal: { kind: 'legacy' } });
    // "0 of 1 wonders" is not one step away: a wonder within reach outranks it.
    const far = { ...goal, value: 0 };
    expect(pickAim({ ...base, goals: [far], wonders: [{ settlement: 's1', city: 'Gadir', name: 'Pyramids', turns: 9 }] })?.id).toBe('wonder');
    const w = { settlement: 's1', city: 'Gadir', name: 'Pyramids', turns: 9 };
    expect(pickAim({ ...base, wonders: [w] })?.text).toBe('Gadir could raise Pyramids in 9 turns.');
    expect(pickAim({ ...base, wonders: [{ ...w, turns: 40 }] })).toBeNull();
    expect(pickAim({ ...base, uncharted: { dir: 'north', share: 0.1 }, explorer: 'u1' })?.action).toEqual({ kind: 'unit', unit: 'u1' });
    expect(pickAim({ ...base, uncharted: { dir: 'north', share: 0.1 }, explorer: null })).toBeNull();
  });
  it('charts the map by compass quarter around home', () => {
    const home = Object.values(court.settlements).find((s) => s.owner === HUMAN && s.isCapital);
    if (!home) return;
    const c = chartedByDirection(court, HUMAN, home.at);
    for (const v of Object.values(c)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('small things', () => {
  it('science and culture show their rate, not a stock nothing spends', () => {
    expect(HUD_YIELDS.filter(isRateYield)).toEqual(['science', 'culture']);
    expect(isRateYield('gold')).toBe(false);
    expect(isRateYield('faith')).toBe(false);
  });
  it('Escape closes the log', () => {
    let closed = 0;
    const h = escapeHandler(() => closed++);
    h({ key: 'Enter' });
    h({ key: 'Escape' });
    expect(closed).toBe(1);
  });
});

describe("a rival leader's words", () => {
  it('a voiced notice that is not first contact becomes a slip in their voice, never folded', () => {
    const rival = court.playerOrder.find((id) => id !== HUMAN)!;
    const text = `${speakerName(court, rival, content)}: “Your soldiers crowd our border. Withdraw them, or we will.”`;
    const ev: SimEvent = { type: 'notice', player: HUMAN, text, kind: 'other' };
    expect(voicedNotice(ev, HUMAN, [court], content)).toEqual({ player: rival, quote: 'Your soldiers crowd our border. Withdraw them, or we will.' });
    expect(voicedNotice({ ...ev, kind: 'firstContact' }, HUMAN, [court], content)).toBeNull();
    expect(voicedNotice({ ...ev, text: 'Raiders are near Gadir.' }, HUMAN, [court], content)).toBeNull();
    expect(speakerPart(text)).toBe(speakerName(court, rival, content));
    // Never folded under "+N more", even in a crowded turn.
    const news: ToastSpec[] = Array.from({ length: 9 }, (_, i) => ({ text: `news ${i}`, tone: 'info', action: null }));
    const ranked = rankToasts([...news, { text, tone: 'info', action: null, voice: rival, keep: true }]);
    expect(ranked.some((t) => t.voice === rival)).toBe(true);
    const items = ranked.map((t, i) => ({ ...t, id: i }));
    expect(splitToasts(items).slips.some((t) => t.voice === rival)).toBe(true);
    expect(splitWhileAnswering(items).slips.map((t) => t.voice)).toEqual([rival]);
  });
});
