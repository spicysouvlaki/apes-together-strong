/**
 * Procedural figure portraits (GDD §3 "Famous people", §11 art direction). Pure: picks the
 * parameters of a woodcut coin/cameo bust from the figure's culture style, kind, a small
 * presentation table (src/ui/art/portrait-presentation.ts) and a seed from its id, so the same
 * figure always looks the same and tests can check every figure in content.
 *
 * Variety comes from several independent axes: view (profile or three-quarter), facial
 * structure (abstract brow/nose/jaw line work, never caricature), age, hair and hair tone,
 * beard, headwear and garment by culture and kind, and an attribute prop by kind. Oral-record
 * archetypes ("A Thule umiak captain") get a role-emblem medallion, never a face, and legends
 * an ornate gold frame. Rendered by src/ui/art/Portrait.tsx.
 */
import type { FigureKind } from '@contracts/content-schemas';
import type { AnyIconName } from './icons-data';
import { artRng, cultureTones, type ArtStyle, type CultureTones } from './palette';
import { presentationOf, type Presentation } from './portrait-presentation';

export const HEADWEAR = [
  'bare',
  'nemes',
  'wig',
  'khepresh',
  'vultureCrown',
  'laurel',
  'fillet',
  'diadem',
  'crestedHelm',
  'petasos',
  'pilos',
  'guan',
  'topknot',
  'futou',
  'hairpins',
  'turban',
  'kalansuwa',
  'keffiyeh',
  'veil',
  'wimple',
  'spangenhelm',
  'circlet',
  'crown',
  'hood',
  'parka',
  'furHat',
  'boqta',
  'cap',
] as const;
export type Headwear = (typeof HEADWEAR)[number];

export const GARMENTS = ['collar', 'himation', 'crossrobe', 'cloak', 'brooch', 'parka', 'deel', 'mantle', 'drape', 'lamellar', 'stole', 'furTrim', 'tunic'] as const;
export type Garment = (typeof GARMENTS)[number];

export const HAIR = ['none', 'short', 'cropped', 'curly', 'long', 'bun', 'braid', 'tied', 'receding', 'shaved'] as const;
export type Hair = (typeof HAIR)[number];

export const BEARDS = ['none', 'short', 'full', 'long', 'goatee', 'moustache'] as const;
export type Beard = (typeof BEARDS)[number];

export const HAIR_TONES = ['black', 'umber', 'auburn', 'flaxen', 'grey', 'silver'] as const;
export type HairTone = (typeof HAIR_TONES)[number];

export const AGES = ['young', 'mature', 'elder'] as const;
export type Age = (typeof AGES)[number];

/** Abstract facial structure: brow, nose, lips and jaw line work (see Portrait.tsx FACE_SHAPE). */
export const FACES = ['classic', 'aquiline', 'strong', 'soft', 'round'] as const;
export type Face = (typeof FACES)[number];

export const VIEWS = ['profile', 'threeQuarter'] as const;
export type View = (typeof VIEWS)[number];

export const PROPS = [
  'none',
  'scroll',
  'book',
  'stylus',
  'compass',
  'staff',
  'oar',
  'setSquare',
  'mallet',
  'spade',
  'lamp',
  'beads',
  'seal',
  'sceptre',
  'spear',
  'sword',
  'axe',
  'sphere',
] as const;
export type Prop = (typeof PROPS)[number];

/** Role emblems for archetype medallions (keyword from the id, else by kind). */
export const EMBLEMS = [
  'boat',
  'sled',
  'horse',
  'hammer',
  'chisel',
  'scroll',
  'sun',
  'iglu',
  'house',
  'wall',
  'bow',
  'caravan',
  'scales',
  'drum',
  'stones',
  'inukshuk',
  'ice',
  'tent',
  'ger',
  'tripod',
  'brush',
  'oracle',
  'herb',
  'shield',
  'staff',
  'star',
  'wolf',
  'cairn',
  'rider',
  'needle',
  'whale',
] as const;
export type Emblem = (typeof EMBLEMS)[number];

/** Culture ornament ring on archetype medallions. */
export const ORNAMENTS = ['lotus', 'meander', 'cloud', 'star', 'knot', 'beadwork', 'scrolls', 'chevron', 'ticks'] as const;
export type Ornament = (typeof ORNAMENTS)[number];

const ORNAMENT_BY_STYLE: Record<ArtStyle, Ornament> = {
  nile: 'lotus',
  aegean: 'meander',
  sinic: 'cloud',
  arabian: 'star',
  nordic: 'knot',
  arctic: 'beadwork',
  steppe: 'scrolls',
  iberian: 'chevron',
  generic: 'ticks',
};

/** Headwear that leaves the hair showing (otherwise hair is hidden or tucked). */
const SHOWS_HAIR: ReadonlySet<Headwear> = new Set([
  'bare',
  'laurel',
  'fillet',
  'diadem',
  'petasos',
  'pilos',
  'circlet',
  'crown',
  'cap',
  'turban',
  'kalansuwa',
  'topknot',
  'guan',
  'hairpins',
  'crestedHelm',
  'spangenhelm',
  'futou',
  'furHat',
  'parka',
]);

/** Headwear drawn only in profile (back drapes and lappets need the side view). */
const PROFILE_ONLY: ReadonlySet<Headwear> = new Set(['nemes', 'wig', 'khepresh', 'vultureCrown', 'keffiyeh', 'veil', 'wimple', 'hood', 'parka', 'boqta', 'crestedHelm']);

type KindChoices = Partial<Record<FigureKind, readonly Headwear[]>> & { default: readonly Headwear[] };

/** Dress by culture style and figure kind (first match wins; one is picked by seed). */
const HEADWEAR_BY_STYLE: Record<ArtStyle, KindChoices> = {
  nile: {
    default: ['wig', 'bare'],
    general: ['khepresh', 'wig'],
    statesman: ['nemes', 'wig', 'khepresh'],
    legend: ['nemes', 'wig'],
    spiritual: ['bare', 'wig'],
    thinker: ['wig', 'bare'],
    explorer: ['wig', 'bare'],
  },
  aegean: {
    default: ['bare', 'fillet'],
    general: ['crestedHelm', 'bare'],
    statesman: ['laurel', 'bare', 'fillet'],
    thinker: ['fillet', 'laurel', 'bare'],
    spiritual: ['bare', 'hood'],
    explorer: ['petasos', 'pilos', 'bare'],
    builder: ['bare', 'pilos'],
    legend: ['crestedHelm', 'pilos'],
  },
  sinic: {
    default: ['guan', 'topknot'],
    general: ['futou', 'topknot'],
    statesman: ['guan', 'futou'],
    spiritual: ['topknot', 'bare'],
    explorer: ['futou', 'guan'],
    builder: ['topknot', 'guan'],
    legend: ['topknot', 'guan'],
  },
  arabian: {
    default: ['keffiyeh', 'turban'],
    thinker: ['turban', 'kalansuwa'],
    spiritual: ['turban', 'keffiyeh'],
    general: ['turban', 'keffiyeh', 'spangenhelm'],
    statesman: ['turban', 'kalansuwa', 'keffiyeh'],
    legend: ['turban', 'keffiyeh'],
  },
  nordic: {
    default: ['bare', 'cap'],
    general: ['spangenhelm', 'bare'],
    statesman: ['circlet', 'bare'],
    thinker: ['hood', 'bare'],
    spiritual: ['hood', 'bare'],
    explorer: ['hood', 'bare', 'cap'],
    legend: ['spangenhelm', 'bare'],
  },
  arctic: { default: ['parka', 'bare'] },
  steppe: { default: ['furHat', 'bare'], spiritual: ['hood', 'furHat'], general: ['furHat', 'spangenhelm'], legend: ['furHat'] },
  iberian: {
    default: ['cap', 'bare'],
    general: ['spangenhelm', 'bare'],
    statesman: ['crown', 'circlet', 'cap'],
    spiritual: ['hood', 'bare'],
    thinker: ['hood', 'cap', 'bare'],
    legend: ['spangenhelm', 'bare'],
  },
  generic: { default: ['bare', 'hood', 'cap'], general: ['spangenhelm'], spiritual: ['hood'] },
};

/** Women's dress by culture style (kind-specific helmets still apply to generals). */
const HEADWEAR_WOMEN: Record<ArtStyle, readonly Headwear[]> = {
  nile: ['wig', 'vultureCrown'],
  aegean: ['fillet', 'diadem', 'veil', 'bare'],
  sinic: ['hairpins', 'bare'],
  arabian: ['veil', 'circlet'],
  nordic: ['veil', 'circlet', 'bare'],
  arctic: ['parka', 'bare'],
  steppe: ['boqta', 'furHat'],
  iberian: ['wimple', 'veil', 'circlet'],
  generic: ['veil', 'bare'],
};

/** Neutral busts (figures not in the presentation table) avoid gendered headwear. */
const NEUTRAL_AVOID: ReadonlySet<Headwear> = new Set(['vultureCrown', 'hairpins', 'boqta', 'wimple', 'veil', 'diadem']);

const GARMENTS_BY_STYLE: Record<ArtStyle, readonly Garment[]> = {
  nile: ['collar', 'drape'],
  aegean: ['himation', 'tunic', 'drape'],
  sinic: ['crossrobe', 'mantle'],
  arabian: ['cloak', 'drape', 'mantle'],
  nordic: ['brooch', 'furTrim', 'tunic'],
  arctic: ['parka'],
  steppe: ['deel', 'furTrim'],
  iberian: ['mantle', 'cloak', 'tunic'],
  generic: ['drape', 'tunic', 'cloak'],
};

const PROPS_BY_KIND: Record<FigureKind, readonly Prop[]> = {
  thinker: ['scroll', 'book', 'stylus'],
  explorer: ['compass', 'staff', 'oar'],
  builder: ['setSquare', 'mallet', 'spade'],
  spiritual: ['lamp', 'beads', 'book'],
  statesman: ['seal', 'sceptre', 'scroll'],
  general: ['spear', 'sword', 'axe'],
  legend: ['sword', 'spear', 'staff', 'scroll'],
};

/** Hair tones a culture plausibly shows before age greys them. */
const TONES_BY_STYLE: Record<ArtStyle, readonly HairTone[]> = {
  nile: ['black'],
  aegean: ['black', 'umber', 'umber', 'auburn'],
  sinic: ['black'],
  arabian: ['black', 'umber'],
  nordic: ['flaxen', 'auburn', 'umber', 'flaxen'],
  arctic: ['black'],
  steppe: ['black', 'umber'],
  iberian: ['black', 'umber', 'auburn'],
  generic: ['black', 'umber', 'auburn'],
};

/** Beards mature men wear, by style (picked by seed; repeats weight the pick). */
const BEARDS_BY_STYLE: Record<ArtStyle, readonly Beard[]> = {
  nile: ['none'],
  aegean: ['full', 'short', 'full', 'none'],
  sinic: ['long', 'goatee', 'moustache', 'none'],
  arabian: ['full', 'short', 'full', 'long'],
  nordic: ['full', 'long', 'short', 'moustache'],
  arctic: ['none'],
  steppe: ['moustache', 'goatee', 'none'],
  iberian: ['short', 'full', 'none'],
  generic: ['short', 'full', 'none'],
};

/** The small badge on every medallion. */
export const KIND_ICON: Record<FigureKind, AnyIconName> = {
  general: 'general',
  statesman: 'statesman',
  thinker: 'thinker',
  spiritual: 'spiritual',
  builder: 'builder',
  explorer: 'explorer',
  legend: 'legend',
};

/** Archetype emblem by a keyword in the figure id (first match wins), else by kind. */
const EMBLEM_KEYWORDS: readonly (readonly [string, Emblem])[] = [
  ['horse_healer', 'herb'],
  ['healer', 'herb'],
  ['shipwright', 'boat'],
  ['umiak', 'boat'],
  ['seafarer', 'boat'],
  ['sailor', 'boat'],
  ['sled', 'sled'],
  ['horse', 'horse'],
  ['rider', 'rider'],
  ['yam', 'rider'],
  ['seamstress', 'needle'],
  ['whaling', 'whale'],
  ['star', 'star'],
  ['millares', 'wall'],
  ['smith', 'hammer'],
  ['carver', 'chisel'],
  ['painter', 'brush'],
  ['scribe', 'scroll'],
  ['chronicler', 'scroll'],
  ['sun', 'sun'],
  ['iglu', 'iglu'],
  ['house', 'house'],
  ['wall', 'wall'],
  ['dam', 'wall'],
  ['bowman', 'bow'],
  ['caravan', 'caravan'],
  ['trader', 'scales'],
  ['angakkuq', 'drum'],
  ['boo', 'drum'],
  ['shaman', 'drum'],
  ['khirigsuur', 'cairn'],
  ['slab_grave', 'stones'],
  ['keeper', 'stones'],
  ['pathfinder', 'inukshuk'],
  ['ice', 'ice'],
  ['isumataq', 'tent'],
  ['felt', 'ger'],
  ['pythia', 'tripod'],
  ['diviner', 'oracle'],
  ['warrior', 'shield'],
  ['war_chief', 'shield'],
  ['envoy', 'staff'],
];

const EMBLEMS_BY_KIND: Record<FigureKind, readonly Emblem[]> = {
  general: ['shield', 'bow'],
  statesman: ['scales', 'staff'],
  thinker: ['scroll', 'sun'],
  spiritual: ['drum', 'stones', 'sun'],
  builder: ['hammer', 'wall', 'house'],
  explorer: ['boat', 'inukshuk', 'caravan'],
  legend: ['star', 'sun'],
};

export const emblemFor = (id: string, kind: FigureKind, r: number): Emblem => {
  for (const [kw, e] of EMBLEM_KEYWORDS) if (id.includes(kw)) return e;
  return pick(EMBLEMS_BY_KIND[kind], r);
};

export interface PortraitSpec {
  mode: 'bust' | 'emblem';
  frame: 'medallion' | 'legend';
  style: ArtStyle;
  kind: FigureKind;
  presentation: Presentation;
  view: View;
  /** Profile looks right (default) or left; a three-quarter head turns the same way. */
  facing: 'left' | 'right';
  face: Face;
  age: Age;
  headwear: Headwear;
  garment: Garment;
  hair: Hair;
  hairTone: HairTone;
  beard: Beard;
  prop: Prop;
  /** Shoulder armour piece (generals). */
  armour: boolean;
  /** Small gold ornament at the ear. */
  earring: boolean;
  /** Degrees of head tilt, -3..3. */
  tilt: number;
  /** Count of beads on the coin ring. */
  beads: number;
  /** Cloth colour variant (veils, hoods, caps, turbans, fur hats), 0..3. */
  accent: number;
  emblem: Emblem;
  ornament: Ornament;
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

/** Men's hair by style (women and neutral busts use their own lists in hairFor). */
const MEN_HAIR: Record<ArtStyle, readonly Hair[]> = {
  nile: ['short', 'cropped'],
  aegean: ['short', 'curly', 'cropped', 'long'],
  // Hair worn up under the cap or crown, never loose down the back (Guan Zhong read as unkempt).
  sinic: ['short'],
  arabian: ['short', 'curly', 'long', 'cropped'],
  nordic: ['long', 'braid', 'short', 'tied'],
  arctic: ['long', 'short'],
  steppe: ['braid', 'tied', 'long'],
  iberian: ['short', 'cropped', 'curly', 'long'],
  generic: ['short', 'cropped', 'curly', 'long', 'tied'],
};

/** Curls only read under open headwear (bands and wreaths), not caps and helmets. */
const OPEN_HEADWEAR: ReadonlySet<Headwear> = new Set(['bare', 'laurel', 'fillet', 'diadem', 'circlet']);

const hairFor = (p: Presentation, style: ArtStyle, age: Age, headwear: Headwear, r: number): Hair => {
  if (!SHOWS_HAIR.has(headwear)) return 'none';
  if (headwear === 'topknot' || headwear === 'guan' || headwear === 'hairpins') return 'bun';
  if (headwear === 'turban' || headwear === 'kalansuwa') return 'short';
  let h: Hair;
  if (p === 'f') h = pick(['bun', 'braid', 'long', 'tied'] as const, r);
  else if (p === 'n') h = pick(['short', 'cropped', 'tied'] as const, r);
  else if (age === 'elder' && r < 0.45) h = 'receding';
  else h = pick(MEN_HAIR[style], r);
  return h === 'curly' && !OPEN_HEADWEAR.has(headwear) ? 'short' : h;
};

const beardFor = (p: Presentation, style: ArtStyle, age: Age, r: number): Beard => {
  if (p !== 'm') return 'none';
  const b = pick(BEARDS_BY_STYLE[style], r);
  // Young men are mostly clean-shaven; when bearded, kept short.
  if (age === 'young') return r < 0.6 ? 'none' : b === 'full' || b === 'long' ? 'short' : b;
  return age === 'elder' && b === 'short' ? 'full' : b;
};

const toneFor = (style: ArtStyle, age: Age, r: number): HairTone => {
  if (age === 'elder') return r < 0.5 ? 'silver' : 'grey';
  return pick(TONES_BY_STYLE[style], r);
};

export const portraitSpec = (f: PortraitInput): PortraitSpec => {
  const rand = artRng(`portrait:${f.id}`);
  // Draw every random number up front so adding an axis never reshuffles the others.
  const r = Array.from({ length: 16 }, () => rand());
  const R = (i: number): number => r[i] ?? 0;
  const hint = presentationOf(f.id);
  const p = hint.p;
  const age: Age = hint.age ?? (R(0) < 0.3 ? 'young' : R(0) < 0.78 ? 'mature' : 'elder');

  const kindChoices = HEADWEAR_BY_STYLE[f.style];
  let choices: readonly Headwear[] = kindChoices[f.kind] ?? kindChoices.default;
  if (p === 'f' && f.kind !== 'general') choices = HEADWEAR_WOMEN[f.style];
  if (p === 'n') {
    const safe = choices.filter((h) => !NEUTRAL_AVOID.has(h));
    choices = safe.length > 0 ? safe : ['bare'];
  }
  const headwear = hint.headwear ?? pick(choices, R(1));
  const hair = hint.hair ?? hairFor(p, f.style, age, headwear, R(2));
  const beard = hint.beard ?? beardFor(p, f.style, age, R(3));
  const face: Face = f.style === 'arctic' ? pick(['round', 'classic'] as const, R(4)) : p === 'f' ? pick(['soft', 'classic', 'round'] as const, R(4)) : p === 'n' ? pick(['classic', 'soft', 'round', 'aquiline'] as const, R(4)) : pick(['classic', 'aquiline', 'strong', 'round', 'strong'] as const, R(4));
  const view: View = PROFILE_ONLY.has(headwear) || R(5) < 0.62 ? 'profile' : 'threeQuarter';
  const armour = f.kind === 'general' && f.style !== 'arctic';
  const garment: Garment = armour && R(6) < 0.45 ? 'lamellar' : f.kind === 'spiritual' && R(6) < 0.35 ? 'stole' : pick(GARMENTS_BY_STYLE[f.style], R(7));

  return {
    mode: f.archetype || hint.emblem ? 'emblem' : 'bust',
    frame: f.kind === 'legend' ? 'legend' : 'medallion',
    style: f.style,
    kind: f.kind,
    presentation: p,
    view,
    facing: R(8) < 0.32 ? 'left' : 'right',
    face,
    age,
    headwear,
    garment,
    hair,
    hairTone: toneFor(f.style, age, R(9)),
    beard,
    prop: hint.prop ?? pick(PROPS_BY_KIND[f.kind], R(10)),
    armour,
    earring: R(11) < (p === 'f' ? 0.6 : 0.2) && SHOWS_HAIR.has(headwear) && f.style !== 'arctic',
    tilt: Math.round((R(12) * 6 - 3) * 10) / 10,
    beads: 26 + Math.floor(R(13) * 8),
    accent: Math.floor(R(15) * 4),
    emblem: hint.emblem ?? emblemFor(f.id, f.kind, R(14)),
    ornament: ORNAMENT_BY_STYLE[f.style],
    tones: cultureTones(f.style, f.culture),
    kindIcon: KIND_ICON[f.kind],
  };
};

/** What a viewer can tell apart: two portraits with the same signature look identical. */
export const portraitSignature = (s: PortraitSpec): string =>
  s.mode === 'emblem'
    ? ['emblem', s.style, s.emblem, s.ornament].join('|')
    : [s.view, s.facing, s.face, s.age, s.hair, s.hairTone, s.beard, s.headwear, s.accent, s.garment, s.prop].join('|');

/** The silhouette-level look (view, face, hair, beard): the variety a 32px portrait shows. */
export const portraitSilhouette = (s: PortraitSpec): string => [s.view, s.face, s.hair, s.beard, s.headwear].join('|');
