/**
 * Settler hints (`queries.settleSites`, GDD §7 "Settlements") and multi-turn paths
 * (`queries.pathTo`): one founding rule shared with `foundSettlement`, one site score shared
 * with the AI, and paths whose first leg always ends on a `reachable` tile.
 */
import { describe, expect, it } from 'vitest';
import { hexDistance, hexNeighbors, type Hex } from '@contracts/hex';
import { warKey, type Command, type GameSetup, type GameState } from '@contracts/sim-api';
import { performance } from 'node:perf_hooks';
import { loadContent } from '../src/content';
import { runAiTurn } from '../src/ai';
import { applyCommand, createGame, queries, sim } from '../src/sim';
import { SETTLE_SITE_MAX, SETTLE_SITE_RANGE } from '../src/sim/constants';
import { tileIndex } from '../src/sim/lookup';
import { canFoundAt, foundSiteError } from '../src/sim/settlements';
import { siteScorer } from '../src/sim/sites';
import { findPaths, planPath } from '../src/sim/units';
import { addSettlement, addUnit, at, fixtureContent, fixtureState, setTile } from './helpers/fixture';

const content = fixtureContent();

const exploreAll = (state: GameState): void => {
  for (const p of Object.values(state.players)) p.explored.fill(1);
};

const run = (state: GameState, player: string, command: Command): ReturnType<typeof applyCommand> => applyCommand(state, player, command, content);

describe('settleSites', () => {
  it('lists explored, legal sites within range, best first and capped; empty for non-settlers', () => {
    const state = fixtureState({ width: 20, height: 20 });
    exploreAll(state);
    addSettlement(state, 'p2', at(4, 4));
    const settler = addUnit(state, 'p1', 'settler', at(10, 10), content);
    const warrior = addUnit(state, 'p1', 'warrior', at(11, 10), content);
    const sites = queries.settleSites(state, settler.id, content);
    expect(sites.length).toBe(SETTLE_SITE_MAX);
    for (const s of sites) {
      expect(canFoundAt(state, 'p1', s.hex, content)).toBe(true);
      expect(hexDistance(s.hex, settler.at)).toBeLessThanOrEqual(SETTLE_SITE_RANGE);
    }
    for (let i = 1; i < sites.length; i++) expect(sites[i - 1]!.score).toBeGreaterThanOrEqual(sites[i]!.score);
    expect(queries.settleSites(state, warrior.id, content)).toEqual([]);
    expect(queries.settleSites(state, 'nope', content)).toEqual([]);
    // Unexplored tiles are never suggested.
    state.players.p1!.explored.fill(0);
    state.players.p1!.explored[tileIndex(state.map, settler.at)] = 1;
    expect(queries.settleSites(state, settler.id, content).map((s) => s.hex)).toEqual([settler.at]);
  });

  it('shares the founding rule with foundSettlement, whose errors say why', () => {
    const state = fixtureState();
    exploreAll(state);
    addSettlement(state, 'p2', at(2, 2));
    const near = addUnit(state, 'p1', 'settler', at(4, 2), content);
    expect(foundSiteError(state, 'p1', near.at, content)).toBe('That tile is too close to another settlement.');
    expect(queries.settleSites(state, near.id, content).some((s) => hexDistance(s.hex, at(2, 2)) <= 3)).toBe(false);
    const r = run(state, 'p1', { type: 'foundSettlement', unit: near.id });
    expect(r.ok ? null : r.error).toBe('That tile is too close to another settlement.');
    setTile(state, at(8, 8), { terrain: 'mountain' });
    expect(foundSiteError(state, 'p1', at(8, 8), content)).toBe('Settlements cannot be founded on impassable terrain.');
    setTile(state, at(9, 8), { terrain: 'coast' });
    expect(foundSiteError(state, 'p1', at(9, 8), content)).toBe('Settlements cannot be founded on water.');
  });

  it('scores fresh water, hills, new luxuries and food; penalizes claimed land and enemies at war', () => {
    const state = fixtureState({ width: 24, height: 16 });
    exploreAll(state);
    const site = at(8, 8);
    const idx = tileIndex(state.map, site);
    const score = (): number => siteScorer(state, 'p1', content)(idx);
    const base = score();
    setTile(state, site, { river: true });
    const river = score();
    expect(river).toBeGreaterThan(base);
    setTile(state, site, { feature: 'hills' });
    expect(score()).toBeGreaterThan(river);
    const before = score();
    setTile(state, at(9, 8), { resource: 'silk' });
    const withLuxury = score();
    expect(withLuxury).toBeGreaterThan(before);
    // A luxury the player already owns adds only its tile yield, not the "new luxury" bonus.
    setTile(state, at(20, 2), { resource: 'silk', owner: 'p1' });
    expect(score()).toBeLessThan(withLuxury);
    setTile(state, at(20, 2), { resource: null, owner: null });
    const plain = score();
    setTile(state, at(7, 8), { terrain: 'desert' });
    expect(score()).toBeLessThan(plain);
    setTile(state, at(7, 8), { terrain: 'grassland' });
    // Someone else's border in reach: those tiles are lost.
    addSettlement(state, 'p2', at(11, 8));
    const crowded = score();
    expect(crowded).toBeLessThan(plain);
    state.wars[warKey('p1', 'p2')] = 1;
    expect(score()).toBeLessThan(crowded);
  });
});

describe('pathTo (fixture)', () => {
  it('walks straight on open land and around a mountain wall through its gap', () => {
    const state = fixtureState({ width: 14, height: 10 });
    exploreAll(state);
    const u = addUnit(state, 'p1', 'warrior', at(1, 5), content);
    const target = at(9, 5);
    const straight = queries.pathTo(state, u.id, target, content);
    expect(straight?.length).toBe(hexDistance(u.at, target));
    for (let row = 0; row < 10; row++) if (row !== 8) setTile(state, at(5, row), { terrain: 'mountain' });
    const around = queries.pathTo(state, u.id, target, content);
    expect(around).not.toBeNull();
    expect(around).toContainEqual(at(5, 8));
    let prev: Hex = u.at;
    for (const h of around ?? []) {
      expect(hexNeighbors(prev)).toContainEqual(h);
      expect(state.map.tiles[tileIndex(state.map, h)]?.terrain).not.toBe('mountain');
      prev = h;
    }
    expect(prev).toEqual(target);
    expect(queries.pathTo(state, u.id, target, content)).toEqual(around);
  });

  it('is null for the own tile, unexplored, impassable or enemy-held targets; detours round visible enemies', () => {
    const state = fixtureState({ width: 14, height: 10 });
    exploreAll(state);
    const u = addUnit(state, 'p1', 'warrior', at(1, 5), content);
    expect(queries.pathTo(state, u.id, u.at, content)).toBeNull();
    setTile(state, at(6, 6), { terrain: 'mountain' });
    expect(queries.pathTo(state, u.id, at(6, 6), content)).toBeNull();
    // Within sight (vision 2): known, so it blocks. Out of sight it would not (no hidden information).
    const enemy = addUnit(state, 'p2', 'warrior', at(3, 5), content);
    expect(queries.pathTo(state, u.id, enemy.at, content)).toBeNull();
    const hidden = addUnit(state, 'p2', 'warrior', at(10, 5), content);
    expect(queries.pathTo(state, u.id, hidden.at, content)?.at(-1)).toEqual(hidden.at);
    const detour = queries.pathTo(state, u.id, at(7, 5), content);
    expect(detour).not.toBeNull();
    expect(detour).not.toContainEqual(enemy.at);
    state.players.p1!.explored[tileIndex(state.map, at(12, 2))] = 0;
    expect(queries.pathTo(state, u.id, at(12, 2), content)).toBeNull();
  });

  it('passes through but never stops on a tile its own unit of the same layer holds', () => {
    const state = fixtureState({ width: 10, height: 6 });
    exploreAll(state);
    for (let row = 0; row < 6; row++) if (row !== 3) setTile(state, at(4, row), { terrain: 'mountain' });
    const u = addUnit(state, 'p1', 'warrior', at(1, 3), content, { movesLeft: 1 });
    addUnit(state, 'p1', 'slinger', at(4, 3), content);
    const plan = planPath(state, u, tileIndex(state.map, at(7, 3)), content);
    expect(plan).not.toBeNull();
    // The friendly-held gap is entered with moves to spare, never as a turn's last tile.
    const gap = plan?.tiles.indexOf(tileIndex(state.map, at(4, 3))) ?? -1;
    expect(gap).toBeGreaterThan(0);
    expect(plan?.turns[gap + 1]).toBe(plan?.turns[gap]);
  });
});

const realSetup = (seed: number, mapSize: GameSetup['mapSize']): GameSetup => {
  const real = loadContent();
  return {
    seed,
    mapSize,
    speed: 'quick',
    players: ['p1', 'p2', 'p3'].map((id, i) => ({
      id,
      isHuman: false,
      leader: real.leaders[(seed + i) % real.leaders.length]?.id ?? '',
      dream: real.dreams[(seed + i) % real.dreams.length]?.id ?? '',
      colors: { primary: '#000', secondary: '#fff' },
      skinTone: 0,
    })),
  };
};

describe('pathTo on real games', () => {
  const real = loadContent();
  it('first leg ends on a reachable tile, every tile explored and adjacent, deterministic and fast', () => {
    let checked = 0;
    let time = 0;
    let calls = 0;
    for (const [seed, size] of [[3, 'small'], [8, 'small'], [21, 'standard']] as const) {
      let state = createGame(realSetup(seed, size), real).state;
      for (let i = 0; i < 3 * 25 && state.phase === 'playing'; i++) state = runAiTurn(state, state.currentPlayer, real, sim).state;
      const pid = state.currentPlayer;
      const explored = state.players[pid]!.explored.flatMap((v, i) => (v ? [i] : []));
      let k = seed;
      for (const u of Object.values(state.units).filter((x) => x.owner === pid)) {
        const reach = new Set(findPaths(state, u, real).endable);
        for (let n = 0; n < 25; n++) {
          k = (k * 1103515245 + 12345) % 2147483648;
          const target = explored[k % explored.length] ?? 0;
          const t0 = performance.now();
          const plan = planPath(state, u, target, real);
          time += performance.now() - t0;
          calls++;
          if (reach.has(target)) expect(plan?.turns.every((t) => t === 0)).toBe(true);
          if (!plan) continue;
          checked++;
          expect(plan.tiles.at(-1)).toBe(target);
          let prev = u.at;
          for (const i of plan.tiles) {
            expect(state.players[pid]!.explored[i]).toBe(1);
            const h = state.map.tiles[i]!;
            expect(hexDistance(prev, h)).toBe(1);
            prev = { q: h.q, r: h.r };
          }
          for (let j = 1; j < plan.turns.length; j++) expect(plan.turns[j]).toBeGreaterThanOrEqual(plan.turns[j - 1]!);
          const firstLeg = plan.tiles.filter((_, j) => plan.turns[j] === 0);
          const last = firstLeg.at(-1);
          if (last !== undefined) {
            expect(reach.has(last)).toBe(true);
            // …so the UI's moveUnit to it is accepted.
            const r = applyCommand(state, pid, { type: 'moveUnit', unit: u.id, to: state.map.tiles[last]! }, real);
            expect(r.ok).toBe(true);
          }
          expect(planPath(state, u, target, real)).toEqual(plan);
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(time / calls).toBeLessThan(3);
  }, 60_000);

  it('settleSites stays well under budget on a real map', () => {
    const state = createGame(realSetup(5, 'small'), real).state;
    const settler = Object.values(state.units).find((u) => u.owner === 'p1' && real.units.find((d) => d.id === u.type)?.canFound);
    expect(settler).toBeDefined();
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) queries.settleSites(state, settler?.id ?? '', real);
    expect((performance.now() - t0) / 20).toBeLessThan(2);
    const sites = queries.settleSites(state, settler?.id ?? '', real);
    expect(sites.length).toBeGreaterThan(0);
    // Founding at the best explored site within reach is accepted by the sim.
    const best = sites[0]!;
    expect(foundSiteError(state, 'p1', best.hex, real)).toBeNull();
  });
});
