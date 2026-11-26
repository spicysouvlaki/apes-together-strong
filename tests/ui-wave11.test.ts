/**
 * Wave 11 playtest fixes (UI only): build queue and suggested next, notices by kind, first
 * contact, one-tap envoys, trade orders, military explore, naming and upgrade lines, idle sheet
 * after "Not now", the Chronicle as a story, and the final-age goals.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, MilestoneProgress, ProductionOption, SimEvent } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { queries as q } from '../src/sim/queries';
import { MAX_QUEUE, queueAdd, queueChoices, queueMove, queueRemove, suggestContext, suggestNext, type SuggestContext } from '../src/ui/shell/build-queue';
import { namingLine, strongestCulture, upgradeCostReason } from '../src/ui/shell/city-lines';
import { eventToToast, noticeToast, rankToasts, type EventNames, type ToastSpec } from '../src/ui/shell/event-toasts';
import { contactMoments, quoteOf, speakerOf } from '../src/ui/shell/first-contact';
import { envoyNeedsConfirm, INFLUENCE_WARNING } from '../src/ui/screens/shared/envoy';
import { parseStoredOrders, storeOrders } from '../src/ui/shell/orders';
import { idleLists } from '../src/ui/shell/IdleSheet';
import { promptKey } from '../src/ui/shell/nags';
import { nearestGoals, showGoals } from '../src/ui/shell/endgame-goals';
import { buildChronicle } from '../src/ui/screens/shared/chronicle';
import { listCapped, peopleParagraph, shareSummary, storyFacts, storyParagraphs, type StoryFacts } from '../src/ui/screens/shared/chronicle-story';
import { buildScenario, HUMAN } from '../src/ui/screens/demo-scenario';
import { speakerName } from '../src/sim/voice';
import { WAR_DECLARED_TEXT } from '../src/sim/diplomacy';

const content = loadContent();
const BAD = /undefined|\[object|NaN|null/;

const opt = (item: string, kind: ProductionOption['kind'], turns: number, cost = turns * 10): ProductionOption => ({ item, kind, cost, turns, goldCost: cost * 2 });

describe('build queue', () => {
  it('adds up to three, removes and reorders', () => {
    let qu: string[] = [];
    for (const x of ['a', 'b', 'c', 'd']) qu = queueAdd(qu, x);
    expect(qu).toEqual(['a', 'b', 'c']);
    expect(qu.length).toBe(MAX_QUEUE);
    expect(queueRemove(qu, 1)).toEqual(['a', 'c']);
    expect(queueMove(qu, 2, -1)).toEqual(['a', 'c', 'b']);
    expect(queueMove(qu, 0, -1)).toEqual(['a', 'b', 'c']);
    expect(queueMove(qu, 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('never offers a building twice, but units may repeat', () => {
    const options = [opt('warrior_band', 'unit', 3), opt('granary', 'building', 5), opt('monument', 'building', 4), opt('pyramids', 'wonder', 20)];
    const picks = queueChoices(options, 'granary', ['warrior_band', 'monument']).map((o) => o.item);
    expect(picks).toEqual(['warrior_band', 'pyramids']);
  });
});

describe('suggested next', () => {
  const options = [opt('warrior_band', 'unit', 3), opt('settler', 'unit', 6), opt('granary', 'building', 5), opt('monument', 'building', 4)];
  const base: SuggestContext = {
    name: 'Gadir',
    unguarded: false,
    threatened: false,
    roomToExpand: false,
    founders: new Set(['settler']),
    military: new Set(['warrior_band']),
  };
  it('guards a threatened, empty city first', () => {
    expect(suggestNext(options, { ...base, unguarded: true, threatened: true, roomToExpand: true })).toEqual({ item: 'warrior_band', why: 'danger is near and nothing guards Gadir' });
  });
  it('then a founder while there is room, then a guard, then the quickest building', () => {
    expect(suggestNext(options, { ...base, unguarded: true, roomToExpand: true })?.item).toBe('settler');
    expect(suggestNext(options, { ...base, unguarded: true })?.item).toBe('warrior_band');
    const b = suggestNext(options, base);
    expect(b?.item).toBe('monument');
    expect(b?.why).toBe('the quickest building (4 turns)');
    expect(suggestNext([], base)).toBeNull();
  });
  it('reads its context from a real snapshot', () => {
    const { state } = buildScenario('start', content);
    const city = Object.values(state.settlements).find((s) => s.owner === HUMAN && s.kind === 'city');
    expect(city).toBeDefined();
    if (!city) return;
    const ctx = suggestContext(state, city.id, content, (a, b) => q.atWar(state, a, b), q.settlementCap(state, HUMAN, content));
    expect(ctx?.name).toBe(city.name);
    expect(ctx?.founders.has('settler')).toBe(true);
    expect(ctx?.military.has('war_canoe')).toBe(false);
    const pick = ctx ? suggestNext(q.productionOptions(state, city.id, content), ctx) : null;
    expect(pick).not.toBeNull();
    expect(q.productionOptions(state, city.id, content).some((o) => o.item === pick?.item)).toBe(true);
  });
});

describe('city lines', () => {
  it('says why a settlement has its name', () => {
    expect(namingLine('Iberian', 'iberian', 'iberian')).toBe('Named in the Iberian fashion, your strongest strand.');
    expect(namingLine('Iberian', 'iberian', null)).toContain('by chance');
    expect(namingLine('Iberian', 'iberian', 'greek')).toBe('Named in the Iberian fashion.');
    expect(namingLine(null, '', null)).toBeNull();
    expect(strongestCulture({ a: 1, b: 3, c: 3 }, ['a', 'b', 'c'])).toBe('b');
    expect(strongestCulture({}, ['a'])).toBeNull();
  });
  it('explains the upgrade price and that it grows', () => {
    expect(upgradeCostReason(140, 3, 80, 20)).toBe('80 base + 20 per citizen (3 citizens). The price rises as the town grows.');
    expect(upgradeCostReason(84, 1, 80, 20)).toBe('80 base + 20 per citizen (1 citizen), −16% from your bonuses. The price rises as the town grows.');
  });
});

const names: EventNames = {
  owner: (id) => (id === 'raiders' ? 'Raiders' : id === 'p2' ? 'the Conqueror’s people' : `Owner ${id}`),
  figure: (id) => id,
  settlement: (id) => (id === 's1' ? { name: 'Gadir', owner: 'p1', at: { q: 3, r: 4 } } : null),
  item: (id) => ({ scout: 'Scout', warrior_band: 'Warrior band', granary: 'Granary' })[id] ?? id,
  research: (id) => id,
  milestone: (k) => k,
  crisis: (id) => id,
  deed: (id) => id,
  nearestSettlement: () => 'Gadir',
  producing: (id) => (id === 's1' ? 'granary' : null),
  namingLine: (id) => (id === 's1' ? 'Named in the Iberian fashion, your strongest strand.' : null),
};
const notice = (extra: Partial<Extract<SimEvent, { type: 'notice' }>>): Extract<SimEvent, { type: 'notice' }> => ({ type: 'notice', player: 'p1', text: 'Something.', ...extra });

describe('notices by kind', () => {
  it('pillage names the town and the gold, keeping the sim sentence when it already does', () => {
    const own = noticeToast(notice({ kind: 'pillaged', settlement: 's1', amount: 12, text: 'Raiders pillaged Gadir: its stores and 12 gold are gone.' }), names);
    expect(own.text).toBe('Raiders pillaged Gadir: its stores and 12 gold are gone.');
    expect(own.tone).toBe('bad');
    expect(own.keep).toBe(true);
    expect(own.at).toEqual({ q: 3, r: 4 });
    const bare = noticeToast(notice({ kind: 'pillaged', settlement: 's1', amount: 12.4, text: 'Your town was raided.' }), names);
    expect(bare.text).toBe('Raiders pillaged Gadir and carried off 12 gold. A garrison or walls would keep them out.');
  });
  it('raider warnings, lost wonders and first contact are never folded', () => {
    const filler: ToastSpec[] = Array.from({ length: 6 }, (_, i) => ({ text: `News ${i}.`, tone: 'good', action: { kind: 'legacy' } }));
    const warn = noticeToast(notice({ kind: 'raiderWarning', settlement: 's1', text: 'Raiders are a day from Gadir, and no one guards it.' }), names);
    const lost = noticeToast(notice({ kind: 'wonderLost', settlement: 's1', text: 'The Pyramids were finished elsewhere first.' }), names);
    const met = noticeToast(notice({ kind: 'firstContact', text: 'The Conqueror of Avarga: “Mind your borders.”' }), names);
    expect(lost.action).toEqual({ kind: 'city', settlement: 's1' });
    expect(met.action).toEqual({ kind: 'diplomacy' });
    const ranked = rankToasts([...filler, warn, lost, met], 3);
    const texts = ranked.map((t) => t.text);
    expect(texts).toContain(warn.text);
    expect(texts).toContain(lost.text);
    expect(texts).toContain(met.text);
    expect(texts[texts.length - 1]).toMatch(/^\+6 more updates/);
  });
  it('falls back to wording when no kind is given', () => {
    expect(noticeToast(notice({ text: 'Raiders gather near Gadir.' }), names).tone).toBe('bad');
    expect(noticeToast(notice({ text: 'A quiet season.' }), names)).toEqual({ text: 'A quiet season.', tone: 'info', action: null });
  });
  it('says which civilian was captured and where', () => {
    const ev = {
      type: 'combat',
      attacker: 'u9',
      attackerOwner: 'raiders',
      defenderOwner: 'p1',
      defender: null,
      capturedUnitDef: 'scout',
      at: { q: 5, r: 5 },
      damageToAttacker: 0,
      damageToDefender: 0,
      attackerDied: false,
      defenderDied: false,
    } as unknown as SimEvent;
    expect(eventToToast(ev, 'p1', names)?.text).toBe('Raiders captured our Scout near Gadir.');
    expect(eventToToast(ev, 'raiders', names)?.text).toBe('We captured Owner p1’s Scout.');
  });
  it('a finished item that hands over to the queue says what comes next', () => {
    expect(eventToToast({ type: 'productionCompleted', settlement: 's1', item: 'warrior_band', player: 'p1' }, 'p1', names)?.text).toBe(
      'Gadir finished Warrior band; now building Granary.',
    );
  });
  it('a founding says why the name', () => {
    const t = eventToToast({ type: 'settlementFounded', settlement: 's1', player: 'p1' }, 'p1', names);
    expect(t?.text).toBe('Gadir was founded. Named in the Iberian fashion, your strongest strand.');
    expect(eventToToast({ type: 'settlementFounded', settlement: 's1', player: 'p2' }, 'p1', names)).toBeNull();
  });
});

describe('first contact', () => {
  it('finds who spoke and what they said', () => {
    const { state } = buildScenario('start', content);
    const rival = state.playerOrder.find((id) => id !== HUMAN) as string;
    const text = `${speakerName(state, rival, content)}: “Mind your borders.”`;
    expect(quoteOf(text)).toBe('Mind your borders.');
    expect(speakerOf(state, text, HUMAN, content)).toBe(rival);
    const ev: SimEvent = { type: 'notice', player: HUMAN, kind: 'firstContact', text };
    expect(contactMoments([ev, ev], HUMAN, [state], content)).toEqual([{ player: rival, quote: 'Mind your borders.' }]);
    expect(contactMoments([{ ...ev, kind: 'other' }], HUMAN, [state], content)).toEqual([]);
  });
});

describe('envoys', () => {
  it('send at once unless it leaves too little to buy peace in a war', () => {
    expect(envoyNeedsConfirm(60, 30, false)).toBe(false);
    expect(envoyNeedsConfirm(30, 30, false)).toBe(false);
    expect(envoyNeedsConfirm(INFLUENCE_WARNING + 30, 30, true)).toBe(false);
    expect(envoyNeedsConfirm(INFLUENCE_WARNING + 29, 30, true)).toBe(true);
  });
});

describe('trade orders', () => {
  it('keep their partner through storage', () => {
    const stored = storeOrders(null, 5, { u1: { kind: 'goto', to: { q: 1, r: 2 }, trade: 's9' }, u2: { kind: 'goto', to: { q: 0, r: 0 } } });
    const back = parseStoredOrders(JSON.parse(JSON.stringify(stored)), 5);
    expect(back.u1).toEqual({ kind: 'goto', to: { q: 1, r: 2 }, trade: 's9' });
    expect(back.u2).toEqual({ kind: 'goto', to: { q: 0, r: 0 } });
  });
});

describe('idle sheet after "Not now"', () => {
  it('does not list a city or tree waved off this turn', () => {
    const { state } = buildScenario('start', content);
    const g: GameState = JSON.parse(JSON.stringify(state));
    const city = Object.values(g.settlements).find((s) => s.owner === HUMAN && s.kind === 'city');
    if (!city) throw new Error('no city');
    city.production = { item: null, progress: 0 };
    expect(idleLists(g, HUMAN, ['tech'], new Set()).cities).toContain(city.id);
    const rest = new Set([promptKey({ type: 'production', settlement: city.id }), promptKey({ type: 'research', tree: 'tech' })]);
    const after = idleLists(g, HUMAN, ['tech', 'civic'], rest);
    expect(after.cities).not.toContain(city.id);
    expect(after.trees).toEqual(['civic']);
  });
});

describe('final-age goals', () => {
  const row = (id: string, track: MilestoneProgress['track'], description: string, value: number, thresholds: [number, number, number], achieved: number): MilestoneProgress => ({
    id,
    track,
    description,
    value,
    thresholds,
    achieved,
  });
  it('names the nearest milestones, nearest first', () => {
    const rows = [
      row('sci', 'science', 'Tree nodes completed: 10', 6, [5, 10, 15], 1),
      row('cul', 'culture', 'Wonders built: 2', 1, [1, 2, 4], 1),
      row('mil', 'military', 'Battles won: 15', 15, [5, 10, 15], 3),
    ];
    const goals = nearestGoals(rows);
    expect(goals.map((x) => x.id)).toEqual(['cul', 'sci']);
    expect(goals[0]?.text).toBe('1 more for a culture milestone (wonders built 1/2)');
    expect(nearestGoals([rows[2] as MilestoneProgress])).toEqual([]);
  });
  it('shows only late in the final age', () => {
    expect(showGoals('classical', 'classical', 80, 'playing')).toBe(true);
    expect(showGoals('classical', 'classical', 40, 'playing')).toBe(false);
    expect(showGoals('ancient', 'classical', 95, 'playing')).toBe(false);
    expect(showGoals('classical', 'classical', 95, 'ended')).toBe(false);
  });
});

describe('the Chronicle as a short story', () => {
  const facts = (over: Partial<StoryFacts> = {}): StoryFacts => ({
    founded: ['Gadir', 'Malaka', 'Onuba', 'Abdera', 'Baria'],
    held: 4,
    wars: [
      { against: 'the Conqueror’s people', by: 'them', turn: 40 },
      { against: 'the Builder’s people', by: 'us', turn: 61 },
    ],
    taken: ['Avarga'],
    lost: [{ name: 'Onuba', to: 'the Conqueror’s people' }],
    conquered: 0,
    suzerainOf: ['Tyre', 'Kish'],
    tradeRoutes: 3,
    reasons: {},
    ...over,
  });

  it('caps name lists at three plus "and N others"', () => {
    expect(listCapped(['a', 'b', 'c', 'd'])).toBe('a, b, c and d');
    expect(listCapped(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('a, b, c and 3 others');
  });

  it('groups figures by why they came and varies the phrasing', () => {
    const { state } = buildScenario('ended', content);
    const view = buildChronicle(state, HUMAN, content);
    if (!view) throw new Error('no view');
    const figs = view.ages.flatMap((a) => a.figures);
    expect(figs.length).toBeGreaterThan(0);
    // Six came for one reason: one sentence, three names and "3 others", not the reason six times.
    const reasons: Record<string, string> = {};
    const ids = figs.map((f) => f.id);
    ids.forEach((id, i) => (reasons[id] = i < 6 ? 'won over by its friendship with their city' : 'drawn by its rivers'));
    const para = peopleParagraph(view, reasons);
    expect(para.match(/friendship/g)?.length).toBe(1);
    if (ids.length >= 6) expect(para).toMatch(/and \d+ others/);
    expect(para).not.toMatch(BAD);
  });

  it('tells wars, city-states and trade in 4 to 6 paragraphs, deterministically', () => {
    const { state } = buildScenario('ended', content);
    const view = buildChronicle(state, HUMAN, content);
    if (!view) throw new Error('no view');
    const input = { view, cultures: ['Iberian', 'Greek'], named: true };
    const f = facts();
    const paras = storyParagraphs(input, f, true, state.turn);
    expect(paras.length).toBeGreaterThanOrEqual(4);
    expect(paras.length).toBeLessThanOrEqual(6);
    const all = paras.join('\n');
    expect(all).toContain('The Conqueror’s people declared war on them on turn 40');
    expect(all).toContain('they went to war with the Builder’s people on turn 61');
    expect(all).toContain('They took Avarga.');
    expect(all).toContain('They lost Onuba to the Conqueror’s people.');
    expect(all).toContain('Tyre and Kish looked to them as protector, and 3 trade routes carried their goods.');
    expect(all).toContain('Their first home was Gadir; Malaka, Onuba, Abdera and Baria followed, and at the end they held 4 settlements.');
    expect(all).not.toMatch(BAD);
    expect(storyParagraphs(input, f, true, state.turn)).toEqual(paras);
    const quiet = storyParagraphs(input, facts({ wars: [], taken: [], lost: [], suzerainOf: [], tradeRoutes: 0 }), true, state.turn).join('\n');
    expect(quiet).toContain('They never went to war.');
    expect(quiet).toContain('no city-state called them protector');
    const shared = shareSummary({ ...input, facts: f }, true, state.turn);
    expect(shared).toContain(paras[1] as string);
    expect(shared).toContain('Apes Together Strong');
  });

  it('reads its facts from the game state', () => {
    const { state } = buildScenario('ended', content);
    const g: GameState = JSON.parse(JSON.stringify(state));
    const rival = g.playerOrder.find((id) => id !== HUMAN) as string;
    g.players[rival]?.chronicle.push({ turn: 30, age: g.age, kind: 'war', ref: HUMAN, text: WAR_DECLARED_TEXT });
    const cs = Object.values(g.cityStates)[0];
    if (cs) {
      cs.suzerain = HUMAN;
      cs.alive = true;
    }
    const f = storyFacts(g, HUMAN, content, (id) => `name:${id}`);
    expect(f.wars.some((w) => w.by === 'them' && w.against === `name:${rival}` && w.turn === 30)).toBe(true);
    if (cs) expect(f.suzerainOf).toContain(content.cityStates.find((c) => c.id === cs.id)?.name);
    expect(f.founded.length).toBeGreaterThan(0);
    expect(f.tradeRoutes).toBe(g.tradeRoutes.filter((r) => r.owner === HUMAN).length);
    for (const id of Object.keys(g.figures).filter((id) => g.figures[id]?.owner === HUMAN)) expect(f.reasons[id]).not.toMatch(/\byour\b/);
  });
});
