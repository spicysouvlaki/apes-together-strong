/**
 * The one modifier engine (CLAUDE.md rule 4). Every bonus in the game is a `Modifier`
 * from content; this file gathers the modifiers that apply to a player and evaluates the
 * simple empire-wide effect kinds. Tile/settlement/unit-scoped evaluation with `when`
 * conditions is built on top of `playerModifiers` by the sim core (yields, combat).
 *
 * Shared by src/sim, src/sim/ages and src/emergence. Owned by the sim core workstream:
 * extend it there, keep these exported signatures stable.
 */
import type { ContentBundle, Effect, GpKind, Modifier } from '@contracts/content-schemas';
import type { GameState, PlayerId } from '@contracts/sim-api';

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
