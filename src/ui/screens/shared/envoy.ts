/**
 * When sending an envoy still asks first (wave 11 playtest: ten confirm sheets a game for a
 * priced, harmless action). One tap sends it; the confirm stays only when the price would leave
 * too little influence to buy peace in a war you are in. Pure.
 */
import { PEACE_INFLUENCE_COST } from '../../../sim/constants';

/** Influence below which a war could not be ended (the price of peace). */
export const INFLUENCE_WARNING = PEACE_INFLUENCE_COST;

export const envoyNeedsConfirm = (influence: number, cost: number, atWar: boolean): boolean =>
  atWar && influence - cost < INFLUENCE_WARNING;
