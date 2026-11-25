/** Offer card wording (GDD §4 "Offer generation", "Deed figures"; §3 legend slot). Pure. */
import type { ContentBundle, GpKind } from '@contracts/content-schemas';
import type { Offer } from '@contracts/sim-api';
import { SKIP_REFUND_SHARE } from '../../../emergence/constants';

export interface OfferView {
  title: string;
  /** Deed story beat ("You held a city through a five-turn siege."), else null. */
  story: string | null;
  /** Small line above the title ("A deed remembered", "Great people"). */
  eyebrow: string;
  tone: 'points' | 'deed' | 'legend';
  /** Label of the secondary (decline) button. */
  declineLabel: string;
  /** Explains what declining means. */
  declineNote: string;
}

const POOL_TITLE: Record<GpKind, string> = {
  military: 'A commander seeks you out',
  statesman: 'A statesman seeks you out',
  thought: 'A thinker seeks you out',
  faith: 'A spiritual leader seeks you out',
  building: 'A builder seeks you out',
  exploration: 'An explorer seeks you out',
};

export const skipSharePercent = (): number => Math.round(SKIP_REFUND_SHARE * 100);

export const offerView = (offer: Offer, content: ContentBundle): OfferView => {
  if (offer.source === 'deed') {
    const deed = content.deeds.find((d) => d.id === offer.deed);
    return {
      title: deed?.name ?? 'A deed remembered',
      story: deed?.description ?? null,
      eyebrow: 'A deed remembered',
      tone: 'deed',
      declineLabel: 'Decline',
      declineNote: 'Declining loses them for good: a deed calls each figure only once.',
    };
  }
  if (offer.source === 'legend') {
    return {
      title: 'A legend walks among you',
      story: null,
      eyebrow: 'Myth and story',
      tone: 'legend',
      declineLabel: 'Let them pass',
      declineNote: 'One legend may join you each age.',
    };
  }
  return {
    title: POOL_TITLE[offer.source],
    story: null,
    eyebrow: 'Great people',
    tone: 'points',
    declineLabel: `Send them on (+${skipSharePercent()}% toward the next)`,
    declineNote: 'Whoever you send on may later join a rival.',
  };
};

/** "1 of 2" position of an offer among the player's open offers, or null when it is the only one. */
export const offerPosition = (offers: readonly Offer[], player: string, id: string): string | null => {
  const mine = offers.filter((o) => o.player === player);
  if (mine.length < 2) return null;
  const i = mine.findIndex((o) => o.id === id);
  return i < 0 ? null : `${i + 1} of ${mine.length}`;
};

/** The player's next open offer other than `exceptId`. */
export const nextOffer = (offers: readonly Offer[], player: string, exceptId: string): Offer | null =>
  offers.find((o) => o.player === player && o.id !== exceptId) ?? null;
