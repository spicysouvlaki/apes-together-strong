/**
 * The attack waiting for an answer (combat preview sheet, or the inline preview when "Confirm
 * attacks" is off). Signals and the two commands; the wording lives in combat-view.ts.
 */
import { signal } from '@preact/signals';
import type { Hex } from '@contracts/hex';
import type { CombatPreview, GameState, PlayerId, UnitId } from '@contracts/sim-api';
import { content, dispatch, lookup, ownerName, q } from '../store';
import { settlementAt, unitsAt } from './hexutil';
import { possessive } from './event-toasts';
import { combatView, type CombatView } from './combat-view';

export interface PendingAttack {
  unit: UnitId;
  target: Hex;
  /** Owner to declare war on first (from the tap intent; the preview's needsWar agrees). */
  declareWarOn: PlayerId | null;
  preview: CombatPreview;
  view: CombatView;
  /** 'sheet' = the confirm sheet is up; 'inline' = shown in the unit sheet, a second tap attacks. */
  mode: 'sheet' | 'inline';
  /** Owner of the target, for portraits and banners. */
  defenderOwner: PlayerId | null;
  /** Defending unit (null for walls / capture). */
  defenderUnit: UnitId | null;
}

export const pendingAttack = signal<PendingAttack | null>(null);

/** The sim's preview, or null (the query is a stub until the gameplay workstream lands it). */
export const fetchPreview = (g: GameState, unit: UnitId, target: Hex): CombatPreview | null => {
  try {
    return q.combatPreview(g, unit, target, content) ?? null;
  } catch {
    return null;
  }
};

const unitName = (g: GameState, id: UnitId): string => {
  const u = g.units[id];
  if (!u) return 'Unit';
  return (u.figure ? lookup.figures[u.figure]?.name : undefined) ?? lookup.units[u.type]?.name ?? 'Unit';
};

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const buildPending = (
  g: GameState,
  me: PlayerId,
  unit: UnitId,
  target: Hex,
  declareWarOn: PlayerId | null,
  preview: CombatPreview,
  mode: PendingAttack['mode'],
): PendingAttack => {
  const enemy = unitsAt(g, target).find((u) => u.owner !== me) ?? null;
  const town = settlementAt(g, target);
  const owner = enemy?.owner ?? (town && town.owner !== me ? town.owner : null) ?? declareWarOn;
  const defender =
    preview.kind === 'unit' && enemy
      ? `${cap(possessive(ownerName(enemy.owner)))} ${unitName(g, enemy.id)}`
      : town
        ? preview.kind === 'walls'
          ? `the walls of ${town.name}`
          : town.name
        : 'the enemy';
  const view = combatView(preview, { attacker: unitName(g, unit), defender, defenderOwner: owner ? ownerName(owner) : 'them' });
  return {
    unit,
    target,
    declareWarOn,
    preview,
    view,
    mode,
    defenderOwner: owner,
    defenderUnit: preview.kind === 'unit' && enemy ? enemy.id : null,
  };
};

/** Send the attack (declaring war first when needed) and clear the pending state. */
export const commitAttack = (a: { unit: UnitId; target: Hex; declareWarOn: PlayerId | null }): void => {
  pendingAttack.value = null;
  if (a.declareWarOn) dispatch({ type: 'declareWar', target: a.declareWarOn });
  dispatch({ type: 'attack', unit: a.unit, target: a.target });
};

export const cancelAttack = (): void => {
  pendingAttack.value = null;
};
