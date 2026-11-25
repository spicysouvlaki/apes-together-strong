/**
 * Pure shell logic: tap intents, End Turn planning, event -> toast mapping, setup building,
 * unit cycling. No DOM; .tsx and CSS are never imported here.
 */
import { describe, expect, it } from 'vitest';
import type { Decision, GameState, SimEvent } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { sim, queries as q } from '../src/sim';
import { decisionModal, planEndTurn } from '../src/ui/shell/decisions';
import { eventFlash, eventToToast, type EventNames } from '../src/ui/shell/event-toasts';
import { homeHex, nextIdleUnit, tileIndexOf } from '../src/ui/shell/hexutil';
import { buildGameSetup, dreamOffer, mulberry32, parseSeed, type SetupChoices } from '../src/ui/shell/setup-logic';
import { resolveTap } from '../src/ui/shell/tap-intent';

const content = loadContent();

const choices: SetupChoices = {
  leader: 'builder',
  dream: 'pax',
  primary: '#0072b2',
  secondary: '#ffffff',
  skinTone: 2,
  mapSize: 'small',
  speed: 'standard',
  rivals: 2,
  seed: 42,
};

const newGame = (): GameState =>
  sim.createGame(
    buildGameSetup(
      choices,
      content.leaders.map((l) => l.id),
      content.dreams.map((d) => d.id),
    ),
    content,
  ).state;

const unitOf = (s: GameState, type: string) => {
  const u = Object.values(s.units).find((x) => x.owner === 'p1' && x.type === type);
  if (!u) throw new Error(`no ${type}`);
  return u;
};

const apply = (s: GameState, cmd: Parameters<typeof sim.applyCommand>[2]): GameState => {
  const r = sim.applyCommand(s, 'p1', cmd, content);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

const atPeace = () => false;

describe('setup-logic', () => {
  it('builds a human p1 plus distinct AI rivals, reproducibly from the seed', () => {
    const a = buildGameSetup(choices, content.leaders.map((l) => l.id), content.dreams.map((d) => d.id));
    const b = buildGameSetup(choices, content.leaders.map((l) => l.id), content.dreams.map((d) => d.id));
    expect(a).toEqual(b);
    expect(a.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(a.players[0]).toMatchObject({ isHuman: true, leader: 'builder', dream: 'pax' });
    expect(new Set(a.players.map((p) => p.leader)).size).toBe(3);
    expect(new Set(a.players.map((p) => p.dream)).size).toBe(3);
    expect(new Set(a.players.map((p) => p.colors.primary)).size).toBe(3);
    expect(a.players.slice(1).every((p) => !p.isHuman)).toBe(true);
  });
  it('clamps rivals to 1–2', () => {
    const ids = [content.leaders.map((l) => l.id), content.dreams.map((d) => d.id)] as const;
    expect(buildGameSetup({ ...choices, rivals: 0 }, ...ids).players).toHaveLength(2);
    expect(buildGameSetup({ ...choices, rivals: 9 }, ...ids).players).toHaveLength(3);
  });
  it('offers 3 distinct dreams and parses seeds strictly', () => {
    const offer = dreamOffer(content.dreams.map((d) => d.id), mulberry32(7));
    expect(offer).toHaveLength(3);
    expect(new Set(offer).size).toBe(3);
    expect(parseSeed(' 123 ')).toBe(123);
    expect(parseSeed('0')).toBeNull();
    expect(parseSeed('12a')).toBeNull();
    expect(parseSeed('')).toBeNull();
  });
  it('produces a setup the sim accepts', () => {
    const s = newGame();
    expect(s.playerOrder).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('tap intent', () => {
  it('selects my unit, then moves to a reachable hex', () => {
    const s = newGame();
    const scout = unitOf(s, 'scout');
    const first = resolveTap({ state: s, me: 'p1', hex: scout.at, selectedUnit: null, reachable: [], attackable: [], lastTap: null, atWar: atPeace });
    expect(first).toMatchObject({ kind: 'selectUnit', unit: scout.id });
    const reach = q.reachable(s, scout.id, content).map((r) => r.hex);
    const to = reach[0]!;
    const move = resolveTap({ state: s, me: 'p1', hex: to, selectedUnit: scout.id, reachable: reach, attackable: [], lastTap: null, atWar: atPeace });
    expect(move).toEqual({ kind: 'move', unit: scout.id, to });
  });

  it('cycles through units sharing a tile, and city first on own settlements', () => {
    const s = newGame();
    const settler = unitOf(s, 'settler');
    const warrior = unitOf(s, 'warrior_band');
    expect(settler.at).toEqual(warrior.at);
    const base = { state: s, me: 'p1', hex: settler.at, selectedUnit: null, reachable: [], attackable: [], atWar: atPeace };
    const a = resolveTap({ ...base, lastTap: null });
    expect(a.kind).toBe('selectUnit');
    const b = resolveTap({ ...base, lastTap: { hex: settler.at, cycleIndex: (a as { cycleIndex: number }).cycleIndex } });
    expect(b.kind).toBe('selectUnit');
    expect((b as { unit: string }).unit).not.toBe((a as { unit: string }).unit);

    const founded = apply(s, { type: 'foundSettlement', unit: settler.id });
    const city = resolveTap({ ...base, state: founded, lastTap: null });
    expect(city.kind).toBe('openCity');
    const next = resolveTap({ ...base, state: founded, lastTap: { hex: settler.at, cycleIndex: 0 } });
    expect(next).toMatchObject({ kind: 'selectUnit', unit: warrior.id });
    const wrap = resolveTap({ ...base, state: founded, lastTap: { hex: settler.at, cycleIndex: 1 } });
    expect(wrap.kind).toBe('openCity');
  });

  it('deselects on empty tiles', () => {
    const s = newGame();
    const empty = s.map.tiles.find((t) => !Object.values(s.units).some((u) => u.at.q === t.q && u.at.r === t.r) && !t.settlement)!;
    const r = resolveTap({ state: s, me: 'p1', hex: empty, selectedUnit: null, reachable: [], attackable: [], lastTap: null, atWar: atPeace });
    expect(r.kind).toBe('deselect');
  });

  it('asks to declare war on a player at peace, but not on raiders or enemies at war', () => {
    const s = newGame();
    const warrior = unitOf(s, 'warrior_band');
    const rival = Object.values(s.units).find((u) => u.owner === 'p2')!;
    const target = rival.at;
    const base = { me: 'p1', hex: target, selectedUnit: warrior.id, reachable: [], attackable: [target], lastTap: null };
    expect(resolveTap({ ...base, state: s, atWar: atPeace })).toEqual({ kind: 'attack', unit: warrior.id, target, declareWarOn: 'p2' });
    expect(resolveTap({ ...base, state: s, atWar: () => true })).toMatchObject({ declareWarOn: null });
    const raided: GameState = { ...s, units: { ...s.units, [rival.id]: { ...rival, owner: 'raiders' } } };
    expect(resolveTap({ ...base, state: raided, atWar: atPeace })).toMatchObject({ kind: 'attack', declareWarOn: null });
  });
});

describe('end turn plan', () => {
  const all = () => true;
  it('blocks on offers/crisis/transition and on government when its screen exists', () => {
    const ds: Decision[] = [{ type: 'research', tree: 'tech' }, { type: 'government' }, { type: 'production', settlement: 's1' }];
    expect(planEndTurn(ds, all)).toMatchObject({ mode: 'next', next: { type: 'government' } });
    const noGov = planEndTurn(ds, (k) => k !== 'government');
    expect(noGov.mode).toBe('end');
    expect(noGov.advisory).toHaveLength(3);
    expect(noGov.idleCities).toEqual(['s1']);
    expect(planEndTurn([{ type: 'offer', offer: 'o1' }], () => false)).toMatchObject({ mode: 'next', next: { type: 'offer', offer: 'o1' } });
    expect(planEndTurn([], all)).toEqual({ mode: 'end', next: null, advisory: [], idleCities: [] });
  });
  it('maps decisions to modals', () => {
    expect(decisionModal({ type: 'offer', offer: 'o9' })).toEqual({ kind: 'offer', offer: 'o9' });
    expect(decisionModal({ type: 'research', tree: 'civic' })).toEqual({ kind: 'tree', tree: 'civic' });
    expect(decisionModal({ type: 'production', settlement: 's2' })).toEqual({ kind: 'city', settlement: 's2' });
    expect(decisionModal({ type: 'crisis', crisis: 'collapse', stage: 1 })).toEqual({ kind: 'crisis' });
    expect(decisionModal({ type: 'transition' })).toEqual({ kind: 'transition' });
  });
  it('matches what the sim reports at game start', () => {
    const s = newGame();
    const plan = planEndTurn(q.pendingDecisions(s, 'p1', content), all);
    expect(plan.mode).toBe('next');
  });
});

describe('event toasts', () => {
  const names: EventNames = {
    owner: (id) => `Owner ${id}`,
    figure: (id) => `Fig ${id}`,
    settlement: (id) => (id === 'mine' ? { name: 'Ur', owner: 'p1' } : { name: 'Kish', owner: 'p2' }),
    item: (id) => `Item ${id}`,
    research: (id) => `Tech ${id}`,
    milestone: (k) => `M ${k}`,
    crisis: (id) => `Crisis ${id}`,
    deed: (id) => `Deed ${id}`,
  };
  const t = (ev: SimEvent) => eventToToast(ev, 'p1', names);

  it('shows my own news with the right tone and action', () => {
    expect(t({ type: 'cultureHint', player: 'p1', culture: 'greek', text: 'Greek sailors talk of you.' })).toEqual({
      text: 'Greek sailors talk of you.',
      tone: 'culture',
      action: null,
    });
    expect(t({ type: 'offerCreated', offer: 'o1', player: 'p1' })?.action).toEqual({ kind: 'offer', offer: 'o1' });
    expect(t({ type: 'productionCompleted', settlement: 'mine', item: 'warrior_band', player: 'p1' })).toMatchObject({
      tone: 'good',
      action: { kind: 'city', settlement: 'mine' },
    });
    expect(t({ type: 'figureJoinedRival', figure: 'f', player: 'p1', rival: 'p2' })?.tone).toBe('bad');
    expect(t({ type: 'crisisStarted', crisis: 'collapse' })?.action).toEqual({ kind: 'crisis' });
    expect(t({ type: 'crisisStage', crisis: 'collapse', stage: 2 })?.action).toEqual({ kind: 'crisis' });
    expect(t({ type: 'warDeclared', by: 'p2', on: 'p1' })?.tone).toBe('bad');
  });

  it('hides other players\' private events', () => {
    expect(t({ type: 'cultureHint', player: 'p2', culture: 'greek', text: 'secret' })).toBeNull();
    expect(t({ type: 'offerCreated', offer: 'o1', player: 'p2' })).toBeNull();
    expect(t({ type: 'researchCompleted', player: 'p2', tree: 'tech', id: 'x' })).toBeNull();
    expect(t({ type: 'settlementGrew', settlement: 'theirs', population: 3 })).toBeNull();
    expect(t({ type: 'notice', player: 'p2', text: 'x' })).toBeNull();
    expect(t({ type: 'settlementGrew', settlement: 'mine', population: 3 })?.text).toBe('Ur grew to 3.');
    expect(t({ type: 'notice', player: null, text: 'all' })?.text).toBe('all');
  });

  it('flashes combat and founding at the right hex', () => {
    let s = newGame();
    const settler = unitOf(s, 'settler');
    s = apply(s, { type: 'foundSettlement', unit: settler.id });
    const sid = Object.values(s.settlements).find((x) => x.owner === 'p1')!.id;
    expect(eventFlash({ type: 'settlementFounded', settlement: sid, player: 'p1' }, s)).toEqual({ hex: settler.at, kind: 'found' });
    expect(eventFlash({ type: 'turnStarted', turn: 2 }, s)).toBeNull();
  });
});

describe('hexutil', () => {
  it('cycles idle units, skipping skipped and wrapping', () => {
    const s = newGame();
    const ids = Object.values(s.units).filter((u) => u.owner === 'p1').map((u) => u.id);
    const first = nextIdleUnit(s, 'p1', new Set(), null)!;
    expect(first.id).toBe(ids[0]);
    const second = nextIdleUnit(s, 'p1', new Set(), first.id)!;
    expect(second.id).toBe(ids[1]);
    const skipSecond = nextIdleUnit(s, 'p1', new Set([ids[1]!]), first.id)!;
    expect(skipSecond.id).toBe(ids[2]);
    expect(nextIdleUnit(s, 'p1', new Set(ids), null)).toBeNull();
  });
  it('finds a home hex and tile indices', () => {
    const s = newGame();
    expect(homeHex(s, 'p1')).toEqual(unitOf(s, 'settler').at);
    const t = s.map.tiles[37]!;
    expect(tileIndexOf(s.map, t)).toBe(37);
    expect(tileIndexOf(s.map, { q: -100, r: 0 })).toBeNull();
  });
});
