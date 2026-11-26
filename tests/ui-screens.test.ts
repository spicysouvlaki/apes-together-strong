/**
 * Pure helpers behind the decision screens (src/ui/screens/shared). No DOM: .tsx and CSS are
 * never imported here. Real games come from the dev scenario driver (src/ui/screens/demo-scenario.ts).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AGES, type ContentBundle, type Modifier } from '@contracts/content-schemas';
import type { GameState, Offer } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { applyCommand } from '../src/sim';
import { buildScenario, HUMAN } from '../src/ui/screens/demo-scenario';
import {
  ancestorYield,
  consumeBurstText,
  cultureHueIn,
  describeActivate,
  describeModifier,
  figureUses,
  initials,
  nameLookup,
  type NameLookup,
} from '../src/ui/screens/shared/describe';
import { figureCountsByCulture, groupRoster, slotIdOfKey, weightRows } from '../src/ui/screens/shared/figures';
import { nextOffer, offerPosition, offerView } from '../src/ui/screens/shared/offer';
import { layoutTree, unlockedBy } from '../src/ui/screens/shared/tree-layout';
import { groupRefinement, TIER_ORDER } from '../src/ui/screens/shared/refinement';
import { buildChronicle } from '../src/ui/screens/shared/chronicle';
import { queries as q } from '../src/sim/queries';

let content: ContentBundle;
let l: NameLookup;
beforeAll(() => {
  content = loadContent();
  l = nameLookup(content);
});

const BAD = /undefined|\[object|NaN|null/;

/** Every Modifier anywhere in the content bundle. */
const allModifiers = (c: ContentBundle): Modifier[] => {
  const out: Modifier[] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (typeof o.scope === 'string' && o.effect && typeof o.effect === 'object') out.push(o as unknown as Modifier);
      Object.values(o).forEach(walk);
    }
  };
  walk(c);
  return out;
};

describe('describeModifier', () => {
  const d = (m: Modifier) => describeModifier(m, l);

  it('words every effect kind', () => {
    expect(d({ scope: 'empire', effect: { kind: 'yield', yield: 'gold', percent: 15 } })).toBe('+15% gold');
    expect(d({ scope: 'empire', effect: { kind: 'yield', yield: 'influence', add: 2 } })).toBe('+2 influence');
    expect(d({ scope: 'empire', effect: { kind: 'yield', yield: 'food', add: 1, percent: 10 } })).toBe('+1 food and +10% food');
    expect(d({ scope: 'unit', effect: { kind: 'combat', add: 3 } })).toBe('+3 combat strength for all units');
    expect(d({ scope: 'unit', effect: { kind: 'combat', add: 3, vs: 'cavalry' } })).toBe('+3 combat strength against cavalry for all units');
    expect(d({ scope: 'unit', when: { unitClass: ['cavalry'] }, effect: { kind: 'combat', add: 5 } })).toBe('+5 combat strength for cavalry');
    expect(d({ scope: 'unit', effect: { kind: 'movement', add: 1 } })).toBe('+1 movement for all units');
    expect(d({ scope: 'empire', effect: { kind: 'gpPoints', gp: 'thought', percent: 25 } })).toBe('+25% thought great-people points');
    expect(d({ scope: 'empire', effect: { kind: 'affinityGain', percent: 10 } })).toBe('Famous people are drawn to you 10% faster');
    expect(d({ scope: 'empire', effect: { kind: 'affinityGain', culture: 'greek', percent: 20 } })).toMatch(/^Greek people are drawn to you 20% faster$/);
    expect(d({ scope: 'empire', effect: { kind: 'cost', target: 'unit', percent: -20 } })).toBe('Units cost 20% less');
    expect(d({ scope: 'empire', effect: { kind: 'cost', target: 'tradition', percent: 10 } })).toBe('Traditions cost 10% more');
    expect(d({ scope: 'empire', effect: { kind: 'cabinetSlot', slot: 'laureate' } })).toBe('Extra Laureate seat');
    expect(d({ scope: 'empire', effect: { kind: 'settlementCap', add: 1 } })).toBe('+1 settlement cap');
    expect(d({ scope: 'empire', effect: { kind: 'tradeRoutes', add: 1 } })).toBe('+1 trade route');
    expect(d({ scope: 'empire', effect: { kind: 'tradeRoutes', add: -1 } })).toBe('-1 trade route');
    expect(d({ scope: 'empire', effect: { kind: 'vision', add: 1 } })).toBe('+1 vision');
    expect(d({ scope: 'empire', effect: { kind: 'unlock', what: 'government', id: 'despotism' } })).toBe('Unlocks Despotism');
    expect(d({ scope: 'empire', effect: { kind: 'unlock', what: 'embark', id: 'embark' } })).toBe('Land units can embark onto water');
    expect(d({ scope: 'empire', effect: { kind: 'unlock', what: 'improvement', id: 'terrace_farm' } })).toBe('Unlocks the terrace farm improvement');
    expect(d({ scope: 'empire', effect: { kind: 'ignoreCold' } })).toBe('No cold penalties');
  });

  it('words every condition field', () => {
    expect(d({ scope: 'tile', when: { terrain: ['floodplain'] }, effect: { kind: 'yield', yield: 'food', add: 2 } })).toBe('+2 food on floodplain tiles');
    expect(d({ scope: 'tile', when: { terrain: ['plains', 'desert'] }, effect: { kind: 'yield', yield: 'food', add: 1 } })).toBe('+1 food on plains or desert tiles');
    expect(d({ scope: 'tile', when: { feature: ['hills'] }, effect: { kind: 'yield', yield: 'gold', add: 1 } })).toBe('+1 gold on hills tiles');
    expect(d({ scope: 'tile', when: { resource: ['tea'] }, effect: { kind: 'yield', yield: 'happiness', add: 2 } })).toMatch(/^\+2 happiness on Tea tiles$/);
    expect(d({ scope: 'tile', when: { river: true }, effect: { kind: 'yield', yield: 'food', add: 1 } })).toBe('+1 food on river tiles');
    expect(d({ scope: 'settlement', when: { coastal: true }, effect: { kind: 'yield', yield: 'gold', add: 1 } })).toBe('+1 gold in coastal settlements');
    expect(d({ scope: 'settlement', when: { capital: true }, effect: { kind: 'yield', yield: 'culture', add: 3 } })).toBe('+3 culture in the capital');
    expect(d({ scope: 'settlement', when: { settlementKind: 'town' }, effect: { kind: 'yield', yield: 'happiness', add: 1 } })).toBe('+1 happiness in towns');
    expect(d({ scope: 'settlement', when: { cityMinPop: 5 }, effect: { kind: 'yield', yield: 'happiness', add: 1 } })).toBe('+1 happiness in every settlement with 5+ population');
    expect(d({ scope: 'settlement', when: { cityMaxPop: 3 }, effect: { kind: 'yield', yield: 'food', add: 1 } })).toContain('at most 3 population');
    expect(d({ scope: 'settlement', when: { minTradeRoutes: 2 }, effect: { kind: 'yield', yield: 'culture', add: 2 } })).toBe('+2 culture in every settlement with 2+ trade routes');
    expect(d({ scope: 'settlement', effect: { kind: 'yield', yield: 'faith', add: 1 } })).toBe('+1 faith in every settlement');
    expect(d({ scope: 'unit', when: { atWar: true }, effect: { kind: 'combat', add: 3 } })).toBe('+3 combat strength for all units while at war');
    expect(d({ scope: 'unit', when: { atWar: false }, effect: { kind: 'movement', add: 1 } })).toContain('while at peace');
    expect(d({ scope: 'unit', when: { climate: ['polar', 'boreal'] }, effect: { kind: 'movement', add: 1 } })).toBe('+1 movement for all units in polar or boreal lands');
    expect(d({ scope: 'unit', when: { adjacentTerrain: ['mountain'] }, effect: { kind: 'combat', add: 1 } })).toContain('next to mountain');
    expect(d({ scope: 'empire', when: { age: ['classical'] }, effect: { kind: 'yield', yield: 'gold', add: 1 } })).toBe('+1 gold during the Classical age');
    expect(d({ scope: 'unit', when: { coastal: true, river: true }, effect: { kind: 'movement', add: 1 } })).toContain('on the coast by rivers');
  });

  it('describes every modifier in live content cleanly', () => {
    const mods = allModifiers(content);
    expect(mods.length).toBeGreaterThan(50);
    for (const m of mods) {
      const text = describeModifier(m, l);
      expect(text.length, JSON.stringify(m)).toBeGreaterThan(3);
      expect(text, JSON.stringify(m)).not.toMatch(BAD);
      expect(text, JSON.stringify(m)).not.toMatch(/_/);
    }
  });

  it('describes every figure, activate effect and Hall yield in content', () => {
    for (const f of content.figures) {
      for (const u of figureUses(f, l)) expect(`${u.label} ${u.text}`, f.id).not.toMatch(BAD);
      expect(consumeBurstText(f)).toMatch(/^\+\d+ \w+ per turn for \d+ turns$/);
      expect(ancestorYield(f.kind)).toMatch(/^\+\d+ \w+ per turn$/);
      if (f.activate) expect(describeActivate(f.activate.effect, f.activate.amount)).not.toMatch(BAD);
    }
  });
});

describe('describe helpers', () => {
  it('gives launch cultures distinct hues', () => {
    const ids = content.cultures.map((c) => c.id);
    expect(new Set(ids.map((id) => cultureHueIn(id, ids))).size).toBe(ids.length);
    expect(cultureHueIn('unknown_culture', ids)).toBe(cultureHueIn('unknown_culture', ids));
  });
  it('makes portrait initials', () => {
    expect(initials('Thutmose III')).toBe('T');
    expect(initials('Ibn Khaldūn')).toBe('IK');
    expect(initials('A Thule umiak captain')).toBe('T');
  });
});

describe('offerView', () => {
  const base: Offer = { id: 'o1', player: 'p1', source: 'thought', candidates: ['homer'], reasons: {}, deed: null, createdTurn: 1 };
  it('titles points offers by pool and offers a skip with the refund share', () => {
    expect(offerView(base, content).title).toBe('A thinker seeks you out');
    expect(offerView({ ...base, source: 'military' }, content).title).toBe('A commander seeks you out');
    expect(offerView({ ...base, source: 'exploration' }, content).title).toBe('An explorer seeks you out');
    expect(offerView(base, content).declineLabel).toBe('Send them on (+25% toward the next)');
  });
  it('tells the deed story and warns that declining loses them', () => {
    const v = offerView({ ...base, source: 'deed', deed: 'siege_of_palmyra' }, content);
    expect(v.title).toBe('The Siege of Palmyra');
    expect(v.story).toMatch(/five-turn siege/);
    expect(v.declineLabel).toBe('Decline');
    expect(v.declineLabel).not.toMatch(/toward/);
    expect(v.declineNote).toMatch(/loses them/);
  });
  it('makes legend offers feel different', () => {
    const v = offerView({ ...base, source: 'legend' }, content);
    expect(v.tone).toBe('legend');
    expect(v.declineLabel).not.toMatch(/toward/);
  });
  it('counts queued offers and finds the next one', () => {
    const offers = [base, { ...base, id: 'o2' }, { ...base, id: 'o3', player: 'p2' }];
    expect(offerPosition(offers, 'p1', 'o1')).toBe('1 of 2');
    expect(offerPosition(offers, 'p1', 'o2')).toBe('2 of 2');
    expect(offerPosition(offers, 'p2', 'o3')).toBeNull();
    expect(nextOffer(offers, 'p1', 'o1')?.id).toBe('o2');
    expect(nextOffer(offers, 'p1', 'o2')?.id).toBe('o1');
    expect(nextOffer([base], 'p1', 'o1')).toBeNull();
  });
});

describe('roster grouping (real game)', () => {
  let state: GameState;
  beforeAll(() => {
    state = buildScenario('court', content).state;
  });

  it('groups every figure the player holds exactly once, in GDD §3 order', () => {
    // Deploy one, consume one, so more groups show up.
    const mine = Object.values(state.figures).filter((f) => f.owner === HUMAN);
    const based = mine.filter((f) => f.location.state === 'based');
    let s = state;
    const general = mine.find((f) => content.figures.find((d) => d.id === f.id)?.uses.includes('unit') && q.figureActions(s, f.id, content).deploy.length > 0);
    if (general) {
      const r = applyCommand(s, HUMAN, { type: 'deployFigure', figure: general.id, settlement: q.figureActions(s, general.id, content).deploy[0] ?? '' }, content);
      if (r.ok) s = r.state;
    }
    const victim = based.find((f) => f.id !== general?.id);
    if (victim) {
      const r = applyCommand(s, HUMAN, { type: 'consumeFigure', figure: victim.id, as: 'refinement' }, content);
      if (r.ok) s = r.state;
    }
    const groups = groupRoster(s, HUMAN, content);
    const ids = groups.flatMap((g) => g.entries.map((e) => e.fs.id));
    expect(ids.length).toBe(mine.length);
    expect(new Set(ids).size).toBe(ids.length);
    const order = ['seated', 'field', 'home', 'hall', 'consumed'];
    const seen = groups.map((g) => order.indexOf(g.id));
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(groups.some((g) => g.id === 'consumed')).toBe(true);
    for (const g of groups) for (const e of g.entries) expect(e.where).not.toMatch(BAD);
    const home = groups.find((g) => g.id === 'home');
    if (home) for (const e of home.entries) expect(e.where).toMatch(/^In /);
  });

  it('lists culture weights and public figure counts heaviest first', () => {
    const rows = weightRows(q.cultureWeights(state, HUMAN, content), content);
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.weight).toBeGreaterThanOrEqual(rows[i]!.weight);
    const counts = figureCountsByCulture(state, 'p2', content);
    const total = Object.values(state.figures).filter((f) => f.owner === 'p2').length;
    expect(counts.reduce((a, c) => a + c.count, 0)).toBe(total);
  });

  it('splits slot keys', () => {
    expect(slotIdOfKey('warleader#1')).toBe('warleader');
    expect(slotIdOfKey('elder')).toBe('elder');
  });
});

describe('tree layout', () => {
  it('places every node of every tree and age without overlap, edges left to right', () => {
    for (const age of AGES) {
      for (const tree of ['tech', 'civic'] as const) {
        const nodes = content.techs.filter((t) => t.age === age && t.tree === tree);
        const lay = layoutTree(nodes);
        expect(lay.cells.length).toBe(nodes.length);
        for (let i = 0; i < lay.cells.length; i++) {
          for (let j = i + 1; j < lay.cells.length; j++) {
            const a = lay.cells[i]!;
            const b = lay.cells[j]!;
            const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            expect(overlap, `${a.id}/${b.id}`).toBe(false);
          }
        }
        const inAge = new Set(nodes.map((n) => n.id));
        const expected = nodes.reduce((n, t) => n + t.requires.filter((r) => inAge.has(r)).length, 0);
        expect(lay.edges.length).toBe(expected);
        for (const e of lay.edges) expect(e.x2).toBeGreaterThan(e.x1);
        for (const c of lay.cells) {
          expect(c.x + c.w).toBeLessThanOrEqual(lay.width);
          expect(c.y + c.h).toBeLessThanOrEqual(lay.height);
        }
      }
    }
  });

  it('moves a clashing node down instead of stacking it', () => {
    const t = content.techs[0]!;
    const lay = layoutTree([t, { ...t, id: 'clone', requires: [] }]);
    expect(lay.cells[0]!.y).not.toBe(lay.cells[1]!.y);
  });

  it('finds what a node unlocks', () => {
    const masonry = unlockedBy('masonry', content);
    expect([...masonry.units, ...masonry.buildings, ...masonry.wonders].length).toBeGreaterThan(0);
  });
});

describe('refinement grouping (real transition)', () => {
  it('orders cultures by weight and tiers custom → institution → signature, owned items kept', () => {
    const { state } = buildScenario('transition', content);
    const p = state.players[HUMAN]!;
    const opts = q.refinementOptions(state, HUMAN, content);
    expect(opts.length).toBeGreaterThan(0);
    const weights = q.cultureWeights(state, HUMAN, content);
    const owned = { traditions: [...p.traditions, opts.find((o) => o.kind === 'tradition')!.id], hybrids: p.hybrids };
    const g = groupRefinement(owned, opts, weights, content);
    for (let i = 1; i < g.cultures.length; i++) expect(g.cultures[i - 1]!.weight).toBeGreaterThanOrEqual(g.cultures[i]!.weight);
    for (const c of g.cultures) {
      const tiers = c.tiers.map((t) => TIER_ORDER.indexOf(t.tier));
      expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
      for (const t of c.tiers) for (const it of t.items) {
        expect(it.def.culture).toBe(c.culture);
        expect(it.owned || it.option !== null).toBe(true);
      }
    }
    const ownedItems = g.cultures.flatMap((c) => c.tiers.flatMap((t) => t.items)).filter((x) => x.owned);
    expect(ownedItems.length).toBe(1);
    // Every option shows up exactly once.
    const shown = g.cultures.flatMap((c) => c.tiers.flatMap((t) => t.items)).filter((x) => x.option).length + g.hybrids.filter((h) => h.option).length;
    expect(shown).toBe(opts.length - 1);
  });
});

describe('chronicle assembly (real finished game)', () => {
  it('tells the story by age with figures, traditions and the result', () => {
    const { state } = buildScenario('ended', content);
    expect(state.phase).toBe('ended');
    const v = buildChronicle(state, HUMAN, content)!;
    expect(v.civName).toBe(state.players[HUMAN]!.civName);
    expect(v.dream?.native.length).toBeGreaterThan(0);
    expect(v.ages.map((a) => a.age)).toEqual(['ancient', 'classical']);
    const figs = v.ages.flatMap((a) => a.figures);
    const held = Object.values(state.figures).filter((f) => f.owner === HUMAN).length;
    expect(figs.length).toBe(held);
    expect(new Set(figs.map((f) => f.id)).size).toBe(figs.length);
    for (const f of figs) {
      expect(f.bio.length).toBeGreaterThan(10);
      expect(f.text).not.toMatch(/\.\.$/);
    }
    const trads = v.ages.flatMap((a) => a.traditions);
    expect(trads.length).toBe(state.players[HUMAN]!.traditions.length);
    for (const t of trads) expect(t.note.length).toBeGreaterThan(10);
    expect(v.result).not.toBeNull();
    expect(v.result!.of).toBe(state.playerOrder.length);
    expect(v.result!.rank).toBeGreaterThanOrEqual(1);
    // Rivals have chronicles too.
    expect(buildChronicle(state, 'p2', content)?.ages.length).toBeGreaterThan(0);
  });
});
