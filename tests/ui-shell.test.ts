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

describe('playtest fixes (shell)', () => {
  it('nudges "Found city" first while the player has no settlement, but never over an offer', async () => {
    const { firstFounder } = await import('../src/ui/shell/hexutil');
    const s = newGame();
    const canFound = (t: string) => !!content.units.find((u) => u.id === t)?.canFound;
    const founder = firstFounder(s, 'p1', canFound);
    expect(founder).toBe(unitOf(s, 'settler').id);
    const all = () => true;
    expect(planEndTurn([{ type: 'government' }], all, founder)).toMatchObject({ mode: 'next', next: { type: 'found', unit: founder } });
    expect(planEndTurn([{ type: 'offer', offer: 'o1' }], all, founder).next).toEqual({ type: 'offer', offer: 'o1' });
    expect(decisionModal({ type: 'found', unit: 'u1' })).toBeNull();
    const founded = apply(s, { type: 'foundSettlement', unit: founder! });
    expect(firstFounder(founded, 'p1', canFound)).toBeNull();
  });

  it('ranks a turn-start batch: threats first, duplicates folded, overflow summarised', async () => {
    const { rankToasts, toastPriority } = await import('../src/ui/shell/event-toasts');
    const info = { text: 'grew', tone: 'info' as const, action: null };
    const war = { text: 'war on us', tone: 'bad' as const, action: { kind: 'diplomacy' as const } };
    const offer = { text: 'offer', tone: 'culture' as const, action: { kind: 'offer' as const, offer: 'o1' } };
    const crisisA = { text: 'crisis began', tone: 'bad' as const, action: { kind: 'crisis' as const } };
    const crisisB = { text: 'stage 1', tone: 'bad' as const, action: { kind: 'crisis' as const } };
    expect(toastPriority(war)).toBeLessThan(toastPriority(offer));
    expect(rankToasts([info, offer, war]).map((t) => t.text)).toEqual(['war on us', 'offer', 'grew']);
    expect(rankToasts([crisisA, crisisB]).map((t) => t.text)).toEqual(['crisis began']);
    const many = rankToasts([info, info, info, war, offer]);
    expect(many).toHaveLength(3);
    expect(many.map((t) => t.text)).toEqual(['war on us', 'offer', '+3 more updates this turn.']);
  });

  it('turns combat into plain-words toasts for the human only', () => {
    const names: EventNames = {
      owner: (id) => (id === 'raiders' ? 'Raiders' : `Owner ${id}`),
      figure: (id) => id,
      settlement: () => null,
      item: (id) => id,
      research: (id) => id,
      milestone: (k) => k,
      crisis: (id) => id,
      deed: (id) => id,
      unit: (id) => (id === 'u1' ? 'Warrior band' : 'Slinger'),
    };
    const base = { type: 'combat' as const, at: { q: 0, r: 0 }, damageToAttacker: 23, damageToDefender: 40, attackerDied: false, defenderDied: true };
    const mine = eventToToast({ ...base, attacker: 'u1', attackerOwner: 'p1', defender: 'u9', defenderOwner: 'raiders' }, 'p1', names);
    expect(mine).toMatchObject({ tone: 'good' });
    expect(mine?.text).toBe('Raiders’ Slinger was destroyed; ours lost 23.');
    const hit = eventToToast({ ...base, defenderDied: false, attacker: 'u9', attackerOwner: 'p2', defender: 'u1', defenderOwner: 'p1' }, 'p1', names);
    expect(hit).toMatchObject({ tone: 'bad', text: 'Owner p2 attacked: our Warrior band lost 40 HP.' });
    expect(eventToToast({ ...base, attacker: 'u9', attackerOwner: 'p2', defender: 'u8', defenderOwner: 'p3' }, 'p1', names)).toBeNull();
  });

  it('explains what the selected unit can do next', async () => {
    const { unitHint } = await import('../src/ui/shell/unit-hints');
    const base = { isFounder: false, canFound: false, isTrader: false, tradeTargets: 0, movesLeft: 2, canMove: true, canAttack: false, hasAttacked: false, military: true };
    expect(unitHint(base)).toBe('Tap a lit tile to move, or a far tile to plan a route.');
    expect(unitHint({ ...base, canAttack: true })).toBe('Tap a red tile to attack. Tap a lit tile to move, or a far tile to plan a route.');
    expect(unitHint({ ...base, movesLeft: 0, canMove: false })).toMatch(/No moves left/);
    expect(unitHint({ ...base, isFounder: true, military: false })).toMatch(/Can’t settle here/);
    expect(unitHint({ ...base, isFounder: true, canFound: true })).toMatch(/Found settlement/);
    expect(unitHint({ ...base, isTrader: true })).toMatch(/trade route/);
  });

  it('Continue picks the newest of the last autosave and the resume save', async () => {
    const { continueSave, RESUME_SLOT, PLAYER_SLOT_COUNT } = await import('../src/ui/shell/saves-logic');
    const meta = (slot: string, savedAt: number) => ({ slot, savedAt, turn: 1, age: 'ancient' as const, civName: null, leader: 'sage' });
    expect(continueSave([meta('auto:0', 10), meta(RESUME_SLOT, 20), meta('slot:0', 30)])?.slot).toBe(RESUME_SLOT);
    expect(continueSave([meta('auto:0', 30), meta(RESUME_SLOT, 20)])?.slot).toBe('auto:0');
    expect(continueSave([meta('slot:2', 5)])?.slot).toBe('slot:2');
    expect(continueSave([])).toBeNull();
    expect(RESUME_SLOT).toBe(`slot:${PLAYER_SLOT_COUNT}`);
  });
});

describe('war targets (attack a neutral = declare war first)', () => {
  it('asks the attack query about a hypothetical war and keeps only visible targets of that owner', async () => {
    const { peacefulOwners, warTargetsFor } = await import('../src/ui/shell/war-targets');
    const { warKey } = await import('@contracts/sim-api');
    const s = newGame();
    expect(peacefulOwners(s, 'p1')).toContain('p2');
    const mineMil = Object.values(s.units).find((u) => u.owner === 'p1' && u.unitClass !== 'civilian')!;
    const theirs = Object.values(s.units).find((u) => u.owner === 'p2')!;
    const idx = tileIndexOf(s.map, theirs.at)!;
    const query = (st: GameState) => (st.wars[warKey('p1', 'p2')] !== undefined ? [theirs.at] : []);
    expect(warTargetsFor(s, 'p1', mineMil.id, query, new Set([idx]))).toEqual([{ hex: theirs.at, owner: 'p2' }]);
    expect(warTargetsFor(s, 'p1', mineMil.id, query, new Set())).toEqual([]); // hidden: no leak
    const tap = resolveTap({
      state: s,
      me: 'p1',
      hex: theirs.at,
      selectedUnit: mineMil.id,
      reachable: [],
      attackable: [],
      lastTap: null,
      atWar: atPeace,
      warTargets: [{ hex: theirs.at, owner: 'p2' }],
    });
    expect(tap).toEqual({ kind: 'attack', unit: mineMil.id, target: theirs.at, declareWarOn: 'p2' });
  });
});

describe('turn news (playtest QoL)', () => {
  const names: EventNames = {
    owner: (id) => `Owner ${id}`,
    figure: (id) => `Fig ${id}`,
    settlement: (id) => (id === 'mine' ? { name: 'Ur', owner: 'p1', at: { q: 3, r: 4 } } : { name: 'Kish', owner: 'p2', at: { q: 9, r: 9 } }),
    item: (id) => `Item ${id}`,
    research: (id) => `Tech ${id}`,
    milestone: (k) => `M ${k}`,
    crisis: (id) => `Crisis ${id}`,
    deed: (id) => `Deed ${id}`,
  };
  const t = (ev: SimEvent) => eventToToast(ev, 'p1', names);

  it('announces a new age', () => {
    expect(t({ type: 'ageStarted', age: 'classical' })).toMatchObject({ tone: 'culture', text: expect.stringMatching(/Classical age begins/) });
  });

  it('tells where things happened so a tap can center the map there', () => {
    const at = { q: 5, r: 6 };
    const fight: SimEvent = {
      type: 'combat',
      attacker: 'u9',
      attackerOwner: 'p2',
      defenderOwner: 'p1',
      defender: 'u1',
      at,
      damageToAttacker: 3,
      damageToDefender: 20,
      attackerDied: false,
      defenderDied: false,
    };
    expect(t(fight)?.at).toEqual(at);
    expect(t({ type: 'settlementGrew', settlement: 'mine', population: 3 })?.at).toEqual({ q: 3, r: 4 });
    expect(t({ type: 'settlementCaptured', settlement: 'mine', from: 'p1', to: 'p2' })?.at).toEqual({ q: 3, r: 4 });
  });

  it('folds overflow into one line that opens the turn log', async () => {
    const { rankToasts } = await import('../src/ui/shell/event-toasts');
    const info = { text: 'grew', tone: 'info' as const, action: null };
    const many = rankToasts([info, info, info, info, info]);
    expect(many).toHaveLength(3);
    expect(many[2]).toMatchObject({ text: '+3 more updates this turn.', action: { kind: 'log' } });
  });

  it('keeps the last 50 events for the log', async () => {
    const { pushLog, turnLog, LOG_MAX } = await import('../src/ui/shell/shell-state');
    turnLog.value = [];
    for (let i = 0; i < 60; i++) pushLog(i, [{ text: `e${i}`, tone: 'info' }]);
    expect(turnLog.value).toHaveLength(LOG_MAX);
    expect(turnLog.value[0]).toEqual({ turn: 10, text: 'e10', tone: 'info' });
    expect(turnLog.value[LOG_MAX - 1]?.text).toBe('e59');
  });
});
