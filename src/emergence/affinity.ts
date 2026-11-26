/**
 * Hidden affinity (GDD §4): A[c] ← 0.98·A[c] + Σ_s w[s,c]·x[s], plus 50/100 hints.
 * Affinity numbers never leave the worker; the player only sees `cultureHint` text and
 * offer reasons, neither of which may contain a number.
 */
import type { ContentBundle, Culture } from '@contracts/content-schemas';
import type { CultureId, PlayerId } from '@contracts/sim-api';
import type { SimCtx } from '../sim/ctx';
import { affinityPercent, playerModifiers } from '../sim/modifiers';
import { AFFINITY_DECAY, AFFINITY_DECAY_DORMANT, AFFINITY_SCALE, HINT_COOLDOWN_SOURCE, HINT_COOLDOWN_TURNS, HINT_THRESHOLDS, HINT_TOP_N } from './constants';
import { topSignal, type Contributions } from './signals';
import { getPlayer, isDormantCulture } from './util';

const gainMultiplier = (percent: number): number => Math.max(0, 1 + percent / 100);

/** Decay and add this turn's signal gains; then fire any hints newly crossed. */
export const updateAffinity = (ctx: SimCtx, player: PlayerId, contributions: Contributions): void => {
  const { state, content } = ctx;
  const p = getPlayer(state, player);
  const mods = playerModifiers(state, player, content);
  for (const c of content.cultures) {
    let raw = 0;
    const row = contributions[c.id] ?? {};
    for (const s of content.signals) raw += row[s.id] ?? 0;
    const gain = raw * AFFINITY_SCALE * gainMultiplier(affinityPercent(mods, c.id));
    // A dormant culture's people cannot come this age: bank its affinity for the age they do.
    const decay = isDormantCulture(content, c.id, state.age) ? AFFINITY_DECAY_DORMANT : AFFINITY_DECAY;
    p.affinity[c.id] = Math.max(0, decay * (p.affinity[c.id] ?? 0) + gain);
  }
  fireHints(ctx, player, contributions);
};

/** Direct grant (wonders, envoys, trade, cultural exchange); applies affinityGain modifiers. */
export const addAffinity = (ctx: SimCtx, player: PlayerId, culture: CultureId, amount: number): void => {
  const p = ctx.state.players[player];
  if (!p) return;
  const mods = playerModifiers(ctx.state, player, ctx.content);
  const gain = amount * gainMultiplier(affinityPercent(mods, culture));
  p.affinity[culture] = Math.max(0, (p.affinity[culture] ?? 0) + gain);
};

/** Fallback when no signal explains the affinity (e.g. it came from envoys or wonders). */
const FALLBACK_HINT = 'the tales of your people';

/**
 * Player-facing hint for crossing `threshold`. Built only from content strings (culture
 * adjective, signal hint), never numbers: "Steppe peoples speak of your herds."
 * For a dormant culture (no figures this age, some later) the hint promises arrival rather
 * than presence, so it never promises a figure that cannot come yet; the age-opening offer
 * (offers.ts `offerAgeOpening`) pays the promise off when their age begins.
 */
export const hintText = (culture: Culture, hint: string, threshold: number, dormant = false): string => {
  const strong = threshold >= (HINT_THRESHOLDS[1] ?? Infinity);
  if (dormant) {
    return strong
      ? `${culture.adjective} peoples beyond the horizon still tell of ${hint}; when a new age dawns, they will come.`
      : `Word of ${hint} travels far; one day ${culture.adjective} peoples will come to find you.`;
  }
  return strong ? `${culture.adjective} travellers seek out ${hint}.` : `${culture.adjective} peoples speak of ${hint}.`;
};

/**
 * Hints speak only of a culture the player is genuinely drawing (fun audit pass 2: every
 * culture crossed 50 and 100 in almost every game, so ~16 hints per player said nothing, and
 * coastal players heard of the Inuit everywhere). A threshold fires only while the culture is
 * among the player's HINT_TOP_N cultures by affinity, and at most one hint per player every
 * HINT_COOLDOWN_TURNS turns (the strongest culture first; others wait their turn).
 */
const fireHints = (ctx: SimCtx, player: PlayerId, contributions: Contributions): void => {
  const { state, content } = ctx;
  const p = getPlayer(state, player);
  if (p.effects.some((e) => e.source === HINT_COOLDOWN_SOURCE && e.untilTurn >= state.turn)) return;
  // Rank cultures by affinity, ties in content order.
  const ranked = content.cultures
    .map((c, i) => ({ c, a: p.affinity[c.id] ?? 0, i }))
    .sort((x, y) => y.a - x.a || x.i - y.i)
    .slice(0, HINT_TOP_N);
  for (const { c, a } of ranked) {
    const shown = p.hintsShown[c.id] ?? 0;
    // The strongest threshold newly crossed: a culture past both at once hears the stronger news once.
    const crossed = HINT_THRESHOLDS.filter((t) => a >= t && shown < t);
    const threshold = crossed[crossed.length - 1];
    if (threshold === undefined) continue;
    const hint = topSignal(contributions, c.id, content)?.hint ?? FALLBACK_HINT;
    const dormant = isDormantCulture(content, c.id, state.age);
    ctx.events.push({ type: 'cultureHint', player, culture: c.id, text: hintText(c, hint, threshold, dormant) });
    p.hintsShown[c.id] = threshold;
    // Cooldown marker: an effect with no modifiers, pruned by the sim after it lapses.
    p.effects.push({ source: HINT_COOLDOWN_SOURCE, untilTurn: state.turn + HINT_COOLDOWN_TURNS - 1, modifiers: [] });
    return;
  }
};

export const cultureById = (content: ContentBundle, id: CultureId): Culture | undefined =>
  content.cultures.find((c) => c.id === id);
