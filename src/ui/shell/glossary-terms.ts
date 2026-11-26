/**
 * Glossary of game terms that appear across the UI (tap a dotted term for a one-paragraph
 * explainer). Pure: numbers come from the sim's named constants, so the explanations follow the
 * rules as tuned (GDD §3–§8). Never mentions affinity numbers (GDD §4 "Hidden affinity").
 */
import {
  HEAVIEST_CULTURE_DISCOUNT_PERCENT,
  RP_CARRY_FRACTION,
  RP_PER_MILESTONE,
  RP_PER_RETIRED_FIGURE,
  SCORE_PER_FIGURE,
  SCORE_PER_HYBRID,
  SCORE_PER_SEATED_FIGURE,
  SCORE_PER_SIGNATURE_EXTRA,
  SCORE_PER_TRADITION,
} from '../../sim/ages/constants';
import { ANARCHY_TURNS, SUZERAIN_MIN_ENVOYS } from '../../sim/constants';
import { GP_START_THRESHOLD, SEATED_TURNS_PER_WEIGHT } from '../../emergence/constants';

export type GlossaryId = 'culture_weight' | 'refinement_points' | 'great_people_points' | 'suzerain' | 'anarchy' | 'legacy_score';

export interface GlossaryEntry {
  id: GlossaryId;
  term: string;
  text: string;
}

export const GLOSSARY: Readonly<Record<GlossaryId, GlossaryEntry>> = {
  culture_weight: {
    id: 'culture_weight',
    term: 'Culture weight',
    text: `How much of a culture your people carry: 1 for every figure of that culture you have ever welcomed, plus 1 for every ${SEATED_TURNS_PER_WEIGHT} turns such figures have sat in your cabinet. When an age ends, weight decides which traditions you may adopt (1 for a custom, 3 for an institution, 5 for a signature), and your heaviest culture's traditions cost ${Math.abs(HEAVIEST_CULTURE_DISCOUNT_PERCENT)}% less.`,
  },
  refinement_points: {
    id: 'refinement_points',
    term: 'Refinement points',
    text: `What you spend between ages to adopt traditions and hybrids. You earn ${RP_PER_MILESTONE} for each legacy milestone reached, ${RP_PER_RETIRED_FIGURE} for each figure who retires to the Hall of Ancestors, the value of any figure you consume for points, and you keep ${Math.round(RP_CARRY_FRACTION * 100)}% of what you left unspent last time.`,
  },
  great_people_points: {
    id: 'great_people_points',
    term: 'Great-people points',
    text: `Six hidden pools (military, statesman, thought, faith, building, exploration) that fill as you play: battles fill the military pool, science the thought pool, exploring and trade the exploration pool, and so on. When a pool passes its threshold (${GP_START_THRESHOLD} at first, then higher each time), famous people of that kind offer to join you. Leader and dream bonuses to these points bring offers sooner.`,
  },
  suzerain: {
    id: 'suzerain',
    term: 'Suzerain',
    text: `The patron of a city-state: whoever has sent it the most envoys, with at least ${SUZERAIN_MIN_ENVOYS}. The suzerain gains the city-state's bonus, and its culture comes to know them, which draws that culture's famous people. Envoys cost influence, and each one you send to the same city-state costs more.`,
  },
  anarchy: {
    id: 'anarchy',
    term: 'Anarchy',
    text: `Changing government in the middle of an age throws your court into disorder for ${ANARCHY_TURNS} turns: no cabinet bonuses, and no seating or unseating. Your first government, and the one you choose between ages, comes free.`,
  },
  legacy_score: {
    id: 'legacy_score',
    term: 'Legacy score',
    text: `How history will remember you, and how the game is won: the highest score when the final age ends wins. ${SCORE_PER_FIGURE} per figure you keep (retired ancestors count, consumed ones do not), ${SCORE_PER_SEATED_FIGURE} more for each one seated, ${SCORE_PER_TRADITION} per tradition (${SCORE_PER_SIGNATURE_EXTRA} more for a signature), ${SCORE_PER_HYBRID} per hybrid, plus legacy points from milestones.`,
  },
};

export const GLOSSARY_IDS = Object.keys(GLOSSARY) as GlossaryId[];

/** Matches any glossary term in running text (case-insensitive, hyphen or space). */
const TERM_PATTERNS: readonly { id: GlossaryId; re: RegExp }[] = [
  { id: 'great_people_points', re: /great[- ]people points/i },
  { id: 'culture_weight', re: /culture weight/i },
  { id: 'refinement_points', re: /refinement points/i },
  { id: 'legacy_score', re: /legacy score/i },
  { id: 'suzerain', re: /suzerain(?:ty)?/i },
  { id: 'anarchy', re: /anarchy/i },
];

export type TextPart = { text: string } | { text: string; term: GlossaryId };

/**
 * Split text into plain runs and glossary terms (first occurrence of each term only, so a
 * paragraph is not a field of dotted underlines).
 */
export const splitTerms = (text: string): TextPart[] => {
  const hits: { start: number; end: number; id: GlossaryId }[] = [];
  for (const { id, re } of TERM_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (hits.some((h) => start < h.end && end > h.start)) continue;
    hits.push({ start, end, id });
  }
  hits.sort((a, b) => a.start - b.start);
  const out: TextPart[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start > at) out.push({ text: text.slice(at, h.start) });
    out.push({ text: text.slice(h.start, h.end), term: h.id });
    at = h.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
};
