/**
 * Pure view-models behind the friction fixes and the key moments: combat preview, the news
 * ticker policy, advisory nags, the crisis card, the title's ended-save button, the offer deck,
 * the recruit reveal's next step, "Your people", the Chronicle story, route turn ticks and the
 * save hand-off. No DOM: .tsx and CSS are never imported here.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ContentBundle } from '@contracts/content-schemas';
import type { CombatPreview, Decision, GameState, Offer, SaveMeta, SimEvent } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { queries as q } from '../src/sim/queries';
import { buildScenario, HUMAN } from '../src/ui/screens/demo-scenario';
import { attackStep, combatView, hpBands, OUTLOOK_TONE, signedFactor } from '../src/ui/shell/combat-view';
import { isThreat, splitToasts, tickerMore } from '../src/ui/shell/ticker';
import { rankToasts } from '../src/ui/shell/event-toasts';
import { EMPTY_NAGS, promptKey, restingNags, restNag } from '../src/ui/shell/nags';
import { planEndTurn } from '../src/ui/shell/decisions';
import { crisisLede, sentences } from '../src/ui/screens/shared/crisis';
import { titleActions } from '../src/ui/shell/ended-saves';
import { clampIndex, clip, deckItems, indexFromScroll, oneLineUse } from '../src/ui/screens/shared/offer-deck';
import { nameLookup, type NameLookup } from '../src/ui/screens/shared/describe';
import { nextSteps } from '../src/ui/shell/recruit-reveal';
import { becomingLine, buildPeople } from '../src/ui/screens/shared/people';
import { buildChronicle } from '../src/ui/screens/shared/chronicle';
import { ageSummary, closingLine, listAnd, openingLine, ordinal, shareSummary } from '../src/ui/screens/shared/chronicle-story';
import { arrivalText, routeTurns, routeTurnStarts } from '../src/ui/shell/orders';
import { fileHandOff, handOffMessage } from '../src/ui/shell/share-file';
import { unitHint } from '../src/ui/shell/unit-hints';
import { sanitizeUiPrefs } from '../src/ui/shell/ui-prefs';

let content: ContentBundle;
let l: NameLookup;
beforeAll(() => {
  content = loadContent();
  l = nameLookup(content);
});

const BAD = /undefined|\[object|NaN|null/;

const preview = (over: Partial<CombatPreview> = {}): CombatPreview => ({
  kind: 'unit',
  ranged: false,
  attackerStrength: 23,
  defenderStrength: 18,
  damageToDefender: { expected: 37, min: 29, max: 44 },
  damageToAttacker: { expected: 25, min: 20, max: 29 },
  defenderHp: 60,
  attackerHp: 100,
  factors: [
    { label: 'Jungle', value: 2, side: 'defender' },
    { label: 'Wounds', value: -4, side: 'defender' },
    { label: 'Leader', value: 3, side: 'attacker' },
  ],
  outlook: 'favorable',
  needsWar: false,
  ...over,
});

describe('combat preview view-model', () => {
  const names = { attacker: 'Warrior band', defender: 'Raiders’ Warrior band', defenderOwner: 'Raiders' };

  it('words both sides, the range of the roll and who is likely to fall', () => {
    const v = combatView(preview(), names);
    expect(v.attacker).toMatchObject({ strength: 23, hp: 100, after: { expected: 75, best: 80, worst: 71 }, falls: 'safe' });
    expect(v.defender).toMatchObject({ strength: 18, hp: 60, after: { expected: 23, best: 31, worst: 16 }, falls: 'safe' });
    expect(v.outlook).toMatchObject({ word: 'Favorable', tone: 'good' });
    expect(v.warLine).toBeNull();
    expect(v.confirmLabel).toBe('Attack');
    expect(v.kindLine).toBe('Melee attack');
    expect(v.summary).not.toMatch(BAD);
  });

  it('sorts factors strongest first and says which side they help', () => {
    const v = combatView(preview(), names);
    expect(v.factors.map((f) => f.label)).toEqual(['Wounds', 'Leader', 'Jungle']);
    expect(v.factors.map((f) => f.value)).toEqual(['−4', '+3', '+2']);
    // A defender malus helps the attacker; a defender bonus hurts.
    expect(v.factors.map((f) => f.helps)).toEqual([true, true, false]);
    expect(signedFactor(-5)).toBe('−5');
  });

  it('flags a likely or possible death, a needed war and ranged attacks', () => {
    const v = combatView(
      preview({ ranged: true, damageToAttacker: { expected: 0, min: 0, max: 0 }, damageToDefender: { expected: 65, min: 50, max: 80 }, needsWar: true, outlook: 'decisive' }),
      { ...names, defenderOwner: 'the Sage’s people' },
    );
    expect(v.attacker.falls).toBe('never');
    expect(v.defender.falls).toBe('likely');
    expect(v.warLine).toBe('This will declare war on the Sage’s people.');
    expect(v.confirmLabel).toBe('Declare war and attack');
    expect(v.kindLine).toBe('Ranged attack: no return fire');
    const maybe = combatView(preview({ damageToAttacker: { expected: 60, min: 40, max: 110 } }), names);
    expect(maybe.attacker.falls).toBe('maybe');
    expect(combatView(preview({ kind: 'capture' }), { ...names, defender: 'Hedeby' }).confirmLabel).toBe('Take it');
    expect(combatView(preview({ kind: 'walls' }), names).kindLine).toBe('Assault the walls');
  });

  it('every outlook has a tone', () => {
    for (const o of ['decisive', 'favorable', 'even', 'risky', 'reckless'] as const) expect(OUTLOOK_TONE[o]).toBeTruthy();
  });

  it('splits an HP bar into kept, at-risk and lost bands against full health', () => {
    const v = combatView(preview(), names);
    const a = hpBands(v.attacker);
    expect(a).toEqual({ kept: 71, risk: 9, lost: 20 });
    const d = hpBands(v.defender);
    // A wounded unit (60 HP) draws as wounded: 40% of the bar is empty space.
    expect(d.kept + d.risk + d.lost).toBe(60);
  });

  it('decides the tap flow: sheet, inline arm then attack, or the old flow without a preview', () => {
    const t = { q: 3, r: 4 };
    expect(attackStep({ hasPreview: false, confirmSetting: true, armed: null, unit: 'u1', target: t }).kind).toBe('legacy');
    expect(attackStep({ hasPreview: true, confirmSetting: true, armed: null, unit: 'u1', target: t }).kind).toBe('sheet');
    expect(attackStep({ hasPreview: true, confirmSetting: false, armed: null, unit: 'u1', target: t }).kind).toBe('arm');
    expect(attackStep({ hasPreview: true, confirmSetting: false, armed: { unit: 'u1', target: t }, unit: 'u1', target: t }).kind).toBe('attack');
    // Armed for another target or unit: arm again, never attack.
    expect(attackStep({ hasPreview: true, confirmSetting: false, armed: { unit: 'u1', target: { q: 0, r: 0 } }, unit: 'u1', target: t }).kind).toBe('arm');
    expect(attackStep({ hasPreview: true, confirmSetting: false, armed: { unit: 'u2', target: t }, unit: 'u1', target: t }).kind).toBe('arm');
  });

  it('keeps the "Confirm attacks" preference sane', () => {
    expect(sanitizeUiPrefs(null)).toEqual({ confirmAttacks: true });
    expect(sanitizeUiPrefs({ confirmAttacks: false })).toEqual({ confirmAttacks: false });
    expect(sanitizeUiPrefs({ confirmAttacks: 'no' })).toEqual({ confirmAttacks: true });
  });
});

describe('news ticker policy', () => {
  const me = 'p1';
  it('treats only hostile acts against the player as threats', () => {
    const combat = (attackerOwner: string, defenderOwner: string): SimEvent =>
      ({ type: 'combat', attacker: 'a', attackerOwner, defender: 'd', defenderOwner, at: { q: 0, r: 0 }, damageToAttacker: 1, damageToDefender: 1, attackerDied: false, defenderDied: false }) as SimEvent;
    expect(isThreat({ type: 'warDeclared', by: 'p2', on: me } as SimEvent, me)).toBe(true);
    expect(isThreat({ type: 'warDeclared', by: me, on: 'p2' } as SimEvent, me)).toBe(false);
    expect(isThreat(combat('raiders', me), me)).toBe(true);
    expect(isThreat(combat(me, 'raiders'), me)).toBe(false);
    expect(isThreat({ type: 'settlementCaptured', settlement: 's1', from: me, to: 'p2' } as SimEvent, me)).toBe(true);
    expect(isThreat({ type: 'crisisStarted', crisis: 'plague' } as SimEvent, me)).toBe(true);
    expect(isThreat({ type: 'settlementGrew', settlement: 's1', population: 3 } as SimEvent, me)).toBe(false);
  });

  it('puts at most two threats in slips; the rest wait in the ticker in order', () => {
    const list = [
      { id: 1, threat: true },
      { id: 2 },
      { id: 3, threat: true },
      { id: 4, threat: true },
      { id: 5 },
    ];
    const { slips, ticker } = splitToasts(list);
    expect(slips.map((t) => t.id)).toEqual([1, 3]);
    expect(ticker.map((t) => t.id)).toEqual([2, 4, 5]);
    expect(tickerMore(1)).toBeNull();
    expect(tickerMore(3)).toBe('+2');
  });

  it('never folds a threat into the "+N more" line', () => {
    const info = { text: 'grew', tone: 'info' as const, action: null };
    const raid = { text: 'raiders attacked', tone: 'bad' as const, action: null, threat: true };
    const ranked = rankToasts([info, info, info, info, raid, raid]);
    expect(ranked.filter((t) => t.threat)).toHaveLength(2);
    expect(ranked[0]?.threat).toBe(true);
    expect(ranked[ranked.length - 1]?.text).toBe('+2 more updates this turn.');
  });
});

describe('advisory nags', () => {
  const prod: Decision = { type: 'production', settlement: 's1' };
  const research: Decision = { type: 'research', tree: 'tech' };
  const civic: Decision = { type: 'research', tree: 'civic' };
  const gov: Decision = { type: 'government' };
  const all = () => true;

  it('keys prompts stably', () => {
    expect(promptKey(prod)).toBe('production:s1');
    expect(promptKey(civic)).toBe('research:civic');
    expect(promptKey({ type: 'found', unit: 'u1' })).toBe('found');
  });

  it('rests a nag for the turn only', () => {
    const m = restNag(EMPTY_NAGS, 1, 'production:s1');
    expect([...restingNags(m, 1)]).toEqual(['production:s1']);
    expect([...restingNags(m, 2)]).toEqual([]);
    expect(restNag(m, 1, 'production:s1')).toBe(m);
    expect(restNag(m, 2, 'research:tech').keys).toEqual(['research:tech']);
  });

  it('turn 1: closing the city sheet moves "Next" on instead of pointing back forever', () => {
    const decisions = [gov, prod, research, civic];
    expect(planEndTurn(decisions, all).next).toEqual(prod);
    const r1 = new Set(['production:s1']);
    expect(planEndTurn(decisions, all, null, r1).next).toEqual(research);
    const r2 = new Set(['production:s1', 'research:tech', 'research:civic']);
    // Only the government is left: it blocks the turn, so it stays.
    expect(planEndTurn(decisions, all, null, r2).next).toEqual(gov);
    // Never the same nag twice in a row: each rested prompt yields a different next one.
    let mem = EMPTY_NAGS;
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const next = planEndTurn(decisions, all, null, restingNags(mem, 1)).next;
      if (!next) break;
      seen.push(promptKey(next));
      mem = restNag(mem, 1, promptKey(next));
    }
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('the advisory chip goes quiet once waved off, but the idle-city check still counts it', () => {
    const plan = planEndTurn([prod], all, null, new Set(['production:s1']));
    expect(plan.mode).toBe('end');
    expect(plan.next).toBeNull();
    expect(plan.idleCities).toEqual(['s1']);
    expect(plan.advisory).toHaveLength(1);
  });
});

describe('crisis card', () => {
  it('states the penalty once: under "While it lasts", not in the description too', () => {
    for (const c of content.crises) {
      const pressure = c.pressure.length ? ['x'] : [];
      const lede = crisisLede(c.description, pressure);
      expect(lede.length).toBeGreaterThan(10);
      if (pressure.length) expect(lede).not.toMatch(/[+\-−]\d+\s*happiness/i);
    }
    expect(crisisLede('A storm. Towns suffer -2 happiness.', ['Towns: -2 happiness'])).toBe('A storm.');
    expect(crisisLede('Towns suffer -2 happiness.', ['x'])).toBe('Towns suffer -2 happiness.');
    expect(crisisLede('A storm. Towns suffer -2 happiness.', [])).toBe('A storm. Towns suffer -2 happiness.');
    expect(sentences('One. Two! Three')).toEqual(['One.', 'Two!', 'Three']);
  });
});

describe('title screen', () => {
  const meta: SaveMeta = { slot: 'auto:0', savedAt: 1, turn: 92, age: 'modern', civName: null, leader: 'builder' };
  it('labels a finished game "View chronicle" and puts New game first', () => {
    expect(titleActions(meta, true)).toEqual({ primary: 'new', saveLabel: 'View chronicle · Turn 92', newFirst: true });
    expect(titleActions(meta, false)).toEqual({ primary: 'continue', saveLabel: 'Continue · Turn 92', newFirst: false });
    expect(titleActions(meta, null).primary).toBe('continue');
    expect(titleActions(null, null)).toEqual({ primary: 'new', saveLabel: null, newFirst: true });
  });
});

describe('offer deck', () => {
  it('builds one strip item per candidate with a short "what they do" line', () => {
    const figs = content.figures.filter((f) => f.age === 'ancient').slice(0, 3);
    const offer: Offer = {
      id: 'o1',
      player: HUMAN,
      source: 'thought',
      candidates: figs.map((f) => f.id),
      reasons: Object.fromEntries(figs.map((f) => [f.id, 'drawn by your rivers'])),
      deed: null,
      turn: 1,
    } as unknown as Offer;
    const byId = Object.fromEntries(content.figures.map((f) => [f.id, f]));
    const items = deckItems(offer, byId, l, true);
    expect(items).toHaveLength(3);
    for (const it of items) {
      expect(it.oneLine.length).toBeGreaterThan(4);
      expect(it.oneLine.length).toBeLessThanOrEqual(56);
      expect(it.oneLine).not.toMatch(BAD);
      expect(it.reason).toBe('drawn by your rivers');
    }
    expect(deckItems(offer, byId, l, false).every((i) => i.reason === null)).toBe(true);
  });

  it('every figure has a one-line use', () => {
    for (const f of content.figures) expect(oneLineUse(f, l)).toMatch(/^(Seat|Field|Once|Spend): /);
  });

  it('clips at a word boundary and tracks the card in view', () => {
    expect(clip('short', 10)).toBe('short');
    expect(clip('+2 culture in coastal settlements and more', 24)).toBe('+2 culture in coastal…');
    expect(indexFromScroll(0, 312, 3)).toBe(0);
    expect(indexFromScroll(330, 312, 3)).toBe(1);
    expect(indexFromScroll(582, 312, 3)).toBe(2);
    expect(indexFromScroll(5000, 312, 3)).toBe(2);
    expect(clampIndex(-3, 3)).toBe(0);
    expect(clampIndex(1, 0)).toBe(0);
  });
});

describe('recruit reveal: best next step', () => {
  it('seats statesmen first, deploys commanders first, always offers "keep at home"', () => {
    const acts = { seat: ['elder#0'], deploy: ['s2', 's1'] };
    expect(nextSteps({ kind: 'thinker', uses: ['cabinet', 'unit'] }, acts, 's1')).toEqual([
      { kind: 'seat', slot: 'elder#0' },
      { kind: 'deploy', settlement: 's1' },
      { kind: 'home' },
    ]);
    expect(nextSteps({ kind: 'general', uses: ['cabinet', 'unit'] }, acts, 's1')[0]).toEqual({ kind: 'deploy', settlement: 's1' });
    expect(nextSteps({ kind: 'builder', uses: ['activate'] }, acts, null)).toEqual([{ kind: 'home' }]);
    expect(nextSteps({ kind: 'thinker', uses: ['cabinet'] }, { seat: [], deploy: [] }, null)).toEqual([{ kind: 'home' }]);
    expect(nextSteps({ kind: 'thinker', uses: ['cabinet'] }, null, null)).toEqual([{ kind: 'home' }]);
  });

  it('never ends on "keep at home" alone when a seat can be opened', () => {
    const none = { seat: [], deploy: [] };
    expect(nextSteps({ kind: 'statesman', uses: ['cabinet'] }, none, 's1', 'no-government')).toEqual([{ kind: 'government' }, { kind: 'home' }]);
    expect(nextSteps({ kind: 'statesman', uses: ['cabinet'] }, none, 's1', 'seat-taken')).toEqual([{ kind: 'cabinet' }, { kind: 'home' }]);
    // A free seat wins over the hint; a figure without the cabinet use gets no seat hint.
    expect(nextSteps({ kind: 'statesman', uses: ['cabinet'] }, { seat: ['elder#0'], deploy: [] }, 's1', 'no-government')[0]).toEqual({ kind: 'seat', slot: 'elder#0' });
    expect(nextSteps({ kind: 'builder', uses: ['activate'] }, none, null, 'no-government')).toEqual([{ kind: 'home' }]);
    // A usable one-time deed is offered too, after any seat step.
    expect(nextSteps({ kind: 'thinker', uses: ['cabinet', 'activate'] }, { ...none, canActivate: true }, 's1', 'seat-taken')).toEqual([
      { kind: 'cabinet' },
      { kind: 'activate' },
      { kind: 'home' },
    ]);
  });
});

describe('"Your people"', () => {
  it('describes the mix in one line', () => {
    expect(becomingLine([])).toMatch(/still finding/);
    expect(becomingLine([{ adjective: 'Greek', share: 0.8 }, { adjective: 'Egyptian', share: 0.2 }])).toBe('Deeply Greek, and growing more so.');
    expect(becomingLine([{ adjective: 'Greek', share: 0.5 }, { adjective: 'Egyptian', share: 0.4 }])).toBe('Greek and Egyptian, woven together.');
    expect(becomingLine([{ adjective: 'Greek', share: 0.6 }, { adjective: 'Egyptian', share: 0.2 }])).toBe('Mostly Greek, with an Egyptian strand.');
    expect(becomingLine([{ adjective: 'Greek', share: 0.3 }, { adjective: 'Sinic', share: 0.28 }, { adjective: 'Norse', share: 0.25 }])).toBe(
      'A blend of Greek, Sinic and Norse ways.',
    );
  });

  it('builds the view from a real game: cultures as shares, the court grouped by culture', () => {
    const { state } = buildScenario('court', content);
    const v = buildPeople(state, HUMAN, q.cultureWeights(state, HUMAN, content), content);
    expect(v).not.toBeNull();
    if (!v) return;
    expect(v.cultures.length).toBeGreaterThan(0);
    expect(v.cultures.length).toBeLessThanOrEqual(4);
    const sum = v.cultures.reduce((s, c) => s + c.share, 0);
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBeLessThanOrEqual(1.0001);
    for (let i = 1; i < v.cultures.length; i++) expect(v.cultures[i - 1]!.share).toBeGreaterThanOrEqual(v.cultures[i]!.share);
    const figures = v.figureGroups.flatMap((g) => g.figures);
    const owned = Object.values(state.figures).filter((f) => f.owner === HUMAN && f.location.state !== 'consumed');
    expect(figures).toHaveLength(owned.length);
    expect(v.becoming).not.toMatch(BAD);
  });
});

describe('Chronicle as a story', () => {
  let state: GameState;
  beforeAll(() => {
    state = buildScenario('ended', content).state;
  });

  it('opens with the civ, its leader, its dream and its roots, and closes the story', () => {
    const view = buildChronicle(state, HUMAN, content);
    expect(view).not.toBeNull();
    if (!view) return;
    const story = { view, cultures: ['Greek', 'Egyptian'], named: true };
    const open = openingLine(story);
    expect(open).toContain(view.civName);
    expect(open).toContain(view.leader);
    expect(open).toContain('Greek and Egyptian roots');
    expect(open).not.toMatch(BAD);
    expect(openingLine({ ...story, named: false })).toContain('a people yet unnamed');
    for (const a of view.ages) expect(ageSummary(a)).toMatch(/\.$/);
    const close = closingLine(view, true, view.ages[view.ages.length - 1]?.age ?? null, state.turn);
    expect(close).not.toMatch(BAD);
    expect(closingLine(view, false, null, 12)).toBe('The chronicle is still being written, turn 12.');
    const text = shareSummary(story, true, state.turn);
    expect(text).toContain('Book I: The Ancient Age.');
    expect(text).toContain('Apes Together Strong');
    expect(text).not.toMatch(BAD);
  });

  it('formats lists and ranks', () => {
    expect(listAnd(['a'])).toBe('a');
    expect(listAnd(['a', 'b', 'c'])).toBe('a, b and c');
    expect([1, 2, 3, 4, 11, 12, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '21st', '22nd']);
  });
});

describe('route preview', () => {
  const path = [1, 2, 3, 4, 5].map((q) => ({ q, r: 0 }));
  it('marks where each new turn starts, consistent with the turn count', () => {
    const cost = () => 1;
    expect(routeTurnStarts(path, 2, 2, cost)).toEqual([2, 4]);
    expect(routeTurns(path, 2, 2, cost)).toBe(3);
    expect(routeTurnStarts(path, 0, 2, cost)).toEqual([0, 2, 4]);
    for (const left of [0, 1, 2, 3]) expect(routeTurns(path, left, 2, cost)).toBe(routeTurnStarts(path, left, 2, cost).length + 1);
  });
  it('says when the unit arrives', () => {
    expect(arrivalText(1)).toBe('Arrives this turn');
    expect(arrivalText(2)).toBe('Arrives next turn');
    expect(arrivalText(4)).toBe('Arrives in 3 turns');
  });
});

describe('save export hand-off', () => {
  const file = { name: 'x.json' } as unknown as File;
  it('shares a file only where the browser can, else downloads', () => {
    expect(fileHandOff({}, file)).toBe('download');
    expect(fileHandOff({ share: async () => {}, canShare: () => true }, file)).toBe('share');
    expect(fileHandOff({ share: async () => {}, canShare: () => false }, file)).toBe('download');
    expect(fileHandOff({ share: async () => {}, canShare: () => true }, null)).toBe('download');
    expect(
      fileHandOff(
        {
          share: async () => {},
          canShare: () => {
            throw new Error('x');
          },
        },
        file,
      ),
    ).toBe('download');
  });
  it('tells the player what happened', () => {
    expect(handOffMessage({ kind: 'shared' }, 'a.json').tone).toBe('good');
    expect(handOffMessage({ kind: 'cancelled' }, 'a.json').text).toMatch(/cancelled/);
    expect(handOffMessage({ kind: 'downloaded' }, 'a.json').text).toMatch(/Files/);
    expect(handOffMessage({ kind: 'failed', message: 'quota' }, 'a.json')).toEqual({ text: 'Export failed: quota', tone: 'bad' });
  });
});

describe('merchant hint', () => {
  const base = { isFounder: false, canFound: false, isTrader: true, tradeTargets: 0, movesLeft: 2, canMove: true, canAttack: false, hasAttacked: false, military: false };
  it('says why a merchant beside a foreign city cannot trade', () => {
    expect(unitHint({ ...base, tradeBlocked: { name: 'Sais', why: 'far', range: 10 } })).toMatch(/Sais is too far from home: .* within 10 tiles/);
    expect(unitHint({ ...base, tradeBlocked: { name: 'Sais', why: 'war', range: 10 } })).toMatch(/at war/);
    expect(unitHint({ ...base, tradeBlocked: null })).toMatch(/Walk next to a foreign city/);
  });
});
