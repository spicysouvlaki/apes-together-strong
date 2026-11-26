/**
 * The one modifier engine (CLAUDE.md rule 4). Every bonus in the game is a `Modifier`
 * from content; this file gathers the modifiers that apply to a player and evaluates the
 * simple empire-wide effect kinds. Tile/settlement/unit-scoped evaluation with `when`
 * conditions is built on top of `playerModifiers` by the sim core (yields, combat).
 *
 * Shared by src/sim, src/sim/ages and src/emergence. Owned by the sim core workstream:
 * extend it there, keep these exported signatures stable.
 */
import type {
  Condition,
  ContentBundle,
  Effect,
  GpKind,
  Modifier,
  UnitClass,
  YieldType,
} from '@contracts/content-schemas';
import type { GameState, PlayerId, Settlement, Tile } from '@contracts/sim-api';
import {
  DIFFICULTY_HUMAN_SETTLEMENT_HAPPINESS,
  DIFFICULTY_RIVAL_COST_PERCENT,
  DIFFICULTY_RIVAL_YIELD_PERCENT,
  DIFFICULTY_YIELDS,
} from './constants';
import { ci, isWater, neighborTiles } from './lookup';

type EffectOf<K extends Effect['kind']> = Extract<Effect, { kind: K }>;

/**
 * Every modifier currently applying to `player`, from all sources: leader, dream, government
 * (not during anarchy), traditions, hybrids, seated figures' cabinetModifiers (not during
 * anarchy), completed techs/civics, wonders owned, suzerainties, active crisis pressure and
 * timed effects. Building modifiers are per-settlement and are NOT included here.
 * Deployed figures' `unitModifiers` apply to that unit and adjacent friendly units (commander
 * aura) and are handled in combat, not here.
 */
export const playerModifiers = (state: GameState, playerId: PlayerId, content: ContentBundle): Modifier[] => {
  const p = state.players[playerId];
  if (!p) return [];
  const out: Modifier[] = [];
  const leader = content.leaders.find((l) => l.id === p.leader);
  if (leader) out.push(...leader.modifiers);
  const dream = content.dreams.find((d) => d.id === p.dream);
  if (dream) out.push(...dream.modifiers);
  if (p.anarchyTurns <= 0) {
    const gov = content.governments.find((g) => g.id === p.government);
    if (gov) out.push(...gov.modifiers);
    for (const key of Object.keys(p.cabinet)) {
      const figId = p.cabinet[key];
      if (!figId) continue;
      const fig = content.figures.find((f) => f.id === figId);
      if (fig) out.push(...fig.cabinetModifiers);
    }
  }
  for (const id of p.traditions) {
    const t = content.traditions.find((x) => x.id === id);
    if (t) out.push(...t.modifiers);
  }
  for (const id of p.hybrids) {
    const h = content.hybrids.find((x) => x.id === id);
    if (h) out.push(...h.modifiers);
  }
  for (const id of p.techs) {
    const t = content.techs.find((x) => x.id === id);
    if (t) out.push(...t.modifiers);
  }
  for (const w of content.wonders) {
    if (state.wonders[w.id]?.owner === playerId) out.push(...w.modifiers);
  }
  for (const cs of content.cityStates) {
    const s = state.cityStates[cs.id];
    if (s && s.alive && s.suzerain === playerId) out.push(...cs.suzerainModifiers);
  }
  if (state.crisis) {
    const crisis = content.crises.find((c) => c.id === state.crisis?.id);
    if (crisis) out.push(...crisis.pressure);
  }
  for (const e of p.effects) {
    if (e.untilTurn === -1 || e.untilTurn >= state.turn) out.push(...e.modifiers);
  }
  out.push(...difficultyModifiers(state.difficulty ?? 'normal', p.isHuman));
  return out;
};

/**
 * Difficulty as ordinary modifiers (GDD §9: rivals get yield bonuses, never hidden
 * information), so it goes through the same engine as every other bonus. 'normal' adds none.
 */
export const difficultyModifiers = (difficulty: GameState['difficulty'], isHuman: boolean): Modifier[] => {
  const out: Modifier[] = [];
  if (isHuman) {
    const happiness = DIFFICULTY_HUMAN_SETTLEMENT_HAPPINESS[difficulty];
    if (happiness) out.push({ scope: 'settlement', effect: { kind: 'yield', yield: 'happiness', add: happiness } });
    return out;
  }
  const percent = DIFFICULTY_RIVAL_YIELD_PERCENT[difficulty];
  if (percent) for (const y of DIFFICULTY_YIELDS) out.push({ scope: 'empire', effect: { kind: 'yield', yield: y, percent } });
  const cost = DIFFICULTY_RIVAL_COST_PERCENT[difficulty];
  if (cost) for (const target of ['unit', 'building'] as const) out.push({ scope: 'empire', effect: { kind: 'cost', target, percent: cost } });
  return out;
};

/** All effects of one kind among `mods`, ignoring `when` (use for unconditional empire effects). */
export const effectsOfKind = <K extends Effect['kind']>(mods: readonly Modifier[], kind: K): EffectOf<K>[] => {
  const out: EffectOf<K>[] = [];
  for (const m of mods) if (m.effect.kind === kind) out.push(m.effect as EffectOf<K>);
  return out;
};

/** Total % bonus to a great-people pool, e.g. 25 for +25%. */
export const gpPercent = (mods: readonly Modifier[], gp: GpKind): number =>
  effectsOfKind(mods, 'gpPoints').reduce((sum, e) => (e.gp === gp ? sum + e.percent : sum), 0);

/** Total % bonus to affinity gain for `culture` (effects with no culture apply to all). */
export const affinityPercent = (mods: readonly Modifier[], culture: string): number =>
  effectsOfKind(mods, 'affinityGain').reduce(
    (sum, e) => (e.culture === undefined || e.culture === culture ? sum + e.percent : sum),
    0,
  );

/** Total % cost change for a target, e.g. -15. */
export const costPercent = (mods: readonly Modifier[], target: EffectOf<'cost'>['target']): number =>
  effectsOfKind(mods, 'cost').reduce((sum, e) => (e.target === target ? sum + e.percent : sum), 0);

/** Apply a summed percent to a base cost; never below 1. */
export const applyCostPercent = (base: number, percent: number): number =>
  Math.max(1, Math.round(base * (1 + Math.max(-90, percent) / 100)));

/** Sum of an integer `add` effect kind (settlementCap, tradeRoutes, vision). */
export const sumAdd = (mods: readonly Modifier[], kind: 'settlementCap' | 'tradeRoutes' | 'vision'): number =>
  effectsOfKind(mods, kind).reduce((sum, e) => sum + e.add, 0);

/** Extra cabinet slot ids granted by modifiers. */
export const extraCabinetSlots = (mods: readonly Modifier[]): string[] =>
  effectsOfKind(mods, 'cabinetSlot').map((e) => e.slot);

export const hasIgnoreCold = (mods: readonly Modifier[]): boolean => mods.some((m) => m.effect.kind === 'ignoreCold');

export const hasUnlock = (mods: readonly Modifier[], what: EffectOf<'unlock'>['what'], id: string): boolean =>
  effectsOfKind(mods, 'unlock').some((e) => e.what === what && e.id === id);

// ---------------------------------------------------------------------------
// Scoped evaluation with `when` conditions. This is the ONE place conditions are
// interpreted (CLAUDE.md rule 4); yields, combat, movement, vision and costs all go
// through it.
// ---------------------------------------------------------------------------

/** What a condition is evaluated against. Fields that do not apply are left out. */
export interface CondEnv {
  state: GameState;
  content: ContentBundle;
  player: PlayerId;
  /** The tile in question: the worked tile, the settlement's center, or the unit's tile. */
  tile?: Tile;
  /** The settlement in question (for tile scope: the settlement working the tile). */
  settlement?: Settlement;
  unitClass?: UnitClass;
}

/** True when `player` is at war with anyone (players or city-states; raiders don't count). */
export const atWarWithAnyone = (state: GameState, player: PlayerId): boolean => {
  for (const key of Object.keys(state.wars)) {
    const [a, b] = key.split('|');
    if (a === player || b === player) return true;
  }
  return false;
};

const tileIsCoastal = (env: CondEnv, tile: Tile): boolean =>
  neighborTiles(env.state.map, tile).some((t) => isWater(t, env.content));

export const conditionMatches = (when: Condition | undefined, env: CondEnv): boolean => {
  if (!when) return true;
  const { tile, settlement } = env;
  if (when.terrain && !(tile && when.terrain.includes(tile.terrain))) return false;
  if (when.feature && !(tile && tile.feature !== null && when.feature.includes(tile.feature))) return false;
  if (when.resource && !(tile && tile.resource !== null && when.resource.includes(tile.resource))) return false;
  if (when.climate && !(tile && when.climate.includes(tile.climate))) return false;
  if (when.river !== undefined && !(tile && tile.river === when.river)) return false;
  if (when.coastal !== undefined && !(tile && tileIsCoastal(env, tile) === when.coastal)) return false;
  if (
    when.adjacentTerrain &&
    !(tile && neighborTiles(env.state.map, tile).some((n) => when.adjacentTerrain?.includes(n.terrain)))
  )
    return false;
  if (when.cityMinPop !== undefined && !(settlement && settlement.population >= when.cityMinPop)) return false;
  if (when.cityMaxPop !== undefined && !(settlement && settlement.population <= when.cityMaxPop)) return false;
  if (when.settlementKind !== undefined && !(settlement && settlement.kind === when.settlementKind)) return false;
  if (when.capital !== undefined && !(settlement && settlement.isCapital === when.capital)) return false;
  if (when.unitClass && !(env.unitClass && when.unitClass.includes(env.unitClass))) return false;
  if (when.age && !when.age.includes(env.state.age)) return false;
  if (when.atWar !== undefined && atWarWithAnyone(env.state, env.player) !== when.atWar) return false;
  if (when.minTradeRoutes !== undefined) {
    let n = 0;
    for (const r of env.state.tradeRoutes) if (r.owner === env.player) n++;
    if (n < when.minTradeRoutes) return false;
  }
  return true;
};

/**
 * `playerModifiers` plus the empire- and unit-scoped modifiers of buildings in the player's
 * settlements (a building's settlement/tile-scoped modifiers stay local to its settlement).
 */
export const empireModifiers = (state: GameState, playerId: PlayerId, content: ContentBundle): Modifier[] => {
  const out = playerModifiers(state, playerId, content);
  const buildings = ci(content).buildings;
  for (const sid of Object.keys(state.settlements)) {
    const s = state.settlements[sid];
    if (!s || s.owner !== playerId) continue;
    for (const b of s.buildings) {
      const def = buildings[b];
      if (!def) continue;
      for (const m of def.modifiers) if (m.scope === 'empire' || m.scope === 'unit') out.push(m);
    }
  }
  return out;
};

/** Modifiers of the buildings in one settlement (all scopes). */
export const buildingModifiers = (settlement: Settlement, content: ContentBundle): Modifier[] => {
  const out: Modifier[] = [];
  const buildings = ci(content).buildings;
  for (const b of settlement.buildings) {
    const def = buildings[b];
    if (def) out.push(...def.modifiers);
  }
  return out;
};

export interface YieldMods {
  add: Partial<Record<YieldType, number>>;
  percent: Partial<Record<YieldType, number>>;
}

/** Sum the `yield` effects among `mods` with the given scope whose conditions hold in `env`. */
export const yieldMods = (mods: readonly Modifier[], scope: Modifier['scope'], env: CondEnv): YieldMods => {
  const out: YieldMods = { add: {}, percent: {} };
  for (const m of mods) {
    if (m.scope !== scope || m.effect.kind !== 'yield') continue;
    if (!conditionMatches(m.when, env)) continue;
    const e = m.effect;
    if (e.add !== undefined) out.add[e.yield] = (out.add[e.yield] ?? 0) + e.add;
    if (e.percent !== undefined) out.percent[e.yield] = (out.percent[e.yield] ?? 0) + e.percent;
  }
  return out;
};

/** Unit-level effects (combat, movement, vision) count from 'unit' and 'empire' scope. */
const unitLevel = (m: Modifier): boolean => m.scope === 'unit' || m.scope === 'empire';

/** Sum of `combat` effects applying to a unit in `env`, against an opponent of class `vs` (null = a settlement). */
export const combatBonus = (mods: readonly Modifier[], env: CondEnv, vs: UnitClass | null): number => {
  let sum = 0;
  for (const m of mods) {
    if (!unitLevel(m) || m.effect.kind !== 'combat') continue;
    if (m.effect.vs !== undefined && m.effect.vs !== vs) continue;
    if (!conditionMatches(m.when, env)) continue;
    sum += m.effect.add;
  }
  return sum;
};

/** Sum of an additive unit-level effect (movement, vision) whose conditions hold. */
export const unitAdd = (mods: readonly Modifier[], kind: 'movement' | 'vision', env: CondEnv): number => {
  let sum = 0;
  for (const m of mods) {
    if (!unitLevel(m) || m.effect.kind !== kind) continue;
    if (!conditionMatches(m.when, env)) continue;
    sum += m.effect.add;
  }
  return sum;
};

/** `costPercent` restricted to modifiers whose conditions hold for `env` (e.g. capital-only discounts). */
export const costPercentIn = (mods: readonly Modifier[], target: EffectOf<'cost'>['target'], env: CondEnv): number => {
  let sum = 0;
  for (const m of mods) {
    if (m.effect.kind !== 'cost' || m.effect.target !== target) continue;
    if (!conditionMatches(m.when, env)) continue;
    sum += m.effect.percent;
  }
  return sum;
};

/** Embark is unlocked by a `unlock embark` modifier from any source (leader, tech, tradition). */
export const canEmbark = (mods: readonly Modifier[]): boolean => effectsOfKind(mods, 'unlock').some((e) => e.what === 'embark');
