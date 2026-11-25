/**
 * Hidden affinity (GDD §4): A[c] ← 0.98·A[c] + Σ_s w[s,c]·x[s], plus 50/100 hints.
 * Affinity numbers never leave the worker; the player only sees `cultureHint` text and
 * offer reasons, neither of which may contain a number.
 */
import type { ContentBundle, Culture } from '@contracts/content-schemas';
import type { CultureId, PlayerId } from '@contracts/sim-api';
import type { SimCtx } from '../sim/ctx';
import { affinityPercent, playerModifiers } from '../sim/modifiers';
import { AFFINITY_DECAY, AFFINITY_SCALE, HINT_THRESHOLDS } from './constants';
import { topSignal, type Contributions } from './signals';
import { getPlayer } from './util';

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
    p.affinity[c.id] = Math.max(0, AFFINITY_DECAY * (p.affinity[c.id] ?? 0) + gain);
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
 */
export const hintText = (culture: Culture, hint: string, threshold: number): string =>
  threshold >= (HINT_THRESHOLDS[1] ?? Infinity)
    ? `${culture.adjective} travellers seek out ${hint}.`
    : `${culture.adjective} peoples speak of ${hint}.`;

const fireHints = (ctx: SimCtx, player: PlayerId, contributions: Contributions): void => {
  const { state, content } = ctx;
  const p = getPlayer(state, player);
  for (const c of content.cultures) {
    const a = p.affinity[c.id] ?? 0;
    const shown = p.hintsShown[c.id] ?? 0;
    for (const threshold of HINT_THRESHOLDS) {
      if (a < threshold || shown >= threshold) continue;
      const hint = topSignal(contributions, c.id, content)?.hint ?? FALLBACK_HINT;
      ctx.events.push({ type: 'cultureHint', player, culture: c.id, text: hintText(c, hint, threshold) });
      p.hintsShown[c.id] = threshold;
    }
  }
};

export const cultureById = (content: ContentBundle, id: CultureId): Culture | undefined =>
  content.cultures.find((c) => c.id === id);
