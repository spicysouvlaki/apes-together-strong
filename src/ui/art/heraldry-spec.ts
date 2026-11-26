/**
 * Culture crests and the player's banner (GDD §2 "Look", §8 Chronicle). Pure parameter
 * selection; drawn by src/ui/art/Heraldry.tsx.
 *
 * Each culture style has one heraldic motif drawn from its material culture (no religious
 * symbols): lotus, amphora, ding vessel, date palm, longship, inuksuk, ger, castle tower.
 */
import { artRng, cultureTones, hashString, textOn, type ArtStyle, type CultureTones } from './palette';
import type { AnyIconName } from './icons-data';

export const MOTIFS = ['lotus', 'amphora', 'ding', 'palm', 'longship', 'inuksuk', 'ger', 'tower', 'star'] as const;
export type Motif = (typeof MOTIFS)[number];

const STYLE_MOTIF: Record<ArtStyle, Motif> = {
  nile: 'lotus',
  aegean: 'amphora',
  sinic: 'ding',
  arabian: 'palm',
  nordic: 'longship',
  arctic: 'inuksuk',
  steppe: 'ger',
  iberian: 'tower',
  generic: 'star',
};

export const FIELDS = ['plain', 'chief', 'bordure', 'pale'] as const;
export type Field = (typeof FIELDS)[number];

export interface CrestSpec {
  motif: Motif;
  field: Field;
  tones: CultureTones;
  /** Motif color (paper on dark fields). */
  charge: string;
}

export const crestSpec = (style: ArtStyle, cultureId: string): CrestSpec => {
  const tones = cultureTones(style, cultureId);
  return {
    motif: STYLE_MOTIF[style],
    field: FIELDS[hashString(`crest:${cultureId}`) % FIELDS.length] ?? 'plain',
    tones,
    charge: textOn(tones.base),
  };
};

/** Leader archetype emblems (setup cards, banner centre). Unknown leaders get a star. */
const LEADER_EMBLEM: Record<string, AnyIconName> = {
  builder: 'builder',
  conqueror: 'attack',
  sage: 'thinker',
  navigator: 'explorer',
  merchant: 'trade',
  prophet: 'faith',
  diplomat: 'peace',
};
export const leaderEmblem = (leaderId: string): AnyIconName => LEADER_EMBLEM[leaderId] ?? 'star';

export interface BannerSpec {
  primary: string;
  secondary: string;
  /** Leader emblem in the field. */
  emblem: AnyIconName;
  /** Up to three culture motifs embroidered on the tail (adopted signature traditions). */
  motifs: Motif[];
  /** Small cloth ripple variation. */
  ripple: number;
}

export const bannerSpec = (input: {
  primary: string;
  secondary: string;
  leader: string;
  /** Culture styles of the player's adopted signature traditions, in adoption order. */
  signatureStyles: readonly ArtStyle[];
  seed: string;
}): BannerSpec => {
  const motifs: Motif[] = [];
  for (const s of input.signatureStyles) {
    const m = STYLE_MOTIF[s];
    if (!motifs.includes(m)) motifs.push(m);
    if (motifs.length === 3) break;
  }
  return {
    primary: input.primary,
    secondary: input.secondary === input.primary ? textOn(input.primary) : input.secondary,
    emblem: leaderEmblem(input.leader),
    motifs,
    ripple: Math.round(artRng(`banner:${input.seed}`)() * 100) / 100,
  };
};
