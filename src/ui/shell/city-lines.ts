/**
 * Short explanatory lines for the city sheet and the founding toast (wave 11 playtest: "Gadir"
 * was named after the heaviest culture with no word why; the upgrade price rose with population
 * without saying so). Pure: weights and costs come in from SimQueries and sim constants.
 */
import type { CultureId } from '@contracts/sim-api';

/** The culture with the most weight (ties: first in `order`); null when nobody has any. */
export const strongestCulture = (weights: Readonly<Record<CultureId, number>>, order: readonly CultureId[]): CultureId | null => {
  let best: CultureId | null = null;
  let bestW = 0;
  for (const c of order) {
    const w = weights[c] ?? 0;
    if (w > bestW) {
      bestW = w;
      best = c;
    }
  }
  return best;
};

/**
 * Why a settlement has its name. The sim names new settlements from the player's heaviest culture,
 * or a random one while no culture has any weight (sim/settlements.ts namingCulture).
 */
export const namingLine = (adjective: string | null, namedFor: CultureId, strongest: CultureId | null): string | null => {
  if (!namedFor || !adjective) return null;
  if (strongest === namedFor) return `Named in the ${adjective} fashion, your strongest strand.`;
  if (strongest === null) return `Named in the ${adjective} fashion, by chance: no culture has shaped your people yet.`;
  return `Named in the ${adjective} fashion.`;
};

/**
 * Why a town's upgrade costs what it does: a base plus a price per citizen, then any percentage
 * from bonuses (sim/settlements.ts upgradeCostOf). Says that it rises as the town grows.
 */
export const upgradeCostReason = (cost: number, population: number, base: number, perPop: number): string => {
  const raw = base + perPop * population;
  const people = population === 1 ? '1 citizen' : `${population} citizens`;
  const bonus = raw > 0 && cost !== raw ? Math.round((cost / raw - 1) * 100) : 0;
  const tail = bonus !== 0 ? `, ${bonus > 0 ? '+' : '−'}${Math.abs(bonus)}% from your bonuses` : '';
  return `${base} base + ${perPop} per citizen (${people})${tail}. The price rises as the town grows.`;
};
