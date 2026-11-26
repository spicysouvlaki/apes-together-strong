/**
 * Signal measurement (GDD §4 "Affinity engine"): what the sim can observe about a player's
 * play each turn. `x[s]` is a plain number for most measures; the two relationship measures
 * (`tradeRoutesWithCulture`, `suzerainOfCulture`) are measured separately for each culture.
 */
import type { ContentBundle, Signal } from '@contracts/content-schemas';
import type { CultureId, GameState, PlayerId } from '@contracts/sim-api';
import { citable, numberedHint } from './reasons';
import { isCoastal, ownSettlements, suzerainByCulture, tileAt, tradeRoutesByCulture } from './util';

/** Everything the signal measures need, computed in one pass over the map. */
export interface PlayerMeasures {
  terrain: Record<string, number>;
  feature: Record<string, number>;
  resource: Record<string, number>;
  climate: Record<string, number>;
  coastalSettlements: number;
  riverSettlements: number;
  settlementCount: number;
  totalPopulation: number;
  unitsOfClass: Record<string, number>;
  /** Military units: every unit that is neither civilian nor a commander (figure). */
  unitsTotal: number;
  /** Scouting civilians: civilians that can neither found nor trade, plus explorer figures (not lookouts). */
  scouts: number;
  tradeRoutes: number;
  tradeRoutesByCulture: Record<CultureId, number>;
  suzerainByCulture: Record<CultureId, number>;
  techsThisAge: number;
  exploredPercent: number;
}

const inc = (rec: Record<string, number>, key: string | null): void => {
  if (key !== null) rec[key] = (rec[key] ?? 0) + 1;
};

export const measurePlayer = (state: GameState, player: PlayerId, content: ContentBundle): PlayerMeasures => {
  const terrain: Record<string, number> = {};
  const feature: Record<string, number> = {};
  const resource: Record<string, number> = {};
  const climate: Record<string, number> = {};
  for (const t of state.map.tiles) {
    if (t.owner !== player) continue;
    inc(terrain, t.terrain);
    inc(feature, t.feature);
    inc(resource, t.resource);
    inc(climate, t.climate);
  }

  const settlements = ownSettlements(state, player);
  let coastal = 0;
  let river = 0;
  let pop = 0;
  for (const s of settlements) {
    if (isCoastal(state, s.at, content)) coastal++;
    if (tileAt(state, s.at)?.river) river++;
    pop += s.population;
  }

  const unitsOfClass: Record<string, number> = {};
  let unitsTotal = 0;
  let scouts = 0;
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (!u || u.owner !== player) continue;
    inc(unitsOfClass, u.unitClass);
    if (u.unitClass !== 'civilian' && u.unitClass !== 'commander') unitsTotal++;
    if (u.unitClass === 'civilian') {
      const def = content.units.find((d) => d.id === u.type);
      // A scout keeping watch as a fortified lookout is not exploring (playtest 3).
      if (def && !def.canFound && (!def.canTrade || def.figureKind === 'explorer') && !u.fortified) scouts++;
    }
  }

  const p = state.players[player];
  let techsThisAge = 0;
  let explored = 0;
  if (p) {
    for (const id of p.techs) if (content.techs.find((t) => t.id === id)?.age === state.age) techsThisAge++;
    for (const e of p.explored) explored += e;
  }
  const tiles = state.map.tiles.length;

  return {
    terrain,
    feature,
    resource,
    climate,
    coastalSettlements: coastal,
    riverSettlements: river,
    settlementCount: settlements.length,
    totalPopulation: pop,
    unitsOfClass,
    unitsTotal,
    scouts,
    tradeRoutes: state.tradeRoutes.filter((r) => r.owner === player).length,
    tradeRoutesByCulture: tradeRoutesByCulture(state, player, content),
    suzerainByCulture: suzerainByCulture(state, player, content),
    techsThisAge,
    exploredPercent: tiles > 0 ? (100 * explored) / tiles : 0,
  };
};

/** x[s] for culture `culture` (only relationship measures depend on the culture). */
export const signalValue = (
  signal: Signal,
  culture: CultureId,
  m: PlayerMeasures,
  state: GameState,
  player: PlayerId,
): number => {
  const p = state.players[player];
  const param = signal.param ?? '';
  switch (signal.measure) {
    case 'ownedTerrain':
      return m.terrain[param] ?? 0;
    case 'ownedFeature':
      return m.feature[param] ?? 0;
    case 'ownedResource':
      return m.resource[param] ?? 0;
    case 'ownedClimate':
      return m.climate[param] ?? 0;
    case 'coastalSettlements':
      return m.coastalSettlements;
    case 'settlementCount':
      return m.settlementCount;
    case 'totalPopulation':
      return m.totalPopulation;
    case 'unitsOfClass':
      return m.unitsOfClass[param] ?? 0;
    case 'battlesWonThisTurn':
      return p?.stats.battlesWonThisTurn ?? 0;
    case 'citiesCapturedThisTurn':
      return p?.stats.citiesCapturedThisTurn ?? 0;
    case 'tradeRoutesWithCulture':
      return m.tradeRoutesByCulture[culture] ?? 0;
    case 'tradeRoutes':
      return m.tradeRoutes;
    case 'riverSettlements':
      return m.riverSettlements;
    case 'wondersBuilt':
      return p?.stats.wondersBuilt ?? 0;
    case 'techsResearched':
      return m.techsThisAge;
    case 'envoysSent':
      return p?.stats.envoysSent ?? 0;
    case 'suzerainOfCulture':
      return m.suzerainByCulture[culture] ?? 0;
    case 'unitsTotal':
      return m.unitsTotal;
    case 'faithIncome':
      return Math.max(0, p?.income.faith ?? 0);
    case 'cultureIncome':
      return Math.max(0, p?.income.culture ?? 0);
    case 'scienceIncome':
      return Math.max(0, p?.income.science ?? 0);
    case 'goldIncome':
      return Math.max(0, p?.income.gold ?? 0);
    case 'exploredPercent':
      return m.exploredPercent;
  }
};

/**
 * Unscaled contribution w[s,c]·x[s] of every signal to every culture it weights, as
 * contributions[culture][signalId]. Cultures and signals iterate in content order.
 */
export type Contributions = Record<CultureId, Record<string, number>>;

export const signalContributions = (
  state: GameState,
  player: PlayerId,
  content: ContentBundle,
  measures: PlayerMeasures = measurePlayer(state, player, content),
): Contributions => {
  const out: Contributions = {};
  for (const c of content.cultures) out[c.id] = {};
  for (const s of content.signals) {
    for (const c of content.cultures) {
      const w = s.weights[c.id];
      if (w === undefined || w === 0) continue;
      const x = signalValue(s, c.id, measures, state, player);
      if (x === 0) continue;
      const row = out[c.id];
      if (row) row[s.id] = w * x;
    }
  }
  return out;
};

/** The signal adding the most to `culture` this turn, or null if none contributes. */
export const topSignal = (contributions: Contributions, culture: CultureId, content: ContentBundle): Signal | null => {
  const row = contributions[culture];
  if (!row) return null;
  let best: Signal | null = null;
  let bestValue = 0;
  for (const s of content.signals) {
    const v = row[s.id] ?? 0;
    if (v > bestValue) {
      best = s;
      bestValue = v;
    }
  }
  return best;
};

/** Every signal adding to `culture` this turn, with its contribution (strongest first; ties keep content order). */
export const topSignals = (
  contributions: Contributions,
  culture: CultureId,
  content: ContentBundle,
): { signal: Signal; value: number }[] => {
  const row = contributions[culture];
  if (!row) return [];
  const out: { signal: Signal; value: number }[] = [];
  for (const s of content.signals) {
    const v = row[s.id] ?? 0;
    if (v <= 0) continue;
    out.push({ signal: s, value: v });
  }
  out.sort((a, b) => b.value - a.value);
  return out;
};

/** The two signals adding the most to `culture` this turn, with their contributions (strongest first). */
export const topTwoSignals = (
  contributions: Contributions,
  culture: CultureId,
  content: ContentBundle,
): { signal: Signal; value: number }[] => topSignals(contributions, culture, content).slice(0, 2);

/**
 * The (up to two) strongest signals for `culture` that may be cited as a reason, each with its
 * number-aware hint: the measured amount (contribution / weight) must be one the player really
 * has (reasons.ts `citable`), and plurals follow the count (playtest 3).
 */
export const citedSignals = (
  state: GameState,
  player: PlayerId,
  contributions: Contributions,
  culture: CultureId,
  content: ContentBundle,
): { signal: Signal; value: number; hint: string }[] => {
  const settlements = ownSettlements(state, player).length;
  const out: { signal: Signal; value: number; hint: string }[] = [];
  for (const x of topSignals(contributions, culture, content)) {
    const w = x.signal.weights[culture] ?? 0;
    const amount = w > 0 ? x.value / w : 0;
    if (!citable(x.signal.measure, amount)) continue;
    out.push({ ...x, hint: numberedHint(x.signal.hint, x.signal.measure, amount, settlements) });
    if (out.length === 2) break;
  }
  return out;
};

