/**
 * Standing orders (multi-turn moves, scout exploring) and settler site descriptions: pure UI
 * logic over real sim states and queries. No DOM.
 */
import { describe, expect, it } from 'vitest';
import { hexDistance, hexEquals, type Hex } from '@contracts/hex';
import type { GameState } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { sim, queries as q } from '../src/sim';
import {
  canExplore,
  enemyAdjacent,
  exploreTarget,
  frontierTiles,
  furthestStep,
  parseStoredOrders,
  pruneOrders,
  routeTurns,
  STORED_GAMES_MAX,
  stepOrder,
  storeOrders,
  withOrder,
  type OrderDeps,
} from '../src/ui/shell/orders';
import { directionWord, shortWhere, siteFacts, siteSummary, whereWord } from '../src/ui/shell/site-hints';
import { buildGameSetup, difficultyNote, knownDifficulty, type SetupChoices } from '../src/ui/shell/setup-logic';

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
const deps = (s: GameState): OrderDeps => ({
  pathTo: (u, to) => q.pathTo(s, u, to, content),
  reachable: (u) => q.reachable(s, u, content).map((r) => r.hex),
  attackTargets: (u) => q.attackTargets(s, u, content),
  hostile: (a, b) => q.atWar(s, a, b),
  isWater: (t) => !!content.terrain.find((x) => x.id === t.terrain)?.water,
});
/** End turns (all players) until it is p1's turn again. */
const nextTurn = (s: GameState): GameState => {
  let st = s;
  const start = st.turn;
  for (let i = 0; i < 20 && (st.turn === start || st.currentPlayer !== 'p1'); i++) {
    const who = st.currentPlayer;
    const r = sim.applyCommand(st, who, { type: 'endTurn' }, content);
    if (!r.ok) throw new Error(r.error);
    st = r.state;
  }
  return st;
};
/** A far explored land tile the scout can route to but not reach this turn. */
const farTarget = (s: GameState, unit: string): Hex => {
  const u = s.units[unit]!;
  const reach = q.reachable(s, unit, content).map((r) => r.hex);
  const p = s.players.p1!;
  const cands = s.map.tiles
    .filter((t, i) => p.explored[i] && !reach.some((h) => hexEquals(h, t)) && hexDistance(t, u.at) >= 2)
    .map((t) => ({ q: t.q, r: t.r }))
    .filter((h) => (q.pathTo(s, unit, h, content)?.length ?? 0) > 0)
    .sort((a, b) => hexDistance(b, u.at) - hexDistance(a, u.at));
  if (!cands[0]) throw new Error('no far target');
  return cands[0];
};

describe('standing orders', () => {
  it('takes the furthest reachable step along a route, never an attack tile', () => {
    const a = { q: 0, r: 0 };
    const b = { q: 1, r: 0 };
    const c = { q: 2, r: 0 };
    expect(furthestStep([a, b, c], [a, b], [])).toEqual(b);
    expect(furthestStep([a, b, c], [a, b], [b])).toEqual(a);
    expect(furthestStep([a, b, c], [], [])).toBeNull();
  });

  it('marches toward a far tile over several turns and finishes on arrival', () => {
    let s = newGame();
    const scout = unitOf(s, 'scout');
    const to = farTarget(s, scout.id);
    let order = withOrder({}, scout.id, { kind: 'goto', to });
    let arrived = false;
    for (let turn = 0; turn < 12 && !arrived; turn++) {
      for (let k = 0; k < 3; k++) {
        const o = order[scout.id];
        if (!o) break;
        const step = stepOrder(s, 'p1', scout.id, o, deps(s));
        if (step.kind === 'done') {
          expect(step.reason).toBe('arrived');
          arrived = true;
          order = withOrder(order, scout.id, null);
          break;
        }
        if (step.kind === 'wait') break;
        s = apply(s, { type: 'moveUnit', unit: scout.id, to: step.to });
        if (step.arrives) {
          arrived = true;
          order = withOrder(order, scout.id, null);
        }
      }
      if (!arrived) s = nextTurn(s);
    }
    expect(arrived).toBe(true);
    expect(s.units[scout.id]!.at).toEqual(to);
  });

  it('waits when the unit has no moves left and drops impossible routes', () => {
    const s = newGame();
    const scout = unitOf(s, 'scout');
    const tired: GameState = { ...s, units: { ...s.units, [scout.id]: { ...scout, movesLeft: 0 } } };
    expect(stepOrder(tired, 'p1', scout.id, { kind: 'goto', to: farTarget(s, scout.id) }, deps(tired))).toEqual({ kind: 'wait' });
    // Unexplored tiles have no known route.
    const p = s.players.p1!;
    const unknown = s.map.tiles.find((_, i) => !p.explored[i])!;
    expect(stepOrder(s, 'p1', scout.id, { kind: 'goto', to: unknown }, deps(s))).toEqual({ kind: 'done', reason: 'impossible' });
    expect(stepOrder(s, 'p1', 'nobody', { kind: 'explore' }, deps(s))).toEqual({ kind: 'done', reason: 'gone' });
  });

  it('marches toward a goal held by our own unit and waits beside it (playtest: scout on the site)', () => {
    const s = newGame();
    const settler = unitOf(s, 'settler');
    const scout = unitOf(s, 'scout');
    const p = s.players.p1!;
    // A known land tile 3 away that the settler can route to while it is empty.
    const goal = s.map.tiles.find(
      (t, i) => p.explored[i] && hexDistance(settler.at, t) === 3 && (q.pathTo(s, settler.id, t, content)?.length ?? 0) > 0,
    )!;
    expect(goal).toBeTruthy();
    const held: GameState = { ...s, units: { ...s.units, [scout.id]: { ...scout, at: { q: goal.q, r: goal.r } } } };
    expect(q.pathTo(held, settler.id, goal, content) ?? []).toHaveLength(0);
    const step = stepOrder(held, 'p1', settler.id, { kind: 'goto', to: goal }, deps(held));
    expect(step.kind).toBe('move');
    if (step.kind === 'move') expect(step.arrives).toBe(false);
    // Beside the occupied goal: keep the order and wait for the scout to move on.
    const beside = s.map.tiles.find((t) => hexDistance(t, goal) === 1 && (q.pathTo(s, settler.id, t, content)?.length ?? 0) > 0)!;
    const next: GameState = { ...held, units: { ...held.units, [settler.id]: { ...settler, at: { q: beside.q, r: beside.r } } } };
    expect(stepOrder(next, 'p1', settler.id, { kind: 'goto', to: goal }, deps(next))).toEqual({ kind: 'wait' });
  });

  it('prunes orders of units that died or changed hands', () => {
    const s = newGame();
    const scout = unitOf(s, 'scout');
    const orders = withOrder(withOrder({}, scout.id, { kind: 'explore' }), 'u999', { kind: 'explore' });
    expect(Object.keys(pruneOrders(s, 'p1', orders))).toEqual([scout.id]);
    const same = withOrder({}, scout.id, { kind: 'explore' });
    expect(pruneOrders(s, 'p1', same)).toBe(same);
  });

  it('a soldier sent to a tile our own unit holds stops beside it; a settler waits', () => {
    const s0 = newGame();
    const warrior = unitOf(s0, 'warrior_band');
    // Put the settler on a land tile next to the warrior, then send the warrior onto it.
    const near = q.reachable(s0, warrior.id, content).map((r) => r.hex).find((h) => hexDistance(h, warrior.at) === 1)!;
    // A second soldier of ours holds the goal (one military unit per tile).
    const holder = { ...warrior, id: 'u_hold', at: near };
    const s: GameState = { ...s0, units: { ...s0.units, [holder.id]: holder } };
    const settler = holder;
    const soldier = { ...deps(s), needsExactTile: () => false };
    expect(stepOrder(s, 'p1', warrior.id, { kind: 'goto', to: settler.at }, soldier)).toEqual({ kind: 'done', reason: 'arrived' });
    // A unit that needs the tile itself (a settler on its site) keeps waiting beside it.
    const founder = { ...deps(s), needsExactTile: () => true };
    expect(stepOrder(s, 'p1', warrior.id, { kind: 'goto', to: settler.at }, founder)).toEqual({ kind: 'wait' });
  });

  it('stores orders per game seed and parses them back, dropping junk', () => {
    const raw = { games: { s7: { u1: { kind: 'goto', to: { q: 1, r: 2 } }, u2: { kind: 'explore' }, u3: { kind: 'goto' }, u4: 5 } } };
    expect(parseStoredOrders(raw, 7)).toEqual({ u1: { kind: 'goto', to: { q: 1, r: 2 } }, u2: { kind: 'explore' } });
    expect(parseStoredOrders(raw, 8)).toEqual({});
    expect(parseStoredOrders('nope', 7)).toEqual({});
    const both = storeOrders(raw, 8, { u9: { kind: 'explore' } });
    expect(parseStoredOrders(both, 7)).toEqual({ u1: { kind: 'goto', to: { q: 1, r: 2 } }, u2: { kind: 'explore' } });
    expect(parseStoredOrders(both, 8)).toEqual({ u9: { kind: 'explore' } });
    let many: unknown = null;
    for (let seed = STORED_GAMES_MAX + 3; seed >= 1; seed--) many = storeOrders(many, seed, { u1: { kind: 'explore' } });
    expect(Object.keys((many as { games: object }).games)).toHaveLength(STORED_GAMES_MAX);
    // The oldest written (largest seeds here) were dropped, the newest kept.
    expect(parseStoredOrders(many, STORED_GAMES_MAX + 3)).toEqual({});
    expect(parseStoredOrders(many, 1)).toEqual({ u1: { kind: 'explore' } });
  });

  it('keeps a walk-home order (recall on arrival) across a reload', () => {
    const stored = storeOrders(null, 3, { u5: { kind: 'goto', to: { q: 4, r: 4 }, recall: true }, u6: { kind: 'goto', to: { q: 1, r: 1 } } });
    expect(parseStoredOrders(JSON.parse(JSON.stringify(stored)), 3)).toEqual({
      u5: { kind: 'goto', to: { q: 4, r: 4 }, recall: true },
      u6: { kind: 'goto', to: { q: 1, r: 1 } },
    });
    // Only the literal flag counts.
    expect(parseStoredOrders({ games: { s3: { u5: { kind: 'goto', to: { q: 4, r: 4 }, recall: 'yes' } } } }, 3)).toEqual({ u5: { kind: 'goto', to: { q: 4, r: 4 } } });
  });

  it('estimates route turns from move costs', () => {
    const path = [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 }];
    expect(routeTurns(path, 2, 2, () => 1)).toBe(2);
    expect(routeTurns(path, 2, 2, () => 2)).toBe(4);
    expect(routeTurns([], 2, 2, () => 1)).toBe(0);
  });
});

describe('explore automation', () => {
  it('scouts and land soldiers explore; founders, traders and ships do not (wave 11)', () => {
    expect(canExplore(content.units.find((u) => u.id === 'scout'))).toBe(true);
    expect(canExplore(content.units.find((u) => u.id === 'settler'))).toBe(false);
    expect(canExplore(content.units.find((u) => u.id === 'merchant'))).toBe(false);
    expect(canExplore(content.units.find((u) => u.id === 'warrior_band'))).toBe(true);
    expect(canExplore(content.units.find((u) => u.id === 'war_canoe'))).toBe(false);
    expect(canExplore(content.units.find((u) => u.id === 'ram'))).toBe(false);
  });

  it('heads for the nearest explored land touching the unknown, and reveals new tiles', () => {
    let s = newGame();
    const scout = unitOf(s, 'scout');
    const before = s.players.p1!.explored.filter(Boolean).length;
    const frontier = frontierTiles(s, 'p1', scout.at, (t) => !!content.terrain.find((x) => x.id === t.terrain)?.water);
    expect(frontier.length).toBeGreaterThan(0);
    const t = exploreTarget(s, 'p1', scout.id, deps(s));
    expect(t).not.toBeNull();
    const step = stepOrder(s, 'p1', scout.id, { kind: 'explore' }, deps(s));
    expect(step.kind).toBe('move');
    if (step.kind === 'move') s = apply(s, { type: 'moveUnit', unit: scout.id, to: step.to });
    expect(s.players.p1!.explored.filter(Boolean).length).toBeGreaterThan(before);
  });

  it('stops when an enemy stands next to the explorer, and when nothing is left', () => {
    const s = newGame();
    const scout = unitOf(s, 'scout');
    const adj = { q: scout.at.q + 1, r: scout.at.r };
    const raider = { ...scout, id: 'r1', owner: 'raiders', at: adj, type: 'warrior_band', unitClass: 'infantry' as const };
    const raided: GameState = { ...s, units: { ...s.units, r1: raider } };
    expect(enemyAdjacent(raided, 'p1', scout.at, (a, b) => q.atWar(raided, a, b))).toBe(true);
    expect(stepOrder(raided, 'p1', scout.id, { kind: 'explore' }, deps(raided))).toEqual({ kind: 'done', reason: 'enemy' });
    // Everything explored: no frontier left.
    const all: GameState = { ...s, players: { ...s.players, p1: { ...s.players.p1!, explored: s.players.p1!.explored.map(() => 1) } } };
    expect(stepOrder(all, 'p1', scout.id, { kind: 'explore' }, deps(all))).toEqual({ kind: 'done', reason: 'explored' });
  });
});

describe('settler site hints', () => {
  it('names rivers, coast and nearby resources of a site', () => {
    const s = newGame();
    const settler = unitOf(s, 'settler');
    const sites = q.settleSites(s, settler.id, content);
    expect(sites.length).toBeGreaterThan(0);
    const f = siteFacts(s, sites[0]!.hex, content)!;
    expect(f.terrain.length).toBeGreaterThan(0);
    expect(siteSummary({ river: true, coast: true, hills: false, resources: ['Wine', 'Iron'], terrain: 'Plains' })).toBe(
      'fresh water from a river, the coast and Wine and Iron nearby',
    );
    expect(siteSummary({ river: false, coast: false, hills: false, resources: [], terrain: 'Plains' })).toBe('');
  });

  it('says where a site is in compass words', () => {
    const o = { q: 0, r: 0 };
    expect(directionWord(o, { q: 1, r: 0 })).toBe('east');
    expect(directionWord(o, { q: 1, r: -1 })).toBe('north-east');
    expect(directionWord(o, { q: 0, r: -1 })).toBe('north-west');
    expect(directionWord(o, { q: -1, r: 1 })).toBe('south-west');
    expect(whereWord(o, { q: 2, r: 0 })).toBe('2 tiles east');
    expect(shortWhere(o, { q: 0, r: 2 })).toBe('2 SE');
  });
});

describe('difficulty in setup', () => {
  it('passes the chosen difficulty to the sim and describes it plainly', () => {
    const setup = buildGameSetup({ ...choices, difficulty: 'hard' }, content.leaders.map((l) => l.id), content.dreams.map((d) => d.id));
    expect(setup.difficulty).toBe('hard');
    expect(buildGameSetup(choices, ['builder', 'sage'], ['pax', 'kleos']).difficulty).toBe('normal');
    expect(sim.createGame(setup, content).state.difficulty).toBe('hard');
    const y = { easy: -20, normal: 0, hard: 25 };
    const c = { easy: 0, normal: 0, hard: -15 };
    expect(difficultyNote('easy', y, c)).toMatch(/20% less/);
    expect(difficultyNote('normal', y, c)).toMatch(/even terms/);
    expect(difficultyNote('hard', y, c)).toMatch(/25% more.*15% cheaper/);
    expect(knownDifficulty('hard')).toBe('hard');
    expect(knownDifficulty('insane')).toBe('normal');
  });
});

describe('routes to tiles that cannot be entered', () => {
  it('marches beside the target instead, by the shortest route', async () => {
    const { routeBeside } = await import('../src/ui/shell/orders');
    const target = { q: 5, r: 5 };
    const lengths: Record<string, number> = { '6,5': 4, '5,6': 2, '4,6': 3 };
    const pathTo = (h: { q: number; r: number }) => {
      const n = lengths[`${h.q},${h.r}`];
      return n ? Array.from({ length: n }, () => h) : null;
    };
    expect(routeBeside(target, pathTo)?.to).toEqual({ q: 5, r: 6 });
    expect(routeBeside(target, () => null)).toBeNull();
  });
});

describe('end-turn safety check', () => {
  it('finds a unit with moves next to an enemy, ignoring fortified or spent ones', async () => {
    const { exposedUnit } = await import('../src/ui/shell/orders');
    const s = newGame();
    const warrior = unitOf(s, 'warrior_band');
    const hostile = (a: string, b: string) => q.atWar(s, a, b) || b === 'raiders' || a === 'raiders';
    expect(exposedUnit(s, 'p1', hostile)).toBeNull();
    const raider = { ...warrior, id: 'r1', owner: 'raiders', at: { q: warrior.at.q + 1, r: warrior.at.r } };
    const raided: GameState = { ...s, units: { ...s.units, r1: raider } };
    expect(exposedUnit(raided, 'p1', hostile)?.owner).toBe('p1');
    const dug: GameState = {
      ...raided,
      units: Object.fromEntries(Object.entries(raided.units).map(([k, u]) => [k, u.owner === 'p1' ? { ...u, fortified: true } : u])),
    };
    expect(exposedUnit(dug, 'p1', hostile)).toBeNull();
  });
});
