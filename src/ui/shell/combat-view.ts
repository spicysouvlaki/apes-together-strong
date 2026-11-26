/**
 * The attack confirmation (GDD §7 "Combat", §11 "Touch"): what the sheet shows before an attack
 * and what a tap on an attackable tile does. Pure. Every number comes from
 * `SimQueries.combatPreview`; this module only words it and decides which step of the
 * tap -> preview -> attack flow a tap is. No combat rule is computed here.
 */
import { hexEquals, type Hex } from '@contracts/hex';
import type { CombatPreview } from '@contracts/sim-api';

export type OutlookTone = 'good' | 'even' | 'bad';

export const OUTLOOK_WORD: Record<CombatPreview['outlook'], string> = {
  decisive: 'Decisive',
  favorable: 'Favorable',
  even: 'Even fight',
  risky: 'Risky',
  reckless: 'Reckless',
};

export const OUTLOOK_TONE: Record<CombatPreview['outlook'], OutlookTone> = {
  decisive: 'good',
  favorable: 'good',
  even: 'even',
  risky: 'bad',
  reckless: 'bad',
};

/** One line under the outlook word: what it means for the attacker, in plain words. */
export const OUTLOOK_NOTE: Record<CombatPreview['outlook'], string> = {
  decisive: 'They will likely break.',
  favorable: 'The odds are with you.',
  even: 'Both sides will bleed.',
  risky: 'You may come off worse.',
  reckless: 'Your unit will likely fall.',
};

export interface CombatSideView {
  name: string;
  strength: number;
  /** HP before the fight. */
  hp: number;
  /** HP left after the fight: expected, and the range from the best to the worst roll. */
  after: { expected: number; best: number; worst: number };
  /** Damage taken (expected, min, max) as the contract gives it. */
  damage: { expected: number; min: number; max: number };
  /** 'never' (no damage possible), 'maybe' (the worst roll kills), 'likely' (expected roll kills). */
  falls: 'never' | 'safe' | 'maybe' | 'likely';
}

export interface CombatFactorView {
  label: string;
  /** "+3", "−5" (true minus sign). */
  value: string;
  side: 'attacker' | 'defender';
  /** Helps the attacker (an attacker bonus or a defender malus). */
  helps: boolean;
}

export interface CombatView {
  kind: CombatPreview['kind'];
  ranged: boolean;
  attacker: CombatSideView;
  defender: CombatSideView;
  factors: CombatFactorView[];
  outlook: { word: string; note: string; tone: OutlookTone };
  /** "This will declare war on Rome." when attacking needs a declaration. */
  warLine: string | null;
  /** Short verb line: "Melee attack", "Ranged attack: no return fire", "Assault the walls", "Take the city". */
  kindLine: string;
  confirmLabel: string;
  /** For screen readers: the whole read in one sentence. */
  summary: string;
}

const clampHp = (n: number, hp: number): number => Math.max(0, Math.min(hp, Math.round(n)));

const sideView = (name: string, strength: number, hp: number, dmg: CombatPreview['damageToDefender']): CombatSideView => {
  const expected = clampHp(hp - dmg.expected, hp);
  const best = clampHp(hp - dmg.min, hp);
  const worst = clampHp(hp - dmg.max, hp);
  const falls: CombatSideView['falls'] = dmg.max <= 0 ? 'never' : expected <= 0 ? 'likely' : worst <= 0 ? 'maybe' : 'safe';
  return {
    name,
    strength: Math.round(strength),
    hp: Math.round(hp),
    after: { expected, best, worst },
    damage: { expected: Math.round(dmg.expected), min: Math.round(dmg.min), max: Math.round(dmg.max) },
    falls,
  };
};

/** "+3" / "−5": factors read like a ledger. */
export const signedFactor = (v: number): string => (v >= 0 ? `+${Math.round(v)}` : `−${Math.abs(Math.round(v))}`);

const KIND_LINE = (p: CombatPreview, defender: string): string => {
  if (p.kind === 'capture') return `Take ${defender}`;
  if (p.kind === 'walls') return p.ranged ? 'Bombard the walls' : 'Assault the walls';
  return p.ranged ? 'Ranged attack: no return fire' : 'Melee attack';
};

export interface CombatNames {
  attacker: string;
  /** The defending unit, or the settlement for walls/capture. */
  defender: string;
  /** Who owns the target (for the war line). */
  defenderOwner: string;
}

export const combatView = (p: CombatPreview, n: CombatNames): CombatView => {
  const attacker = sideView(n.attacker, p.attackerStrength, p.attackerHp, p.damageToAttacker);
  const defender = sideView(n.defender, p.defenderStrength, p.defenderHp, p.damageToDefender);
  const factors = [...p.factors]
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .map((f) => ({ label: f.label, value: signedFactor(f.value), side: f.side, helps: f.side === 'attacker' ? f.value >= 0 : f.value < 0 }));
  const outlook = { word: OUTLOOK_WORD[p.outlook], note: OUTLOOK_NOTE[p.outlook], tone: OUTLOOK_TONE[p.outlook] };
  const warLine = p.needsWar ? `This will declare war on ${n.defenderOwner}.` : null;
  const confirmLabel = p.needsWar ? 'Declare war and attack' : p.kind === 'capture' ? 'Take it' : 'Attack';
  const kindLine = KIND_LINE(p, n.defender);
  const summary =
    p.kind === 'capture'
      ? `${n.attacker} can take ${n.defender}. ${warLine ?? ''}`.trim()
      : `${n.attacker}, strength ${attacker.strength}, against ${n.defender}, strength ${defender.strength}. ` +
        `${n.defender} is left with about ${defender.after.expected} of ${defender.hp} health; ` +
        `${n.attacker} with about ${attacker.after.expected} of ${attacker.hp}. ${outlook.word}. ${warLine ?? ''}`.trim();
  return { kind: p.kind, ranged: p.ranged, attacker, defender, factors, outlook, warLine, kindLine, confirmLabel, summary };
};

/** Percent widths for an HP bar: what stays for sure, the band the roll decides, what is lost for sure. */
export const hpBands = (s: CombatSideView): { kept: number; risk: number; lost: number } => {
  // Drawn against full health (100, or more for walls) so a wounded unit looks wounded.
  const scale = Math.max(100, s.hp);
  const pct = (x: number): number => Math.round((x / scale) * 1000) / 10;
  const kept = pct(s.after.worst);
  const risk = pct(s.after.best - s.after.worst);
  const lost = pct(s.hp - s.after.best);
  return { kept, risk, lost };
};

// --- The tap flow ------------------------------------------------------------------

/** A previewed attack, waiting for the player's answer. */
export interface ArmedAttack {
  unit: string;
  target: Hex;
}

export type AttackStep =
  /** No preview from the sim (stub or unknown target): the old flow. */
  | { kind: 'legacy' }
  /** Show the confirm sheet. */
  | { kind: 'sheet' }
  /** "Confirm attacks" is off: show the preview inline in the unit sheet; the next tap attacks. */
  | { kind: 'arm' }
  /** The second tap on an armed target: attack now. */
  | { kind: 'attack' };

/**
 * What a tap on an attackable (or war-declarable) tile does. With the setting on (default) every
 * attack goes through the sheet. With it off, the first tap arms the target and shows the
 * preview in the unit sheet; a second tap on the same target attacks.
 */
export const attackStep = (opts: { hasPreview: boolean; confirmSetting: boolean; armed: ArmedAttack | null; unit: string; target: Hex }): AttackStep => {
  if (!opts.hasPreview) return { kind: 'legacy' };
  if (opts.confirmSetting) return { kind: 'sheet' };
  const a = opts.armed;
  if (a && a.unit === opts.unit && hexEquals(a.target, opts.target)) return { kind: 'attack' };
  return { kind: 'arm' };
};
