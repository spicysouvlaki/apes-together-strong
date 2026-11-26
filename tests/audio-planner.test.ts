import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@contracts/sim-api';
import { BIG_GAP_MS, CADENCE_GAP_MS, DEFAULT_MAX_SOUNDS, DEFAULT_MAX_SPAN_MS, EVENT_CUES, MAX_GAP_MS, MIN_GAP_MS, TAIL_ALLOWANCE_MS, planEvents } from '../src/audio/planner';
import { TURN_LOG } from '../src/audio/turnlog';
import { RECIPES } from '../src/audio/recipes';

const ME = 'p1';
const RIVAL = 'p2';
const OTHER = 'p3';

/**
 * One sample of every SimEvent type, as `me`'s own event where it has an owner. The Record
 * type makes a new SimEvent type a compile error here until a sample (and a mapping) exists.
 */
const SAMPLES: { [K in SimEvent['type']]: Extract<SimEvent, { type: K }> } = {
  turnStarted: { type: 'turnStarted', turn: 5 },
  offerCreated: { type: 'offerCreated', offer: 'o', player: ME },
  figureRecruited: { type: 'figureRecruited', figure: 'f', player: ME },
  figureJoinedRival: { type: 'figureJoinedRival', figure: 'f', player: ME, rival: RIVAL },
  figureRetired: { type: 'figureRetired', figure: 'f', player: ME },
  figureCaptured: { type: 'figureCaptured', figure: 'f', from: RIVAL, to: ME },
  deedCompleted: { type: 'deedCompleted', deed: 'd', figure: 'f', player: ME },
  cultureHint: { type: 'cultureHint', player: ME, culture: 'greek', text: 't' },
  settlementFounded: { type: 'settlementFounded', settlement: 's', player: ME },
  settlementGrew: { type: 'settlementGrew', settlement: 'mine', population: 3 },
  settlementCaptured: { type: 'settlementCaptured', settlement: 's', from: RIVAL, to: ME },
  productionCompleted: { type: 'productionCompleted', settlement: 's', item: 'i', player: ME },
  wonderBuilt: { type: 'wonderBuilt', wonder: 'w', player: ME, settlement: 's' },
  researchCompleted: { type: 'researchCompleted', player: ME, tree: 'tech', id: 't' },
  combat: { type: 'combat', attacker: 'a', attackerOwner: ME, defenderOwner: RIVAL, defender: 'd', at: { q: 0, r: 0 }, damageToAttacker: 5, damageToDefender: 20, attackerDied: false, defenderDied: false },
  warDeclared: { type: 'warDeclared', by: RIVAL, on: ME },
  peaceMade: { type: 'peaceMade', a: ME, b: RIVAL },
  envoySent: { type: 'envoySent', player: ME, cityState: 'c' },
  suzerainChanged: { type: 'suzerainChanged', cityState: 'c', suzerain: ME },
  tradeRouteOpened: { type: 'tradeRouteOpened', player: ME, from: 's', to: 't' },
  milestoneReached: { type: 'milestoneReached', player: ME, milestone: 'm', track: 'culture' as Extract<SimEvent, { type: 'milestoneReached' }>['track'] },
  crisisStarted: { type: 'crisisStarted', crisis: 'c' },
  crisisStage: { type: 'crisisStage', crisis: 'c', stage: 2 },
  traditionAdopted: { type: 'traditionAdopted', player: ME, tradition: 't' },
  hybridAdopted: { type: 'hybridAdopted', player: ME, hybrid: 'h' },
  civNamed: { type: 'civNamed', player: ME, name: 'n' },
  ageProgress: { type: 'ageProgress', value: 40 },
  ageEnded: { type: 'ageEnded', age: 'ancient' },
  transitionStarted: { type: 'transitionStarted', from: 'ancient', to: 'classical' },
  ageStarted: { type: 'ageStarted', age: 'classical' },
  playerEliminated: { type: 'playerEliminated', player: ME, by: RIVAL },
  gameEnded: { type: 'gameEnded', winner: ME },
  notice: { type: 'notice', player: null, text: 'hello' },
};

const owner = (id: string): string => (id === 'mine' ? ME : RIVAL);
const plan1 = (ev: SimEvent, viewer: string | null = ME) => planEvents([ev], viewer, { settlementOwner: owner });

/** Intentionally silent: no sound however it is seen. */
const SILENT = new Set<SimEvent['type']>(['ageProgress', 'transitionStarted', 'notice']);

describe('event planner: coverage', () => {
  it('maps every SimEvent type (exhaustive)', () => {
    expect(Object.keys(EVENT_CUES).sort()).toEqual(Object.keys(SAMPLES).sort());
  });

  it('own events make a sound unless intentionally silent', () => {
    for (const [type, ev] of Object.entries(SAMPLES) as [SimEvent['type'], SimEvent][]) {
      const p = plan1(ev);
      if (SILENT.has(type)) expect(p, type).toEqual([]);
      else expect(p.length, type).toBeGreaterThan(0);
      for (const s of p) {
        expect(RECIPES[s.sfx], type).toBeDefined();
        expect(s.gain).toBeGreaterThan(0);
        expect(s.gain).toBeLessThanOrEqual(1);
      }
    }
  });

  it('maps the signature moments to the right sounds', () => {
    expect(plan1(SAMPLES.offerCreated).map((p) => p.sfx)).toEqual(['offer']);
    expect(plan1(SAMPLES.figureRecruited).map((p) => p.sfx)).toEqual(['recruit']);
    expect(plan1(SAMPLES.cultureHint).map((p) => p.sfx)).toEqual(['hint']);
    expect(plan1(SAMPLES.wonderBuilt).map((p) => p.sfx)).toEqual(['wonder']);
    expect(plan1(SAMPLES.playerEliminated).map((p) => p.sfx)).toEqual(['defeat']);
  });
});

describe('event planner: viewer filtering', () => {
  it("is silent for third parties' private events", () => {
    const theirs: SimEvent[] = [
      { ...SAMPLES.offerCreated, player: OTHER },
      { ...SAMPLES.figureRecruited, player: OTHER },
      { ...SAMPLES.productionCompleted, player: OTHER },
      { ...SAMPLES.researchCompleted, player: OTHER },
      { ...SAMPLES.cultureHint, player: OTHER },
      { ...SAMPLES.settlementFounded, player: OTHER },
      { type: 'settlementGrew', settlement: 'theirs', population: 4 },
      { type: 'warDeclared', by: RIVAL, on: OTHER },
      { type: 'peaceMade', a: RIVAL, b: OTHER },
      { type: 'settlementCaptured', settlement: 's', from: RIVAL, to: OTHER },
      { ...SAMPLES.combat, attackerOwner: RIVAL, defenderOwner: OTHER },
      { ...SAMPLES.milestoneReached, player: OTHER },
      { ...SAMPLES.traditionAdopted, player: OTHER },
      { ...SAMPLES.deedCompleted, player: OTHER },
    ];
    for (const ev of theirs) expect(plan1(ev), ev.type).toEqual([]);
  });

  it('rivals acting on me are loud; a rival wonder is a soft distant cue', () => {
    const war = plan1({ type: 'warDeclared', by: RIVAL, on: ME });
    expect(war).toEqual([{ sfx: 'war', delayMs: 0, gain: 1, distant: false }]);
    const lost = plan1({ type: 'settlementCaptured', settlement: 's', from: ME, to: RIVAL });
    expect(lost[0]?.sfx).toBe('war');
    const rivalWonder = plan1({ ...SAMPLES.wonderBuilt, player: RIVAL });
    expect(rivalWonder[0]).toMatchObject({ sfx: 'wonder', distant: true });
    expect(rivalWonder[0]!.gain).toBeLessThan(0.5);
  });

  it('settlement growth needs the owner lookup and only ticks for my cities', () => {
    expect(planEvents([SAMPLES.settlementGrew], ME)).toEqual([]);
    expect(plan1({ type: 'settlementGrew', settlement: 'theirs', population: 2 })).toEqual([]);
    expect(plan1(SAMPLES.settlementGrew)[0]?.sfx).toBe('tap');
  });

  it('a null viewer hears only world events', () => {
    expect(plan1(SAMPLES.offerCreated, null)).toEqual([]);
    expect(plan1(SAMPLES.crisisStarted, null)[0]?.sfx).toBe('crisis');
    expect(plan1(SAMPLES.gameEnded, null)).toEqual([]);
  });

  it('combat: my unit dying is a loss; a kill is a small victory; ranged guessed from no return damage', () => {
    const died = plan1({ ...SAMPLES.combat, attackerOwner: RIVAL, defenderOwner: ME, defenderDied: true });
    expect(died.map((p) => p.sfx)).toEqual(['unitLost', 'attack']);
    const kill = plan1({ ...SAMPLES.combat, defenderDied: true });
    expect(kill.map((p) => p.sfx)).toEqual(['victory', 'attack']);
    const ranged = plan1({ ...SAMPLES.combat, damageToAttacker: 0 });
    expect(ranged.map((p) => p.sfx)).toEqual(['ranged']);
  });
});

describe('event planner: batching', () => {
  it('collapses duplicates (ten growths = one soft tick)', () => {
    const grow: SimEvent[] = Array.from({ length: 10 }, () => SAMPLES.settlementGrew);
    const p = planEvents(grow, ME, { settlementOwner: owner });
    expect(p).toHaveLength(1);
    expect(p[0]?.sfx).toBe('tap');
    expect(p[0]!.gain).toBeLessThanOrEqual(1);
  });

  it('orders by importance and spaces sounds 120–250 ms apart within ~3 s', () => {
    const batch: SimEvent[] = [
      SAMPLES.turnStarted,
      SAMPLES.settlementGrew,
      SAMPLES.productionCompleted,
      SAMPLES.researchCompleted,
      SAMPLES.cultureHint,
      { type: 'warDeclared', by: RIVAL, on: ME },
      SAMPLES.offerCreated,
      SAMPLES.tradeRouteOpened,
      SAMPLES.envoySent,
    ];
    const p = planEvents(batch, ME, { settlementOwner: owner });
    expect(p[0]?.sfx).toBe('war');
    expect(p[1]?.sfx).toBe('offer');
    expect(p.length).toBeLessThanOrEqual(5);
    expect(p.map((s) => s.sfx)).not.toContain('tap'); // least important dropped first
    for (let i = 1; i < p.length; i++) {
      const gap = p[i]!.delayMs - p[i - 1]!.delayMs;
      const tier = RECIPES[p[i - 1]!.sfx].tier;
      expect(gap).toBeGreaterThanOrEqual(MIN_GAP_MS);
      // Big sounds get more room so the next one does not smear them.
      expect(gap).toBeLessThanOrEqual(tier === 'big' || tier === 'fanfare' ? BIG_GAP_MS : MAX_GAP_MS);
    }
    expect(p[p.length - 1]!.delayMs).toBeLessThanOrEqual(DEFAULT_MAX_SPAN_MS);
    expect(new Set(p.map((s) => s.sfx)).size).toBe(p.length);
  });

  it('keeps the age cadence together: ageEnd, then ageStart after the IV chord rings', () => {
    const p = planEvents([SAMPLES.ageEnded, SAMPLES.figureRecruited, SAMPLES.transitionStarted, SAMPLES.ageStarted], ME);
    const end = p.findIndex((s) => s.sfx === 'ageEnd');
    expect(p[end + 1]?.sfx).toBe('ageStart');
    expect(p[end + 1]!.delayMs - p[end]!.delayMs).toBe(CADENCE_GAP_MS);
  });

  it('respects caps', () => {
    const all = Object.values(SAMPLES) as SimEvent[];
    const p = planEvents(all, ME, { settlementOwner: owner, maxSounds: 3 });
    expect(p).toHaveLength(3);
    const q = planEvents(all, ME, { settlementOwner: owner, maxSpanMs: 200 });
    expect(q[q.length - 1]!.delayMs).toBeLessThanOrEqual(200);
    expect(planEvents([], ME)).toEqual([]);
  });

  it('is pure: same input, same plan', () => {
    const all = Object.values(SAMPLES) as SimEvent[];
    expect(planEvents(all, ME, { settlementOwner: owner })).toEqual(planEvents(all, ME, { settlementOwner: owner }));
  });
});

describe('event planner on real turn starts (autoplay logs, src/audio/turnlog.ts)', () => {
  const plans = TURN_LOG.map((b) => planEvents(b.events, ME, { settlementOwner: () => ME }));
  it('a busy turn start is a short phrase: at most 5 sounds, done in about 3 s', () => {
    expect(plans.some((p) => p.length === DEFAULT_MAX_SOUNDS)).toBe(true); // the log has busy turns
    for (const p of plans) {
      expect(p.length).toBeLessThanOrEqual(5);
      const end = Math.max(0, ...p.map((s) => s.delayMs + RECIPES[s.sfx].dur * 1000));
      const cadence = p.some((s) => s.sfx === 'ageStart');
      expect(end).toBeLessThanOrEqual(cadence ? 3600 : DEFAULT_MAX_SPAN_MS + TAIL_ALLOWANCE_MS);
    }
  });

  it('never plays the same sound twice in a row, within a batch or into the next', () => {
    let prev: string | undefined;
    for (const b of TURN_LOG) {
      const p = planEvents(b.events, ME, { settlementOwner: () => ME, ...(prev ? { avoidFirst: prev as never } : {}) });
      const seq = p.map((s) => s.sfx);
      for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
      if (prev && seq.length > 1 && seq[0] !== 'ageEnd') expect(seq[0]).not.toBe(prev);
      prev = seq[seq.length - 1] ?? prev;
    }
  });

  it('avoidFirst swaps the opening sound but keeps the age cadence intact', () => {
    const batch = [SAMPLES.researchCompleted, SAMPLES.productionCompleted];
    const first = planEvents(batch, ME)[0]?.sfx;
    expect(first).toBeDefined();
    const swapped = planEvents(batch, ME, { avoidFirst: first! }).map((s) => s.sfx);
    expect(swapped[0]).not.toBe(first);
    expect(swapped).toContain(first);
    const age = planEvents([SAMPLES.ageEnded, SAMPLES.ageStarted], ME, { avoidFirst: 'ageEnd' });
    expect(age.map((s) => s.sfx)).toEqual(['ageEnd', 'ageStart']);
  });
});
