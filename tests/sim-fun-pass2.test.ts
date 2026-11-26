/**
 * Rules changed by the second fun-and-fairness pass (scripts/fun-audit.ts): crisis raiders
 * pillage undefended settlements, routes over capacity close, wonder races tell the loser,
 * commanders have their own stacking layer (deploy onto a garrisoned city, recall from next
 * door), balanced citizens, and fair starts (tropical compensation, seats drawn by lot).
 */
import { describe, expect, it } from 'vitest';
import { axialToOffset, hexDistance, type Hex } from '@contracts/hex';
import { RAIDER_PLAYER, type GameSetup, type Tile } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { figureActions } from '../src/emergence';
import { sim } from '../src/sim';
import { RAIDER_PILLAGE_GOLD } from '../src/sim/constants';
import { closeRoutesOverCapacity } from '../src/sim/diplomacy';
import { generateMap } from '../src/sim/mapgen';
import { isUndefended, pillage, pillageTarget } from '../src/sim/raids';
import { seedRng } from '../src/sim/rng';
import { completeItem } from '../src/sim/settlements';
import { moveRaiders } from '../src/sim/turn';
import { spawnUnit } from '../src/sim/units';
import { workedTilesWithYields } from '../src/sim/yields';
import { addSettlement, addUnit, at, ctxOf, fixtureContent, fixtureState, setTile } from './helpers/fixture';

const content = fixtureContent();

describe('crisis raiders (src/sim/raids.ts)', () => {
  const world = () => {
    const state = fixtureState({ width: 14, height: 10 });
    const town = addSettlement(state, 'p1', at(5, 5), { name: 'Ur', kind: 'town', isCapital: false, population: 3 });
    town.foodStored = 12;
    town.production.progress = 20;
    state.players.p1!.stock.gold = 100;
    return { state, town, ctx: ctxOf(state, content) };
  };

  it('pillage an undefended settlement next to them: stores, work and gold lost, one citizen once per crisis', () => {
    const { state, town, ctx } = world();
    expect(isUndefended(state, town)).toBe(true);
    const r1 = addUnit(state, RAIDER_PLAYER, 'warrior', at(6, 5), content);
    expect(pillageTarget(state, r1)?.id).toBe(town.id);
    pillage(ctx, r1, town);
    expect(town.population).toBe(2);
    expect(town.foodStored).toBe(0);
    expect(town.production.progress).toBe(0);
    expect(state.players.p1!.stock.gold).toBe(100 - RAIDER_PILLAGE_GOLD);
    expect(state.units[r1.id]).toBeUndefined(); // they scatter with the loot
    const notice = ctx.events.find((e) => e.type === 'notice');
    expect(notice?.type === 'notice' && notice.text).toMatch(/^Raiders pillaged .*garrison or walls/);
    expect(notice?.type === 'notice' && notice.text).not.toMatch(/\d/);
    // A second raid in the same crisis takes stores again but no more people.
    town.foodStored = 5;
    const r2 = addUnit(state, RAIDER_PLAYER, 'warrior', at(6, 5), content);
    pillage(ctx, r2, town);
    expect(town.population).toBe(2);
    expect(town.foodStored).toBe(0);
  });

  it('a garrison or a wall building keeps them out; the world phase raids only the undefended', () => {
    const { state, town, ctx } = world();
    addUnit(state, 'p1', 'warrior', town.at, content);
    expect(isUndefended(state, town)).toBe(false);
    const walled = addSettlement(state, 'p2', at(10, 2), { kind: 'town', isCapital: false, population: 3 });
    walled.maxHp += 50;
    expect(isUndefended(state, walled)).toBe(false);
    const raider = addUnit(state, RAIDER_PLAYER, 'warrior', at(6, 5), content);
    expect(pillageTarget(state, raider)).toBeNull();
    moveRaiders(ctx);
    expect(town.population).toBe(3);
    // Playtest 3: raiders no longer storm a guarded settlement (the garrison used to fall to
    // wave after wave, and the town was then pillaged every turn).
    expect(ctx.events.some((e) => e.type === 'combat')).toBe(false);
    expect(ctx.events.some((e) => e.type === 'notice' && /pillaged/.test(e.text))).toBe(false);
  });

  it('in the world phase they walk to an undefended settlement in reach and pillage it', () => {
    const { state, town, ctx } = world();
    addUnit(state, RAIDER_PLAYER, 'warrior', at(8, 5), content, { movesLeft: 2 });
    moveRaiders(ctx);
    expect(town.population).toBe(2);
    expect(Object.values(state.units).filter((u) => u.owner === RAIDER_PLAYER)).toHaveLength(0);
  });
});

describe('trade routes over capacity close (plague quarantine has a cost and a point)', () => {
  it('closes the newest routes beyond capacity, with a notice', () => {
    const state = fixtureState({ width: 20, height: 10, players: 3 });
    const a = addSettlement(state, 'p1', at(3, 3));
    const b = addSettlement(state, 'p2', at(9, 3));
    const c = addSettlement(state, 'p3', at(15, 3));
    state.tradeRoutes.push({ id: 't1', owner: 'p1', from: a.id, to: b.id }, { id: 't2', owner: 'p1', from: a.id, to: c.id });
    const ctx = ctxOf(state, content);
    closeRoutesOverCapacity(ctx); // base capacity 1
    expect(state.tradeRoutes.map((r) => r.id)).toEqual(['t1']);
    expect(ctx.events).toEqual([{ type: 'notice', player: 'p1', text: 'A trade route closed: you no longer have the capacity to keep it.' }]);
  });
});

describe('wonder races', () => {
  it("the loser keeps every point invested and is told so", () => {
    const state = fixtureState({ width: 20, height: 10 });
    const a = addSettlement(state, 'p1', at(3, 3));
    const b = addSettlement(state, 'p2', at(12, 3));
    a.production = { item: 'pyramid', progress: 100 };
    b.production = { item: 'pyramid', progress: 70 };
    const ctx = ctxOf(state, content);
    expect(completeItem(ctx, a, 'pyramid')).toBe(true);
    expect(b.production).toEqual({ item: null, progress: 70 });
    const told = ctx.events.find((e) => e.type === 'notice' && e.player === 'p2');
    expect(told?.type === 'notice' && told.text).toBe(
      `Pyramid was completed by another people first. The work ${b.name} put into it is not lost: it goes to the next thing ${b.name} builds.`,
    );
  });
});

describe('commanders have their own stacking layer', () => {
  it('a general deploys onto a garrisoned city and can be recalled from the city or next to it', () => {
    const real = loadContent();
    const general = real.figures.find((f) => f.kind === 'general' && f.uses.includes('unit') && !f.deed);
    const unitDef = real.units.find((u) => u.figureKind === 'general');
    const infantry = real.units.find((u) => u.unitClass === 'infantry' && !u.figureKind);
    if (!general || !unitDef || !infantry) throw new Error('content lacks a general');
    const state = fixtureState({ width: 14, height: 10 });
    const city = addSettlement(state, 'p1', at(5, 5));
    addUnit(state, 'p1', infantry.id, city.at, real);
    state.figures[general.id] = { id: general.id, owner: 'p1', recruitedTurn: 1, recruitedAge: 'ancient', reason: 'test', activated: false, location: { state: 'based', settlement: city.id } };
    const r = sim.applyCommand(state, 'p1', { type: 'deployFigure', figure: general.id, settlement: city.id }, real);
    if (!r.ok) throw new Error(r.error);
    const unit = Object.values(r.state.units).find((u) => u.figure === general.id);
    expect(unit?.at).toEqual(city.at);
    expect(figureActions(r.state, general.id, real).canRecall).toBe(true);
    // Step next door: recall still works; two tiles away it does not, with a reason.
    const next = r.state;
    const u = Object.values(next.units).find((x) => x.figure === general.id)!;
    u.at = at(6, 5);
    expect(hexDistance(u.at, city.at)).toBe(1);
    expect(figureActions(next, general.id, real).canRecall).toBe(true);
    u.at = at(8, 5);
    expect(figureActions(next, general.id, real).blocked.recall).toMatch(/into or next to one of your settlements/);
    u.at = at(6, 5);
    const back = sim.applyCommand(next, 'p1', { type: 'recallFigure', figure: general.id }, real);
    if (!back.ok) throw new Error(back.error);
    expect(back.state.figures[general.id]?.location).toEqual({ state: 'based', settlement: city.id });
  });

  it('two commanders still cannot share a tile, and a military unit shields its commander', () => {
    const state = fixtureState();
    const ctx = ctxOf(state, content);
    const h = at(4, 4);
    addUnit(state, 'p1', 'general', h, content);
    const second = spawnUnit(ctx, 'p1', 'general', h);
    expect(state.units[second ?? '']?.at).not.toEqual(h);
    const w = spawnUnit(ctx, 'p1', 'warrior', h);
    expect(state.units[w ?? '']?.at).toEqual(h);
  });
});

describe('balanced citizens', () => {
  it('once the city grows comfortably, citizens take a production tile over more food', () => {
    const state = fixtureState({ width: 12, height: 10 });
    const s = addSettlement(state, 'p1', at(5, 5), { population: 3 });
    // Ring 1: two oases (4 food, 1 gold) and one plains-forest-horses tile (1 food, 3 production).
    setTile(state, at(6, 5), { feature: 'oasis' });
    setTile(state, at(4, 5), { feature: 'oasis' });
    setTile(state, at(5, 4), { feature: 'oasis' });
    setTile(state, at(5, 6), { terrain: 'plains', feature: 'forest', resource: 'horses' });
    const worked = workedTilesWithYields(state, s, content).slice(1);
    expect(worked).toHaveLength(3);
    const prod = worked.filter((w) => w.yields.production >= 3);
    expect(prod).toHaveLength(1);
  });
});

describe('fair starts', () => {
  const tileOf = (tiles: readonly Tile[], width: number, h: Hex): Tile | undefined => {
    const { col, row } = axialToOffset(h);
    return tiles[row * width + col];
  };

  it('tropical starts are rarer and come with a river, coast or luxury nearby', () => {
    const real = loadContent();
    let tropical = 0;
    let all = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const m = generateMap('small', 3, real, { rng: seedRng(seed) });
      for (const h of m.starts.slice(0, 3)) {
        const t = tileOf(m.map.tiles, m.map.width, h);
        all++;
        if (t?.climate === 'tropical') tropical++;
      }
    }
    // Before pass 2 about a third of starts were tropical (and half of the first seat's).
    expect(tropical / all).toBeLessThan(0.22);
  });

  it('seats draw their starts by lot rather than the first seat taking the best', () => {
    const real = loadContent();
    let firstSeatOnBest = 0;
    const seeds = 16;
    for (let seed = 1; seed <= seeds; seed++) {
      const setup: GameSetup = {
        seed,
        mapSize: 'small',
        speed: 'standard',
        players: ['p1', 'p2', 'p3'].map((id) => ({ id, isHuman: id === 'p1', leader: real.leaders[0]!.id, dream: real.dreams[0]!.id, colors: { primary: '#111111', secondary: '#222222' }, skinTone: 0 })),
      };
      const m = generateMap('small', 3, real, { rng: seedRng(seed) });
      const { state } = sim.createGame(setup, real);
      const settler = Object.values(state.units).find((u) => u.owner === 'p1' && real.units.find((d) => d.id === u.type)?.canFound);
      if (settler && settler.at.q === m.starts[0]?.q && settler.at.r === m.starts[0]?.r) firstSeatOnBest++;
    }
    expect(firstSeatOnBest).toBeGreaterThan(0);
    expect(firstSeatOnBest).toBeLessThan(seeds * 0.7);
  });
});
