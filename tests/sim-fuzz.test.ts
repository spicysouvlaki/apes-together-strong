/**
 * Command fuzzing (CLAUDE.md rule 2, "applyCommand never throws"): thousands of random, mostly
 * illegal commands from random players against a real game that AI turns keep moving. Asserts
 * that applyCommand never throws, never mutates its input, answers well-formed commands with
 * player-facing errors, and that every accepted state stays plain JSON with consistent
 * references (see `stateProblems`).
 */
import { describe, expect, it } from 'vitest';
import type { Command, GameSetup, GameState, PlayerId } from '@contracts/sim-api';
import { CITY_STATE_PREFIX, RAIDER_PLAYER } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { runAiTurn } from '../src/ai';
import { applyCommand, createGame, sim } from '../src/sim';

const content = loadContent();

/** mulberry32: the test's own randomness (never the sim's RNG). */
const rngOf = (seed: number) => {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const setup = (seed: number): GameSetup => ({
  seed,
  mapSize: 'small',
  speed: 'quick',
  players: ['p1', 'p2', 'p3'].map((id, i) => ({
    id,
    isHuman: i === 0,
    leader: content.leaders[(seed + i) % content.leaders.length]?.id ?? '',
    dream: content.dreams[(seed + i) % content.dreams.length]?.id ?? '',
    colors: { primary: '#aa0000', secondary: '#ffffff' },
    skinTone: i,
  })),
});

/** Everything wrong with a state: non-JSON values, impossible numbers, dangling references. */
export const stateProblems = (s: GameState): string[] => {
  const out: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (out.length > 20) return;
    if (v === undefined) out.push(`${path} is undefined`);
    else if (typeof v === 'number' && !Number.isFinite(v)) out.push(`${path} is ${v}`);
    else if (typeof v === 'function') out.push(`${path} is a function`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v !== null && typeof v === 'object') {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) out.push(`${path} is not a plain object`);
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    }
  };
  walk(s, 'state');
  const isOwner = (o: string): boolean =>
    s.players[o] !== undefined || o === RAIDER_PLAYER || (o.startsWith(CITY_STATE_PREFIX) && s.cityStates[o.slice(CITY_STATE_PREFIX.length)] !== undefined);
  const tileAtHex = (h: { q: number; r: number }) => s.map.tiles.find((t) => t.q === h.q && t.r === h.r);
  for (const [id, st] of Object.entries(s.settlements)) {
    if (!Number.isInteger(st.population) || st.population < 1) out.push(`settlement ${id} population ${st.population}`);
    if (!isOwner(st.owner)) out.push(`settlement ${id} owner ${st.owner} missing`);
    if (tileAtHex(st.at)?.settlement !== id) out.push(`settlement ${id} not on its tile`);
  }
  for (const t of s.map.tiles) {
    if (t.settlement && !s.settlements[t.settlement]) out.push(`tile ${t.q},${t.r} names missing settlement ${t.settlement}`);
    if (t.owner !== null && !isOwner(t.owner)) out.push(`tile ${t.q},${t.r} owner ${t.owner} missing`);
  }
  for (const [id, u] of Object.entries(s.units)) {
    if (!tileAtHex(u.at)) out.push(`unit ${id} off the map`);
    if (!isOwner(u.owner)) out.push(`unit ${id} owner ${u.owner} missing`);
    if (!(u.hp > 0 && u.hp <= 100)) out.push(`unit ${id} hp ${u.hp}`);
    if (u.movesLeft < 0) out.push(`unit ${id} movesLeft ${u.movesLeft}`);
    if (u.figure) {
      const loc = s.figures[u.figure]?.location;
      if (!loc || loc.state !== 'unit' || loc.unit !== id) out.push(`unit ${id} figure ${u.figure} not linked back`);
    }
  }
  for (const [id, f] of Object.entries(s.figures)) {
    const p = s.players[f.owner];
    if (!p) out.push(`figure ${id} owner ${f.owner} missing`);
    const loc = f.location;
    if (loc.state === 'based' && s.settlements[loc.settlement]?.owner !== f.owner) out.push(`figure ${id} based in missing/foreign ${loc.settlement}`);
    if (loc.state === 'unit' && s.units[loc.unit]?.figure !== id) out.push(`figure ${id} unit ${loc.unit} missing`);
    if (loc.state === 'seated' && p?.cabinet[loc.slot] !== id) out.push(`figure ${id} seat ${loc.slot} not linked back`);
  }
  for (const [pid, p] of Object.entries(s.players)) {
    for (const [key, fid] of Object.entries(p.cabinet)) {
      if (fid === null) continue;
      const f = s.figures[fid];
      if (!f || f.owner !== pid || f.location.state !== 'seated' || f.location.slot !== key) out.push(`${pid} seat ${key} names ${fid} wrongly`);
    }
  }
  for (const o of s.offers) if (!s.players[o.player]?.alive) out.push(`offer ${o.id} for dead/missing ${o.player}`);
  for (const r of s.tradeRoutes) if (!s.settlements[r.from] || !s.settlements[r.to]) out.push(`route ${r.id} dangling`);
  for (const [id, cs] of Object.entries(s.cityStates)) if (!s.settlements[cs.settlement]) out.push(`city-state ${id} settlement missing`);
  return out;
};

const randomCommand = (s: GameState, rnd: () => number): Command => {
  const pick = <T,>(xs: readonly T[], fallback: T): T => (xs.length ? (xs[Math.floor(rnd() * xs.length)] as T) : fallback);
  const units = [...Object.keys(s.units), 'u_missing'];
  const settlements = [...Object.keys(s.settlements), 's_missing'];
  const figures = [...Object.keys(s.figures), ...content.figures.slice(0, 5).map((f) => f.id), 'ghost'];
  const players = [...s.playerOrder, `${CITY_STATE_PREFIX}${Object.keys(s.cityStates)[0] ?? 'x'}`, RAIDER_PLAYER, 'nobody'];
  const ownUnit = Object.values(s.units).find((u) => u.owner === s.currentPlayer && rnd() < 0.3);
  const near = ownUnit && rnd() < 0.7 ? ownUnit.at : { q: Math.floor(rnd() * 40) - 5, r: Math.floor(rnd() * 40) - 5 };
  const hex = { q: near.q + Math.floor(rnd() * 5) - 2, r: near.r + Math.floor(rnd() * 5) - 2 };
  const unit = ownUnit && rnd() < 0.6 ? ownUnit.id : pick(units, 'u');
  const items = [...content.units.map((u) => u.id), ...content.buildings.map((b) => b.id), ...content.wonders.map((w) => w.id), 'nothing'];
  const keys = Object.values(s.players).flatMap((p) => Object.keys(p.cabinet));
  const options = content.crises.flatMap((c) => c.stages.flatMap((st) => st.options.map((o) => o.id)));
  const all: (() => Command)[] = [
    () => ({ type: 'moveUnit', unit, to: hex }),
    () => ({ type: 'attack', unit, target: hex }),
    () => ({ type: 'fortify', unit }),
    () => ({ type: 'disbandUnit', unit }),
    () => ({ type: 'foundSettlement', unit }),
    () => ({ type: 'openTradeRoute', unit, to: pick(settlements, 's') }),
    () => ({ type: 'setProduction', settlement: pick(settlements, 's'), item: rnd() < 0.1 ? null : pick(items, 'x') }),
    () => ({ type: 'buyItem', settlement: pick(settlements, 's'), item: pick(items, 'x') }),
    () => ({ type: 'upgradeSettlement', settlement: pick(settlements, 's') }),
    () => ({ type: 'setResearch', tree: rnd() < 0.5 ? 'tech' : 'civic', id: pick(content.techs.map((t) => t.id), 'x') }),
    () => ({ type: 'setGovernment', government: pick([...content.governments.map((g) => g.id), 'anarchy?'], 'x') }),
    () => ({ type: 'chooseOffer', offer: pick([...s.offers.map((o) => o.id), 'o_missing'], 'o'), figure: rnd() < 0.3 ? null : pick(figures, 'f') }),
    () => ({ type: 'seatFigure', figure: pick(figures, 'f'), slot: pick([...keys, 'nowhere#0'], 'k') }),
    () => ({ type: 'unseatFigure', figure: pick(figures, 'f') }),
    () => ({ type: 'deployFigure', figure: pick(figures, 'f'), settlement: pick(settlements, 's') }),
    () => ({ type: 'recallFigure', figure: pick(figures, 'f') }),
    () => ({ type: 'activateFigure', figure: pick(figures, 'f') }),
    () => ({ type: 'consumeFigure', figure: pick(figures, 'f'), as: rnd() < 0.5 ? 'refinement' : 'yields' }),
    () => ({ type: 'declareWar', target: pick(players, 'x') }),
    () => ({ type: 'makePeace', target: pick(players, 'x') }),
    () => ({ type: 'sendEnvoy', cityState: pick([...Object.keys(s.cityStates), 'atlantis'], 'x') }),
    () => ({ type: 'chooseCrisisResponse', option: pick([...options, 'nope'], 'x') }),
    () => ({ type: 'adoptTradition', tradition: pick([...content.traditions.map((t) => t.id), 'nope'], 'x') }),
    () => ({ type: 'adoptHybrid', hybrid: pick([...content.hybrids.map((h) => h.id), 'nope'], 'x') }),
    () => ({ type: 'nameCiv', name: pick(['', '  ', 'Fuzzland', 'x'.repeat(60)], '') }),
    () => ({ type: 'finishTransition' }),
    () => ({ type: 'endTurn' }),
  ];
  return pick(all, all[0] as () => Command)();
};

/** Malformed commands as a buggy UI might send them: missing fields, wrong types, unknown types. */
const malformed = (s: GameState): unknown[] => {
  const unit = Object.values(s.units).find((u) => u.owner === s.currentPlayer)?.id ?? 'u1';
  const settlement = Object.values(s.settlements).find((x) => x.owner === s.currentPlayer)?.id ?? 's1';
  const figure = Object.values(s.figures).find((f) => f.owner === s.currentPlayer)?.id ?? 'f1';
  return [
    null,
    {},
    { type: 'bogus' },
    { type: 'moveUnit', unit },
    { type: 'moveUnit', unit, to: { q: 'a', r: null } },
    { type: 'attack', unit, target: null },
    { type: 'openTradeRoute', unit },
    { type: 'setProduction', settlement },
    { type: 'buyItem', settlement, item: { id: 'x' } },
    { type: 'seatFigure', figure, slot: {} },
    { type: 'deployFigure', figure, settlement: 7 },
    { type: 'consumeFigure', figure, as: 'snacks' },
    { type: 'nameCiv', name: 42 },
    { type: 'setResearch', tree: 'magic', id: 'x' },
    { type: 'declareWar', target: { id: 'p2' } },
    { type: 'sendEnvoy' },
  ];
};

/** Errors a player sees in a toast: a sentence, no ids, no JavaScript internals. */
const INTERNAL = /Cannot read prop|undefined|is not a function|is not iterable|Maximum call stack|\b[a-z]+_[a-z_]+\b/;

describe('command fuzzing', () => {
  it('thousands of random commands never throw, mutate the input or corrupt the state', () => {
    const seed = Number(process.env.FUZZ_SEED ?? 11);
    const rnd = rngOf(20251125 + seed);
    let state = createGame(setup(seed), content).state;
    let fired = 0;
    let accepted = 0;
    const badErrors = new Set<string>();
    const fire = (player: PlayerId, cmd: unknown): void => {
      const before = JSON.stringify(state);
      let r: ReturnType<typeof applyCommand>;
      try {
        r = applyCommand(state, player, cmd as Command, content);
      } catch (err) {
        throw new Error(`applyCommand threw on ${JSON.stringify(cmd)}: ${String(err)}`);
      }
      fired++;
      expect(JSON.stringify(state)).toBe(before);
      if (!r.ok) {
        expect(typeof r.error).toBe('string');
        if (INTERNAL.test(r.error)) badErrors.add(`${JSON.stringify(cmd)}: ${r.error}`);
        return;
      }
      accepted++;
      const problems = stateProblems(r.state);
      expect(problems, `after ${JSON.stringify(cmd)} by ${player}`).toEqual([]);
      state = r.state;
    };

    let games = 1;
    for (let round = 0; fired < 3000 && round < 1000; round++) {
      if (state.phase === 'ended') {
        // A fuzzed human loses fast (disbanded settler, reckless wars): start another game.
        state = createGame(setup(seed + games++), content).state;
      }
      for (let i = 0; i < 12; i++) {
        const player = rnd() < 0.8 ? state.currentPlayer : (state.playerOrder[Math.floor(rnd() * 3)] ?? 'p1');
        fire(rnd() < 0.02 ? 'nobody' : player, randomCommand(state, rnd));
      }
      if (round % 10 === 0) for (const m of malformed(state)) fire(state.currentPlayer, m);
      // Keep the game moving: an AI plays the rest of the turn (or the transition).
      const pid =
        state.phase === 'transition'
          ? (state.playerOrder.find((p) => state.transition && !state.transition.recap[p]?.done) ?? state.currentPlayer)
          : state.currentPlayer;
      state = runAiTurn(state, pid, content, sim).state;
      expect(stateProblems(state)).toEqual([]);
    }
    expect(fired).toBeGreaterThanOrEqual(3000);
    expect(accepted).toBeGreaterThan(50);
    expect([...badErrors]).toEqual([]);
  }, 120_000);

  it('an exception inside a module becomes { ok: false } with the original message', () => {
    const { state } = createGame(setup(3), content);
    const unit = Object.values(state.units).find((u) => u.owner === 'p1');
    const broken = new Proxy(content, {
      get: (target, key, receiver) => {
        if (key === 'units') throw new Error('boom: content unavailable');
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const before = JSON.stringify(state);
    const r = applyCommand(state, 'p1', { type: 'moveUnit', unit: unit?.id ?? '', to: unit?.at ?? { q: 0, r: 0 } }, broken);
    expect(r).toEqual({ ok: false, error: 'boom: content unavailable' });
    expect(JSON.stringify(state)).toBe(before);
    expect(applyCommand(state, 'p1', { type: 'moveUnit', unit: unit?.id } as unknown as Command, content)).toEqual({
      ok: false,
      error: 'That action is not recognized.',
    });
  });
});
