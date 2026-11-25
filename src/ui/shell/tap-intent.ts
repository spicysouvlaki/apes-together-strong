/**
 * What a tap on the map means (GDD §11 "Touch"). Pure: the MapView feeds it the snapshot, the
 * current selection and the legal targets it already got from SimQueries, and executes the
 * returned intent. No rules are decided here beyond "which legal option did the tap pick".
 */
import { hexEquals, type Hex } from '@contracts/hex';
import { RAIDER_PLAYER, type GameState, type PlayerId, type SettlementId, type UnitId } from '@contracts/sim-api';
import { settlementAt, unitsAt } from './hexutil';

export type TapIntent =
  | { kind: 'move'; unit: UnitId; to: Hex }
  /** `declareWarOn` is set when the target's owner is not at war with us yet (needs a confirm). */
  | { kind: 'attack'; unit: UnitId; target: Hex; declareWarOn: PlayerId | null }
  | { kind: 'selectUnit'; unit: UnitId; cycleIndex: number }
  | { kind: 'openCity'; settlement: SettlementId; cycleIndex: number }
  | { kind: 'deselect'; hex: Hex };

export interface TapInput {
  state: GameState;
  me: PlayerId;
  hex: Hex;
  selectedUnit: UnitId | null;
  reachable: readonly Hex[];
  attackable: readonly Hex[];
  /** The previous tap, if it was on this same hex, and which cycle entry it picked. */
  lastTap: { hex: Hex; cycleIndex: number } | null;
  /** SimQueries.atWar, bound to the state. */
  atWar: (a: PlayerId, b: PlayerId) => boolean;
  /** Targets that need a declaration of war first (war-targets.ts). */
  warTargets?: readonly { hex: Hex; owner: PlayerId }[];
}

/** Owner of whatever stands on an attackable hex: a unit first, else the settlement. */
export const targetOwner = (state: GameState, hex: Hex, me: PlayerId): PlayerId | null => {
  const enemy = unitsAt(state, hex).find((u) => u.owner !== me);
  if (enemy) return enemy.owner;
  const s = settlementAt(state, hex);
  return s && s.owner !== me ? s.owner : null;
};

export const resolveTap = (input: TapInput): TapIntent => {
  const { state, me, hex, selectedUnit } = input;
  const selected = selectedUnit ? state.units[selectedUnit] : undefined;
  const sel = selected && selected.owner === me ? selected : undefined;

  if (sel && input.attackable.some((h) => hexEquals(h, hex))) {
    const owner = targetOwner(state, hex, me);
    // Raiders are always hostile (GDD §5 "Collapse"); everyone else needs a declaration.
    const needs = owner && owner !== RAIDER_PLAYER && !input.atWar(me, owner) ? owner : null;
    return { kind: 'attack', unit: sel.id, target: hex, declareWarOn: needs };
  }
  const war = sel ? input.warTargets?.find((t) => hexEquals(t.hex, hex)) : undefined;
  if (sel && war) return { kind: 'attack', unit: sel.id, target: hex, declareWarOn: war.owner };
  if (sel && input.reachable.some((h) => hexEquals(h, hex))) {
    return { kind: 'move', unit: sel.id, to: hex };
  }

  // Cycle list for this tile: own settlement first, then own units in stable order.
  const settlement = settlementAt(state, hex);
  const mySettlement = settlement && settlement.owner === me ? settlement : null;
  const units = unitsAt(state, hex, me);
  const entries: ({ kind: 'city'; id: SettlementId } | { kind: 'unit'; id: UnitId })[] = [];
  if (mySettlement) entries.push({ kind: 'city', id: mySettlement.id });
  for (const u of units) entries.push({ kind: 'unit', id: u.id });
  if (entries.length === 0) return { kind: 'deselect', hex };

  let prev = -1;
  if (input.lastTap && hexEquals(input.lastTap.hex, hex)) prev = input.lastTap.cycleIndex;
  else if (sel && hexEquals(sel.at, hex)) prev = entries.findIndex((e) => e.kind === 'unit' && e.id === sel.id);
  const index = (prev + 1) % entries.length;
  const pick = entries[index];
  if (!pick) return { kind: 'deselect', hex };
  return pick.kind === 'city'
    ? { kind: 'openCity', settlement: pick.id, cycleIndex: index }
    : { kind: 'selectUnit', unit: pick.id, cycleIndex: index };
};
