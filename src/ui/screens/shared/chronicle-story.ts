/**
 * The Chronicle as a story (GDD §8 "Chronicle"): an opening line from the civ's name, leader,
 * dream and top cultures; a short story in a few paragraphs (wave 11 playtest: the old ending
 * read as a list, ten names in one sentence and the same reason six times, with no word of
 * city-states, trade or wars); each age as a book; a closing line; a plain-text summary to share.
 * Pure and deterministic: built from the ChronicleView (chronicle.ts), the GameState and names.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameState, PlayerId } from '@contracts/sim-api';
import { annalVoice } from '../../../emergence/figures';
import { WAR_DECLARED_TEXT } from '../../../sim/diplomacy';
import type { ChronicleAge, ChronicleView } from './chronicle';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const AGE_WORD: Record<string, string> = { ancient: 'Ancient', classical: 'Classical', exploration: 'Exploration', modern: 'Modern' };

export const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "A and B", "A, B and C". */
export const listAnd = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** At most `max` names, then "and N others" ("A, B, C and 7 others"). */
export const listCapped = (xs: readonly string[], max = 3): string => {
  if (xs.length <= max + 1) return listAnd(xs);
  const rest = xs.length - max;
  return `${xs.slice(0, max).join(', ')} and ${rest} others`;
};

/** What happened beyond the figures and traditions: the facts a story needs (from GameState). */
export interface StoryFacts {
  /** Settlements this people founded, in order. */
  founded: string[];
  /** Settlements held now. */
  held: number;
  /** Wars, in the order they began. `by` is who declared. */
  wars: { against: string; by: 'us' | 'them'; turn: number }[];
  /** Cities taken from others and lost to others ("Gadir to the Conqueror's people"). */
  taken: string[];
  lost: { name: string; to: string | null }[];
  /** Rival peoples this people conquered outright. */
  conquered: number;
  /** City-states that look to this people now. */
  suzerainOf: string[];
  /** Trade routes this people runs now. */
  tradeRoutes: number;
  /** Why each figure came, in the annal voice; 'deed' for deed figures. */
  reasons: Record<string, string>;
}

export interface StoryInput {
  view: ChronicleView;
  /** Adjectives of the heaviest cultures, heaviest first ("Egyptian", "Sinic"). */
  cultures: readonly string[];
  /** The civ was named by its player (else "a people yet unnamed"). */
  named: boolean;
  /** Present when the story is told in full (storyParagraphs); absent in older callers. */
  facts?: StoryFacts;
}

const TAKEN = / was taken\.$/;
const LOST = / was lost\.$/;
const FOUNDED = / was founded\.$/;

/** Story facts for `player` from the snapshot. `ownerName` names players and city-states. */
export const storyFacts = (state: GameState, player: PlayerId, content: ContentBundle, ownerName: (id: string) => string): StoryFacts => {
  const p = state.players[player];
  const facts: StoryFacts = { founded: [], held: 0, wars: [], taken: [], lost: [], conquered: 0, suzerainOf: [], tradeRoutes: 0, reasons: {} };
  if (!p) return facts;
  const nameOf = (id: string, text: string, re: RegExp): string => state.settlements[id]?.name ?? text.replace(re, '');
  for (const e of p.chronicle) {
    if (e.kind === 'founding') facts.founded.push(nameOf(e.ref, e.text, FOUNDED));
    if (e.kind !== 'war') continue;
    if (e.text === WAR_DECLARED_TEXT && state.players[e.ref]) facts.wars.push({ against: ownerName(e.ref), by: 'us', turn: e.turn });
    else if (TAKEN.test(e.text)) facts.taken.push(nameOf(e.ref, e.text, TAKEN));
    else if (LOST.test(e.text)) {
      const owner = state.settlements[e.ref]?.owner;
      facts.lost.push({ name: nameOf(e.ref, e.text, LOST), to: owner && owner !== player ? ownerName(owner) : null });
    } else if (e.ref !== player && state.players[e.ref]) facts.conquered++;
  }
  // Wars declared on us live in the declarer's chronicle.
  for (const id of state.playerOrder) {
    if (id === player) continue;
    for (const e of state.players[id]?.chronicle ?? []) {
      if (e.kind === 'war' && e.text === WAR_DECLARED_TEXT && e.ref === player) facts.wars.push({ against: ownerName(id), by: 'them', turn: e.turn });
    }
  }
  facts.wars.sort((a, b) => a.turn - b.turn);
  facts.held = Object.values(state.settlements).filter((s) => s.owner === player).length;
  facts.suzerainOf = Object.values(state.cityStates)
    .filter((cs) => cs.alive && cs.suzerain === player)
    .map((cs) => content.cityStates.find((c) => c.id === cs.id)?.name ?? ownerName(`cs:${cs.id}`));
  facts.tradeRoutes = state.tradeRoutes.filter((r) => r.owner === player).length;
  for (const f of Object.values(state.figures)) {
    if (f.owner !== player) continue;
    const def = content.figures.find((x) => x.id === f.id);
    facts.reasons[f.id] = def?.deed ? 'deed' : f.reason ? annalVoice(f.reason) : '';
  }
  return facts;
};

const shortName = (n: string): string => n.replace(/\s*\([^)]*\)\s*$/, '');

/** Phrasings for a group that came for one reason; picked by the group's place (deterministic). */
const GROUP_LINES: readonly ((names: string, reason: string, many: boolean) => string)[] = [
  (n, r) => `${cap(r)}, ${n} came to court.`,
  (n, r) => `${n} followed, ${r}.`,
  (n, r) => `Then came ${n}, ${r}.`,
  (n, r, many) => `${cap(r)}, ${n} ${many ? 'were' : 'was'} next to join them.`,
];

/** The people paragraph: figures grouped by why they came, names capped, phrasing varied. */
export const peopleParagraph = (view: ChronicleView, reasons: Readonly<Record<string, string>>): string => {
  const figures = view.ages.flatMap((a) => a.figures).sort((a, b) => a.turn - b.turn);
  if (figures.length === 0) return 'No famous person ever came to their court; they made their way alone.';
  const groups: { reason: string; names: string[] }[] = [];
  const deeds: string[] = [];
  const loose: string[] = [];
  for (const f of figures) {
    const r = reasons[f.id] ?? '';
    if (r === 'deed') deeds.push(shortName(f.name));
    else if (!r) loose.push(shortName(f.name));
    else {
      const g = groups.find((x) => x.reason === r);
      if (g) g.names.push(shortName(f.name));
      else groups.push({ reason: r, names: [shortName(f.name)] });
    }
  }
  // The biggest draws first; ties keep arrival order.
  const ordered = groups.map((g, i) => ({ g, i })).sort((a, b) => b.g.names.length - a.g.names.length || a.i - b.i).map((x) => x.g);
  const told = ordered.slice(0, 3);
  for (const g of ordered.slice(3)) loose.push(...g.names);
  const lines = told.map((g, i) => (GROUP_LINES[i % GROUP_LINES.length] as (n: string, r: string, m: boolean) => string)(listCapped(g.names), g.reason, g.names.length > 1));
  if (deeds.length) lines.push(`${listCapped(deeds)} ${deeds.length === 1 ? 'was' : 'were'} drawn by great deeds.`);
  if (loose.length) lines.push(`${listCapped(loose)} came for reasons of their own.`);
  const n = figures.length;
  return `${n === 1 ? 'One famous person' : `${n} famous people`} joined them. ${lines.join(' ')}`;
};

const foundingSentence = (f: StoryFacts): string => {
  const [first, ...rest] = f.founded;
  if (!first) return '';
  if (rest.length === 0) return ` Their first home was ${first}.`;
  return ` Their first home was ${first}; ${listCapped(rest)} followed${f.held ? `, and at the end they held ${f.held} ${f.held === 1 ? 'settlement' : 'settlements'}` : ''}.`;
};

const keptParagraph = (view: ChronicleView): string => {
  const traditions = view.ages.flatMap((a) => a.traditions).map((t) => t.name);
  const hybrids = view.ages.flatMap((a) => a.hybrids).map((t) => t.name);
  const wonders = view.ages.flatMap((a) => a.wonders).map((w) => w.name);
  const parts: string[] = [];
  if (traditions.length) parts.push(`They kept the ways of ${listCapped(traditions)}`);
  if (hybrids.length) parts.push(`${parts.length ? 'and blended' : 'They blended'} old ways into ${listCapped(hybrids)}`);
  let out = parts.length ? `${parts.join(', ')}.` : '';
  if (wonders.length) out += `${out ? ' ' : ''}${wonders.length === 1 ? `${wonders[0]} rose in their lands` : `${listCapped(wonders)} rose in their lands`}.`;
  return out;
};

const warParagraph = (view: ChronicleView, f: StoryFacts): string => {
  const out: string[] = [];
  if (f.wars.length === 0) out.push('They never went to war.');
  else {
    const told = f.wars.slice(0, 3).map((w) => (w.by === 'us' ? `went to war with ${w.against} on turn ${w.turn}` : `${w.against} declared war on them on turn ${w.turn}`));
    const lead = told[0] ?? '';
    const first = lead.startsWith('went') ? `They ${lead}` : cap(lead);
    const more = told.slice(1).map((t) => (t.startsWith('went') ? `they ${t}` : t));
    out.push(`${[first, ...more].join('; ')}${f.wars.length > 3 ? `, among ${f.wars.length} wars` : ''}.`);
    if (f.taken.length) out.push(`They took ${listCapped(f.taken)}.`);
    if (f.lost.length) out.push(`They lost ${listCapped(f.lost.map((l) => (l.to ? `${l.name} to ${l.to}` : l.name)))}.`);
    if (!f.taken.length && !f.lost.length) out.push('No city changed hands.');
    if (f.conquered) out.push(f.conquered === 1 ? 'One rival people was conquered outright.' : `${f.conquered} rival peoples were conquered outright.`);
  }
  const crises = view.ages.flatMap((a) => a.crises).map((c) => c.text.split(':')[0]?.trim() ?? c.text);
  const uniq = [...new Set(crises)];
  if (uniq.length) out.push(`They endured ${listCapped(uniq)}.`);
  return out.join(' ');
};

const tiesParagraph = (f: StoryFacts): string => {
  const cs = f.suzerainOf.length ? `${listCapped(f.suzerainOf)} looked to them as protector` : '';
  const tr = f.tradeRoutes ? `${f.tradeRoutes === 1 ? 'one trade route' : `${f.tradeRoutes} trade routes`} carried their goods` : '';
  if (cs && tr) return `${cap(cs)}, and ${tr}.`;
  if (cs) return `${cap(cs)}; no caravan of theirs was on the roads at the end.`;
  if (tr) return `${cap(tr)}, though no city-state called them protector.`;
  return 'They kept to themselves: no city-state called them protector, and no caravan carried their goods.';
};

/**
 * The story in four to six short paragraphs: who they were and where they began; who came and
 * why; what they kept and built; their wars and hard times; their friends and trade; the end.
 */
export const storyParagraphs = (input: StoryInput, facts: StoryFacts, ended: boolean, turn: number): string[] => {
  const { view } = input;
  const paras = [`${openingLine(input)}${foundingSentence(facts)}`, peopleParagraph(view, facts.reasons)];
  const kept = keptParagraph(view);
  if (kept) paras.push(kept);
  paras.push(warParagraph(view, facts));
  paras.push(tiesParagraph(facts));
  paras.push(closingLine(view, ended, view.ages[view.ages.length - 1]?.age ?? null, turn));
  return paras;
};

export const openingLine = ({ view, cultures, named }: StoryInput): string => {
  // Civ names are stored lower-case ("the Egyptian Tiānxià"): right for mid-sentence.
  const who = named ? view.civName : 'a people yet unnamed';
  const dream = view.dream ? `, who carried the dream “${view.dream.meaning}”` : '';
  const roots = cultures.length > 0 ? ` Their ways grew from ${listAnd(cultures.slice(0, 3))} roots.` : ' No one yet knew what they would become.';
  // Leader archetypes are titled "The Merchant"; mid-sentence it is "led by the Merchant".
  const leader = view.leader.replace(/^The /, 'the ');
  return `This is the chronicle of ${who}, led by ${leader}${dream}.${roots}`;
};

/** One line for a book: who joined, what was kept, what was built, what was fought. */
export const ageSummary = (a: ChronicleAge): string => {
  const parts: string[] = [];
  if (a.figures.length) parts.push(`${listCapped(a.figures.map((f) => shortName(f.name)))} ${a.figures.length === 1 ? 'joined' : 'joined the court'}`);
  const kept = [...a.hybrids, ...a.traditions].map((t) => t.name);
  if (kept.length) parts.push(`${listCapped(kept)} ${kept.length === 1 ? 'was' : 'were'} adopted`);
  if (a.wonders.length) parts.push(`${listCapped(a.wonders.map((w) => w.name))} rose`);
  if (a.wars.length) parts.push(a.wars.length === 1 ? 'one war was fought' : `${a.wars.length} wars were fought`);
  if (a.crises.length) parts.push('hard times were endured');
  return parts.length ? `${cap(parts.join('; '))}.` : 'A quiet age, remembered for little.';
};

export const closingLine = (view: ChronicleView, ended: boolean, lastAge: string | null, turn: number): string => {
  if (!ended) return `The chronicle is still being written, turn ${turn}.`;
  const figures = view.ages.reduce((n, a) => n + a.figures.length, 0);
  const kept = view.ages.reduce((n, a) => n + a.traditions.length + a.hybrids.length, 0);
  const tail = `${figures} ${figures === 1 ? 'figure' : 'figures'} served them; ${kept} ${kept === 1 ? 'tradition endures' : 'traditions endure'}.`;
  if (view.result?.won) return `And so ${view.civName} prevailed. ${tail}`;
  const place = view.result ? `They finished ${ordinal(view.result.rank)} of ${view.result.of}` : 'Their story closed';
  return `${place}${lastAge ? ` as the ${AGE_WORD[lastAge] ?? cap(lastAge)} age ended` : ''}. ${tail}`;
};

export const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** The whole story as plain text, for the share sheet (the story paragraphs when facts are known). */
export const shareSummary = (input: StoryInput, ended: boolean, turn: number): string => {
  const { view } = input;
  if (input.facts) {
    return [`The Chronicle of ${cap(view.civName)}`, '', ...storyParagraphs(input, input.facts, ended, turn).flatMap((p) => [p, '']), '— Apes Together Strong'].join('\n');
  }
  const lines = [`The Chronicle of ${cap(view.civName)}`, '', openingLine(input), ''];
  view.ages.forEach((a, i) => {
    lines.push(`Book ${ROMAN[i] ?? i + 1}: The ${AGE_WORD[a.age] ?? cap(a.age)} Age. ${ageSummary(a)}`);
  });
  lines.push('', closingLine(view, ended, view.ages[view.ages.length - 1]?.age ?? null, turn), '', '— Apes Together Strong');
  return lines.join('\n');
};
