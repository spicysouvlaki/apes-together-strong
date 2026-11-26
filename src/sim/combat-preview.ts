/**
 * `queries.combatPreview` (attack confirmation UI, GDD §7 "Combat"): the expected outcome of
 * an attack, computed with the very same `planAttack` and strength breakdowns that
 * `resolveAttack` sums (src/sim/combat.ts), so the preview and the rules can never disagree.
 * The roll r ∈ [COMBAT_RANDOM_MIN, COMBAT_RANDOM_MAX] gives min/max; its mean gives `expected`.
 * Pure: no RNG draw, no mutation, and only what the attacker's owner can currently see.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { CombatPreview, GameState, UnitId } from '@contracts/sim-api';
import type { Hex } from '@contracts/hex';
import { attackBreakdown, combatDamage, defenseBreakdown, isHostile, planAttack, settlementBreakdown, type StrengthBreakdown } from './combat';
import { COMBAT_RANDOM_MAX, COMBAT_RANDOM_MIN } from './constants';
import { tileIndex } from './lookup';
import { visibleTileSet } from './units';

/** Outlook thresholds (damage the attacker takes over damage it deals, expected rolls). */
export const OUTLOOK_FAVORABLE_RATIO = 0.67;
export const OUTLOOK_RISKY_RATIO = 1.25;
export const OUTLOOK_RECKLESS_RATIO = 2;

const ROLL_MEAN = (COMBAT_RANDOM_MIN + COMBAT_RANDOM_MAX) / 2;

interface Range {
  expected: number;
  min: number;
  max: number;
}

const NONE: Range = { expected: 0, min: 0, max: 0 };

const damageRange = (sa: number, sd: number, cap = Infinity): Range => ({
  expected: Math.min(cap, combatDamage(sa, sd, ROLL_MEAN)),
  min: Math.min(cap, combatDamage(sa, sd, COMBAT_RANDOM_MIN)),
  max: Math.min(cap, combatDamage(sa, sd, COMBAT_RANDOM_MAX)),
});

const sideFactors = (b: StrengthBreakdown, side: 'attacker' | 'defender'): CombatPreview['factors'] =>
  b.factors.map((f) => ({ label: f.label, value: f.value, side }));

/**
 * One word for the attacker's prospects. Decisive: a capture, or a sure kill at no risk of
 * dying. Reckless: the attacker is expected to die or takes over twice what it deals. Risky:
 * it might die, or takes more than it deals. Favorable: a kill is possible, or it deals clearly
 * more than it takes. Otherwise even.
 */
export const outlookOf = (kind: CombatPreview['kind'], toD: Range, toA: Range, defenderHp: number, attackerHp: number): CombatPreview['outlook'] => {
  if (kind === 'capture') return 'decisive';
  const ratio = toA.expected / Math.max(1, toD.expected);
  const mayDie = toA.max >= attackerHp;
  if (toD.min >= defenderHp && !mayDie) return 'decisive';
  if (toA.expected >= attackerHp || ratio > OUTLOOK_RECKLESS_RATIO) return 'reckless';
  if (mayDie || ratio > OUTLOOK_RISKY_RATIO) return 'risky';
  if (toD.max >= defenderHp || ratio <= OUTLOOK_FAVORABLE_RATIO) return 'favorable';
  return 'even';
};

export const combatPreview = (state: GameState, unitId: UnitId, target: Hex, content: ContentBundle): CombatPreview | null => {
  const u = state.units[unitId];
  if (!u) return null;
  const idx = tileIndex(state.map, target);
  if (idx < 0 || !visibleTileSet(state, u.owner, content).includes(idx)) return null;
  const plan = planAttack(state, u, target, content, true);
  if (typeof plan === 'string') return null;
  const { ranged, defender, settlement, civilians } = plan;
  const enemy = defender?.owner ?? settlement?.owner ?? civilians[0]?.owner ?? '';
  const needsWar = !isHostile(state, u.owner, enemy);
  const factors: CombatPreview['factors'] = [];
  let kind: CombatPreview['kind'];
  let sa = 0;
  let sd = 0;
  let toD = NONE;
  let toA = NONE;
  let defenderHp = 0;
  if (defender) {
    kind = 'unit';
    const a = attackBreakdown(state, u, { at: target, unitClass: defender.unitClass, settlement: false }, ranged, content);
    const d = defenseBreakdown(state, defender, u.unitClass, content);
    sa = a.total;
    sd = d.total;
    factors.push(...sideFactors(a, 'attacker'), ...sideFactors(d, 'defender'));
    toD = damageRange(sa, sd);
    toA = ranged ? NONE : damageRange(sd, sa);
    defenderHp = defender.hp;
  } else if (settlement && settlement.hp > 0) {
    kind = 'walls';
    const a = attackBreakdown(state, u, { at: target, unitClass: null, settlement: true }, ranged, content);
    const d = settlementBreakdown(state, settlement, content);
    sa = a.total;
    sd = d.total;
    factors.push(...sideFactors(a, 'attacker'), ...sideFactors(d, 'defender'));
    toD = damageRange(sa, sd, settlement.hp);
    toA = ranged ? NONE : damageRange(sd, sa);
    defenderHp = settlement.hp;
  } else if (settlement && u.unitClass === 'naval') {
    // Ships cannot take a city whose walls are down; the attack does nothing.
    kind = 'walls';
    defenderHp = 0;
  } else {
    kind = 'capture';
    defenderHp = settlement?.hp ?? 0;
  }
  factors.sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  return {
    kind,
    ranged,
    attackerStrength: sa,
    defenderStrength: sd,
    damageToDefender: toD,
    damageToAttacker: toA,
    defenderHp,
    attackerHp: u.hp,
    factors,
    outlook: outlookOf(kind, toD, toA, Math.max(1, defenderHp), u.hp),
    needsWar,
  };
};
