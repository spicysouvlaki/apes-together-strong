/**
 * Refinement screen grouping (GDD §6): traditions by culture then tier, then hybrids.
 * Options and their blocked reasons come from `q.refinementOptions`; this only arranges them. Pure.
 */
import type { ContentBundle, Hybrid, Tradition } from '@contracts/content-schemas';
import type { CultureId, PlayerState, RefinementOption } from '@contracts/sim-api';

export const TIER_ORDER = ['custom', 'institution', 'signature'] as const;
export type Tier = (typeof TIER_ORDER)[number];
export const TIER_LABEL: Record<Tier, string> = { custom: 'Custom', institution: 'Institution', signature: 'Signature' };

export interface TraditionItem {
  def: Tradition;
  owned: boolean;
  /** Null for owned items. */
  option: RefinementOption | null;
}

export interface HybridItem {
  def: Hybrid;
  owned: boolean;
  option: RefinementOption | null;
}

export interface CultureGroup {
  culture: CultureId;
  weight: number;
  tiers: { tier: Tier; items: TraditionItem[] }[];
}

export interface RefinementGroups {
  cultures: CultureGroup[];
  hybrids: HybridItem[];
}

/**
 * Cultures ordered by weight (heaviest first, then content order); within each, tiers in
 * custom → institution → signature order. Only items the sim offers or the player owns.
 */
export const groupRefinement = (
  player: Pick<PlayerState, 'traditions' | 'hybrids'>,
  options: readonly RefinementOption[],
  weights: Record<CultureId, number>,
  content: ContentBundle,
): RefinementGroups => {
  const opt: Record<string, RefinementOption> = {};
  for (const o of options) opt[`${o.kind}:${o.id}`] = o;

  const cultures: CultureGroup[] = content.cultures
    .map((c, i) => ({ c, i, weight: weights[c.id] ?? 0 }))
    .sort((a, b) => b.weight - a.weight || a.i - b.i)
    .map(({ c, weight }) => {
      const tiers = TIER_ORDER.map((tier) => ({
        tier,
        items: content.traditions
          .filter((t) => t.culture === c.id && t.tier === tier)
          .map((t): TraditionItem => {
            const owned = player.traditions.includes(t.id);
            return { def: t, owned, option: owned ? null : (opt[`tradition:${t.id}`] ?? null) };
          })
          .filter((x) => x.owned || x.option !== null),
      })).filter((t) => t.items.length > 0);
      return { culture: c.id, weight, tiers };
    })
    .filter((g) => g.tiers.length > 0);

  const hybrids = content.hybrids
    .map((h): HybridItem => {
      const owned = player.hybrids.includes(h.id);
      return { def: h, owned, option: owned ? null : (opt[`hybrid:${h.id}`] ?? null) };
    })
    .filter((x) => x.owned || x.option !== null)
    // Owned first, then affordable, then the rest.
    .sort((a, b) => rank(a) - rank(b));

  return { cultures, hybrids };
};

const rank = (x: HybridItem): number => (x.owned ? 0 : x.option?.available ? 1 : 2);
