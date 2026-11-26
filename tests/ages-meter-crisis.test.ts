import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hexDistance } from '@contracts/hex';
import { RAIDER_PLAYER } from '@contracts/sim-api';
import { addAgeProgress, agesWorldPhase, handleAgesCommand } from '../src/sim/ages';
import {
  METER_PER_TURN,
  POP_LOSS_INTERVAL,
  POP_LOSS_INTERVAL_WITH_TRADE,
  RAIDER_CAP_PER_PLAYER,
  RAIDER_SPAWN_INTERVAL,
} from '../src/sim/ages/constants';
import { crisisResponseBlocked, raiderSpawnTiles, raiderUnitType } from '../src/sim/ages/crisis';
import {
  addSettlement,
  eventsOf,
  fixtureContent,
  makeCtx,
  makeState,
  player,
  resetFakes,
  spawnUnit,
  tileIndexAt,
} from './helpers/ages';

vi.mock('../src/emergence', async () => await import('./helpers/ages'));
vi.mock('../src/sim/stats', async () => await import('./helpers/ages'));
vi.mock('../src/sim/units', async () => await import('./helpers/ages'));

beforeEach(resetFakes);

describe('age meter', () => {
  it('adds, clamps to 0–100 and emits ageProgress', () => {
    const ctx = makeCtx(makeState());
    addAgeProgress(ctx, 4);
    expect(ctx.state.ageProgress).toBe(4);
    addAgeProgress(ctx, 500);
    expect(ctx.state.ageProgress).toBe(100);
    addAgeProgress(ctx, -1000);
    expect(ctx.state.ageProgress).toBe(0);
    expect(eventsOf(ctx, 'ageProgress').map((e) => e.value)).toEqual([4, 100, 0]);
  });

  it('does nothing outside play', () => {
    const ctx = makeCtx(makeState(undefined, { phase: 'transition', ageProgress: 10 }));
    addAgeProgress(ctx, 5);
    expect(ctx.state.ageProgress).toBe(10);
    expect(ctx.events).toEqual([]);
    agesWorldPhase(ctx);
    expect(ctx.state.ageProgress).toBe(10);
  });

  it('keeps fractional gains to two decimals', () => {
    const ctx = makeCtx(makeState());
    addAgeProgress(ctx, 0.5);
    addAgeProgress(ctx, 0.1 + 0.2);
    expect(ctx.state.ageProgress).toBe(0.8);
  });

  it.each([
    ['quick', 35],
    ['standard', 50],
    ['epic', 75],
  ] as const)('%s speed: per-turn gain alone covers ~half the meter in %i turns', (speed, turns) => {
    const state = makeState(undefined, { speed });
    // Drop crises so the run measures pacing only.
    const content = { ...fixtureContent(), crises: [] };
    const ctx = makeCtx(state, content);
    for (let i = 0; i < turns; i++) agesWorldPhase(ctx);
    expect(state.ageProgress).toBeGreaterThan(46);
    expect(state.ageProgress).toBeLessThan(54);
    expect(Math.abs(METER_PER_TURN[speed] * turns - 50)).toBeLessThan(1);
  });
});

describe('crisis', () => {
  it('starts at 70 with the current age crisis and fires stage 1 with every living player awaiting', () => {
    const state = makeState(undefined, { ageProgress: 68.5 });
    player(state, 'p3').alive = false;
    const ctx = makeCtx(state);
    agesWorldPhase(ctx);
    expect(state.ageProgress).toBe(69.5);
    expect(state.crisis).toBeNull();
    agesWorldPhase(ctx);
    expect(state.crisis).toEqual({ id: 'collapse', stage: 1, awaiting: ['p1', 'p2'] });
    expect(eventsOf(ctx, 'crisisStarted')).toEqual([{ type: 'crisisStarted', crisis: 'collapse' }]);
    expect(eventsOf(ctx, 'crisisStage')).toEqual([{ type: 'crisisStage', crisis: 'collapse', stage: 1 }]);
  });

  it('skips when the age has no crisis', () => {
    const state = makeState(undefined, { ageProgress: 75 });
    const ctx = makeCtx(state, { ...fixtureContent(), crises: [] });
    agesWorldPhase(ctx);
    expect(state.crisis).toBeNull();
  });

  it('fires stages 2 and 3 as the meter passes 80 and 90, one per world phase', () => {
    const state = makeState(undefined, { ageProgress: 69 });
    const ctx = makeCtx(state);
    agesWorldPhase(ctx);
    expect(state.crisis?.stage).toBe(1);
    state.ageProgress = 95;
    agesWorldPhase(ctx);
    expect(state.crisis?.stage).toBe(2);
    agesWorldPhase(ctx);
    expect(state.crisis?.stage).toBe(3);
    agesWorldPhase(ctx);
    expect(state.crisis?.stage).toBe(3);
    expect(eventsOf(ctx, 'crisisStage').map((e) => e.stage)).toEqual([1, 2, 3]);
  });

  describe('responses', () => {
    const atStage1 = () => {
      const state = makeState(undefined, { ageProgress: 69 });
      const ctx = makeCtx(state);
      agesWorldPhase(ctx);
      return { state, ctx };
    };

    it('applies stock deltas, records the choice, leaves awaiting, writes the chronicle', () => {
      const { state, ctx } = atStage1();
      player(state, 'p1').stock.gold = 30;
      expect(handleAgesCommand(ctx, 'p1', { type: 'chooseCrisisResponse', option: 'collapse_a1' })).toBeNull();
      const p = player(state, 'p1');
      expect(p.stock.gold).toBe(0);
      expect(p.crisisChoices).toEqual(['collapse_a1']);
      expect(p.effects).toEqual([]);
      expect(state.crisis?.awaiting).toEqual(['p2', 'p3']);
      expect(p.chronicle.at(-1)?.kind).toBe('crisis');
    });

    // Playtest 3: "Pay tribute −40 gold" was accepted with 18 gold in the treasury.
    it('refuses a response the player cannot pay while another is affordable, in plain words', () => {
      const { state, ctx } = atStage1();
      player(state, 'p1').stock.gold = 18;
      expect(crisisResponseBlocked(state, 'p1', 'collapse_a1', ctx.content)).toBe('collapse_a1 costs 30 gold; you have 18. Choose another response.');
      expect(crisisResponseBlocked(state, 'p1', 'collapse_b1', ctx.content)).toBeNull();
      const err = handleAgesCommand(ctx, 'p1', { type: 'chooseCrisisResponse', option: 'collapse_a1' });
      expect(err).toMatch(/costs 30 gold; you have 18/);
      expect(player(state, 'p1').stock.gold).toBe(18);
      expect(state.crisis?.awaiting).toContain('p1');
      expect(handleAgesCommand(ctx, 'p1', { type: 'chooseCrisisResponse', option: 'collapse_b1' })).toBeNull();
    });

    it('when neither response is affordable, only the cheaper one is allowed and takes what the player has', () => {
      const content = fixtureContent();
      const stage = content.crises[0]?.stages[0];
      const b1 = stage?.options[1];
      if (!b1) throw new Error('fixture');
      b1.stock = { gold: -50 };
      const state = makeState(undefined, { ageProgress: 69 });
      const ctx = makeCtx(state, content);
      agesWorldPhase(ctx);
      player(state, 'p1').stock.gold = 10;
      expect(crisisResponseBlocked(state, 'p1', 'collapse_b1', content)).toMatch(/afford neither response; collapse_a1 takes what you have/);
      expect(handleAgesCommand(ctx, 'p1', { type: 'chooseCrisisResponse', option: 'collapse_b1' })).not.toBeNull();
      expect(handleAgesCommand(ctx, 'p1', { type: 'chooseCrisisResponse', option: 'collapse_a1' })).toBeNull();
      expect(player(state, 'p1').stock.gold).toBe(0);
    });

    it('adds the option modifiers as a TimedEffect lasting until the age ends', () => {
      const { state, ctx } = atStage1();
      expect(handleAgesCommand(ctx, 'p2', { type: 'chooseCrisisResponse', option: 'collapse_b1' })).toBeNull();
      expect(player(state, 'p2').effects).toEqual([
        { source: 'crisis:collapse_b1', untilTurn: -1, modifiers: fixtureContent().crises[0]?.stages[0]?.options[1]?.modifiers },
      ]);
      expect(player(state, 'p2').stock.gold).toBe(100);
    });

    it('rejects a second answer, an option of another stage, and when no crisis is active', () => {
      const { ctx } = atStage1();
      expect(handleAgesCommand(ctx, 'p1', { type: 'chooseCrisisResponse', option: 'collapse_a2' })).toMatch(/not an option/);
      expect(handleAgesCommand(ctx, 'p1', { type: 'chooseCrisisResponse', option: 'collapse_a1' })).toBeNull();
      expect(handleAgesCommand(ctx, 'p1', { type: 'chooseCrisisResponse', option: 'collapse_b1' })).toMatch(/No crisis response/);
      const calm = makeCtx(makeState());
      expect(handleAgesCommand(calm, 'p1', { type: 'chooseCrisisResponse', option: 'collapse_a1' })).toMatch(/No crisis is under way/);
    });
  });

  describe('raiders', () => {
    const setup = () => {
      const state = makeState(['p1', 'p2'], { ageProgress: 72, crisis: { id: 'collapse', stage: 1, awaiting: [] } });
      addSettlement(state, 's1', 'p1', 4, 4);
      addSettlement(state, 's2', 'p2', 11, 11);
      return { state, ctx: makeCtx(state) };
    };

    it('picks the current-age infantry, falling back to earlier ages', () => {
      const { state, ctx } = setup();
      expect(raiderUnitType(ctx)?.id).toBe('warrior_band');
      state.age = 'classical';
      expect(raiderUnitType(ctx)?.id).toBe('spearman');
      state.age = 'exploration';
      expect(raiderUnitType(ctx)?.id).toBe('spearman');
    });

    it('spawn tiles are unowned passable land 3–5 tiles away with no unit', () => {
      const { state, ctx } = setup();
      const center = state.settlements['s1']!.at;
      const blockedTile = state.map.tiles.find((t) => hexDistance(t, center) === 3)!;
      blockedTile.terrain = 'ocean';
      const owned = state.map.tiles.find((t) => hexDistance(t, center) === 4 && t !== blockedTile)!;
      owned.owner = 'p1';
      const tiles = raiderSpawnTiles(ctx, center);
      expect(tiles.length).toBeGreaterThan(0);
      for (const h of tiles) {
        const d = hexDistance(h, center);
        expect(d).toBeGreaterThanOrEqual(3);
        expect(d).toBeLessThanOrEqual(5);
        const tile = state.map.tiles[tileIndexAt(state, h)]!;
        expect(tile.owner).toBeNull();
        expect(tile.terrain).toBe('grassland');
      }
    });

    it('spawns one raider per living player on interval turns, up to the cap', () => {
      const { state, ctx } = setup();
      state.turn = RAIDER_SPAWN_INTERVAL * 5 + 1;
      agesWorldPhase(ctx);
      expect(spawnUnit).not.toHaveBeenCalled();
      for (let i = 0; i < 4; i++) {
        state.turn = RAIDER_SPAWN_INTERVAL * (10 + i);
        agesWorldPhase(ctx);
      }
      const raiders = Object.values(state.units).filter((u) => u.owner === RAIDER_PLAYER);
      expect(raiders).toHaveLength(RAIDER_CAP_PER_PLAYER * 2);
      expect(raiders.every((u) => u.type === 'warrior_band')).toBe(true);
      expect(spawnUnit.mock.calls[0]?.[1]).toBe(RAIDER_PLAYER);
    });

    it('is deterministic for the same state', () => {
      const a = setup();
      const b = setup();
      a.state.turn = b.state.turn = RAIDER_SPAWN_INTERVAL * 7;
      agesWorldPhase(a.ctx);
      agesWorldPhase(b.ctx);
      expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    });
  });

  describe('popLoss', () => {
    const setup = () => {
      const state = makeState(['p1', 'p2'], {
        age: 'classical',
        ageProgress: 72,
        crisis: { id: 'plague', stage: 1, awaiting: [] },
      });
      addSettlement(state, 's1', 'p1', 2, 2, { population: 5 });
      addSettlement(state, 's2', 'p1', 6, 2, { population: 2 });
      addSettlement(state, 's3', 'p2', 10, 10, { population: 5 });
      return { state, ctx: makeCtx(state) };
    };

    it('takes 1 pop every 10 turns from settlements above 2', () => {
      const { state, ctx } = setup();
      state.turn = POP_LOSS_INTERVAL * 3 + 5;
      agesWorldPhase(ctx);
      expect(state.settlements['s1']?.population).toBe(5);
      state.turn = POP_LOSS_INTERVAL * 4;
      agesWorldPhase(ctx);
      expect(state.settlements['s1']?.population).toBe(4);
      expect(state.settlements['s2']?.population).toBe(2);
      expect(state.settlements['s3']?.population).toBe(4);
    });

    it('spreads faster to players with trade routes', () => {
      const { state, ctx } = setup();
      state.tradeRoutes.push({ id: 'r1', owner: 'p2', from: 's3', to: 's3' });
      state.turn = POP_LOSS_INTERVAL_WITH_TRADE * 3; // 15: not a multiple of 10
      agesWorldPhase(ctx);
      expect(state.settlements['s1']?.population).toBe(5);
      expect(state.settlements['s3']?.population).toBe(4);
    });
  });

  it('unrest: unhappy players lose production progress', () => {
    const content = fixtureContent();
    content.crises = [{ ...content.crises[0]!, behaviors: ['unrest'] }];
    const state = makeState(['p1', 'p2'], { ageProgress: 72, crisis: { id: 'collapse', stage: 1, awaiting: [] } });
    addSettlement(state, 's1', 'p1', 2, 2, { production: { item: 'x', progress: 40 } });
    addSettlement(state, 's2', 'p2', 8, 8, { production: { item: 'x', progress: 40 } });
    player(state, 'p1').happiness = -3;
    agesWorldPhase(makeCtx(state, content));
    expect(state.settlements['s1']?.production.progress).toBe(30);
    expect(state.settlements['s2']?.production.progress).toBe(40);
  });
});
