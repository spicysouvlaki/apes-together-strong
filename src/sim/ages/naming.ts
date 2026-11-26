/** Civilization naming (GDD §6 "Naming"): adjective of the top culture(s) + the dream's word. */
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameState, PlayerId } from '@contracts/sim-api';
import { cultureWeights } from '../../emergence';
import type { SimCtx } from '../ctx';
import { CIV_NAME_MAX, CIV_NAME_MIN, NAME_OPTION_COUNT } from './constants';
import { addChronicle } from './util';

/** Fallback word when the dream is missing from content. */
const FALLBACK_DREAM_WORD = 'Realm';

/** Cultures with weight > 0, heaviest first; ties keep content order. */
const rankedCultures = (state: GameState, player: PlayerId, content: ContentBundle) => {
  const weights = cultureWeights(state, player, content);
  return content.cultures
    .map((c, i) => ({ c, i, w: weights[c.id] ?? 0 }))
    .filter((x) => x.w > 0)
    .sort((x, y) => y.w - x.w || x.i - y.i)
    .map((x) => x.c);
};

/**
 * Three distinct names, e.g. "the Hellenic Pax", "the Hellenic-Sinic Pax", "the Pax of
 * Al-Andalus" (latest hybrid). With no figures yet, falls back to the dream and leader.
 */
export const nameOptions = (state: GameState, player: PlayerId, content: ContentBundle): string[] => {
  const p = state.players[player];
  if (!p) return [];
  const dream = content.dreams.find((d) => d.id === p.dream)?.romanized ?? FALLBACK_DREAM_WORD;
  const [first, second] = rankedCultures(state, player, content);
  const lastHybridId = p.hybrids[p.hybrids.length - 1];
  const hybrid = lastHybridId ? content.hybrids.find((h) => h.id === lastHybridId) : undefined;
  const leader = content.leaders.find((l) => l.id === p.leader)?.name;

  const pool: string[] = [];
  if (first) {
    pool.push(`the ${first.adjective} ${dream}`);
    if (second) pool.push(`the ${first.adjective}-${second.adjective} ${dream}`);
    if (hybrid) pool.push(`the ${dream} of ${hybrid.name}`);
    pool.push(`${first.adjective} ${dream}`);
    if (second) pool.push(`the ${second.adjective} ${dream}`);
  } else if (hybrid) {
    pool.push(`the ${dream} of ${hybrid.name}`);
  }
  pool.push(`the ${dream}`);
  if (leader) pool.push(`the ${dream} of ${leader}`);
  pool.push(`the First ${dream}`, `the Great ${dream}`);

  const out: string[] = [];
  for (const name of pool) {
    const n = name.slice(0, CIV_NAME_MAX).trim();
    if (!out.includes(n)) out.push(n);
    if (out.length === NAME_OPTION_COUNT) break;
  }
  return out;
};

/** Set the civ name (trimmed, 1–40 chars). Shared by `nameCiv` and the finishTransition auto-fill. */
export const setCivName = (ctx: SimCtx, player: PlayerId, raw: string): string | null => {
  const name = raw.trim();
  if (name.length < CIV_NAME_MIN || name.length > CIV_NAME_MAX) {
    return `A name must be ${CIV_NAME_MIN}–${CIV_NAME_MAX} characters long.`;
  }
  const p = ctx.state.players[player];
  if (!p) return 'That player is not in this game.';
  p.civName = name;
  ctx.events.push({ type: 'civNamed', player, name });
  addChronicle(ctx.state, player, 'name', player, `The people took the name ${name}.`);
  return null;
};
