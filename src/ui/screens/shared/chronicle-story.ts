/**
 * The Chronicle as a story (GDD §8 "Chronicle"): an opening line from the civ's name, leader,
 * dream and top cultures; each age as a book; a closing line; and a plain-text summary to share.
 * Pure: built from the ChronicleView (chronicle.ts) plus culture names.
 */
import type { ChronicleAge, ChronicleView } from './chronicle';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const AGE_WORD: Record<string, string> = { ancient: 'Ancient', classical: 'Classical', exploration: 'Exploration', modern: 'Modern' };

export const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "A and B", "A, B and C". */
export const listAnd = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

export interface StoryInput {
  view: ChronicleView;
  /** Adjectives of the heaviest cultures, heaviest first ("Egyptian", "Sinic"). */
  cultures: readonly string[];
  /** The civ was named by its player (else "a people yet unnamed"). */
  named: boolean;
}

export const openingLine = ({ view, cultures, named }: StoryInput): string => {
  // Civ names are stored lower-case ("the Egyptian Tiānxià"): right for mid-sentence.
  const who = named ? view.civName : 'a people yet unnamed';
  const dream = view.dream ? `, who carried the dream “${view.dream.meaning}”` : '';
  const roots = cultures.length > 0 ? ` Their ways grew from ${listAnd(cultures.slice(0, 3))} roots.` : ' No one yet knew what they would become.';
  return `This is the chronicle of ${who}, led by ${view.leader}${dream}.${roots}`;
};

/** One line for a book: who joined, what was kept, what was built, what was fought. */
export const ageSummary = (a: ChronicleAge): string => {
  const parts: string[] = [];
  if (a.figures.length) parts.push(`${listAnd(a.figures.map((f) => f.name.replace(/\s*\([^)]*\)\s*$/, '')))} ${a.figures.length === 1 ? 'joined' : 'joined the court'}`);
  const kept = [...a.hybrids, ...a.traditions].map((t) => t.name);
  if (kept.length) parts.push(`${listAnd(kept)} ${kept.length === 1 ? 'was' : 'were'} adopted`);
  if (a.wonders.length) parts.push(`${listAnd(a.wonders.map((w) => w.name))} rose`);
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

/** The whole story as plain text, for the share sheet. */
export const shareSummary = (input: StoryInput, ended: boolean, turn: number): string => {
  const { view } = input;
  const lines = [`The Chronicle of ${cap(view.civName)}`, '', openingLine(input), ''];
  view.ages.forEach((a, i) => {
    lines.push(`Book ${ROMAN[i] ?? i + 1}: The ${AGE_WORD[a.age] ?? cap(a.age)} Age. ${ageSummary(a)}`);
  });
  lines.push('', closingLine(view, ended, view.ages[view.ages.length - 1]?.age ?? null, turn), '', '— Apes Together Strong');
  return lines.join('\n');
};
