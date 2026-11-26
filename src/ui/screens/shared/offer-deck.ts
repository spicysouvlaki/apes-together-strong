/**
 * The offer as a deck (GDD §4 "Offers"): one full card per candidate in a swipeable row, with a
 * compact comparison strip on top (portrait, kind, culture, one line of what they do for you).
 * Pure: names and uses come from content through the describe helpers.
 */
import type { Figure } from '@contracts/content-schemas';
import type { Offer } from '@contracts/sim-api';
import { figureUses, KIND_LABEL, shortName, type NameLookup } from './describe';

export interface DeckItem {
  id: string;
  name: string;
  short: string;
  kind: Figure['kind'];
  kindLabel: string;
  culture: string;
  /** "Seat: +2 science in the capital" — the first thing they do for you, one short line. */
  oneLine: string;
  /** Why they came (the game's pillar, "Play is the recruiter"), or null. */
  reason: string | null;
}

/** Shorten to `max` characters at a word boundary, with an ellipsis. */
export const clip = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '')}…`;
};

const USE_WORD: Record<string, string> = {
  'Deployed as a unit': 'Field',
  'Activated once': 'Once',
  'If consumed': 'Spend',
};

/** The headline use: cabinet seat bonus, else field aura, else the one-time deed. */
export const oneLineUse = (def: Figure, l: NameLookup, max = 56): string => {
  const uses = figureUses(def, l);
  const u = uses[0];
  if (!u) return '';
  const word = u.label.startsWith('In the cabinet') ? 'Seat' : (USE_WORD[u.label] ?? u.label);
  return clip(`${word}: ${u.text.split('; ')[0] ?? u.text}`, max);
};

export const deckItems = (offer: Offer, figures: Readonly<Record<string, Figure | undefined>>, l: NameLookup, withReasons: boolean): DeckItem[] =>
  offer.candidates.flatMap((id) => {
    const def = figures[id];
    if (!def) return [];
    return [
      {
        id,
        name: def.name,
        short: shortName(def.name),
        kind: def.kind,
        kindLabel: KIND_LABEL[def.kind],
        culture: def.culture,
        oneLine: oneLineUse(def, l),
        reason: withReasons ? (offer.reasons[id] ?? null) : null,
      },
    ];
  });

export const clampIndex = (i: number, n: number): number => (n <= 0 ? 0 : Math.max(0, Math.min(n - 1, Math.round(i))));

/** Which card is in view, from the row's scroll position (cards are `step` px apart). */
export const indexFromScroll = (scrollLeft: number, step: number, n: number): number => (step > 0 ? clampIndex(scrollLeft / step, n) : 0);
