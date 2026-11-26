/**
 * Settlement site evaluation (operational layer, GDD §9). Legality and the score are the
 * sim's own (`canFoundAt`, `siteScorer` in src/sim/sites.ts, the same ones behind the
 * player's settler hints); the AI only re-weights them by personality: its yield
 * preferences, how much a new luxury pleases it and how much a seafarer loves the coast.
 * It ignores border overlap (it has its own compactness preference in `findSites`).
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameState, PlayerId } from '@contracts/sim-api';
import { SITE_WEIGHTS, type SiteWeights } from '../sim/constants';
import { hexOfIndex } from '../sim/lookup';
import { canFoundAt } from '../sim/settlements';
import { siteScorer } from '../sim/sites';
import type { Persona } from './persona';

export { ownedLuxuries } from '../sim/sites';

/** The sim's founding rule, by tile index. */
export const siteLegal = (state: GameState, player: PlayerId, idx: number, content: ContentBundle): boolean =>
  canFoundAt(state, player, hexOfIndex(state.map, idx), content);

/** The shared site weights with this personality's preferences on top. */
export const personaSiteWeights = (pe: Persona): SiteWeights => ({
  ...SITE_WEIGHTS,
  yield: { ...pe.yieldW },
  newLuxury: 4 * pe.yieldW.happiness,
  coast: SITE_WEIGHTS.coast + 3 * pe.w.seafarer,
  overlap: 0,
});

/** Score sites for this AI (build once per decision; it caches tile values). */
export const aiSiteScorer = (state: GameState, player: PlayerId, content: ContentBundle, pe: Persona): ((idx: number) => number) =>
  siteScorer(state, player, content, personaSiteWeights(pe));
