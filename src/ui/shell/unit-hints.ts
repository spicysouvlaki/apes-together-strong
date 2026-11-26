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
  /**
   * A trader stands beside a foreign settlement it still cannot trade with: why, in the sim's
   * terms (display only; tradeTargets decided). 'far' = beyond the route range from every home
   * city; 'war' = at war with its owner; 'open' = a route to it already runs.
   */
  tradeBlocked?: { name: string; why: 'far' | 'war' | 'open'; range: number } | null;
}

export const unitHint = (u: UnitHintInput): string => {
  if (u.isFounder && u.canFound) return 'Tap Found settlement to settle here, or tap a numbered site to march there.';
  const parts: string[] = [];
  if (u.isFounder) parts.push('Can’t settle here. Tap a numbered site to march there.');
  if (u.isTrader && u.tradeTargets === 0) {
    const b = u.tradeBlocked;
    if (b?.why === 'far') parts.push(`${b.name} is too far from home: a trade route needs one of your settlements within ${b.range} tiles of it.`);
    else if (b?.why === 'war') parts.push(`No trade with ${b.name} while you are at war with it.`);
    else if (b?.why === 'open') parts.push(`A route to ${b.name} already runs. Find another foreign city.`);
    else parts.push('Walk next to a foreign city or city-state you are not at war with to open a trade route.');
  }
  if (u.canAttack) parts.push('Tap a red tile to attack.');
  else if (u.canDeclare) parts.push('A neutral target is in reach: tap it to declare war and attack.');
  if (u.canMove) parts.push('Tap a lit tile to move, or a far tile to plan a route.');
  else if (u.movesLeft <= 0) parts.push(u.military && !u.hasAttacked ? 'No moves left this turn. Fortify to dig in.' : 'No moves left this turn.');
  else if (!u.canAttack) parts.push('Nowhere to move from here.');
  return parts.join(' ');
};
