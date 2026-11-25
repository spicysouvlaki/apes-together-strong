/**
 * Refinement (GDD §6): spending refinement points on traditions and hybrids at an age
 * transition. One rule function per kind serves both the command and the query, so the UI's
 * "blocked" reasons always match what the sim enforces.
 */
import type { Age, ContentBundle, Hybrid, Tradition } from '@contracts/content-schemas';
import type { CultureId, GameState, PlayerId, RefinementOption } from '@contracts/sim-api';
import { cultureWeights } from '../../emergence';
import type { SimCtx } from '../ctx';
import { applyCostPercent, costPercent, playerModifiers } from '../modifiers';
import {
  HEAVIEST_CULTURE_DISCOUNT_PERCENT,
  MAX_HYBRIDS_PER_TRANSITION,
  MAX_SIGNATURES_PER_TRANSITION,
  REFINEMENT_ESCALATION,
  TIER_WEIGHT,
} from './constants';
import { addChronicle, ageIndex, ageName } from './util';

/** Culture with the highest weight (> 0); ties go to the earlier culture in content order. */
export const heaviestCulture = (weights: Record<CultureId, number>, content: ContentBundle): CultureId | null => {
  let best: CultureId | null = null;
  let bestW = 0;
  for (const c of content.cultures) {
    const w = weights[c.id] ?? 0;
    if (w > bestW) {
      best = c.id;
      bestW = w;
    }
  }
  return best;
};

/** Age whose refinements are on offer: the one being entered, or the current one outside a transition. */
const targetAge = (state: GameState): Age => state.transition?.toAge ?? state.age;

const cultureName = (id: string, content: ContentBundle): string =>
  content.cultures.find((c) => c.id === id)?.name ?? id;

interface Check {
  cost: number;
  blocked: string | null;
}

interface RuleCtx {
  state: GameState;
  player: PlayerId;
  content: ContentBundle;
  weights: Record<CultureId, number>;
  heaviest: CultureId | null;
  costMod: number;
  /** Traditions and hybrids already adopted in the current transition (cost escalation). */
  boughtNow: number;
}

/**
 * Adoptions made during the current transition. The turn counter does not advance while a
 * transition is open and adoption is only legal then, so this turn's chronicle entries are
 * exactly this transition's purchases.
 */
const boughtThisTransition = (state: GameState, player: PlayerId): number => {
  if (state.phase !== 'transition') return 0;
  const p = state.players[player];
  if (!p) return 0;
  let n = 0;
  for (const e of p.chronicle) if (e.turn === state.turn && (e.kind === 'tradition' || e.kind === 'hybrid')) n++;
  return n;
};

const ruleCtx = (state: GameState, player: PlayerId, content: ContentBundle): RuleCtx => {
  const weights = cultureWeights(state, player, content);
  return {
    state,
    player,
    content,
    weights,
    heaviest: heaviestCulture(weights, content),
    costMod: costPercent(playerModifiers(state, player, content), 'tradition'),
    boughtNow: boughtThisTransition(state, player),
  };
};

/** Each adoption in one transition makes the next cost more, so going deep beats buying every custom. */
const finalCost = (base: number, discounted: boolean, rc: RuleCtx): number =>
  applyCostPercent(base, (discounted ? HEAVIEST_CULTURE_DISCOUNT_PERCENT : 0) + rc.costMod) +
  rc.boughtNow * REFINEMENT_ESCALATION;

/** Shared tail: transition gate and points. Earlier checks win so the reason is the most useful. */
const finalChecks = (rc: RuleCtx, cost: number): string | null => {
  const p = rc.state.players[rc.player];
  const recap = rc.state.transition?.recap[rc.player];
  if (rc.state.phase !== 'transition' || !recap) return 'Refine at the next age transition';
  if (recap.done) return 'Refinement finished';
  if ((p?.refinementPoints ?? 0) < cost) return 'Not enough points';
  return null;
};

const checkTradition = (t: Tradition, rc: RuleCtx): Check => {
  const p = rc.state.players[rc.player];
  const cost = finalCost(t.cost, rc.heaviest === t.culture, rc);
  const blocked = ((): string | null => {
    if (!p) return 'Unknown player';
    if (p.traditions.includes(t.id)) return 'Already adopted';
    if (ageIndex(t.age) > ageIndex(targetAge(rc.state))) return `Available from the ${ageName(t.age)} age`;
    const need = TIER_WEIGHT[t.tier];
    if ((rc.weights[t.culture] ?? 0) < need) return `Needs weight ${need} in ${cultureName(t.culture, rc.content)}`;
    for (const req of t.requires) {
      if (!p.traditions.includes(req) && !p.hybrids.includes(req)) {
        const name = rc.content.traditions.find((x) => x.id === req)?.name ?? req;
        return `Needs ${name}`;
      }
    }
    const recap = rc.state.transition?.recap[rc.player];
    if (t.tier === 'signature' && recap && recap.signaturesBought >= MAX_SIGNATURES_PER_TRANSITION) {
      return 'One new signature per transition';
    }
    return finalChecks(rc, cost);
  })();
  return { cost, blocked };
};

const checkHybrid = (h: Hybrid, rc: RuleCtx): Check => {
  const p = rc.state.players[rc.player];
  const [a, b] = h.cultures;
  const cost = finalCost(h.cost, rc.heaviest === a || rc.heaviest === b, rc);
  const blocked = ((): string | null => {
    if (!p) return 'Unknown player';
    if (p.hybrids.includes(h.id)) return 'Already adopted';
    if (ageIndex(h.age) > ageIndex(targetAge(rc.state))) return `Available from the ${ageName(h.age)} age`;
    for (const c of [a, b]) {
      if ((rc.weights[c] ?? 0) < h.minWeight) return `Needs weight ${h.minWeight} in ${cultureName(c, rc.content)}`;
    }
    const recap = rc.state.transition?.recap[rc.player];
    if (recap && recap.hybridsBought >= MAX_HYBRIDS_PER_TRANSITION) return 'One new hybrid per transition';
    return finalChecks(rc, cost);
  })();
  return { cost, blocked };
};

export const refinementOptions = (state: GameState, player: PlayerId, content: ContentBundle): RefinementOption[] => {
  const p = state.players[player];
  if (!p) return [];
  const rc = ruleCtx(state, player, content);
  const maxAge = ageIndex(targetAge(state));
  const out: RefinementOption[] = [];
  for (const t of content.traditions) {
    if (ageIndex(t.age) > maxAge || p.traditions.includes(t.id)) continue;
    const c = checkTradition(t, rc);
    out.push({ id: t.id, kind: 'tradition', cost: c.cost, available: c.blocked === null, blocked: c.blocked });
  }
  for (const h of content.hybrids) {
    if (ageIndex(h.age) > maxAge || p.hybrids.includes(h.id)) continue;
    const c = checkHybrid(h, rc);
    out.push({ id: h.id, kind: 'hybrid', cost: c.cost, available: c.blocked === null, blocked: c.blocked });
  }
  return out;
};

export const adoptTradition = (ctx: SimCtx, player: PlayerId, id: string): string | null => {
  const { state, content } = ctx;
  const t = content.traditions.find((x) => x.id === id);
  if (!t) return 'Unknown tradition';
  const check = checkTradition(t, ruleCtx(state, player, content));
  if (check.blocked) return check.blocked;
  const p = state.players[player];
  const recap = state.transition?.recap[player];
  if (!p || !recap) return 'Not in a transition';
  p.refinementPoints -= check.cost;
  p.traditions.push(t.id);
  if (t.tier === 'signature') recap.signaturesBought++;
  ctx.events.push({ type: 'traditionAdopted', player, tradition: t.id });
  addChronicle(state, player, 'tradition', t.id, `${t.name}: ${t.history.note}`);
  return null;
};

export const adoptHybrid = (ctx: SimCtx, player: PlayerId, id: string): string | null => {
  const { state, content } = ctx;
  const h = content.hybrids.find((x) => x.id === id);
  if (!h) return 'Unknown hybrid';
  const check = checkHybrid(h, ruleCtx(state, player, content));
  if (check.blocked) return check.blocked;
  const p = state.players[player];
  const recap = state.transition?.recap[player];
  if (!p || !recap) return 'Not in a transition';
  p.refinementPoints -= check.cost;
  p.hybrids.push(h.id);
  recap.hybridsBought++;
  ctx.events.push({ type: 'hybridAdopted', player, hybrid: h.id });
  addChronicle(state, player, 'hybrid', h.id, `${h.name}: ${h.history.note}`);
  return null;
};
