/**
 * Wave 12 playtest fixes (UI only): named setup radios, the glossary not hijacking a first tap,
 * the Chronicle's prose (archetype articles, one reason told once, wars and losses grouped,
 * "the Collapse", "now" before the end), leader titles mid-sentence, the build queue's full note
 * and suggestions (no settler without land, no scout as advice, one spoken sentence), and unmet
 * rivals.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ProductionOption } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { dreamLabel } from '../src/ui/shell/setup-logic';
import { termExplainsOnTap } from '../src/ui/shell/GlossarySheet';
import { MAX_QUEUE, openLandNear, queueFullNote, suggestionLabel, suggestNext, type SuggestContext } from '../src/ui/shell/build-queue';
import { hasMet } from '../src/ui/screens/shared/envoy';
import { buildChronicle } from '../src/ui/screens/shared/chronicle';
import {
  leaderTitle,
  lostSentence,
  midName,
  openingLine,
  peopleParagraph,
  reasonKey,
  storyParagraphs,
  storyVoice,
  warSentence,
  type StoryFacts,
} from '../src/ui/screens/shared/chronicle-story';
import { buildScenario, HUMAN } from '../src/ui/screens/demo-scenario';

const content = loadContent();
const BAD = /undefined|\[object|NaN|null/;

describe('setup accessibility', () => {
  it('names a founding dream by its romanized word, meaning and language', () => {
    expect(dreamLabel({ native: 'κλέος', romanized: 'Kléos', meaning: 'Undying glory', language: 'Ancient Greek' })).toBe('Kléos, “Undying glory”, Ancient Greek');
  });

  it('a first tap on an unchosen radio card chooses it without opening the glossary', () => {
    const el = (attrs: Record<string, string>) => ({ getAttribute: (n: string) => attrs[n] ?? null });
    expect(termExplainsOnTap(el({ role: 'radio', 'aria-checked': 'false' }))).toBe(false);
    expect(termExplainsOnTap(el({ role: 'radio', 'aria-checked': 'true' }))).toBe(true);
    expect(termExplainsOnTap(el({}))).toBe(true);
    expect(termExplainsOnTap(null)).toBe(true);
  });
});

describe('Chronicle prose', () => {
  it('lower-cases an archetype article mid-sentence and leader titles after "led by"', () => {
    expect(midName('An Atlantic Bronze Age trader')).toBe('an Atlantic Bronze Age trader');
    expect(midName('A Taymanite scribe')).toBe('a Taymanite scribe');
    expect(midName('Confucius (Kong Qiu)')).toBe('Confucius');
    expect(midName('Aristotle')).toBe('Aristotle');
    expect(leaderTitle('The Merchant')).toBe('the Merchant');
  });

  it('tells reasons in the story voice and knows two phrasings are one reason', () => {
    expect(storyVoice('drawn by your harbors')).toBe('drawn by their harbors');
    expect(reasonKey(storyVoice('following tales of your desert roads'))).toBe('their desert roads');
    expect(reasonKey(storyVoice('curious to see your desert roads with their own eyes'))).toBe('their desert roads');
    expect(reasonKey('drawn by its harbors')).toBe('its harbors');
    expect(reasonKey('something unheard of')).toBe('something unheard of');
  });

  it('groups figures drawn by one thing however it was phrased, and caps an archetype only at a sentence start', () => {
    const { state } = buildScenario('ended', content);
    const view = buildChronicle(state, HUMAN, content);
    if (!view) throw new Error('no view');
    const figs = view.ages.flatMap((a) => a.figures);
    if (figs.length < 2) return;
    const [a, b] = figs as [(typeof figs)[number], (typeof figs)[number]];
    const reasons: Record<string, string> = {};
    for (const f of figs) reasons[f.id] = 'drawn by their rivers';
    reasons[a.id] = storyVoice('following tales of your desert roads');
    reasons[b.id] = storyVoice('curious to see your desert roads with their own eyes');
    const para = peopleParagraph(view, reasons);
    expect(para.match(/desert roads/g)?.length).toBe(1);
    expect(para).not.toMatch(/[,:] An? [A-Z]/);
    expect(para).not.toMatch(BAD);
  });

  it('names a repeat declarer once and says how the war ended', () => {
    const s = warSentence([
      { against: 'the Conqueror’s people', by: 'them', turn: 40, ongoing: false },
      { against: 'the Conqueror’s people', by: 'them', turn: 70, ongoing: false },
      { against: 'the Builder’s people', by: 'us', turn: 61, ongoing: true },
    ]);
    expect(s.match(/Conqueror/g)?.length).toBe(1);
    expect(s).toContain('The Conqueror’s people declared war on them twice, on turns 40 and 70, and in time made peace');
    expect(s).toContain('they went to war with the Builder’s people on turn 61, a war not yet over');
    expect(warSentence([{ against: 'X', by: 'them', turn: 3 }])).toBe('X declared war on them on turn 3.');
  });

  it('names a taker once in the lost-cities sentence', () => {
    const s = lostSentence([
      { name: 'Onuba', to: 'the Conqueror’s people' },
      { name: 'Baria', to: 'the Conqueror’s people' },
      { name: 'Abdera', to: 'the Conqueror’s people' },
      { name: 'Malaka', to: null },
    ]);
    expect(s.match(/Conqueror/g)?.length).toBe(1);
    expect(s).toBe('They lost Onuba, Baria and Abdera to the Conqueror’s people, and Malaka.');
  });

  it('speaks of "now" before the end, "the Collapse", and a neutral close for a people without ties', () => {
    const { state } = buildScenario('ended', content);
    const view = buildChronicle(state, HUMAN, content);
    if (!view) throw new Error('no view');
    const facts: StoryFacts = {
      founded: ['Gadir', 'Malaka'],
      held: 2,
      wars: [],
      taken: [],
      lost: [],
      conquered: 0,
      suzerainOf: [],
      tradeRoutes: 0,
      reasons: {},
    };
    const input = { view, cultures: ['Greek'], named: true };
    const mid = storyParagraphs(input, facts, false, 40).join('\n');
    expect(mid).toContain('and now they hold 2 settlements');
    expect(mid).toContain('For now, no city-state called them protector');
    const end = storyParagraphs(input, facts, true, 40).join('\n');
    expect(end).toContain('and at the end they held 2 settlements');
    expect(end).not.toContain('kept to themselves');
    const crisisView = { ...view, ages: view.ages.map((a, i) => (i === 0 ? { ...a, crises: [{ turn: 3, text: 'Collapse: hard times' }] } : a)) } as typeof view;
    expect(storyParagraphs({ ...input, view: crisisView }, facts, true, 40).join('\n')).toContain('They endured the Collapse.');
    expect(openingLine({ ...input, view: { ...view, leader: 'The Merchant' } })).toContain('led by the Merchant');
  });
});

describe('build queue and suggestions', () => {
  const opt = (item: string, kind: ProductionOption['kind'], turns: number): ProductionOption => ({ item, kind, cost: turns * 10, turns, goldCost: turns * 20 });
  const base: SuggestContext = { name: 'Gadir', unguarded: false, threatened: false, roomToExpand: false, founders: new Set(['settler']), military: new Set(['spearman']) };

  it('explains a full queue instead of hiding the add button', () => {
    expect(queueFullNote(MAX_QUEUE)).toBe('The queue holds 3; the next opens when the first starts.');
  });

  it('never suggests a scout when every building is built; a soldier at most', () => {
    expect(suggestNext([opt('scout', 'unit', 2), opt('merchant', 'unit', 4)], base)).toBeNull();
    expect(suggestNext([opt('scout', 'unit', 2), opt('spearman', 'unit', 4)], base)).toEqual({ item: 'spearman', why: 'every building here is built' });
  });

  it('reads the suggestion as one sentence', () => {
    expect(suggestionLabel('Feast Hall', 'the quickest building (4 turns)')).toBe('Suggested: build Feast Hall. The quickest building (4 turns).');
    expect(suggestionLabel('Settler', 'there is room for another settlement', 'Gadir')).toBe('Suggested for Gadir: build Settler. There is room for another settlement.');
  });

  it('only calls for a settler when explored, foundable land is in reach', () => {
    const { state } = buildScenario('ended', content);
    const g: GameState = JSON.parse(JSON.stringify(state));
    const city = Object.values(g.settlements).find((s) => s.owner === HUMAN);
    if (!city) throw new Error('no city');
    const p = g.players[HUMAN];
    if (!p) throw new Error('no player');
    p.explored = p.explored.map(() => 0);
    expect(openLandNear(g, HUMAN, city.at, content)).toBe(false);
  });
});

describe('rivals not yet met', () => {
  it('knows a rival is unmet until their lands are seen or they speak', () => {
    const { state } = buildScenario('ended', content);
    const g: GameState = JSON.parse(JSON.stringify(state));
    const rival = g.playerOrder.find((id) => id !== HUMAN) as string;
    const p = g.players[HUMAN];
    if (!p) throw new Error('no player');
    p.explored = p.explored.map(() => 0);
    p.effects = p.effects.filter((e) => !e.source.startsWith('met:'));
    expect(hasMet(g, HUMAN, rival)).toBe(false);
    p.effects.push({ source: `met:${rival}`, untilTurn: 9999, modifiers: [] });
    expect(hasMet(g, HUMAN, rival)).toBe(true);
  });
});
