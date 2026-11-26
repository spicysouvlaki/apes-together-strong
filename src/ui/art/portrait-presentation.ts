/**
 * How a named figure is drawn where history is clear about it (GDD §3 "Famous people", §11).
 * Content carries no gender or appearance, so this small cosmetic table lists only figures we
 * are confident about; every other id (including figures added later) gets a neutral bust:
 * no beard, hair or headwear that reads either way. Never used by game rules.
 *
 * Keep entries factual and dignified: women are drawn as the rulers, scholars and saints they
 * were (no softening props), monks shaved, eunuchs beardless, well-attested elders aged.
 */
import type { Age, Beard, Emblem, Hair, Headwear, Prop } from './portrait-spec';

export type Presentation = 'f' | 'm' | 'n';

export interface PresentationHint {
  p: Presentation;
  age?: Age;
  hair?: Hair;
  beard?: Beard;
  headwear?: Headwear;
  prop?: Prop;
  /** Draw an emblem instead of a bust (for legends who were not people). */
  emblem?: Emblem;
}

const F = (h: Omit<PresentationHint, 'p'> = {}): PresentationHint => ({ p: 'f', ...h });
const M = (h: Omit<PresentationHint, 'p'> = {}): PresentationHint => ({ p: 'm', ...h });

export const FIGURE_PRESENTATION: Readonly<Record<string, PresentationHint>> = {
  // Women
  hatshepsut: F({ headwear: 'nemes', prop: 'sceptre' }),
  ahmose_nefertari: F({ headwear: 'vultureCrown' }),
  arsinoe_ii: F({ headwear: 'diadem' }),
  cleopatra_vii: F({ headwear: 'diadem', hair: 'bun' }),
  hypatia: F({ prop: 'book' }),
  fu_hao: F({ prop: 'axe' }),
  wu_zetian: F({ headwear: 'hairpins', age: 'mature' }),
  hua_mulan: F({ age: 'young', prop: 'sword' }),
  zabibe: F({ headwear: 'veil' }),
  samsi: F({ headwear: 'veil' }),
  teelhunu: F({ headwear: 'veil' }),
  queen_of_sheba: F({ headwear: 'circlet' }),
  zenobia: F({ headwear: 'diadem', prop: 'spear' }),
  rabia_al_adawiyya: F({ headwear: 'veil', age: 'elder', prop: 'beads' }),
  fatima_al_fihri: F({ headwear: 'veil' }),
  margaret_i: F({ headwear: 'crown', age: 'mature' }),
  birgitta_of_sweden: F({ headwear: 'wimple', age: 'elder', prop: 'book' }),
  sorghaghtani_beki: F({ headwear: 'boqta', age: 'mature' }),
  maria_de_molina: F({ headwear: 'wimple', age: 'mature' }),
  egeria: F({ headwear: 'veil', prop: 'staff' }),
  peseshet: F({ prop: 'scroll' }),
  sappho: F({ prop: 'stylus' }),
  ban_zhao: F({ age: 'mature', prop: 'scroll' }),
  al_khansa: F({ headwear: 'veil', prop: 'stylus' }),
  zubayda: F({ headwear: 'circlet', prop: 'spade' }),
  audr_the_deep_minded: F({ headwear: 'veil', age: 'elder', prop: 'staff' }),
  gudrid: F({ prop: 'oar' }),
  borte_ujin: F({ headwear: 'boqta' }),
  khutulun: F({ age: 'young', prop: 'spear' }),
  urraca: F({ headwear: 'crown', prop: 'sceptre' }),
  // Men with well-known looks
  homer: M({ age: 'elder', beard: 'long', prop: 'scroll' }),
  solon: M({ age: 'elder', beard: 'full' }),
  thales: M({ age: 'elder', beard: 'full', prop: 'compass' }),
  confucius: M({ age: 'elder', beard: 'long', prop: 'scroll' }),
  sunzi: M({ beard: 'goatee' }),
  ptahhotep: M({ age: 'elder' }),
  antony_the_great: M({ age: 'elder', beard: 'long', headwear: 'hood' }),
  aristotle: M({ age: 'mature', beard: 'short', prop: 'scroll' }),
  pericles: M({ age: 'mature', beard: 'full', headwear: 'crestedHelm' }),
  basil_of_caesarea: M({ age: 'mature', beard: 'long' }),
  phidias: M({ age: 'mature', beard: 'full', prop: 'mallet' }),
  alexander_the_great: M({ age: 'young', beard: 'none', hair: 'curly', headwear: 'bare', prop: 'spear' }),
  odysseus: M({ age: 'mature', beard: 'full', headwear: 'pilos', prop: 'oar' }),
  themistocles: M({ beard: 'full' }),
  miltiades: M({ beard: 'full' }),
  xuanzang: M({ age: 'mature', beard: 'none', hair: 'shaved', headwear: 'bare', prop: 'beads' }),
  zheng_he: M({ beard: 'none', prop: 'compass' }),
  zhang_heng: M({ beard: 'long', prop: 'sphere' }),
  guan_zhong: M({ beard: 'long' }),
  duke_of_zhou: M({ beard: 'long' }),
  yu_the_great: M({ beard: 'full', prop: 'spade' }),
  harun_al_rashid: M({ headwear: 'kalansuwa', beard: 'full' }),
  al_kindi: M({ beard: 'full', prop: 'book' }),
  ibn_khaldun: M({ age: 'mature', beard: 'full', headwear: 'turban', prop: 'book' }),
  ibn_battuta: M({ beard: 'full', headwear: 'turban', prop: 'staff' }),
  ibn_fadlan: M({ beard: 'short', prop: 'scroll' }),
  khalid_ibn_al_walid: M({ beard: 'full', prop: 'sword' }),
  sinbad: M({ beard: 'short', prop: 'oar' }),
  harald_hardrada: M({ beard: 'full', prop: 'axe' }),
  snorri_sturluson: M({ age: 'mature', beard: 'full', prop: 'book' }),
  leif_erikson: M({ age: 'mature', beard: 'full', prop: 'oar' }),
  ohthere: M({ beard: 'full' }),
  ingolfr_arnarson: M({ beard: 'long' }),
  sigurd: M({ age: 'young', beard: 'none', prop: 'sword' }),
  chinggis_khan: M({ age: 'mature', beard: 'goatee', headwear: 'furHat' }),
  subutai: M({ beard: 'moustache' }),
  modu_chanyu: M({ beard: 'moustache' }),
  jangar: M({ age: 'young', prop: 'spear' }),
  el_cid: M({ age: 'mature', beard: 'long', prop: 'sword' }),
  alfonso_x: M({ age: 'mature', headwear: 'crown', prop: 'book' }),
  isidore_of_seville: M({ age: 'elder', beard: 'full', prop: 'book' }),
  ramon_llull: M({ age: 'elder', beard: 'long', headwear: 'hood' }),
  viriathus: M({ beard: 'full', prop: 'spear' }),
  julius_lacer: M({ prop: 'setSquare' }),
  imhotep: M({ age: 'mature', prop: 'setSquare' }),
  ramesses_ii: M({ headwear: 'khepresh', prop: 'sceptre' }),
  thutmose_iii: M(),
  harkhuf: M({ prop: 'staff' }),
  sinuhe: M(),
  nectanebo_i: M(),
  manetho: M({ prop: 'scroll' }),
  cosmas_indicopleustes: M({ age: 'mature', beard: 'full', prop: 'compass' }),
  setne_khamwas: M({ prop: 'scroll' }),
  eupalinos: M(),
  kolaios: M(),
  archias_of_corinth: M(),
  pytheas: M({ prop: 'compass' }),
  sunshu_ao: M(),
  wei_qing: M(),
  li_bing: M(),
  zhang_qian: M({ prop: 'staff' }),
  gindibu: M(),
  karibil_watar: M(),
  argantonio: M({ age: 'elder', beard: 'long' }),
  kiviuq: M({ beard: 'none' }),
  bernardo_del_carpio: M({ prop: 'sword' }),
  gargoris_and_habis: M({ age: 'elder', beard: 'long' }),
  amenhotep_son_of_hapu: M({ age: 'elder', prop: 'scroll' }),
  shenoute: M({ age: 'elder', beard: 'long', headwear: 'hood' }),
  herodotus: M({ age: 'mature', beard: 'full', prop: 'scroll' }),
  archimedes: M({ age: 'elder', beard: 'full', prop: 'compass' }),
  cai_lun: M({ beard: 'none', prop: 'scroll' }),
  shen_kuo: M({ age: 'mature', beard: 'long', prop: 'compass' }),
  ibn_al_haytham: M({ age: 'mature', beard: 'full', headwear: 'turban', prop: 'book' }),
  harald_bluetooth: M({ age: 'mature', beard: 'full' }),
  kublai_khan: M({ age: 'mature', beard: 'goatee', headwear: 'furHat' }),
  seneca: M({ age: 'elder', beard: 'short', prop: 'scroll' }),
  master_mateo: M({ prop: 'mallet' }),
  // Not a person: the blue-grey wolf and the fallow doe of the Secret History.
  borte_chino: { p: 'n', emblem: 'wolf' },
};

export const presentationOf = (id: string): PresentationHint => FIGURE_PRESENTATION[id] ?? { p: 'n' };
