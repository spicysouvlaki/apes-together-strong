/**
 * Settlements (GDD §7 "Settlements"): founding, naming, borders, growth, production,
 * buying, town → city upgrades.
 */
import type { ContentBundle, Modifier } from '@contracts/content-schemas';
import { hexDistance, type Hex } from '@contracts/hex';
import type { CultureId, GameState, PlayerId, Settlement, SettlementId, UnitId } from '@contracts/sim-api';
import { addAffinity, cultureWeights } from '../emergence';
import { addAgeProgress } from './ages';
import { addChronicle } from './chronicle';
import {
  AGE_INDEX,
  BORDER_RADIUS_BY_POP,
  BUY_GOLD_PER_PRODUCTION,
  FOOD_PER_POP,
  FOUND_CLAIM_RADIUS,
  MIN_SETTLEMENT_DISTANCE,
  SETTLEMENT_VISION,
  UNREST_THRESHOLD,
  UPGRADE_COST_BASE,
  UPGRADE_COST_PER_POP,
  WALL_BASE_HP,
  WONDERS_PURCHASABLE,
  WONDER_AGE_PROGRESS,
} from './constants';
import { mintId, type SimCtx } from './ctx';
import { capitalOf, ci, isCoastalHex, isWater, tileAt, tilesInRange } from './lookup';
import { applyCostPercent, buildingModifiers, conditionMatches, costPercentIn, empireModifiers, type CondEnv } from './modifiers';
import { pick } from './rng';
import { removeUnit, revealAround, spawnUnit } from './units';
import { growthCost, resourceRevealed, type YieldRecord } from './yields';

// --- Founding ------------------------------------------------------------------

/**
 * Why `player` may not found a settlement at `at`, or null when it may: land, passable, not
 * owned by someone else, and no settlement within MIN_SETTLEMENT_DISTANCE. The one founding
 * rule: `foundSettlement`, `canFoundAt`, `queries.settleSites` and the AI all use it.
 */
export const foundSiteError = (state: GameState, player: PlayerId, at: Hex, content: ContentBundle): string | null => {
  const tile = tileAt(state.map, at);
  if (!tile) return 'That tile is off the map.';
  if (tile.settlement) return 'There is already a settlement here.';
  if (isWater(tile, content)) return 'Settlements cannot be founded on water.';
  const terrain = ci(content).terrain[tile.terrain];
  if (!terrain || terrain.moveCost === null) return 'Settlements cannot be founded on impassable terrain.';
  if (tile.owner !== null && tile.owner !== player) return 'That land belongs to someone else.';
  for (const id of Object.keys(state.settlements)) {
    const s = state.settlements[id];
    if (s && hexDistance(s.at, at) <= MIN_SETTLEMENT_DISTANCE) return 'That tile is too close to another settlement.';
  }
  return null;
};

export const canFoundAt = (state: GameState, player: PlayerId, at: Hex, content: ContentBundle): boolean =>
  foundSiteError(state, player, at, content) === null;

export const borderRadius = (population: number): number => {
  let r = 0;
  for (const [minPop, radius] of BORDER_RADIUS_BY_POP) if (population >= minPop) r = radius;
  return r;
};

/** Claim every unowned tile within `radius`, nearest first. */
export const claimTiles = (state: GameState, s: Settlement, radius: number): void => {
  for (const t of tilesInRange(state.map, s.at, radius)) if (t.owner === null) t.owner = s.owner;
};

/** The player's heaviest culture (GDD §6 "New cities are named from the heaviest culture"), else a seeded pick. */
export const namingCulture = (state: GameState, player: PlayerId, content: ContentBundle): CultureId | null => {
  if (content.cultures.length === 0) return null;
  const weights = cultureWeights(state, player, content);
  let best: CultureId | null = null;
  let bestW = 0;
  for (const c of content.cultures) {
    const w = weights[c.id] ?? 0;
    if (w > bestW) {
      bestW = w;
      best = c.id;
    }
  }
  return best ?? pick(state, content.cultures).id;
};

export const pickName = (state: GameState, culture: CultureId | null, content: ContentBundle): string => {
  const used = new Set<string>();
  for (const id of Object.keys(state.settlements)) {
    const s = state.settlements[id];
    if (s) used.add(s.name);
  }
  const names = (culture && ci(content).cultures[culture]?.cityNames) || [];
  for (const n of names) if (!used.has(n)) return n;
  const base = names[0] ?? 'Settlement';
  for (let i = 2; ; i++) {
    const n = `${base} ${i}`;
    if (!used.has(n)) return n;
  }
};

/** Create a settlement record on the map (no validation). Shared by founding and city-states. */
export const createSettlement = (
  state: GameState,
  owner: PlayerId,
  at: Hex,
  opts: { name: string; namedFor: CultureId; kind: 'town' | 'city'; isCapital: boolean; population: number },
): Settlement => {
  const id = mintId(state, 's');
  const s: Settlement = {
    id,
    owner,
    originalOwner: owner,
    name: opts.name,
    namedFor: opts.namedFor,
    at: { q: at.q, r: at.r },
    kind: opts.kind,
    population: opts.population,
    foodStored: 0,
    isCapital: opts.isCapital,
    foundedTurn: state.turn,
    buildings: [],
    hp: WALL_BASE_HP,
    maxHp: WALL_BASE_HP,
    siegeTurns: 0,
    production: { item: null, progress: 0 },
  };
  state.settlements[id] = s;
  const tile = tileAt(state.map, at);
  if (tile) {
    tile.settlement = id;
    tile.owner = owner;
  }
  claimTiles(state, s, Math.max(FOUND_CLAIM_RADIUS, borderRadius(opts.population)));
  return s;
};

export const foundSettlement = (ctx: SimCtx, player: PlayerId, unitId: UnitId): string | null => {
  const { state, content } = ctx;
  const unit = state.units[unitId];
  if (!unit || unit.owner !== player) return 'That unit is not yours.';
  if (!ci(content).units[unit.type]?.canFound) return 'This unit cannot found settlements.';
  const siteError = foundSiteError(state, player, unit.at, content);
  if (siteError) return siteError;
  const first = !capitalOf(state, player);
  const culture = namingCulture(state, player, content);
  const s = createSettlement(state, player, unit.at, {
    name: pickName(state, culture, content),
    namedFor: culture ?? '',
    kind: first ? 'city' : 'town',
    isCapital: first,
    population: 1,
  });
  removeUnit(ctx, unitId);
  const p = state.players[player];
  if (p) revealAround(state, p.explored, s.at, SETTLEMENT_VISION);
  ctx.events.push({ type: 'settlementFounded', settlement: s.id, player });
  addChronicle(state, player, 'founding', s.id, `${s.name} was founded.`);
  return null;
};

// --- Production items ----------------------------------------------------------

export type ItemKind = 'unit' | 'building' | 'wonder';

export const itemKind = (content: ContentBundle, item: string): ItemKind | null => {
  const idx = ci(content);
  if (idx.units[item]) return 'unit';
  if (idx.buildings[item]) return 'building';
  if (idx.wonders[item]) return 'wonder';
  return null;
};

const settlementEnv = (state: GameState, s: Settlement, content: ContentBundle): CondEnv => {
  const env: CondEnv = { state, content, player: s.owner, settlement: s };
  const t = tileAt(state.map, s.at);
  if (t) env.tile = t;
  return env;
};

/** Production cost after `cost` modifiers (empire + this settlement's buildings). */
export const itemCost = (
  state: GameState,
  s: Settlement,
  item: string,
  content: ContentBundle,
  mods?: readonly Modifier[],
): number => {
  const idx = ci(content);
  const all = [...(mods ?? empireModifiers(state, s.owner, content)), ...buildingModifiers(s, content)];
  const env = settlementEnv(state, s, content);
  const unit = idx.units[item];
  if (unit) {
    let pct = costPercentIn(all, 'unit', env);
    if (unit.canFound) pct += costPercentIn(all, 'settler', env);
    return applyCostPercent(unit.cost, pct);
  }
  const b = idx.buildings[item];
  if (b) return applyCostPercent(b.cost, costPercentIn(all, 'building', env));
  const w = idx.wonders[item];
  if (w) return applyCostPercent(w.cost, costPercentIn(all, 'wonder', env));
  return Infinity;
};

const ownsResource = (state: GameState, player: PlayerId, resource: string, content: ContentBundle): boolean =>
  resourceRevealed(state, resource, content) && state.map.tiles.some((t) => t.owner === player && t.resource === resource);

/** Items this settlement could make, ignoring whether it is a town (buying works in towns). */
export const availableItems = (state: GameState, s: Settlement, content: ContentBundle): { item: string; kind: ItemKind }[] => {
  const p = state.players[s.owner];
  if (!p) return [];
  const known = new Set(p.techs);
  const age = AGE_INDEX[state.age];
  const coastal = isCoastalHex(state.map, s.at, content);
  const env = settlementEnv(state, s, content);
  const idx = ci(content);
  const unitOk = (id: string): boolean => {
    const u = idx.units[id];
    if (!u || u.figureKind) return false;
    if (AGE_INDEX[u.age] > age) return false;
    if (u.requiresTech && !known.has(u.requiresTech)) return false;
    if (u.requiresResource && !ownsResource(state, s.owner, u.requiresResource, content)) return false;
    if (u.unitClass === 'naval' && !coastal) return false;
    return true;
  };
  const out: { item: string; kind: ItemKind }[] = [];
  for (const u of content.units) {
    if (!unitOk(u.id)) continue;
    // Obsolete once its upgrade can be built.
    if (u.upgradesTo && unitOk(u.upgradesTo)) continue;
    out.push({ item: u.id, kind: 'unit' });
  }
  for (const b of content.buildings) {
    if (s.buildings.includes(b.id) || AGE_INDEX[b.age] > age) continue;
    if (b.requiresTech && !known.has(b.requiresTech)) continue;
    if (!conditionMatches(b.requires, env)) continue;
    out.push({ item: b.id, kind: 'building' });
  }
  for (const w of content.wonders) {
    // Wonders belong to their age (GDD §7 "~8 wonders per age"): a past age's wonder is no
    // longer buildable, otherwise it is a trivial bargain for whoever is behind (autoplay: 85%
    // of ancient wonders were finished in the classical age). Banked progress stays.
    if (state.wonders[w.id] || AGE_INDEX[w.age] !== age) continue;
    if (w.requiresTech && !known.has(w.requiresTech)) continue;
    if (!conditionMatches(w.requires, env)) continue;
    out.push({ item: w.id, kind: 'wonder' });
  }
  return out;
};

export const canProduce = (state: GameState, s: Settlement, item: string, content: ContentBundle): boolean =>
  availableItems(state, s, content).some((x) => x.item === item);

/** Gold price of an item: remaining production × BUY_GOLD_PER_PRODUCTION. */
export const goldCostOf = (state: GameState, s: Settlement, item: string, content: ContentBundle, mods?: readonly Modifier[]): number => {
  const cost = itemCost(state, s, item, content, mods);
  const progress = s.production.item === item ? s.production.progress : 0;
  return Math.max(1, Math.ceil(Math.max(0, cost - progress) * BUY_GOLD_PER_PRODUCTION));
};

/** Finish an item in a settlement. Returns false when it could not be placed (no room for a unit, wonder taken). */
export const completeItem = (ctx: SimCtx, s: Settlement, item: string): boolean => {
  const { state, content } = ctx;
  const kind = itemKind(content, item);
  if (kind === 'unit') {
    if (spawnUnit(ctx, s.owner, item, s.at) === null) return false;
  } else if (kind === 'building') {
    const def = ci(content).buildings[item];
    if (!def || s.buildings.includes(item)) return false;
    s.buildings.push(item);
    s.maxHp += def.defense;
    s.hp += def.defense;
  } else if (kind === 'wonder') {
    const def = ci(content).wonders[item];
    if (!def || state.wonders[item]) return false;
    state.wonders[item] = { owner: s.owner, settlement: s.id, turn: state.turn };
    const p = state.players[s.owner];
    if (p) p.stats.wondersBuilt++;
    addAffinity(ctx, s.owner, def.culture, def.affinity);
    addAgeProgress(ctx, WONDER_AGE_PROGRESS);
    addChronicle(state, s.owner, 'wonder', item, `${def.name} was completed in ${s.name}.`);
    ctx.events.push({ type: 'wonderBuilt', wonder: item, player: s.owner, settlement: s.id });
    // Anyone else building it loses the item (progress stays banked).
    for (const id of Object.keys(state.settlements)) {
      const o = state.settlements[id];
      if (o && o.id !== s.id && o.production.item === item) o.production.item = null;
    }
  } else {
    return false;
  }
  ctx.events.push({ type: 'productionCompleted', settlement: s.id, item, player: s.owner });
  return true;
};

export const setProduction = (ctx: SimCtx, player: PlayerId, sid: SettlementId, item: string | null): string | null => {
  const { state, content } = ctx;
  const s = state.settlements[sid];
  if (!s || s.owner !== player) return 'That settlement is not yours.';
  if (s.kind !== 'city') return 'Towns do not build items; upgrade it to a city first.';
  if (item !== null && !canProduce(state, s, item, content)) return 'That cannot be built here right now.';
  // Progress carries over between items (simplification: one progress counter per settlement).
  s.production.item = item;
  return null;
};

export const buyItem = (ctx: SimCtx, player: PlayerId, sid: SettlementId, item: string): string | null => {
  const { state, content } = ctx;
  const s = state.settlements[sid];
  const p = state.players[player];
  if (!s || !p || s.owner !== player) return 'That settlement is not yours.';
  const kind = itemKind(content, item);
  if (kind === 'wonder' && !WONDERS_PURCHASABLE) return 'Wonders cannot be bought; they must be built.';
  if (!canProduce(state, s, item, content)) return 'That cannot be bought here right now.';
  const gold = goldCostOf(state, s, item, content);
  if (p.stock.gold < gold) return `That costs ${gold} gold; you have ${Math.floor(p.stock.gold)}.`;
  if (!completeItem(ctx, s, item)) return 'There is no free tile around the settlement to place it.';
  p.stock.gold -= gold;
  if (s.production.item === item) s.production = { item: null, progress: 0 };
  return null;
};

export const upgradeCostOf = (state: GameState, s: Settlement, content: ContentBundle): number => {
  const mods = [...empireModifiers(state, s.owner, content), ...buildingModifiers(s, content)];
  return applyCostPercent(
    UPGRADE_COST_BASE + UPGRADE_COST_PER_POP * s.population,
    costPercentIn(mods, 'upgrade', settlementEnv(state, s, content)),
  );
};

export const upgradeSettlement = (ctx: SimCtx, player: PlayerId, sid: SettlementId): string | null => {
  const { state, content } = ctx;
  const s = state.settlements[sid];
  const p = state.players[player];
  if (!s || !p || s.owner !== player) return 'That settlement is not yours.';
  if (s.kind === 'city') return `${s.name} is already a city.`;
  const cost = upgradeCostOf(state, s, content);
  if (p.stock.gold < cost) return `Upgrading ${s.name} costs ${cost} gold; you have ${Math.floor(p.stock.gold)}.`;
  p.stock.gold -= cost;
  s.kind = 'city';
  addChronicle(state, player, 'city', s.id, `${s.name} became a city.`);
  return null;
};

// --- Start of turn --------------------------------------------------------------

/** Growth and starvation (GDD §7). Unrest stops growth. */
export const growSettlement = (ctx: SimCtx, s: Settlement, y: YieldRecord, happiness: number): void => {
  let surplus = y.food - FOOD_PER_POP * s.population;
  if (happiness < UNREST_THRESHOLD) surplus = Math.min(0, surplus);
  s.foodStored = Math.round((s.foodStored + surplus) * 100) / 100;
  const cost = growthCost(s.population);
  if (s.foodStored >= cost) {
    s.foodStored = Math.round((s.foodStored - cost) * 100) / 100;
    s.population++;
    claimTiles(ctx.state, s, borderRadius(s.population));
    ctx.events.push({ type: 'settlementGrew', settlement: s.id, population: s.population });
  } else if (s.foodStored < 0) {
    if (s.population > 1) s.population--;
    s.foodStored = 0;
  }
};

/** Add production and finish the item if it is paid for. Towns don't produce. */
export const produceInSettlement = (ctx: SimCtx, s: Settlement, y: YieldRecord, mods: readonly Modifier[]): void => {
  const { state, content } = ctx;
  if (s.kind !== 'city') return;
  const item = s.production.item;
  if (item === null) return; // idle production is banked as gold in computeEmpire
  if (!canProduce(state, s, item, content)) {
    s.production.item = null;
    return;
  }
  s.production.progress = Math.round((s.production.progress + y.production) * 100) / 100;
  const cost = itemCost(state, s, item, content, mods);
  if (s.production.progress >= cost && completeItem(ctx, s, item)) {
    s.production.progress = Math.round((s.production.progress - cost) * 100) / 100;
    s.production.item = null;
  }
};

