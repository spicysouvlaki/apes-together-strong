/**
 * Procedural figure portraits (GDD §3 "Famous people", §11 art direction). Pure: picks the
 * parameters of a cameo/coin-style bust from the figure's culture style, kind and a seed from
 * its id, so the same figure always looks the same and tests can check every figure in content.
 *
 * Faces stay abstract (a paper-light profile silhouette, no features beyond an ink eye-line);
 * identity comes from respectful dress: headwear and garment chosen by culture style and kind.
 * Oral-record archetypes ("A Thule umiak captain") get a role-emblem medallion, never a face,
 * and legends an ornate gold frame. Rendered by src/ui/art/Portrait.tsx.
 */
import type { FigureKind } from '@contracts/content-schemas';
import type { AnyIconName } from './icons-data';
import { artRng, cultureTones, type ArtStyle, type CultureTones } from './palette';

export const HEADWEAR = [
  'bare',
  'nemes',
  'wig',
  'khepresh',
  'laurel',
  'fillet',
  'crestedHelm',
  'petasos',
  'guan',
  'topknot',
  'futou',
  'turban',
  'keffiyeh',
  'veil',
  'spangenhelm',
  'circlet',
  'hood',
  'parka',
  'furHat',
  'cap',
] as const;
export type Headwear = (typeof HEADWEAR)[number];

export const GARMENTS = ['collar', 'himation', 'crossrobe', 'cloak', 'brooch', 'parka', 'deel', 'mantle', 'drape'] as const;
export type Garment = (typeof GARMENTS)[number];

export const HAIR = ['none', 'short', 'long', 'bun', 'braid'] as const;
export type Hair = (typeof HAIR)[number];

/** Headwear that leaves the hair showing (otherwise hair is hidden or tucked). */
const SHOWS_HAIR: ReadonlySet<Headwear> = new Set(['bare', 'laurel', 'fillet', 'petasos', 'circlet', 'cap', 'turban', 'topknot', 'guan']);

type KindChoices = Partial<Record<FigureKind, readonly Headwear[]>> & { default: readonly Headwear[] };

/** Dress by culture style and figure kind (first match wins; one is picked by seed). */
const HEADWEAR_BY_STYLE: Record<ArtStyle, KindChoices> = {
  nile: { default: ['wig'], general: ['khepresh'], statesman: ['nemes', 'wig'], legend: ['nemes'], spiritual: ['bare', 'wig'], thinker: ['wig'] },
  aegean: {
    default: ['bare', 'fillet'],
    general: ['crestedHelm'],
    statesman: ['laurel', 'bare'],
    thinker: ['fillet', 'laurel', 'bare'],
    spiritual: ['veil'],
    explorer: ['petasos'],
    legend: ['crestedHelm'],
  },
  sinic: { default: ['guan'], general: ['futou'], spiritual: ['topknot'], explorer: ['futou'], builder: ['topknot', 'guan'], legend: ['topknot'] },
  arabian: { default: ['keffiyeh'], thinker: ['turban'], spiritual: ['veil', 'turban'], general: ['turban', 'keffiyeh'], legend: ['veil', 'circlet'] },
  nordic: { default: ['bare'], general: ['spangenhelm'], statesman: ['circlet'], thinker: ['hood'], spiritual: ['veil', 'hood'], explorer: ['hood', 'bare'], legend: ['spangenhelm'] },
  arctic: { default: ['parka'] },
  steppe: { default: ['furHat'], spiritual: ['hood', 'furHat'], legend: ['furHat'] },
  iberian: { default: ['cap'], general: ['spangenhelm'], statesman: ['circlet', 'cap'], spiritual: ['hood', 'veil'], legend: ['spangenhelm'] },
  generic: { default: ['bare', 'hood', 'cap'], general: ['spangenhelm'], spiritual: ['hood'] },
};

const GARMENT_BY_STYLE: Record<ArtStyle, Garment> = {
  nile: 'collar',
  aegean: 'himation',
  sinic: 'crossrobe',
  arabian: 'cloak',
  nordic: 'brooch',
  arctic: 'parka',
  steppe: 'deel',
  iberian: 'mantle',
  generic: 'drape',
};

/** The small badge on every medallion, and the emblem of archetypes. */
export const KIND_ICON: Record<FigureKind, AnyIconName> = {
  general: 'general',
  statesman: 'statesman',
  thinker: 'thinker',
  spiritual: 'spiritual',
  builder: 'builder',
  explorer: 'explorer',
  legend: 'legend',
};

export interface PortraitSpec {
  mode: 'bust' | 'emblem';
  frame: 'medallion' | 'legend';
  style: ArtStyle;
  kind: FigureKind;
  headwear: Headwear;
  garment: Garment;
  hair: Hair;
  /** Profile looks right (default) or left. */
  facing: 'left' | 'right';
  /** Shoulder armour piece (generals). */
  armour: boolean;
  /** Small gold ornament at the ear. */
  earring: boolean;
  /** Degrees of head tilt, -3..3. */
  tilt: number;
  /** Count of beads on the coin ring. */
  beads: number;
  tones: CultureTones;
  kindIcon: AnyIconName;
}

export interface PortraitInput {
  id: string;
  kind: FigureKind;
  archetype: boolean;
  style: ArtStyle;
  culture: string;
}

const pick = <T>(list: readonly T[], r: number): T => list[Math.min(list.length - 1, Math.floor(r * list.length))] as T;

export const portraitSpec = (f: PortraitInput): PortraitSpec => {
  const rand = artRng(`portrait:${f.id}`);
  const choices = HEADWEAR_BY_STYLE[f.style];
  const headwear = pick(choices[f.kind] ?? choices.default, rand());
  const hairChoices: readonly Hair[] = SHOWS_HAIR.has(headwear) ? ['short', 'long', 'bun', 'braid', 'short'] : ['none'];
  let hair = pick(hairChoices, rand());
  if (headwear === 'topknot' || headwear === 'guan') hair = 'bun';
  if (headwear === 'turban') hair = 'short';
  return {
    mode: f.archetype ? 'emblem' : 'bust',
    frame: f.kind === 'legend' ? 'legend' : 'medallion',
    style: f.style,
    kind: f.kind,
    headwear,
    garment: GARMENT_BY_STYLE[f.style],
    hair,
    facing: rand() < 0.3 ? 'left' : 'right',
    armour: f.kind === 'general' && f.style !== 'arctic',
    earring: rand() < 0.25 && SHOWS_HAIR.has(headwear),
    tilt: Math.round((rand() * 6 - 3) * 10) / 10,
    beads: 26 + Math.floor(rand() * 8),
    tones: cultureTones(f.style, f.culture),
    kindIcon: KIND_ICON[f.kind],
  };
};
