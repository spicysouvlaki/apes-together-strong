/**
 * Playtest 4 fixes (UI only): stale ticker news, whispers that lead to "Your people", news
 * wording, the log folding repeats, the resume recap, settlement cycling and the court's "why".
 */
import { describe, expect, it } from 'vitest';
import type { ChronicleEntry, SimEvent } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { queries as q } from '../src/sim/queries';
import { freshToasts } from '../src/ui/store';
import { dedupeByScreen, eventToToast, milestoneSentence, noticeTone, summarizeAttacks, type EventNames, type ToastSpec } from '../src/ui/shell/event-toasts';
import { foldRepeats } from '../src/ui/shell/shell-state';
import { recapLines, shouldRecap } from '../src/ui/shell/resume-recap';
import { ownSettlementRing } from '../src/ui/shell/hexutil';
import { buildPeople } from '../src/ui/screens/shared/people';
import { buildScenario, HUMAN } from '../src/ui/screens/demo-scenario';

const content = loadContent();

const names: EventNames = {
  owner: (id) => (id === 'raiders' ? 'Raiders' : `Owner ${id}`),
  figure: (id) => `Fig ${id}`,
  settlement: () => null,
  item: (id) => id,
  research: (id) => id,
  milestone: (k) => k,
  crisis: (id) => id,
  deed: (id) => (id === 'thule' ? 'The Thule Migration' : id),
  settlementAt: (hex) => (hex.q === 2 && hex.r === 12 ? 'Toletum' : null),
  unitAt: (hex, owner) => (hex.q === 4 && hex.r === 26 && owner === 'p1' ? 'Merchant' : null),
};
const t = (ev: SimEvent) => eventToToast(ev, 'p1', names);

describe('ticker freshness', () => {
  it('drops news from earlier turns and keeps unstamped tips', () => {
    const list = [{ id: 1, turn: 29 }, { id: 2, turn: 31 }, { id: 3 }];
    expect(freshToasts(list, 31).map((x) => x.id)).toEqual([2, 3]);
  });
});

describe('news wording', () => {
  it('names the city whose walls were hit', () => {
    const ev = {
      type: 'combat',
      attacker: 'u1',
      attackerOwner: 'raiders',
      defender: null,
      defenderOwner: 'p1',
      at: { q: 2, r: 12 },
      damageToAttacker: 0,
      damageToDefender: 30,
      attackerDied: false,
      defenderDied: true,
    } as unknown as SimEvent;
    expect(t(ev)?.text).toBe('Raiders attacked: the walls of Toletum were breached.');
  });

  it('says a captured civilian was captured, not that walls fell', () => {
    const ev = {
      type: 'combat',
      attacker: 'u8',
      attackerOwner: 'p3',
      defender: null,
      defenderOwner: 'p1',
      at: { q: 4, r: 26 },
      damageToAttacker: 0,
      damageToDefender: 0,
      attackerDied: false,
      defenderDied: true,
    } as unknown as SimEvent;
    expect(t(ev)).toMatchObject({ text: 'Owner p3 captured our Merchant.', tone: 'bad' });
  });

  it('says milestones as a chronicler would', () => {
    expect(milestoneSentence('Figures recruited: 3')).toBe('Milestone reached: 3 figures recruited.');
    expect(milestoneSentence('Tree nodes completed: 15')).toBe('Milestone reached: 15 tree nodes completed.');
    expect(milestoneSentence('Chart 30% of the world')).toBe('Milestone reached: Chart 30% of the world.');
  });

  it('ranks raider warnings with bad news', () => {
    expect(noticeTone('Raiders are a day from Toletum, and no one guards it.')).toBe('bad');
    expect(noticeTone('Raiders pillaged Toletum: its stores are gone.')).toBe('bad');
    expect(noticeTone('Parthenon was completed by another people first. The work Hàojīng put into it is not lost.')).toBe('bad');
    expect(noticeTone('The Conqueror of Iqaluit: “Your borders press against ours.”')).toBe('info');
  });

  it('lower-cases a leading article in a rival deed', () => {
    expect(t({ type: 'deedCompleted', player: 'p3', deed: 'thule', figure: 'x' } as SimEvent)?.text).toBe('Owner p3 achieved the Thule Migration.');
  });
});

describe('attack summaries', () => {
  const hit = (defender: string | null, died: boolean, at = { q: 9, r: 9 }) =>
    ({ type: 'combat', attacker: 'a', attackerOwner: 'p3', defender, defenderOwner: 'p1', at, damageToAttacker: 0, damageToDefender: 20, attackerDied: false, defenderDied: died }) as unknown as SimEvent;
  const unitNames: EventNames = { ...names, unit: () => 'Warrior band' };

  it('folds three or more attacks by one attacker into one line', () => {
    const evs = [hit('u1', false), hit('u2', false), hit('u3', true), hit(null, true, { q: 2, r: 12 })];
    const { summaries, folded } = summarizeAttacks(evs, 'p1', unitNames);
    expect(folded.size).toBe(4);
    expect(summaries.map((s) => s.text)).toEqual(['Owner p3 attacked 4 times: a Warrior band destroyed, 2 units hurt, the walls of Toletum struck.']);
  });

  it('leaves one or two attacks as their own sentences', () => {
    const { summaries, folded } = summarizeAttacks([hit('u1', false), hit('u2', false)], 'p1', unitNames);
    expect(summaries).toEqual([]);
    expect(folded.size).toBe(0);
  });
});

describe('turn log', () => {
  it('says "crisis began" once, not again as "stage 1"', () => {
    const a: ToastSpec = { text: 'Crisis: Collapse has begun.', tone: 'bad', action: { kind: 'crisis' } };
    const b: ToastSpec = { text: 'Collapse deepens (stage 1).', tone: 'bad', action: { kind: 'crisis' } };
    const c: ToastSpec = { text: 'Gadir grew to 4.', tone: 'info', action: null };
    expect(dedupeByScreen([a, b, c]).map((x) => x.text)).toEqual([a.text, c.text]);
  });

  it('folds the same sentence into one line with a count', () => {
    const p = { text: 'Raiders pillaged Toletum.', tone: 'bad' as const };
    const g = { text: 'Gadir grew to 4.', tone: 'info' as const };
    expect(foldRepeats([p, g, p, p]).map((e) => e.text)).toEqual(['Raiders pillaged Toletum. (3 times)', 'Gadir grew to 4.']);
  });
});

describe('the story so far', () => {
  it('recaps only resumed games', () => {
    expect(shouldRecap(null, 7, 53)).toBe(true);
    expect(shouldRecap(null, 7, 1)).toBe(false);
    expect(shouldRecap(7, 7, 53)).toBe(false);
  });

  it('keeps the last beats and shortens tradition notes', () => {
    const e = (turn: number, kind: ChronicleEntry['kind'], text: string): ChronicleEntry => ({ turn, age: 'ancient', kind, ref: 'x', text });
    const lines = recapLines(
      [
        e(40, 'figure', 'Homer joined the court.'),
        e(51, 'tradition', 'Falcata: The falcata, a curved sword used by Iberian warriors, was prized.'),
        e(51, 'name', 'The people took the name the Iberian Pax.'),
        e(52, 'age', 'The Classical age began.'),
        e(52, 'city', 'Toletum became a city.'),
      ],
      4,
    );
    expect(lines.map((l) => l.text)).toEqual(['Adopted Falcata.', 'The people took the name the Iberian Pax.', 'The Classical age began.', 'Toletum became a city.']);
  });
});

describe('settlement ring', () => {
  it('orders the capital first, then cities, then towns', () => {
    const g = {
      settlements: {
        s9: { id: 's9', owner: 'p1', isCapital: false, kind: 'town' },
        s10: { id: 's10', owner: 'p1', isCapital: false, kind: 'city' },
        s2: { id: 's2', owner: 'p1', isCapital: true, kind: 'city' },
        s3: { id: 's3', owner: 'p2', isCapital: false, kind: 'city' },
      },
    };
    expect(ownSettlementRing(g, 'p1')).toEqual(['s2', 's10', 's9']);
  });
});

describe('your people: why they came', () => {
  it('gives each culture at most two distinct reasons, newest first', () => {
    const { state } = buildScenario('court', content);
    const v = buildPeople(state, HUMAN, q.cultureWeights(state, HUMAN, content), content);
    expect(v).not.toBeNull();
    for (const grp of v?.figureGroups ?? []) {
      expect(grp.why.length).toBeLessThanOrEqual(2);
      expect(new Set(grp.why.map((w) => w.text.toLowerCase())).size).toBe(grp.why.length);
      for (const w of grp.why) expect(w.text).toMatch(/^[A-Z].*[.!?]$/);
    }
  });
});
