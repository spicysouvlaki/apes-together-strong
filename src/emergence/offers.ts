/**
 * Offer generation (GDD §4 "Offer generation", "Deed figures"; GDD §3 legend slot).
 */
import { GP_KINDS, type ContentBundle, type Figure, type FigureKind, type GpKind } from '@contracts/content-schemas';
import type { CultureId, FigureId, GameState, Offer, PlayerId } from '@contracts/sim-api';
import { mintId, type SimCtx } from '../sim/ctx';
import { weightedIndex } from '../sim/rng';
import { statValue } from '../sim/stats';
import * as K from './constants';
import { topSignal, type Contributions } from './signals';
import { figureDef, getPlayer, kindsForGp, suzerainByCulture, tradeRoutesByCulture } from './util';

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

/** The player's top-N cultures by affinity (ties in content order); only cultures with A > 0. */
export const topCultures = (state: GameState, player: PlayerId, content: ContentBundle): CultureId[] => {
  const p = getPlayer(state, player);
  return content.cultures
    .map((c, i) => ({ id: c.id, a: p.affinity[c.id] ?? 0, i }))
    .filter((x) => x.a > 0)
    .sort((x, y) => y.a - x.a || x.i - y.i)
    .slice(0, K.TOP_CULTURES_GUARANTEED)
    .map((x) => x.id);
};

/** Player-facing "why they came", from the culture's strongest signal for this player. No numbers. */
export const offerReason = (
  state: GameState,
  player: PlayerId,
  culture: CultureId,
  contributions: Contributions,
  content: ContentBundle,
): string => {
  const a = getPlayer(state, player).affinity[culture] ?? 0;
  if (a < K.REASON_MIN_AFFINITY) return 'a wanderer who heard of your people';
  const signal = topSignal(contributions, culture, content);
  if (signal) return `drawn by ${signal.hint}`;
  if (partnerCultures(state, player, content)[culture]) return 'drawn by your ties with their people';
  return 'drawn by the tales of your people';
};

/** Figures named in the player's open offers (so one player never sees a figure twice). */
const offeredTo = (state: GameState, player: PlayerId): Record<FigureId, true> => {
  const out: Record<FigureId, true> = {};
  for (const o of state.offers) if (o.player === player) for (const f of o.candidates) out[f] = true;
  return out;
};

/** GDD §4 step 1: unrecruited, non-deed figures of these kinds in the current age. */
export const offerPool = (state: GameState, player: PlayerId, kinds: readonly FigureKind[], content: ContentBundle): Figure[] => {
  const already = offeredTo(state, player);
  return content.figures.filter(
    (f) =>
      f.age === state.age && kinds.includes(f.kind) && f.deed === undefined && !state.figures[f.id] && !already[f.id],
  );
};

/**
 * GDD §4 steps 2–3: weighted draw of up to 3 without replacement, then guarantee one from
 * the top-3 affinity cultures when the pool has such a figure (replacing the last pick).
 */
export const drawCandidates = (state: GameState, player: PlayerId, pool: readonly Figure[], content: ContentBundle): Figure[] => {
  const p = getPlayer(state, player);
  const partners = partnerCultures(state, player, content);
  const weightOf = (f: Figure): number => offerWeight(p.affinity[f.culture] ?? 0, partners[f.culture] === true);

  const remaining = pool.slice();
  const drawn: Figure[] = [];
  while (drawn.length < K.OFFER_CANDIDATES && remaining.length > 0) {
    const i = weightedIndex(state, remaining.map(weightOf));
    const [f] = remaining.splice(i, 1);
    if (f) drawn.push(f);
  }

  const top = topCultures(state, player, content);
  if (top.length > 0 && !drawn.some((f) => top.includes(f.culture))) {
    const fromTop = remaining.filter((f) => top.includes(f.culture));
    if (fromTop.length > 0 && drawn.length > 0) {
      const pickIdx = weightedIndex(state, fromTop.map(weightOf));
      const pick = fromTop[pickIdx];
      if (pick) drawn[drawn.length - 1] = pick;
    }
  }
  return drawn;
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
  for (const f of figures) reasons[f.id] = offerReason(ctx.state, player, f.culture, contributions, ctx.content);
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

/** Pools at or over threshold create offers (one per pool per turn, capped by MAX_OPEN_OFFERS). */
export const createPointsOffers = (ctx: SimCtx, player: PlayerId, contributions: Contributions): void => {
  const { state } = ctx;
  const p = getPlayer(state, player);
  if (state.turn >= K.FIRST_OFFER_TURN && openOfferCount(state, player) === 0 && neverOffered(state, player)) {
    // Onboarding: the fullest pool (ties in GP_KINDS order) offers early.
    const order = GP_KINDS.slice().sort((a, b) => p.gp[b] - p.gp[a] || GP_KINDS.indexOf(a) - GP_KINDS.indexOf(b));
    for (const gp of order) {
      if (createDrawnOffer(ctx, player, gp, kindsForGp(gp), contributions)) {
        spendPool(state, player, gp);
        break;
      }
    }
  }
  for (const gp of GP_KINDS) {
    if (openOfferCount(state, player) >= K.MAX_OPEN_OFFERS) return;
    if (p.gp[gp] < p.gpThreshold[gp]) continue;
    if (!createDrawnOffer(ctx, player, gp, kindsForGp(gp), contributions)) continue; // keep the points
    spendPool(state, player, gp);
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
  for (const deed of content.deeds) {
    if (state.deedsDone.includes(deed.id)) continue;
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
      text: deed.description,
    });
  }
};

/** Content figure for an id known to exist. */
export const mustFigure = (content: ContentBundle, id: FigureId): Figure => {
  const f = figureDef(content, id);
  if (!f) throw new Error(`unknown figure ${id}`);
  return f;
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
