/**
 * Offer generation (GDD §4 "Offer generation", "Deed figures"; GDD §3 legend slot).
 */
import { AGES, FIGURE_KIND_TO_GP, GP_KINDS, type ContentBundle, type Figure, type FigureKind, type GpKind } from '@contracts/content-schemas';
import type { CultureId, FigureId, GameState, Offer, PlayerId } from '@contracts/sim-api';
import { mintId, type SimCtx } from '../sim/ctx';
import { weightedIndex } from '../sim/rng';
import { statValue } from '../sim/stats';
import * as K from './constants';
import { AGE_OPENING_REASON, PARTNER_REASONS, REASON_FAMILY, TALES_REASONS, WANDERER_REASONS, pickPhrase, signalReason } from './reasons';
import { cultureWeights } from './queries';
import { citedSignals, signalContributions, type Contributions } from './signals';
import { culturesWithFiguresIn, figureDef, getPlayer, kindsForGp, suzerainByCulture, tradeRoutesByCulture } from './util';

/** Cultures the player has a city-state suzerainty or trade route with (×2 offer weight). */
export const partnerCultures = (state: GameState, player: PlayerId, content: ContentBundle): Record<CultureId, true> => {
  const out: Record<CultureId, true> = {};
  const routes = tradeRoutesByCulture(state, player, content);
  const suz = suzerainByCulture(state, player, content);
  for (const c of content.cultures) if ((routes[c.id] ?? 0) > 0 || (suz[c.id] ?? 0) > 0) out[c.id] = true;
  return out;
};

export const offerWeight = (affinity: number, partner: boolean): number =>
  Math.pow(Math.max(0, affinity) + K.OFFER_WEIGHT_BASE, K.OFFER_WEIGHT_EXPONENT) * (partner ? K.PARTNER_WEIGHT_MULT : 1);

/**
 * The player's top-N cultures by affinity (ties in content order); only cultures with A > 0.
 * With `among`, only those cultures compete: the draw guarantee uses the cultures actually in
 * the pool, so a culture with no figures this age (a dormant one) never wastes the guarantee.
 */
export const topCultures = (
  state: GameState,
  player: PlayerId,
  content: ContentBundle,
  among?: Record<CultureId, true>,
): CultureId[] => {
  const p = getPlayer(state, player);
  return content.cultures
    .map((c, i) => ({ id: c.id, a: p.affinity[c.id] ?? 0, i }))
    .filter((x) => x.a > 0 && (!among || among[x.id] === true))
    .sort((x, y) => y.a - x.a || x.i - y.i)
    .slice(0, K.TOP_CULTURES_GUARANTEED)
    .map((x) => x.id);
};

/**
 * Player-facing "why they came", from the culture's strongest signal (and a close second) for
 * this player, phrased from a small family of templates (reasons.ts). No numbers. `figure`
 * only varies the phrasing; omit it for the plain "drawn by …" form.
 */
export const offerReason = (
  state: GameState,
  player: PlayerId,
  culture: CultureId,
  contributions: Contributions,
  content: ContentBundle,
  figure = '',
  used?: Map<string, string>,
): string => {
  const a = getPlayer(state, player).affinity[culture] ?? 0;
  // A signal the player really has is always the best reason, even while the culture's
  // affinity is still low (wave 11: two of three reasons in a first offer were the generic
  // wanderer line though a real signal fed each culture). Generic lines are the last resort.
  // Wave 13 ("Drawn by your wide plains" / "Curious to see your wide plains…" in one offer):
  // with `used` (signal id -> the reason given for it in this offer), the signals already cited
  // by other candidates are passed over for the culture's next citable one; when it has no
  // other, the earlier reason is repeated word for word rather than rephrased.
  const cited = citedSignals(state, player, contributions, culture, content, used ? 4 : 2);
  const fresh = used ? cited.filter((x) => !used.has(x.signal.id)) : cited;
  const [first, second] = fresh.length > 0 ? fresh : cited;
  if (first) {
    const secondHint =
      second &&
      second.hint !== first.hint &&
      REASON_FAMILY[second.signal.measure] === REASON_FAMILY[first.signal.measure] &&
      second.value >= K.REASON_SECOND_SIGNAL_SHARE * first.value
        ? second.hint
        : null;
    const earlier = used?.get(first.signal.id);
    if (earlier !== undefined) return earlier;
    const text = figure ? signalReason(state, figure, first.signal.measure, first.hint, secondHint) : `drawn by ${first.hint}`;
    used?.set(first.signal.id, text);
    if (secondHint && second && used && !used.has(second.signal.id)) used.set(second.signal.id, text);
    return text;
  }
  if (partnerCultures(state, player, content)[culture]) return figure ? pickPhrase(state, figure, PARTNER_REASONS) : PARTNER_REASONS[0];
  if (a < K.REASON_MIN_AFFINITY) return figure ? pickPhrase(state, figure, WANDERER_REASONS) : WANDERER_REASONS[0];
  return figure ? pickPhrase(state, figure, TALES_REASONS) : TALES_REASONS[0];
};

/**
 * Figures named in any open offer. An invitation is exclusive: a figure already invited by
 * one court (this player's or a rival's) is not drawn for another until that offer closes.
 * Wave 11: with shared candidates, choosing a figure from the later of two offers sent them
 * to the earlier court ("joined a rival"), which read as a stale, broken offer. (The contest
 * rule in figures.ts still settles saves made before this.)
 */
const invited = (state: GameState): Record<FigureId, true> => {
  const out: Record<FigureId, true> = {};
  for (const o of state.offers) for (const f of o.candidates) out[f] = true;
  return out;
};

/** GDD §4 step 1: unrecruited, non-deed figures of these kinds in the current age. */
export const offerPool = (state: GameState, _player: PlayerId, kinds: readonly FigureKind[], content: ContentBundle): Figure[] => {
  const already = invited(state);
  return content.figures.filter(
    (f) =>
      f.age === state.age && kinds.includes(f.kind) && f.deed === undefined && !state.figures[f.id] && !already[f.id],
  );
};

/**
 * GDD §4 steps 2–3: weighted draw of up to 3 without replacement, then guarantee one from
 * the top-3 affinity cultures when the pool has such a figure (replacing the last pick).
 */
/**
 * Can a figure that only serves in a cabinet be seated under the player's government? (Any
 * seat of the current cabinet accepts its kind.) Figures with other uses always count as usable.
 */
export const figureUsable = (state: GameState, player: PlayerId, f: Figure, content: ContentBundle): boolean => {
  if (f.uses.some((u) => u !== 'cabinet')) return true;
  const p = getPlayer(state, player);
  for (const key of Object.keys(p.cabinet)) {
    const slot = content.cabinetSlots.find((s) => s.id === (key.split('#')[0] ?? key));
    if (slot && slot.accepts.includes(f.kind)) return true;
  }
  return false;
};

/** Figures this player was shown and passed over during the current age. */
export const passedOver = (state: GameState, player: PlayerId): Record<FigureId, true> => {
  const out: Record<FigureId, true> = {};
  for (const e of state.players[player]?.effects ?? []) {
    if (e.source.startsWith(K.PASSED_OVER_SOURCE)) out[e.source.slice(K.PASSED_OVER_SOURCE.length)] = true;
  }
  return out;
};

/** Remember that the player passed over these figures (until the age ends; no modifiers). */
export const markPassedOver = (state: GameState, player: PlayerId, figures: readonly FigureId[]): void => {
  const p = state.players[player];
  if (!p) return;
  const known = passedOver(state, player);
  for (const f of figures) {
    if (known[f] || state.figures[f]) continue;
    p.effects.push({ source: K.PASSED_OVER_SOURCE + f, untilTurn: -1, modifiers: [] });
    known[f] = true;
  }
};

export const drawCandidates = (state: GameState, player: PlayerId, pool: readonly Figure[], content: ContentBundle): Figure[] => {
  const p = getPlayer(state, player);
  const partners = partnerCultures(state, player, content);
  const passed = passedOver(state, player);
  const weightOf = (f: Figure): number =>
    offerWeight(p.affinity[f.culture] ?? 0, partners[f.culture] === true) *
    (figureUsable(state, player, f, content) ? 1 : K.UNSEATABLE_WEIGHT_MULT) *
    (passed[f.id] ? K.PASSED_OVER_WEIGHT_MULT : 1);

  const remaining = pool.slice();
  const drawn: Figure[] = [];
  while (drawn.length < K.OFFER_CANDIDATES && remaining.length > 0) {
    const i = weightedIndex(state, remaining.map(weightOf));
    const [f] = remaining.splice(i, 1);
    if (f) drawn.push(f);
  }

  const inPool: Record<CultureId, true> = {};
  for (const f of pool) inPool[f.culture] = true;
  const top = topCultures(state, player, content, inPool);
  if (top.length > 0 && !drawn.some((f) => top.includes(f.culture))) {
    const fromTop = remaining.filter((f) => top.includes(f.culture));
    if (fromTop.length > 0 && drawn.length > 0) {
      const pickIdx = weightedIndex(state, fromTop.map(weightOf));
      const pick = fromTop[pickIdx];
      if (pick) {
        const [out] = drawn.splice(drawn.length - 1, 1, pick);
        if (out) remaining.push(out);
        remaining.splice(remaining.indexOf(pick), 1);
      }
    }
  }
  // Wave 13 (fewer offers, each one a real choice): when the court already leans to a culture
  // that a hybrid pairs with another, one candidate of that other culture is offered too, so
  // most offers weigh deepening the main culture against reaching for a hybrid.
  const wanted = hybridPartners(state, player, content);
  if (drawn.length >= K.OFFER_CANDIDATES && !drawn.some((f) => wanted[f.culture])) {
    const fromPartners = remaining.filter((f) => wanted[f.culture]);
    // Replace the last candidate that the top-culture guarantee does not need.
    let slot = -1;
    for (let i = drawn.length - 1; i >= 0 && slot < 0; i--) {
      const rest = drawn.filter((_, j) => j !== i);
      if (top.length === 0 || rest.some((f) => top.includes(f.culture)) || !top.includes(drawn[i]?.culture ?? '')) slot = i;
    }
    if (fromPartners.length > 0 && slot >= 0) {
      const pick = fromPartners[weightedIndex(state, fromPartners.map(weightOf))];
      if (pick) drawn[slot] = pick;
    }
  }
  return drawn;
};

/**
 * Cultures that would bring a hybrid closer (GDD §6 "3 in both cultures"): some hybrid of this
 * age or the next pairs them with a culture the player already holds at weight
 * HYBRID_NUDGE_MIN_WEIGHT or more, and the player is still short of the hybrid's weight in them.
 * Public information only (culture weights are shown to the player).
 */
export const hybridPartners = (state: GameState, player: PlayerId, content: ContentBundle): Record<CultureId, true> => {
  const out: Record<CultureId, true> = {};
  const weights = cultureWeights(state, player, content);
  const age = AGES.indexOf(state.age);
  for (const h of content.hybrids) {
    if (AGES.indexOf(h.age) > age + 1) continue;
    const [a, b] = h.cultures;
    if (!a || !b) continue;
    if ((weights[a] ?? 0) >= K.HYBRID_NUDGE_MIN_WEIGHT && (weights[b] ?? 0) < h.minWeight) out[b] = true;
    if ((weights[b] ?? 0) >= K.HYBRID_NUDGE_MIN_WEIGHT && (weights[a] ?? 0) < h.minWeight) out[a] = true;
  }
  return out;
};

export const openOfferCount = (state: GameState, player: PlayerId): number =>
  state.offers.filter((o) => o.player === player && o.deed === null).length;

const pushOffer = (
  ctx: SimCtx,
  player: PlayerId,
  source: Offer['source'],
  figures: readonly Figure[],
  reasons: Record<FigureId, string>,
  deed: string | null,
): Offer => {
  const offer: Offer = {
    id: mintId(ctx.state, 'o'),
    player,
    source,
    candidates: figures.map((f) => f.id),
    reasons,
    deed,
    createdTurn: ctx.state.turn,
  };
  ctx.state.offers.push(offer);
  ctx.events.push({ type: 'offerCreated', offer: offer.id, player });
  return offer;
};

const reasonsFor = (
  ctx: SimCtx,
  player: PlayerId,
  figures: readonly Figure[],
  contributions: Contributions,
): Record<FigureId, string> => {
  const reasons: Record<FigureId, string> = {};
  const used = new Map<string, string>();
  // Strongest culture first, so it keeps its best reason and the others give way.
  const p = getPlayer(ctx.state, player);
  const order = figures.slice().sort((x, y) => (p.affinity[y.culture] ?? 0) - (p.affinity[x.culture] ?? 0) || (x.id < y.id ? -1 : 1));
  for (const f of order) reasons[f.id] = offerReason(ctx.state, player, f.culture, contributions, ctx.content, f.id, used);
  return reasons;
};

/** Draw an offer of `kinds` for the player. Returns false (and creates nothing) if the pool is empty. */
export const createDrawnOffer = (
  ctx: SimCtx,
  player: PlayerId,
  source: GpKind | 'legend',
  kinds: readonly FigureKind[],
  contributions: Contributions,
): boolean => {
  const pool = offerPool(ctx.state, player, kinds, ctx.content);
  if (pool.length === 0) return false;
  const drawn = drawCandidates(ctx.state, player, pool, ctx.content);
  if (drawn.length === 0) return false;
  pushOffer(ctx, player, source, drawn, reasonsFor(ctx, player, drawn, contributions), null);
  return true;
};

const spendPool = (state: GameState, player: PlayerId, gp: GpKind): void => {
  const p = getPlayer(state, player);
  const threshold = p.gpThreshold[gp];
  p.gp[gp] = Math.max(0, p.gp[gp] - threshold);
  p.gpThreshold[gp] = threshold * K.GP_THRESHOLD_GROWTH;
};

/** True until the player's first points offer (every threshold is still the starting one). */
const neverOffered = (state: GameState, player: PlayerId): boolean => {
  const p = getPlayer(state, player);
  return p.stats.figuresRecruited === 0 && GP_KINDS.every((k) => p.gpThreshold[k] === K.GP_START_THRESHOLD);
};

/** Turn of this player's latest recruit in the current age, or null if none yet. */
export const lastRecruitTurn = (state: GameState, player: PlayerId): number | null => {
  let last: number | null = null;
  for (const id of Object.keys(state.figures)) {
    const f = state.figures[id];
    if (f && f.owner === player && f.recruitedAge === state.age && (last === null || f.recruitedTurn > last)) last = f.recruitedTurn;
  }
  return last;
};

/**
 * Order in which pools are served: how full each is (banked points over threshold) plus the
 * player's current lean — this turn's gain into the pool over the mean gain of all pools,
 * times GP_LEAN_WEIGHT. Wave 11 (scholar play drew few thinkers): offers are paced, so in a
 * long game most pools sit banked at the cap and the fill alone tied, leaving GP_KINDS order
 * and threshold growth to pick; the lean lets what the player is doing now decide instead.
 */
export const poolOrderKey =
  (gp: Readonly<Record<GpKind, number>>, threshold: Readonly<Record<GpKind, number>>, gains?: Readonly<Record<GpKind, number>>) =>
  (k: GpKind): number => {
    const fill = gp[k] / threshold[k];
    if (!gains) return fill;
    const mean = GP_KINDS.reduce((a, j) => a + Math.max(0, gains[j]), 0) / GP_KINDS.length;
    return fill + (mean > 0 ? (K.GP_LEAN_WEIGHT * Math.max(0, gains[k])) / mean : 0);
  };

/**
 * Pools create offers (GDD §4 "when a pool crosses its threshold"), paced (see
 * OFFER_DROUGHT_TURNS): onboarding at FIRST_OFFER_TURN, a drought offer from the fullest pool,
 * otherwise the first pool at threshold — at most one points offer per turn, capped by
 * MAX_OPEN_OFFERS, and none right after a recruit.
 */
export const createPointsOffers = (
  ctx: SimCtx,
  player: PlayerId,
  contributions: Contributions,
  gains?: Readonly<Record<GpKind, number>>,
): void => {
  const { state } = ctx;
  const p = getPlayer(state, player);
  const open = openOfferCount(state, player);
  const key = poolOrderKey(p.gp, p.gpThreshold, gains);
  const fullest = GP_KINDS.slice().sort((a, b) => key(b) - key(a) || GP_KINDS.indexOf(a) - GP_KINDS.indexOf(b));
  if (state.turn >= K.FIRST_OFFER_TURN && open === 0 && neverOffered(state, player)) {
    // Onboarding: the fullest pool (ties in GP_KINDS order) offers early.
    for (const gp of fullest) {
      if (createDrawnOffer(ctx, player, gp, kindsForGp(gp), contributions)) {
        spendPool(state, player, gp);
        return;
      }
    }
  }
  if (open >= K.MAX_OPEN_OFFERS) return;
  const last = lastRecruitTurn(state, player);
  if (last !== null && state.turn - last < K.OFFER_MIN_GAP_TURNS) return;
  const since = state.turn - (last ?? ageStartTurn(state, player));
  const drought = open === 0 && state.turn >= K.FIRST_OFFER_TURN && since >= K.OFFER_DROUGHT_TURNS;
  for (const gp of fullest) {
    const fill = p.gp[gp] / p.gpThreshold[gp];
    if (fill < 1 && !(drought && fill >= K.OFFER_DROUGHT_MIN_FILL)) continue;
    if (!createDrawnOffer(ctx, player, gp, kindsForGp(gp), contributions)) continue; // keep the points
    spendPool(state, player, gp);
    return;
  }
};

/** Figures this player recruited during the current age (for the legend slot). */
const recruitedThisAge = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const id of Object.keys(state.figures)) {
    const f = state.figures[id];
    if (f && f.owner === player && f.recruitedAge === state.age) n++;
  }
  return n;
};

/** One legend offer per age once the player's renown (total affinity or figures) is high enough. */
export const maybeOfferLegend = (ctx: SimCtx, player: PlayerId, contributions: Contributions): void => {
  const { state, content } = ctx;
  const p = getPlayer(state, player);
  if (p.legendSlotUsed || openOfferCount(state, player) >= K.MAX_OPEN_OFFERS) return;
  let total = 0;
  for (const c of content.cultures) total += p.affinity[c.id] ?? 0;
  if (total < K.LEGEND_TOTAL_AFFINITY && recruitedThisAge(state, player) < K.LEGEND_FIGURES_THIS_AGE) return;
  if (createDrawnOffer(ctx, player, 'legend', ['legend'], contributions)) p.legendSlotUsed = true;
};

/** Deed figures (GDD §4): once per world, the first player to meet the trigger gets the offer. */
export const checkDeeds = (ctx: SimCtx, player: PlayerId): void => {
  const { state, content } = ctx;
  // One deed at a time, spaced out: lifetime counters mean several classical deeds can
  // already be satisfied on the first turn of the age, and they must not all land at once.
  const p = state.players[player];
  if (!p) return;
  if (state.offers.some((o) => o.player === player && o.deed !== null)) return;
  for (let i = p.chronicle.length - 1; i >= 0; i--) {
    const e = p.chronicle[i];
    if (e && e.kind === 'deed') {
      if (state.turn - e.turn < K.DEED_SPACING_TURNS) return;
      break;
    }
  }
  const intoAge = state.turn - ageStartTurn(state, player);
  if (state.age !== AGES[0] && intoAge < K.DEED_AGE_OPENING_QUIET_TURNS) return;
  for (const deed of content.deeds) {
    if (state.deedsDone.includes(deed.id)) continue;
    if (K.TRANSITION_ONLY_MEASURES.includes(deed.trigger.measure) && intoAge < K.DEED_TRANSITION_MEASURE_DELAY) continue;
    const fig = content.figures.find((f) => f.deed === deed.id);
    if (!fig || fig.age !== state.age || state.figures[fig.id]) continue;
    if (statValue(state, player, deed.trigger.measure, deed.trigger.param, content) < deed.trigger.count) continue;
    state.deedsDone.push(deed.id);
    pushOffer(ctx, player, 'deed', [fig], { [fig.id]: deed.description }, deed.id);
    ctx.events.push({ type: 'deedCompleted', deed: deed.id, figure: fig.id, player });
    getPlayer(state, player).chronicle.push({
      turn: state.turn,
      age: state.age,
      kind: 'deed',
      ref: deed.id,
      // deed.description is second person ("You held a city…"); the Chronicle names the deed.
      text: `A deed was done: ${deed.name}.`,
    });
    return;
  }
};

/**
 * First turn of the current age for this player, read from their own Chronicle ("The
 * Classical age began."); turn 1 in the first age.
 */
export const ageStartTurn = (state: GameState, player: PlayerId): number => {
  const p = state.players[player];
  if (!p) return 1;
  for (const e of p.chronicle) if (e.kind === 'age' && e.age === state.age && e.ref === state.age) return e.turn;
  return 1;
};

/**
 * The culture whose arrival the player was promised and whose age has now begun: no figures
 * in the previous age, figures in this one, a hint was shown for it, and it is among the
 * player's top AGE_OPENING_TOP_N affinity cultures (hints fire for many cultures; the payoff
 * is for the ones the player's land really leaned toward). Null if none.
 */
export const promisedCulture = (state: GameState, player: PlayerId, content: ContentBundle): CultureId | null => {
  const idx = AGES.indexOf(state.age);
  const prev = AGES[idx - 1];
  if (!prev) return null;
  const p = getPlayer(state, player);
  const before = culturesWithFiguresIn(content, prev);
  const now = culturesWithFiguresIn(content, state.age);
  const top = topCultures(state, player, content).slice(0, K.AGE_OPENING_TOP_N);
  let best: CultureId | null = null;
  let bestA = 0;
  for (const c of content.cultures) {
    if (before[c.id] || !now[c.id]) continue;
    const a = p.affinity[c.id] ?? 0;
    if (a <= 0) continue;
    const promised = (p.hintsShown[c.id] ?? 0) >= (K.HINT_THRESHOLDS[0] ?? 0) && top.includes(c.id);
    if (promised && a > bestA) {
      best = c.id;
      bestA = a;
    }
  }
  return best;
};

/**
 * Age-opening offer: run once per player on the first turn of a new age (lifecycle
 * `onAgeStarted`). Pays off a dormant culture's hint by offering up to three of its figures
 * at once (any kind but legends; the offer's pool is the first candidate's kind). Its reason
 * recalls the old promise. Returns true when an offer was made.
 */
export const offerAgeOpening = (ctx: SimCtx, player: PlayerId): boolean => {
  const { state, content } = ctx;
  const culture = promisedCulture(state, player, content);
  if (!culture) return false;
  const kinds = (Object.keys(FIGURE_KIND_TO_GP) as FigureKind[]).filter((k) => k !== 'legend');
  const pool = offerPool(state, player, kinds, content).filter((f) => f.culture === culture);
  if (pool.length === 0) return false;
  const remaining = pool.slice();
  const drawn: Figure[] = [];
  while (drawn.length < K.AGE_OPENING_CANDIDATES && remaining.length > 0) {
    const [f] = remaining.splice(weightedIndex(state, remaining.map(() => 1)), 1);
    if (f) drawn.push(f);
  }
  const first = drawn[0];
  if (!first || first.kind === 'legend') return false;
  const contributions = signalContributions(state, player, content);
  const hint = citedSignals(state, player, contributions, culture, content)[0]?.hint ?? 'your people';
  const reasons: Record<FigureId, string> = {};
  for (const f of drawn) reasons[f.id] = AGE_OPENING_REASON.replace('{h}', hint);
  pushOffer(ctx, player, FIGURE_KIND_TO_GP[first.kind], drawn, reasons, null);
  return true;
};

/** Content figure for an id known to exist. */
export const mustFigure = (content: ContentBundle, id: FigureId): Figure => {
  const f = figureDef(content, id);
  if (!f) throw new Error(`unknown figure ${id}`);
  return f;
};

/** Kinds an offer of this source draws from (deeds have no pool). */
export const kindsForSource = (source: Offer['source']): FigureKind[] =>
  source === 'deed' ? [] : source === 'legend' ? ['legend'] : kindsForGp(source);

/**
 * An open offer lost its last candidate to a rival's court. Refill it from its own pool with
 * a fresh draw (same source, same reasons rules); if the pool is empty, drop it with the
 * usual refund and tell the player ('offerWithdrawn'). Returns true when refilled.
 */
export const refillOrWithdraw = (ctx: SimCtx, offer: Offer): boolean => {
  const { state, content } = ctx;
  const kinds = kindsForSource(offer.source);
  const pool = kinds.length > 0 && state.players[offer.player] ? offerPool(state, offer.player, kinds, content) : [];
  const drawn = pool.length > 0 ? drawCandidates(state, offer.player, pool, content) : [];
  if (drawn.length > 0) {
    offer.candidates = drawn.map((f) => f.id);
    offer.reasons = reasonsFor(ctx, offer.player, drawn, signalContributions(state, offer.player, content));
    return true;
  }
  dropOffer(state, offer.id, true);
  ctx.events.push({
    type: 'notice',
    player: offer.player,
    kind: 'offerWithdrawn',
    text: 'Every figure in one of your open offers joined another court first; the offer is withdrawn and its points return to you.',
  });
  return false;
};

/**
 * Remove an offer. A dropped points offer (all candidates gone to rivals, or the age ended)
 * refunds the threshold it consumed, so the player gets another offer soon.
 */
export const dropOffer = (state: GameState, offerId: string, refund: boolean): void => {
  const idx = state.offers.findIndex((o) => o.id === offerId);
  if (idx < 0) return;
  const [o] = state.offers.splice(idx, 1);
  const p = o ? state.players[o.player] : undefined;
  if (!o || !p || !refund || o.source === 'deed') return;
  if (o.source === 'legend') p.legendSlotUsed = false;
  else p.gp[o.source] += p.gpThreshold[o.source] / K.GP_THRESHOLD_GROWTH;
};
