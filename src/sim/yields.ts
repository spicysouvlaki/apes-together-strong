/**
 * Tile, settlement and empire yields; citizen assignment; happiness (GDD §7 "Settlements").
 * Pure functions of (state, …, content). Callers that evaluate many settlements of one
 * player pass the player's modifiers in to avoid recomputing them.
 */
import { AGES, YIELDS, type ContentBundle, type Modifier, type YieldType, type Yields } from '@contracts/content-schemas';
import type { GameState, PlayerId, Settlement, SettlementId, Tile } from '@contracts/sim-api';
import { ancestorYields } from '../emergence';
import {
  AGE_INDEX,
  CAPITAL_YIELDS,
  CELEBRATION_THRESHOLD,
  CELEBRATION_YIELD_PERCENT,
  CITY_BASE_YIELDS,
  CITY_CENTER_MIN_YIELDS,
  COLD_FOOD_PENALTY,
  FEATURE_YIELDS,
  FOOD_PER_POP,
  FOOD_SURPLUS_SOFT_CAP_BASE,
  FOOD_SURPLUS_SOFT_CAP_PER_POP,
  SATISFIED_FOOD_SHARE,
  FREE_MILITARY_UNITS,
  GROWTH_BASE,
  GROWTH_EXPONENT,
  GROWTH_LINEAR,
  HAPPINESS_BASE,
  HAPPINESS_PER_OVER_CAP,
  HAPPINESS_POP_FREE,
  IDLE_PRODUCTION_TO_GOLD,
  PAST_AGE_BUILDING_YIELD,
  POP_YIELDS,
  RIVER_GOLD,
  SETTLEMENT_CAP,
  TILE_SCORE,
  TOWN_PRODUCTION_TO_GOLD,
  TRADE_PARTNER_GOLD,
  TRADE_ROUTE_GOLD,
  UNHAPPY_YIELD_PERCENT_MAX,
  UNHAPPY_YIELD_PERCENT_PER_POINT,
  UNIT_GOLD_UPKEEP,
  WAR_WEARINESS_PER_WAR,
  WORK_RADIUS,
} from './constants';
import { ci, playerSettlements, round2, tileAt, tilesInRange } from './lookup';
import { buildingModifiers, empireModifiers, hasIgnoreCold, sumAdd, yieldMods, type CondEnv } from './modifiers';

export type YieldRecord = Record<YieldType, number>;

export const zeroYields = (): YieldRecord => {
  const out = {} as YieldRecord;
  for (const y of YIELDS) out[y] = 0;
  return out;
};

const addYields = (into: YieldRecord, add: Yields, scale = 1): void => {
  for (const y of YIELDS) {
    const v = add[y];
    if (v !== undefined) into[y] += v * scale;
  }
};

/** Stockpiled yields (local food/production are not stockpiled empire-wide). */
export const STOCK_YIELDS: readonly YieldType[] = ['gold', 'science', 'culture', 'faith', 'influence'];
const LOCAL_YIELDS: readonly YieldType[] = ['food', 'production'];

export const resourceRevealed = (state: GameState, resourceId: string, content: ContentBundle): boolean => {
  const r = ci(content).resources[resourceId];
  return !!r && AGE_INDEX[r.revealAge] <= AGE_INDEX[state.age];
};

/**
 * Yield of one tile for `player`: terrain + feature + resource + river + tile-scoped modifiers.
 * Resource happiness is excluded (luxuries count once per empire in `computeHappiness`);
 * happiness from tile-scoped modifiers is kept and counts as the settlement's amenity.
 */
export const tileYield = (
  state: GameState,
  tile: Tile,
  player: PlayerId,
  content: ContentBundle,
  mods: readonly Modifier[],
  settlement?: Settlement,
): YieldRecord => {
  const out = zeroYields();
  const terrain = ci(content).terrain[tile.terrain];
  if (terrain) addYields(out, terrain.yields);
  if (tile.feature) addYields(out, FEATURE_YIELDS[tile.feature] ?? {});
  if (tile.resource && resourceRevealed(state, tile.resource, content)) {
    const r = ci(content).resources[tile.resource];
    // Resource happiness counts once per empire (computeHappiness), not per worked tile.
    if (r) addYields(out, { ...r.yields, happiness: 0 });
  }
  if (tile.river) out.gold += RIVER_GOLD;
  // Cold (polar climate) tiles feed less, unless an `ignoreCold` modifier applies (Inuit
  // traditions, Greenland Crossing): the rule those modifiers lift.
  if (tile.climate === 'polar' && !hasIgnoreCold(mods)) out.food -= COLD_FOOD_PENALTY;
  const env: CondEnv = { state, content, player, tile };
  if (settlement) env.settlement = settlement;
  const tm = yieldMods(mods, 'tile', env);
  addYields(out, tm.add);
  for (const y of YIELDS) {
    const p = tm.percent[y];
    if (p) out[y] *= 1 + p / 100;
  }
  for (const y of YIELDS) out[y] = y === 'happiness' ? round2(out[y]) : Math.max(0, round2(out[y]));
  return out;
};

const tileScore = (y: YieldRecord, foodShare = 1): number => {
  let s = 0;
  for (const k of YIELDS) s += y[k] * (TILE_SCORE[k] ?? 0) * (k === 'food' ? foodShare : 1);
  return s;
};

/** Food surplus at which citizens start favoring other yields: 2 + half the population, rounded up. */
export const foodSurplusSoftCap = (population: number): number => FOOD_SURPLUS_SOFT_CAP_BASE + Math.ceil(population * FOOD_SURPLUS_SOFT_CAP_PER_POP);

/**
 * Tiles the settlement may work: owned by its owner within WORK_RADIUS, not another
 * settlement's center, and nearer to this settlement than to any other of the owner's
 * settlements (ties go to the settlement listed first in `state.settlements`).
 */
export const workableTiles = (state: GameState, s: Settlement): Tile[] => {
  const mine = playerSettlements(state, s.owner);
  const out: Tile[] = [];
  for (const t of tilesInRange(state.map, s.at, WORK_RADIUS)) {
    if (t.owner !== s.owner || t.settlement !== null) continue;
    let bestId: string | null = null;
    let bestD = Infinity;
    for (const o of mine) {
      const d = (Math.abs(o.at.q - t.q) + Math.abs(o.at.q + o.at.r - t.q - t.r) + Math.abs(o.at.r - t.r)) / 2;
      if (d < bestD) {
        bestD = d;
        bestId = o.id;
      }
    }
    if (bestId === s.id) out.push(t);
  }
  return out;
};

const settlementMods = (state: GameState, s: Settlement, content: ContentBundle, mods?: readonly Modifier[]): Modifier[] => [
  ...(mods ?? empireModifiers(state, s.owner, content)),
  ...buildingModifiers(s, content),
];

/** The center tile plus the `population` best workable tiles, with their yields. */
export const workedTilesWithYields = (
  state: GameState,
  s: Settlement,
  content: ContentBundle,
  mods?: readonly Modifier[],
): { tile: Tile; yields: YieldRecord }[] => {
  const all = settlementMods(state, s, content, mods);
  const center = tileAt(state.map, s.at);
  const out: { tile: Tile; yields: YieldRecord }[] = [];
  if (center) {
    const y = tileYield(state, center, s.owner, content, all, s);
    for (const k of YIELDS) {
      const min = CITY_CENTER_MIN_YIELDS[k];
      if (min !== undefined && y[k] < min) y[k] = min;
    }
    out.push({ tile: center, yields: y });
  }
  const pool = workableTiles(state, s).map((tile) => ({ tile, yields: tileYield(state, tile, s.owner, content, all, s) }));
  // Citizens pick tiles one at a time, best first (ties: nearest first). Once the city already
  // grows comfortably, extra food is worth less than production (fun audit pass 2: food-rich
  // jungle and floodplain capitals worked only 3-food tiles, grew big, unhappy and unproductive).
  let surplus = (out[0]?.yields.food ?? 0) - FOOD_PER_POP * s.population;
  const softCap = foodSurplusSoftCap(s.population);
  for (let k = 0; k < s.population && pool.length > 0; k++) {
    const share = surplus >= softCap ? SATISFIED_FOOD_SHARE : 1;
    let best = 0;
    let bestScore = -Infinity;
    pool.forEach((x, i) => {
      const sc = tileScore(x.yields, share);
      if (sc > bestScore) {
        bestScore = sc;
        best = i;
      }
    });
    const [x] = pool.splice(best, 1);
    if (!x) break;
    surplus += x.yields.food;
    out.push(x);
  }
  return out;
};

/** Yield percent from empire happiness: celebration bonus or unhappiness penalty (GDD §7). */
export const happinessYieldPercent = (happiness: number): number => {
  if (happiness >= CELEBRATION_THRESHOLD) return CELEBRATION_YIELD_PERCENT;
  if (happiness < 0) return -Math.min(UNHAPPY_YIELD_PERCENT_MAX, -happiness * UNHAPPY_YIELD_PERCENT_PER_POINT);
  return 0;
};

const buildingYieldScale = (state: GameState, buildingAge: (typeof AGES)[number]): number =>
  AGE_INDEX[buildingAge] < AGE_INDEX[state.age] ? PAST_AGE_BUILDING_YIELD : 1;

/**
 * Per-turn yields of one settlement. Towns turn production into gold. `happiness` holds
 * the settlement's own amenities (buildings and settlement-scoped modifiers).
 */
export const settlementYields = (
  state: GameState,
  s: Settlement,
  content: ContentBundle,
  mods?: readonly Modifier[],
): YieldRecord => {
  const emp = mods ?? empireModifiers(state, s.owner, content);
  const all = settlementMods(state, s, content, emp);
  const out = zeroYields();
  for (const w of workedTilesWithYields(state, s, content, emp)) addYields(out, w.yields);
  if (s.kind === 'city') {
    addYields(out, CITY_BASE_YIELDS);
    addYields(out, POP_YIELDS, s.population);
  }
  if (s.isCapital) addYields(out, CAPITAL_YIELDS);
  const idx = ci(content);
  for (const b of s.buildings) {
    const def = idx.buildings[b];
    if (def) addYields(out, def.yields, buildingYieldScale(state, def.age));
  }
  for (const w of Object.keys(state.wonders)) {
    const rec = state.wonders[w];
    const def = idx.wonders[w];
    if (rec && def && rec.settlement === s.id && rec.owner === s.owner) addYields(out, def.yields);
  }
  const center = tileAt(state.map, s.at);
  const env: CondEnv = { state, content, player: s.owner, settlement: s };
  if (center) env.tile = center;
  const sm = yieldMods(all, 'settlement', env);
  addYields(out, sm.add);
  // Empire-scoped local yields: flat adds go to the capital, percents to every settlement.
  const em = yieldMods(emp, 'empire', { state, content, player: s.owner });
  for (const y of LOCAL_YIELDS) {
    if (s.isCapital) out[y] += em.add[y] ?? 0;
  }
  const player = state.players[s.owner];
  const happyPct = player ? happinessYieldPercent(player.happiness) : 0;
  for (const y of YIELDS) {
    if (y === 'happiness') continue;
    let pct = (sm.percent[y] ?? 0) + happyPct;
    if (LOCAL_YIELDS.includes(y)) pct += em.percent[y] ?? 0;
    if (pct) out[y] *= 1 + pct / 100;
  }
  if (s.kind === 'town') {
    out.gold += out.production * TOWN_PRODUCTION_TO_GOLD;
    out.production = 0;
  }
  for (const y of YIELDS) out[y] = round2(out[y]);
  return out;
};

/** Settlement cap for the current age (GDD §7) plus `settlementCap` modifiers. */
export const settlementCapFor = (state: GameState, player: PlayerId, content: ContentBundle, mods?: readonly Modifier[]): number =>
  SETTLEMENT_CAP[state.age] + sumAdd(mods ?? empireModifiers(state, player, content), 'settlementCap');

export const warCount = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const key of Object.keys(state.wars)) {
    const [a, b] = key.split('|');
    if (a === player || b === player) n++;
  }
  return n;
};

/**
 * Empire happiness (GDD §7): base + luxuries (each kind once) + amenities − 1 per pop above 5
 * per settlement − cap penalty − war weariness.
 */
export const computeHappiness = (
  state: GameState,
  player: PlayerId,
  content: ContentBundle,
  mods?: readonly Modifier[],
): number => {
  const emp = mods ?? empireModifiers(state, player, content);
  let h = HAPPINESS_BASE;
  const luxuries = new Set<string>();
  for (const t of state.map.tiles) {
    if (t.owner !== player || !t.resource) continue;
    const r = ci(content).resources[t.resource];
    if (r && r.class === 'luxury' && resourceRevealed(state, r.id, content)) luxuries.add(r.id);
  }
  // Sorted so floating-point summation order never depends on Set insertion order.
  for (const id of [...luxuries].sort()) h += ci(content).resources[id]?.yields.happiness ?? 0;
  const mine = playerSettlements(state, player);
  for (const s of mine) {
    h += settlementYields(state, s, content, emp).happiness;
    h -= Math.max(0, s.population - HAPPINESS_POP_FREE);
  }
  h += yieldMods(emp, 'empire', { state, content, player }).add.happiness ?? 0;
  const over = mine.length - settlementCapFor(state, player, content, emp);
  if (over > 0) h -= over * HAPPINESS_PER_OVER_CAP;
  h -= warCount(state, player) * WAR_WEARINESS_PER_WAR;
  return Math.round(h);
};

export interface EmpireYields {
  income: YieldRecord;
  perSettlement: Record<SettlementId, YieldRecord>;
}

/** Per-turn income of a player: settlement yields + empire modifiers + ancestors + trade. */
export const computeEmpire = (state: GameState, player: PlayerId, content: ContentBundle, mods?: readonly Modifier[]): EmpireYields => {
  const emp = mods ?? empireModifiers(state, player, content);
  const income = zeroYields();
  const perSettlement: Record<SettlementId, YieldRecord> = {};
  for (const s of playerSettlements(state, player)) {
    const y = settlementYields(state, s, content, emp);
    perSettlement[s.id] = y;
    for (const k of YIELDS) if (k !== 'happiness') income[k] += y[k];
    if (s.kind === 'city' && s.production.item === null) income.gold += y.production * IDLE_PRODUCTION_TO_GOLD;
  }
  const em = yieldMods(emp, 'empire', { state, content, player });
  for (const y of STOCK_YIELDS) income[y] += em.add[y] ?? 0;
  addYields(income, ancestorYields(state, player, content));
  for (const r of state.tradeRoutes) {
    if (r.owner === player) income.gold += TRADE_ROUTE_GOLD;
    else if (state.settlements[r.to]?.owner === player) income.gold += TRADE_PARTNER_GOLD;
  }
  for (const y of STOCK_YIELDS) {
    const p = em.percent[y];
    if (p) income[y] *= 1 + p / 100;
  }
  income.gold -= militaryUpkeep(state, player);
  income.happiness = state.players[player]?.happiness ?? 0;
  for (const y of YIELDS) income[y] = round2(income[y]);
  return { income, perSettlement };
};

/** Gold per turn the player's army costs: UNIT_GOLD_UPKEEP per non-figure military unit beyond the free allowance. */
export const militaryUpkeep = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (u && u.owner === player && u.unitClass !== 'civilian' && !u.figure) n++;
  }
  return Math.max(0, n - FREE_MILITARY_UNITS) * UNIT_GOLD_UPKEEP;
};

/** Food needed for the next population point: 5 + 4·pop + pop^1.4 (GDD §7). */
export const growthCost = (population: number): number => Math.floor(GROWTH_BASE + GROWTH_LINEAR * population + Math.pow(population, GROWTH_EXPONENT));
