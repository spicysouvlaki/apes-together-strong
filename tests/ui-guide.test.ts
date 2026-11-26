/**
 * The in-game guide (GDD §11 onboarding): tip selection over scripted game states, pacing and
 * goals, and the glossary registry. Pure; no DOM.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { sim, queries as q } from '../src/sim';
import { STEP_IDS, advisorFor, goalsMet, nextAdvice, type GuideMemory, type GuideView } from '../src/ui/shell/advice';
import { GLOSSARY, GLOSSARY_IDS, splitTerms } from '../src/ui/shell/glossary-terms';
import { buildGameSetup, type SetupChoices } from '../src/ui/shell/setup-logic';

const content = loadContent();
const choices: SetupChoices = {
  leader: 'builder',
  dream: 'pax',
  primary: '#0072b2',
  secondary: '#ffffff',
  skinTone: 2,
  mapSize: 'small',
  speed: 'standard',
  rivals: 2,
  seed: 42,
};
const newGame = (): GameState =>
  sim.createGame(
    buildGameSetup(
      choices,
      content.leaders.map((l) => l.id),
      content.dreams.map((d) => d.id),
    ),
    content,
  ).state;
const unitOf = (s: GameState, type: string) => {
  const u = Object.values(s.units).find((x) => x.owner === 'p1' && x.type === type);
  if (!u) throw new Error(`no ${type}`);
  return u;
};
const apply = (s: GameState, cmd: Parameters<typeof sim.applyCommand>[2]): GameState => {
  const r = sim.applyCommand(s, 'p1', cmd, content);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

const fresh: GuideMemory = { seen: [], lastTipTurn: -1, current: null };
const noView: GuideView = { selectedUnitType: null, ordered: [] };
const tip = (s: GameState, mem: GuideMemory = fresh, view: GuideView = noView) => nextAdvice(s, 'p1', mem, view, content, q);
const seen = (...ids: string[]): GuideMemory => ({ ...fresh, seen: ids });

/** Found the first city and answer the opening decisions. */
const settled = (): GameState => {
  let s = newGame();
  s = apply(s, { type: 'foundSettlement', unit: unitOf(s, 'settler').id });
  const city = Object.values(s.settlements).find((x) => x.owner === 'p1')!;
  s = apply(s, { type: 'setProduction', settlement: city.id, item: 'warrior_band' });
  for (const tree of ['tech', 'civic'] as const) {
    const opt = q.researchOptions(s, 'p1', tree, content)[0];
    if (opt) s = apply(s, { type: 'setResearch', tree, id: opt.id });
  }
  const gov = q.governmentOptions(s, 'p1', content)[0];
  if (gov) s = apply(s, { type: 'setGovernment', government: gov });
  return s;
};

describe('guide: opening steps follow the game state', () => {
  it('starts by asking for the first city, pointing at the settler button', () => {
    const s = newGame();
    const a = tip(s)!;
    expect(a.id).toBe('found');
    expect(a.target).toBe('decision:found');
    const sel = tip(s, fresh, { selectedUnitType: 'settler', ordered: [] })!;
    expect(sel.target).toBe('found');
    expect(sel.text).toMatch(/Found settlement/);
    expect(sel.short).toBeDefined();
  });

  it('steps aside while the settler marches, and is only done once a city stands', () => {
    const s = newGame();
    const settler = unitOf(s, 'settler');
    const marching = tip(s, fresh, { selectedUnitType: null, ordered: [settler.id] });
    expect(marching?.id).not.toBe('found');
    expect(goalsMet(s, 'p1', noView, content, q)).not.toContain('found');
    const founded = apply(s, { type: 'foundSettlement', unit: settler.id });
    expect(goalsMet(founded, 'p1', noView, content, q)).toContain('found');
  });

  it('then production, research and government, in that order, each once', () => {
    let s = newGame();
    s = apply(s, { type: 'foundSettlement', unit: unitOf(s, 'settler').id });
    expect(tip(s, seen('found'))?.id).toBe('production');
    expect(tip(s, seen('found'))?.target).toBe('decision:production');
    expect(tip(s, seen('found', 'production'))?.id).toBe('research');
    expect(tip(s, seen('found', 'production', 'research'))?.id).toBe('government');
  });

  it('teaches exploring and End Turn once the opening decisions are made', () => {
    const s = settled();
    const mem = seen('found', 'production', 'research', 'government');
    const a = tip(s, mem)!;
    expect(a.id).toBe('explore');
    expect(a.target).toBe('nextUnit');
    expect(tip(s, mem, { selectedUnitType: 'scout', ordered: [] })?.target).toBe('explore');
    const scout = unitOf(s, 'scout');
    expect(tip(s, mem, { selectedUnitType: null, ordered: [scout.id] })?.id).toBe('end_turn');
    expect(tip(s, { ...mem, seen: [...mem.seen, 'explore'] })?.target).toBe('endTurn');
  });
});

describe('guide: the first figure offer and the cabinet', () => {
  it('explains the offer when one is waiting, then the four uses, then seating', () => {
    const s = settled();
    const fig = content.figures.find((f) => f.age === 'ancient' && f.uses.includes('cabinet') && !f.deed)!;
    const offered: GameState = {
      ...s,
      offers: [{ id: 'o1', player: 'p1', source: 'statesman', candidates: [fig.id], reasons: { [fig.id]: 'drawn by your rivers' }, deed: null, createdTurn: s.turn }],
    };
    const a = tip(offered, seen('found', 'production', 'research', 'government'))!;
    expect(a.id).toBe('offer');
    expect(a.target).toBe('decision:offer');
    expect(a.text).toMatch(/drawn from history/);
    const recruited = apply(offered, { type: 'chooseOffer', offer: 'o1', figure: fig.id });
    const b = tip(recruited, seen('found', 'production', 'research', 'government', 'offer'))!;
    expect(b.id).toBe('figures');
    expect(b.text).toContain(fig.name);
    expect(b.text).toMatch(/seated.*deployed.*activated.*consumed/);
    const c = tip(recruited, seen('found', 'production', 'research', 'government', 'offer', 'figures'));
    const canSeat = q.figureActions(recruited, fig.id, content).seat.length > 0;
    if (canSeat) expect(c?.id).toBe('seat');
    // Once seated, tips are attributed to that advisor.
    expect(advisorFor(recruited, 'p1', content)).toBeNull();
    const key = q.figureActions(recruited, fig.id, content).seat[0];
    if (key) {
      const seated = apply(recruited, { type: 'seatFigure', figure: fig.id, slot: key });
      expect(advisorFor(seated, 'p1', content)).toMatchObject({ figure: fig.id, name: fig.name });
    }
  });
});

describe('guide: pacing, memory and later steps', () => {
  it('never shows a seen tip again and shows nothing outside play', () => {
    const s = newGame();
    expect(tip(s, seen(...STEP_IDS))).toBeNull();
    expect(tip({ ...s, phase: 'transition' })).toBeNull();
  });

  it('paces situational tips to one new tip per turn', () => {
    const s = settled();
    const grown: GameState = {
      ...s,
      turn: 12,
      settlements: Object.fromEntries(Object.entries(s.settlements).map(([k, v]) => [k, v.owner === 'p1' ? { ...v, population: 3 } : v])),
    };
    const opening = ['found', 'production', 'research', 'government', 'explore', 'end_turn', 'offer', 'figures', 'seat'];
    expect(tip(grown, { seen: opening, lastTipTurn: 11, current: null })?.id).toBe('growth');
    // A paced tip already appeared this turn: the next one waits for the next turn...
    expect(tip(grown, { seen: [...opening, 'growth'], lastTipTurn: 12, current: null })).toBeNull();
    // ...but the tip on screen keeps its place.
    expect(tip(grown, { seen: opening, lastTipTurn: 12, current: 'growth' })?.id).toBe('growth');
  });

  it('names the settlement cap and the crisis point from the rules', () => {
    const s = settled();
    const later: GameState = { ...s, turn: 14, ageProgress: 40 };
    const opening = ['found', 'production', 'research', 'government', 'explore', 'end_turn', 'growth', 'culture', 'town', 'happiness', 'city_states', 'trade'];
    const a = tip(later, { seen: opening, lastTipTurn: 0, current: null })!;
    expect(a.id).toBe('expand');
    expect(a.text).toContain(String(q.settlementCap(later, 'p1', content)));
    const b = tip(later, { seen: [...opening, 'expand'], lastTipTurn: 0, current: null })!;
    expect(b.id).toBe('age');
    expect(b.target).toBe('age');
    expect(b.text).toMatch(/70/);
  });

  it('warns about nearby enemies right away (not paced)', () => {
    const s = settled();
    const city = Object.values(s.settlements).find((x) => x.owner === 'p1')!;
    const raider = { ...unitOf(s, 'warrior_band'), id: 'r1', owner: 'raiders', at: { q: city.at.q + 2, r: city.at.r } };
    const raided: GameState = { ...s, units: { ...s.units, r1: raider } };
    const opening = ['found', 'production', 'research', 'government', 'explore', 'end_turn'];
    expect(tip(raided, { seen: opening, lastTipTurn: raided.turn, current: null })?.id).toBe('war');
  });

  it('never mentions affinity or numbers of hidden scores', () => {
    for (const id of STEP_IDS) expect(id).not.toMatch(/affinity/);
    const s = settled();
    const a = tip({ ...s, turn: 12, players: { ...s.players, p1: { ...s.players.p1!, hintsShown: { greek: 50 } } } }, seen('found', 'production', 'research', 'government', 'explore', 'end_turn'));
    expect(a?.id).toBe('culture');
    expect(a?.text).not.toMatch(/\d/);
  });
});

describe('glossary', () => {
  it('has an entry for every term the UI links', () => {
    expect(GLOSSARY_IDS.sort()).toEqual(['anarchy', 'culture_weight', 'great_people_points', 'legacy_score', 'refinement_points', 'suzerain']);
    for (const id of GLOSSARY_IDS) {
      expect(GLOSSARY[id].text.length).toBeGreaterThan(80);
      expect(GLOSSARY[id].text).not.toMatch(/affinity/i);
    }
    expect(GLOSSARY.legacy_score.text).toMatch(/10 per figure/);
  });

  it('links the first mention of each term in running text', () => {
    const parts = splitTerms('Thought great-people points +30%; great-people points again.');
    expect(parts).toEqual([{ text: 'Thought ' }, { text: 'great-people points', term: 'great_people_points' }, { text: ' +30%; great-people points again.' }]);
    expect(splitTerms('No terms here.')).toEqual([{ text: 'No terms here.' }]);
    const two = splitTerms('Your legacy score and culture weight');
    expect(two.filter((p) => 'term' in p).map((p) => ('term' in p ? p.term : ''))).toEqual(['legacy_score', 'culture_weight']);
  });
});

describe('guide memory', () => {
  it('keeps per-game progress keyed by seed and drops junk', async () => {
    const { parseGuideStore } = await import('../src/ui/shell/guide-state');
    expect(parseGuideStore(null)).toEqual({ disabled: false, games: {} });
    const raw = { disabled: true, games: { s42: { seen: ['found', 'nonsense', 3], lastTipTurn: 9 }, '42': { seen: ['found'] }, s7: 'x' } };
    expect(parseGuideStore(raw)).toEqual({ disabled: true, games: { s42: { seen: ['found'], lastTipTurn: 9 } } });
  });
});
