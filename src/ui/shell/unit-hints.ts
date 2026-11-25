/**
 * One line under the selected unit saying what the player can do next (GDD §11 clarity). Pure;
 * every fact comes from SimQueries results the sheet already has, so no rules are decided here.
 */
export interface UnitHintInput {
  isFounder: boolean;
  /** q.canFound for this unit right now. */
  canFound: boolean;
  isTrader: boolean;
  /** q.tradeTargets(...).length */
  tradeTargets: number;
  movesLeft: number;
  /** q.reachable is non-empty. */
  canMove: boolean;
  /** q.attackTargets is non-empty. */
  canAttack: boolean;
  hasAttacked: boolean;
  military: boolean;
  /** Neutral units or cities in reach that would need a declaration of war (war-targets.ts). */
  canDeclare?: boolean;
}

export const unitHint = (u: UnitHintInput): string => {
  if (u.isFounder && u.canFound) return 'A good spot? Tap Found settlement, or move on to a better one.';
  const parts: string[] = [];
  if (u.isFounder) parts.push('Can’t settle here: pick open land outside other borders, a few tiles from any settlement.');
  if (u.isTrader && u.tradeTargets === 0) parts.push('Walk next to a foreign city or city-state you are not at war with to open a trade route.');
  if (u.canAttack) parts.push('Tap a red tile to attack.');
  else if (u.canDeclare) parts.push('A neutral target is in reach: tap it to declare war and attack.');
  if (u.canMove) parts.push('Tap a lit tile to move.');
  else if (u.movesLeft <= 0) parts.push(u.military && !u.hasAttacked ? 'No moves left this turn. Fortify to dig in.' : 'No moves left this turn.');
  else if (!u.canAttack) parts.push('Nowhere to move from here.');
  return parts.join(' ');
};
