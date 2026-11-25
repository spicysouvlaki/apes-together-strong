/**
 * The operational economy (GDD §9): what each city builds, when gold buys items or turns towns
 * into cities, and where spare influence goes. One empire-wide plan is computed per turn so
 * per-city choices agree (one settler in flight, one wonder at a time, enough defenders).
 */
import type { ContentBundle, LegacyTrack, UnitDef } from '@contracts/content-schemas';
import { hexDistance } from '@contracts/hex';
import type { ProductionOption, Settlement } from '@contracts/sim-api';
import { tradeRouteCap } from '../sim/diplomacy';
import { ci, playerSettlements } from '../sim/lookup';
import { queries } from '../sim/queries';
import { exec, me, type AiCtx } from './ctx';
import { buildingValue, figureOf } from './decisions';
import { ownedLuxuries, siteLegal, siteScore } from './sites';
import { enemiesAtWar, hostilesNear, isMilitary, ownSettlements, ownUnits } from './world';

/** Sites scoring below this are not worth a settler. */
export const MIN_SITE_SCORE = 14;
/** How far from our nearest settlement a new site may be. */
export const MAX_SITE_DISTANCE = 9;
/** Gold kept back for emergencies. */
const GOLD_RESERVE = 40;
/** Wonders slower than this many turns in a city are not started. */
const MAX_WONDER_TURNS = 40;
/** Buildings slower than this are skipped unless nothing else fits. */
const MAX_BUILDING_TURNS = 30;

export interface Site {
  idx: number;
  score: number;
}

export interface EmpirePlan {
  focus: LegacyTrack;
  settlements: number;
  cap: number;
  settlersOwned: number;
  settlersQueued: number;
  military: number;
  militaryQueued: number;
  armyTarget: number;
  scouts: number;
  merchants: number;
  routes: number;
  routeCap: number;
  tradePartners: number;
  wondersQueued: number;
  /** Wonder ids some own city is already building (never two cities on one wonder). */
  wonderItems: string[];
  atWar: boolean;
  rushFigures: number;
  sites: Site[];
  goldIncome: number;
  happiness: number;
}

const unitDef = (content: ContentBundle, id: string | null): UnitDef | undefined => (id ? ci(content).units[id] : undefined);

/** Candidate settlement sites near our empire, best first. */
export const findSites = (ai: AiCtx): Site[] => {
  const { state, player, content } = ai;
  const own = ownSettlements(state, player);
  const origins = own.length > 0 ? own.map((s) => s.at) : ownUnits(state, player).map((u) => u.at);
  if (origins.length === 0) return [];
  const lux = ownedLuxuries(state, player, content);
  const explored = me(ai).explored;
  const out: Site[] = [];
  const n = state.map.tiles.length;
  for (let i = 0; i < n; i++) {
    if (!explored[i]) continue;
    const tile = state.map.tiles[i];
    if (!tile) continue;
    let near = Infinity;
    for (const o of origins) near = Math.min(near, hexDistance(o, tile));
    if (near > MAX_SITE_DISTANCE) continue;
    if (!siteLegal(state, player, i, content)) continue;
    const score = siteScore(state, player, i, content, ai.persona, lux);
    if (score < MIN_SITE_SCORE) continue;
    // Prefer compact empires: distance beyond 5 costs a little.
    out.push({ idx: i, score: score - Math.max(0, near - 5) * 1.5 });
  }
  out.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return out;
};

const tradePartnerCount = (ai: AiCtx): number => {
  const { state, player } = ai;
  const home = playerSettlements(state, player);
  let n = 0;
  for (const id of Object.keys(state.settlements)) {
    const s = state.settlements[id];
    if (!s || s.owner === player) continue;
    if (enemiesAtWar(state, player).includes(s.owner)) continue;
    if (state.tradeRoutes.some((r) => r.owner === player && r.to === s.id)) continue;
    if (home.some((h) => hexDistance(h.at, s.at) <= 10)) n++;
  }
  return n;
};

export const makePlan = (ai: AiCtx, focus: LegacyTrack): EmpirePlan => {
  const { state, player, content } = ai;
  const p = me(ai);
  const units = ownUnits(state, player);
  const own = ownSettlements(state, player);
  const idx = ci(content);
  let settlersQueued = 0;
  let militaryQueued = 0;
  let wondersQueued = 0;
  const wonderItems: string[] = [];
  for (const s of own) {
    const item = s.production.item;
    if (!item) continue;
    const u = idx.units[item];
    if (u?.canFound) settlersQueued++;
    else if (u && u.unitClass !== 'civilian') militaryQueued++;
    if (idx.wonders[item]) {
      wondersQueued++;
      wonderItems.push(item);
    }
  }
  const military = units.filter((u) => isMilitary(u) && !u.figure).length;
  const atWar = enemiesAtWar(state, player).length > 0;
  const pe = ai.persona;
  const base = own.length + 1 + Math.floor(pe.w.warmonger * own.length * 0.5);
  const armyTarget = atWar ? base + 3 + pe.w.warmonger * 2 : base + (state.crisis ? 1 : 0);
  let rushFigures = 0;
  for (const id of Object.keys(state.figures)) {
    const f = state.figures[id];
    if (!f || f.owner !== player || f.location.state !== 'based') continue;
    if (figureOf(content, id)?.activate?.effect === 'rush_wonder') rushFigures++;
  }
  return {
    focus,
    settlements: own.length,
    cap: queries.settlementCap(state, player, content),
    settlersOwned: units.filter((u) => idx.units[u.type]?.canFound).length,
    settlersQueued,
    military,
    militaryQueued,
    armyTarget,
    scouts: units.filter((u) => {
      const d = idx.units[u.type];
      return !!d && d.unitClass === 'civilian' && !d.canFound && !d.canTrade;
    }).length,
    merchants: units.filter((u) => idx.units[u.type]?.canTrade && !u.figure).length,
    routes: state.tradeRoutes.filter((r) => r.owner === player).length,
    routeCap: tradeRouteCap(state, player, content),
    tradePartners: tradePartnerCount(ai),
    wondersQueued,
    wonderItems,
    atWar,
    rushFigures,
    sites: findSites(ai),
    goldIncome: p.income.gold,
    happiness: p.happiness,
  };
};

/** Best military unit on offer: strength per cost, with a bias for raw strength. */
const bestMilitary = (ai: AiCtx, opts: ProductionOption[], wantRanged: boolean, wantSiege = false): ProductionOption | null => {
  let best: ProductionOption | null = null;
  let bestScore = -Infinity;
  for (const o of opts) {
    if (o.kind !== 'unit') continue;
    const d = unitDef(ai.content, o.item);
    if (!d || d.unitClass === 'civilian' || d.unitClass === 'naval' || d.unitClass === 'commander') continue;
    const str = Math.max(d.strength, d.rangedStrength ?? 0);
    let s = str * 2 - o.cost * 0.15;
    if (wantRanged && d.rangedStrength) s += 8;
    if (d.unitClass === 'siege') s += wantSiege ? 25 : -10;
    if (s > bestScore) {
      bestScore = s;
      best = o;
    }
  }
  return best;
};

const civilianOption = (ai: AiCtx, opts: ProductionOption[], pred: (d: UnitDef) => boolean): ProductionOption | null =>
  opts.find((o) => {
    const d = unitDef(ai.content, o.item);
    return o.kind === 'unit' && !!d && pred(d);
  }) ?? null;

const isScoutDef = (d: UnitDef): boolean => d.unitClass === 'civilian' && !d.canFound && !d.canTrade && !d.figureKind;

const exploredShare = (ai: AiCtx): number => {
  const e = me(ai).explored;
  let n = 0;
  for (const v of e) n += v;
  return e.length ? n / e.length : 1;
};

/** Pick what city `s` should make next. */
export const chooseProduction = (ai: AiCtx, s: Settlement, plan: EmpirePlan): string | null => {
  const { state, player, content } = ai;
  const pe = ai.persona;
  const opts = queries.productionOptions(state, s.id, content);
  if (opts.length === 0) return null;
  const hostiles = hostilesNear(state, player, s.at, 4);
  const garrisoned = Object.keys(state.units).some((id) => {
    const u = state.units[id];
    return !!u && u.owner === player && isMilitary(u) && u.at.q === s.at.q && u.at.r === s.at.r;
  });

  // 1. Defense first.
  if (hostiles.length > 0 && (!garrisoned || plan.military + plan.militaryQueued < plan.armyTarget)) {
    const m = bestMilitary(ai, opts, true);
    if (m) return m.item;
  }
  if (!garrisoned && plan.military + plan.militaryQueued < plan.settlements) {
    const m = bestMilitary(ai, opts, false);
    if (m) return m.item;
  }

  // 2. Expansion (GDD §7 settlement cap; happiness pays for going over).
  const expansionWanted =
    plan.settlements + plan.settlersOwned + plan.settlersQueued < plan.cap &&
    plan.settlersOwned + plan.settlersQueued < 1 + (pe.w.expansionist > 0 ? 1 : 0) &&
    plan.sites.length > plan.settlersOwned + plan.settlersQueued &&
    hostiles.length === 0 &&
    // Happiness pays for sprawl (GDD §7): don't settle into unrest.
    plan.happiness >= (pe.w.expansionist > 0 ? -1 : 1) &&
    (s.population >= 2 || (s.isCapital && state.turn < 12));
  if (expansionWanted) {
    const st = civilianOption(ai, opts, (d) => d.canFound);
    if (st) {
      plan.settlersQueued++;
      return st.item;
    }
  }

  // 3. War production.
  if (plan.atWar && plan.military + plan.militaryQueued < plan.armyTarget) {
    // Every third unit ranged, every fourth a siege engine for the walls.
    const n = plan.military + plan.militaryQueued;
    const m = bestMilitary(ai, opts, n % 3 === 2, n % 4 === 3);
    if (m) {
      plan.militaryQueued++;
      return m.item;
    }
  }

  // 4. Scouting and trade.
  if (plan.scouts === 0 && state.turn < 80 && exploredShare(ai) < 0.45) {
    const sc = civilianOption(ai, opts, isScoutDef);
    if (sc) {
      plan.scouts++;
      return sc.item;
    }
  }
  if (plan.routes + plan.merchants < plan.routeCap && plan.tradePartners > plan.merchants) {
    const mc = civilianOption(ai, opts, (d) => d.canTrade);
    if (mc) {
      plan.merchants++;
      return mc.item;
    }
  }

  // 5. Peacetime army upkeep: below target, and income can carry it.
  if (plan.military + plan.militaryQueued < plan.armyTarget && (plan.goldIncome > 2 || plan.military < plan.settlements)) {
    const m = bestMilitary(ai, opts, plan.military % 3 === 2);
    if (m) {
      plan.militaryQueued++;
      return m.item;
    }
  }

  // 6. Wonders vs buildings, by value per turn.
  let best: string | null = null;
  let bestScore = 0;
  const wonderLimit = 1 + (pe.w.builder > 0 ? 1 : 0);
  for (const o of opts) {
    if (o.turns === null) continue;
    let v = 0;
    if (o.kind === 'building') {
      if (o.turns > MAX_BUILDING_TURNS) continue;
      v = buildingValue(content, o.item, pe);
      const def = ci(content).buildings[o.item];
      // Unhappy empires value amenities much more (unrest stops growth below −10).
      if (def && plan.happiness < 5) v += (def.yields.happiness ?? 0) * (5 - plan.happiness) * 0.6;
      if (def && def.defense > 0 && hostiles.length > 0) v += 4;
      v = (v + 0.5) / Math.max(1, o.cost / 40);
    } else if (o.kind === 'wonder') {
      if (o.turns > MAX_WONDER_TURNS || plan.wondersQueued >= wonderLimit || plan.wonderItems.includes(o.item)) continue;
      const w = ci(content).wonders[o.item];
      if (!w) continue;
      v = 2 + 1.5 * pe.w.builder + (plan.focus === 'culture' ? 2 : 0) + plan.rushFigures * 1.5;
      for (const amount of Object.values(w.yields)) v += (amount ?? 0) * 0.5;
      v = v / Math.max(1, o.cost / 120);
    } else continue;
    if (v > bestScore) {
      bestScore = v;
      best = o.item;
    }
  }
  if (best) {
    if (ci(content).wonders[best]) {
      plan.wondersQueued++;
      plan.wonderItems.push(best);
    }
    return best;
  }

  // 7. Fallbacks: a soldier if affordable, else the cheapest building, else nothing (banks gold).
  if (plan.military < plan.armyTarget + 2 && plan.goldIncome > 4) {
    const m = bestMilitary(ai, opts, false);
    if (m) return m.item;
  }
  const cheapest = opts.filter((o) => o.kind === 'building').sort((a, b) => a.cost - b.cost)[0];
  return cheapest?.item ?? null;
};

export const manageProduction = (ai: AiCtx, plan: EmpirePlan): void => {
  for (const s of ownSettlements(ai.state, ai.player)) {
    if (s.kind !== 'city' || s.production.item !== null) continue;
    const item = chooseProduction(ai, s, plan);
    if (item) exec(ai, { type: 'setProduction', settlement: s.id, item });
  }
};

/** Spend gold: emergency defenders, town → city upgrades, then rushing useful items. */
export const spendGold = (ai: AiCtx, plan: EmpirePlan): void => {
  const { state, player, content } = ai;
  const gold = (): number => me(ai).stock.gold;
  const own = ownSettlements(state, player);
  const reserve = GOLD_RESERVE + (plan.goldIncome < 0 ? 40 : 0);

  // Emergency: an ungarrisoned settlement with enemies close.
  for (const s of own) {
    if (hostilesNear(ai.state, player, s.at, 3).length === 0) continue;
    const garrisoned = Object.keys(ai.state.units).some((id) => {
      const u = ai.state.units[id];
      return !!u && u.owner === player && isMilitary(u) && u.at.q === s.at.q && u.at.r === s.at.r;
    });
    if (garrisoned) continue;
    // productionOptions is empty for towns; they get their defenders from nearby cities.
    const m = bestMilitary(ai, queries.productionOptions(ai.state, s.id, content), true);
    if (m && m.goldCost <= gold()) exec(ai, { type: 'buyItem', settlement: s.id, item: m.item });
  }

  // Towns become cities (they then produce, research and host figures).
  const towns = ownSettlements(ai.state, player)
    .filter((s) => s.kind === 'town')
    .map((s) => ({ s, cost: queries.upgradeCost(ai.state, s.id, content) }))
    .sort((a, b) => a.cost - b.cost || (a.s.id < b.s.id ? -1 : 1));
  let saving = 0;
  for (const t of towns) {
    if (gold() - t.cost < reserve) {
      saving = t.cost;
      break;
    }
    exec(ai, { type: 'upgradeSettlement', settlement: t.s.id });
  }

  // Rush the cheapest-to-finish items when gold piles up (keeping savings for a town upgrade).
  for (let guard = 0; guard < 3 && gold() > 120 + reserve + saving; guard++) {
    const cities = ownSettlements(ai.state, player).filter((s) => s.kind === 'city' && s.production.item !== null);
    let pickS: Settlement | null = null;
    let pickCost = Infinity;
    for (const s of cities) {
      const item = s.production.item;
      if (!item || ci(content).wonders[item]) continue;
      const opt = queries.productionOptions(ai.state, s.id, content).find((o) => o.item === item);
      if (!opt || (opt.turns ?? 99) <= 2) continue;
      if (opt.goldCost < pickCost) {
        pickCost = opt.goldCost;
        pickS = s;
      }
    }
    if (!pickS || !pickS.production.item || gold() - pickCost < reserve + saving + 40) break;
    if (!exec(ai, { type: 'buyItem', settlement: pickS.id, item: pickS.production.item })) break;
  }
};

/** Spare influence buys envoys: toward a suzerainty we can win, or a culture we already favour. */
export const sendEnvoys = (ai: AiCtx): void => {
  const { state, player, content } = ai;
  const keep = enemiesAtWar(state, player).length > 0 ? 45 : 10;
  const weights = queries.cultureWeights(state, player, content);
  const own = ownSettlements(state, player);
  for (let guard = 0; guard < 3; guard++) {
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const def of content.cityStates) {
      const cs = ai.state.cityStates[def.id];
      if (!cs || !cs.alive) continue;
      const settlement = ai.state.settlements[cs.settlement];
      if (!settlement) continue;
      const cost = queries.envoyCost(ai.state, player, def.id, content);
      if (me(ai).stock.influence - cost < keep) continue;
      const mine = cs.envoys[player] ?? 0;
      let rival = 0;
      for (const [pid, n] of Object.entries(cs.envoys)) if (pid !== player) rival = Math.max(rival, n);
      let s = 0;
      if (cs.suzerain === player) s -= 1 + Math.max(0, mine - rival - 1) * 2;
      else if (mine + 1 >= 3 && mine + 1 > rival) s += 4;
      else s += 1 - Math.max(0, rival - mine) * 0.7;
      s += Math.min(4, weights[def.culture] ?? 0) * (0.3 + 0.5 * ai.persona.w.collector);
      let dist = Infinity;
      for (const o of own) dist = Math.min(dist, hexDistance(o.at, settlement.at));
      s -= Math.min(20, dist) * 0.1;
      s -= cost / 40;
      if (s > bestScore) {
        bestScore = s;
        best = def.id;
      }
    }
    if (!best || !exec(ai, { type: 'sendEnvoy', cityState: best })) return;
  }
};
