/**
 * M2 emergence check (docs/WORKSTREAMS.md): for each of the 8 first-playable cultures, a
 * scripted player whose territory and play match that culture's home signals sees that
 * culture in at least half of their offers by mid-age (~turn 25 of ~50).
 *
 * Offers are counted over the age where the culture has figures (Inuit: classical). An offer
 * counts as "eligible" when the content pool it was drawn from held at least one figure of
 * the culture; offers whose pool had none cannot show the culture whatever the affinity, so
 * the check is over eligible offers (both numbers are logged). A culture is skipped only if
 * content has no eligible figures at all for it in that age.
 */
import { describe, expect, it, vi } from 'vitest';
import { FIGURE_KIND_TO_GP, type ContentBundle, type Figure, type FigureKind } from '@contracts/content-schemas';
import type { GameState } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import { emergenceTick, handleFigureCommand } from '../src/emergence';
import { CULTURE_PROFILES, makeCtx, scenarioState, scenarioStep, type CultureProfile } from './helpers/emergence';

vi.mock('../src/sim/units', () => import('./helpers/emergence'));
vi.mock('../src/sim/stats', () => import('./helpers/emergence'));
vi.mock('../src/sim/ages', () => import('./helpers/emergence'));

const realContent = loadContent();
let content: ContentBundle = realContent;

/**
 * The target roster (docs/WORKSTREAMS.md workstream 7): ~6 figures per culture per age, one
 * per non-legend kind. Used to check the engine independently of how far content has grown.
 */
const syntheticRoster = (base: ContentBundle): ContentBundle => {
  const extra: Figure[] = [];
  for (const age of ['ancient', 'classical'] as const) {
    for (const c of base.cultures) {
      for (const kind of Object.keys(FIGURE_KIND_TO_GP) as FigureKind[]) {
        extra.push({
          id: `synthetic_${c.id}_${age}_${kind}`,
          name: `A ${c.adjective} ${kind}`,
          culture: c.id,
          age,
          kind,
          archetype: true,
          uses: ['cabinet'],
          cabinetSlots: [],
          cabinetModifiers: [],
          unitModifiers: [],
          consumeValue: 1,
          bio: 'Archetype. Synthetic test figure.',
          source: 'test',
        });
      }
    }
  }
  return { ...base, figures: [...base.figures, ...extra] };
};
const TURNS = 25;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

interface RunResult {
  offers: number;
  withCulture: number;
  eligible: number;
  eligibleWithCulture: number;
  firstOfferTurn: number | null;
  ranking: string[];
  affinity: number;
}

const kindsOfSource = (source: string): FigureKind[] =>
  source === 'legend'
    ? ['legend']
    : (Object.keys(FIGURE_KIND_TO_GP) as Exclude<FigureKind, 'legend'>[]).filter((k) => FIGURE_KIND_TO_GP[k] === source);

const poolHasCulture = (state: GameState, source: string, culture: string): boolean =>
  content.figures.some(
    (f) =>
      f.culture === culture &&
      f.age === state.age &&
      f.deed === undefined &&
      kindsOfSource(source).includes(f.kind) &&
      !state.figures[f.id],
  );

const runProfile = (profile: CultureProfile, seed: number, turns = TURNS): RunResult => {
  const state = scenarioState(content, profile, seed);
  const r: RunResult = { offers: 0, withCulture: 0, eligible: 0, eligibleWithCulture: 0, firstOfferTurn: null, ranking: [], affinity: 0 };
  for (let turn = 1; turn <= turns; turn++) {
    scenarioStep(state, content, profile, turn);
    const ctx = makeCtx(state, content);
    emergenceTick(ctx, 'p1');
    for (const offer of state.offers.filter((o) => o.player === 'p1' && o.deed === null)) {
      const cultures = offer.candidates.map((id) => content.figures.find((f) => f.id === id)?.culture);
      const has = cultures.includes(profile.culture);
      const eligible = poolHasCulture(state, offer.source, profile.culture);
      r.offers++;
      if (has) r.withCulture++;
      if (eligible) r.eligible++;
      if (eligible && has) r.eligibleWithCulture++;
      r.firstOfferTurn ??= turn;
      const pick = offer.candidates.find((id) => content.figures.find((f) => f.id === id)?.culture === profile.culture) ?? offer.candidates[0] ?? null;
      expect(handleFigureCommand(ctx, 'p1', { type: 'chooseOffer', offer: offer.id, figure: pick })).toBeNull();
    }
    state.players.p1!.stats.battlesWonThisTurn = 0;
  }
  const p = state.players.p1!;
  r.ranking = content.cultures
    .map((c) => c.id)
    .sort((a, b) => (p.affinity[b] ?? 0) - (p.affinity[a] ?? 0));
  r.affinity = p.affinity[profile.culture] ?? 0;
  return r;
};

const checkAll = (label: string, getContent: () => ContentBundle, measure: 'eligible' | 'raw'): void => {
  for (const profile of CULTURE_PROFILES) {
    it(`${label} ${profile.culture}: home signals draw ${profile.culture} figures in at least half the offers`, () => {
      content = getContent();
      const hasFigures = content.figures.some((f) => f.culture === profile.culture && f.age === profile.age && f.deed === undefined);
      if (!hasFigures) {
        console.warn(`[M2] skip ${profile.culture}/${profile.age}: content has no eligible figures`);
        return;
      }
      const total = { offers: 0, withCulture: 0, eligible: 0, eligibleWithCulture: 0 };
      const firsts: (number | null)[] = [];
      let topCount = 0;
      let affinitySum = 0;
      for (const seed of SEEDS) {
        const r = runProfile(profile, seed);
        total.offers += r.offers;
        total.withCulture += r.withCulture;
        total.eligible += r.eligible;
        total.eligibleWithCulture += r.eligibleWithCulture;
        firsts.push(r.firstOfferTurn);
        if (r.ranking[0] === profile.culture) topCount++;
        affinitySum += r.affinity;
      }
      if (measure === 'eligible' && total.eligible === 0) {
        console.warn(`[M2 ${label}] ${profile.culture}: no offer pool held a ${profile.culture} figure (content too thin to measure)`);
      }
      const share =
        measure === 'raw'
          ? total.withCulture / Math.max(1, total.offers)
          : total.eligible > 0
            ? total.eligibleWithCulture / total.eligible
            : 1;
      console.info(
        `[M2 ${label}] ${profile.culture.padEnd(9)} top-affinity ${topCount}/${SEEDS.length}, A@${TURNS}≈${(affinitySum / SEEDS.length).toFixed(0)}, ` +
          `offers ${total.offers}, with culture ${total.withCulture} (raw ${(total.withCulture / Math.max(1, total.offers) * 100).toFixed(0)}%), ` +
          `eligible ${total.eligible}, eligible with culture ${total.eligibleWithCulture} (${(share * 100).toFixed(0)}%), first offers ${firsts.join(',')}`,
      );
      // Distinguishable: the culture is this player's strongest affinity in every seed.
      expect(topCount).toBe(SEEDS.length);
      expect(share).toBeGreaterThanOrEqual(0.5);
    });
  }
};

describe('offer pacing (GDD §4, §11)', () => {
  // Wave 13: offers come less often (playtest: ~25 per 109 turns felt like an interruption);
  // the target is ~14–18 per standard 2-age game for a human seat, deeds and legends included.
  it('first offer around turn 8; roughly 5–9 points offers over a ~50-turn age', () => {
    content = syntheticRoster(realContent);
    const counts: number[] = [];
    for (const profile of CULTURE_PROFILES) {
      for (const seed of SEEDS.slice(0, 3)) {
        const r = runProfile({ ...profile, age: profile.age }, seed, 50);
        expect(r.firstOfferTurn).toBe(8);
        counts.push(r.offers);
      }
    }
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    console.info(`[pacing] offers per 50 turns: mean ${mean.toFixed(1)}, range ${Math.min(...counts)}–${Math.max(...counts)}`);
    expect(mean).toBeGreaterThanOrEqual(5);
    expect(mean).toBeLessThanOrEqual(9);
  });
});

describe('M2 emergence check', () => {
  checkAll('content', () => realContent, 'eligible');
  checkAll('full-roster', () => syntheticRoster(realContent), 'raw');
});
