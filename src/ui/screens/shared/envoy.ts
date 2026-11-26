/**
 * When sending an envoy still asks first (wave 11 playtest: ten confirm sheets a game for a
 * priced, harmless action). One tap sends it; the confirm stays only when the price would leave
 * too little influence to buy peace in a war you are in. Pure.
 */
import type { GameState, PlayerId } from '@contracts/sim-api';
import { PEACE_INFLUENCE_COST } from '../../../sim/constants';
import { contactsOf } from '../../../sim/voice';

/** Influence below which a war could not be ended (the price of peace). */
export const INFLUENCE_WARNING = PEACE_INFLUENCE_COST;

export const envoyNeedsConfirm = (influence: number, cost: number, atWar: boolean): boolean =>
  atWar && influence - cost < INFLUENCE_WARNING;

/** Has `me` met `other` (first contact, or their lands seen)? The sim's own contact rule. */
export const hasMet = (state: GameState, me: PlayerId, other: PlayerId): boolean => contactsOf(state, me)[other] === true;
