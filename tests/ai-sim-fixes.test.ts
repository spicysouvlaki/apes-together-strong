/**
 * Sim rules changed by the autoplay hardening pass (AI workstream), on real content:
 * - no figure offers for a player without a settlement (they could never be accepted and
 *   blocked endTurn forever); leftovers are withdrawn;
 * - gold upkeep for military units beyond a free allowance, desertion when the treasury is empty;
 * - legacy milestones count per-age battles and activations;
 * - achievement meter gains scale down with more than 3 living players.
 */
import { describe, expect, it } from 'vitest';
import type { GameSetup, GameState, Unit } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { sim, queries } from '../src/sim';
import { addAgeProgress } from '../src/sim/ages';
import { METER_PER_TURN, METER_REFERENCE_PLAYERS } from '../src/sim/ages/constants';
import { FREE_MILITARY_UNITS, UNIT_GOLD_UPKEEP } from '../src/sim/constants';
import type { SimCtx } from '../src/sim/ctx';
import { desertForUpkeep } from '../src/sim/turn';
import { computeEmpire, militaryUpkeep } from '../src/sim/yields';
import { FIRST_OFFER_TURN, GP_AGE_SCALE, GP_BASE_PER_POOL } from '../src/emergence/constants';
import { gpGain } from '../src/emergence/points';
import { measurePlayer } from '../src/emergence/signals';

const content = loadContent();

const setup = (players: number, mapSize: GameSetup['mapSize'] = 'small'): GameSetup => ({
  seed: 11,
  mapSize,
  speed: 'standard',
  players: Array.from({ length: players }, (_, i) => ({
    id: `p${i + 1}`,
    isHuman: false,
    leader: content.leaders[i % content.leaders.length]?.id ?? '',
    dream: content.dreams[0]?.id ?? '',
    colors: { primary: '#123456', secondary: '#654321' },
    skinTone: 0,
  })),
});

const endRound = (state: GameState): GameState => {
  let s = state;
  for (let i = 0; i < s.playerOrder.length && s.phase === 'playing'; i++) {
    const r = sim.applyCommand(s, s.currentPlayer, { type: 'endTurn' }, content);
    if (!r.ok) throw new Error(`endTurn rejected: ${r.error}`);
    s = r.state;
  }
  return s;
};

const found = (state: GameState, player: string): GameState => {
  const settler = Object.values(state.units).find((u) => u.owner === player && u.type === 'settler');
  if (!settler) throw new Error('no settler');
  const r = sim.applyCommand(state, player, { type: 'foundSettlement', unit: settler.id }, content);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

describe('offers need a home (emergence dead-lock fix)', () => {
  it('a player who never founds gets no offer at the forced first-offer turn, and endTurn never blocks', () => {
    let s = sim.createGame(setup(3), content).state;
    for (let t = 1; t <= FIRST_OFFER_TURN + 4; t++) s = endRound(s);
    expect(s.turn).toBeGreaterThan(FIRST_OFFER_TURN);
    expect(s.offers).toEqual([]);
  });

  it('a player who loses every settlement has its open offers withdrawn at its next turn start', () => {
    let s = sim.createGame(setup(3), content).state;
    s = found(s, 'p1');
    // Keep a settler so p1 stays alive without a settlement.
    const spare = Object.values(s.units).find((u) => u.owner === 'p2' && u.type === 'settler') as Unit;
    s.units[spare.id] = { ...spare, owner: 'p1' };
    const fig = content.figures.find((f) => f.age === 'ancient' && !f.deed);
    s.offers.push({ id: 'o_test', player: 'p1', source: 'thought', candidates: [fig?.id ?? ''], reasons: {}, deed: null, createdTurn: 1 });
    const settlementId = Object.values(s.settlements).find((x) => x.owner === 'p1')?.id ?? '';
    const tile = s.map.tiles.find((t) => t.settlement === settlementId);
    if (tile) tile.settlement = null;
    delete s.settlements[settlementId];
    const before = s.players.p1?.gp.thought ?? 0;
    // p1 cannot accept (no home) but may still skip; at the next turn start the offer is gone.
    s = endRound(endRound(s));
    expect(s.offers.filter((o) => o.player === 'p1')).toEqual([]);
    expect(s.players.p1?.alive).toBe(true);
    // The withdrawn points offer refunded its threshold.
    expect(s.players.p1?.gp.thought ?? 0).toBeGreaterThan(before);
  });
});

describe('military gold upkeep', () => {
  const withUnits = (n: number): GameState => {
    let s = sim.createGame(setup(3), content).state;
    s = found(s, 'p1');
    const city = Object.values(s.settlements).find((x) => x.owner === 'p1');
    const warrior = Object.values(s.units).find((u) => u.owner === 'p1' && u.unitClass === 'infantry') as Unit;
    for (let i = 1; i < n; i++) {
      const id = `ux${i}`;
      s.units[id] = { ...warrior, id, at: { q: (city?.at.q ?? 0) + 30, r: (city?.at.r ?? 0) + i } };
    }
    return s;
  };

  it('costs UNIT_GOLD_UPKEEP per military unit beyond the free allowance; civilians and figure-units are free', () => {
    const s = withUnits(FREE_MILITARY_UNITS + 3);
    expect(militaryUpkeep(s, 'p1')).toBe(3 * UNIT_GOLD_UPKEEP);
    const fig = Object.values(s.units).find((u) => u.id === 'ux1') as Unit;
    s.units[fig.id] = { ...fig, figure: 'imhotep' };
    expect(militaryUpkeep(s, 'p1')).toBe(2 * UNIT_GOLD_UPKEEP);
    const base = withUnits(FREE_MILITARY_UNITS);
    expect(militaryUpkeep(base, 'p1')).toBe(0);
    const goldWith = computeEmpire(withUnits(FREE_MILITARY_UNITS + 3), 'p1', content).income.gold;
    const goldWithout = computeEmpire(base, 'p1', content).income.gold;
    expect(goldWithout - goldWith).toBeCloseTo(3 * UNIT_GOLD_UPKEEP, 5);
  });

  it('an empty treasury makes the weakest unit desert and resets gold to 0', () => {
    const s = withUnits(FREE_MILITARY_UNITS + 2);
    s.players.p1!.stock.gold = -3;
    const ctx: SimCtx = { state: s, content, events: [] };
    const count = (): number => Object.values(s.units).filter((u) => u.owner === 'p1' && u.unitClass !== 'civilian').length;
    const n = count();
    desertForUpkeep(ctx, 'p1');
    expect(count()).toBe(n - 1);
    expect(s.players.p1!.stock.gold).toBe(0);
    expect(ctx.events.some((e) => e.type === 'notice' && e.player === 'p1')).toBe(true);
  });
});

describe('great-people points per age', () => {
  it('play-derived points shrink by GP_AGE_SCALE in later ages; the base does not', () => {
    let s = sim.createGame(setup(3), content).state;
    s = found(s, 'p1');
    s.players.p1!.income.science = 20;
    const thought = (): number => gpGain(s, 'p1', content, measurePlayer(s, 'p1', content)).thought;
    const ancient = thought() - GP_BASE_PER_POOL;
    s.age = 'classical';
    const classical = thought() - GP_BASE_PER_POOL;
    expect(ancient).toBeGreaterThan(0);
    expect(classical).toBeCloseTo((ancient * GP_AGE_SCALE.classical) / GP_AGE_SCALE.ancient, 8);
  });
});

describe('legacy milestones are per-age achievements', () => {
  it('classical "win battles" counts battlesWonThisAge, not lifetime battles', () => {
    const s = sim.createGame(setup(3), content).state;
    s.age = 'classical';
    const p = s.players.p1!;
    p.stats.battlesWon = 40;
    p.stats.battlesWonThisAge = 6;
    const row = queries.milestones(s, 'p1', content).find((m) => m.id === 'classical_military');
    expect(row?.value).toBe(6);
  });

  it('classical "great works" counts only figures activated this age', () => {
    const s = sim.createGame(setup(3), content).state;
    s.age = 'classical';
    s.players.p1!.stats.figuresActivated = 9;
    const [old, fresh, idle] = content.figures.filter((f) => !f.deed);
    const base = { owner: 'p1', recruitedTurn: 1, reason: '', location: { state: 'retired' as const } };
    s.figures[old!.id] = { ...base, id: old!.id, recruitedAge: 'ancient', activated: true };
    s.figures[fresh!.id] = { ...base, id: fresh!.id, recruitedAge: 'classical', activated: true };
    s.figures[idle!.id] = { ...base, id: idle!.id, recruitedAge: 'classical', activated: false };
    const row = queries.milestones(s, 'p1', content).find((m) => m.id === 'classical_culture');
    expect(row?.value).toBe(1);
  });
});

describe('age meter scales with player count', () => {
  it('up to the reference count gains are unchanged; above it they shrink proportionally', () => {
    const three = sim.createGame(setup(3), content).state;
    const ctx3: SimCtx = { state: three, content, events: [] };
    addAgeProgress(ctx3, 3);
    expect(three.ageProgress).toBe(3);

    const five = sim.createGame(setup(5, 'standard'), content).state;
    const ctx5: SimCtx = { state: five, content, events: [] };
    addAgeProgress(ctx5, 5);
    expect(five.ageProgress).toBe(Math.round(((5 * METER_REFERENCE_PLAYERS) / 5) * 100) / 100);
  });

  it('gains scale with game speed like the per-turn tick (Quick ages stay ~35 turns)', () => {
    const quick = sim.createGame({ ...setup(3), speed: 'quick' }, content).state;
    const ctx: SimCtx = { state: quick, content, events: [] };
    addAgeProgress(ctx, 2);
    expect(quick.ageProgress).toBe(Math.round(((2 * METER_PER_TURN.quick) / METER_PER_TURN.standard) * 100) / 100);
  });
});
