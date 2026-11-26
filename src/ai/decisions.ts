/**
 * Answers to the decisions that gate a turn or steer the empire (GDD §9 "operational"):
 * figure offers, crisis responses, government, research, and the strategic focus.
 * The AI never reads `affinity`: offers are judged on public information only (figure kind,
 * the player's own culture weights, open cabinet seats) just like a human would.
 */
import type { ContentBundle, Figure, LegacyTrack, Modifier } from '@contracts/content-schemas';
import { AGES, LEGACY_TRACKS } from '@contracts/content-schemas';
import type { CultureId, Offer } from '@contracts/sim-api';
import { queries } from '../sim/queries';
import { exec, me, type AiCtx } from './ctx';
import { modifiersScore, type Persona } from './persona';
import { hash01, hashStr } from './util';

// --- Strategic layer ----------------------------------------------------------------

/**
 * The legacy track this AI leans into for the current 10-turn window (GDD §9 "re-plan every
 * 10 turns"): personality plus progress toward the next milestone tier, with a small seeded
 * nudge per window so plans differ between games.
 */
export const focusTrack = (ai: AiCtx): LegacyTrack => {
  const { state, player, content } = ai;
  const ms = queries.milestones(state, player, content);
  const bucket = Math.floor(state.turn / 10);
  let best: LegacyTrack = 'legacy';
  let bestScore = -Infinity;
  for (const t of LEGACY_TRACKS) {
    const m = ms.find((x) => x.track === t);
    let progress = 0;
    if (m && m.achieved < 3) progress = Math.min(1, m.value / Math.max(1, m.thresholds[m.achieved] ?? 1));
    const done = m && m.achieved >= 3 ? 1 : 0;
    const score = ai.persona.track[t] + progress * 1.2 - done + hash01(`${state.seed}|${player}|focus|${bucket}|${t}`) * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
};

// --- Figure offers ------------------------------------------------------------------

const figureIndex = new WeakMap<ContentBundle, Record<string, Figure>>();
export const figureOf = (content: ContentBundle, id: string): Figure | undefined => {
  let idx = figureIndex.get(content);
  if (!idx) {
    idx = {};
    for (const f of content.figures) idx[f.id] = f;
    figureIndex.set(content, idx);
  }
  return idx[id];
};

/** Kinds that could sit in a currently empty seat. */
const openSeatKinds = (ai: AiCtx): string[] => {
  const p = me(ai);
  const out: string[] = [];
  for (const key of Object.keys(p.cabinet)) {
    if (p.cabinet[key]) continue;
    const slot = ai.content.cabinetSlots.find((s) => s.id === key.split('#')[0]);
    if (slot) for (const k of slot.accepts) if (!out.includes(k)) out.push(k);
  }
  return out;
};

/** Offer-score bonus for a figure that brings a planned hybrid's second culture toward its weight. */
export const HYBRID_PLAN_BONUS = 1.4;

/** Offer-score bonus for a figure of the AI's one target hybrid (`targetHybrid`) while short of its weight. */
export const HYBRID_TARGET_BONUS = 2.2;

/**
 * The hybrid this AI works toward: of the hybrids of this age or the next, the one whose two
 * cultures it is closest to completing (weights counted up to the hybrid's minimum; ties in
 * content order), once it holds at least one figure of either culture. Public information only.
 */
export const targetHybrid = (ai: AiCtx, weights: Record<CultureId, number>): { cultures: readonly CultureId[]; minWeight: number } | null => {
  const ageIdx = AGES.indexOf(ai.state.age);
  let best: { cultures: readonly CultureId[]; minWeight: number } | null = null;
  let bestScore = 0;
  for (const h of ai.content.hybrids) {
    if (AGES.indexOf(h.age) > ageIdx + 1 || me(ai).hybrids.includes(h.id)) continue;
    const [a, b] = h.cultures;
    if (!a || !b) continue;
    const wa = Math.min(weights[a] ?? 0, h.minWeight);
    const wb = Math.min(weights[b] ?? 0, h.minWeight);
    // Both halves count, the weaker one a little more (a pair needs both).
    const score = wa + wb + 0.5 * Math.min(wa, wb);
    if (score > bestScore) {
      bestScore = score;
      best = { cultures: h.cultures, minWeight: h.minWeight };
    }
  }
  return best;
};

/** Offer-score bonus per culture-hint threshold crossed (50, 100). */
export const HINT_LEAN = 0.9;

export const offerFigureScore = (
  ai: AiCtx,
  def: Figure,
  weights: Record<CultureId, number>,
  seatKinds: readonly string[],
): number => {
  const pe = ai.persona;
  let s = pe.kind[def.kind];
  const w = weights[def.culture] ?? 0;
  // Collectors snowball their heaviest cultures (refinement ladders); others lean gently.
  s += pe.w.collector > 0 ? 0.9 * Math.min(w, 6) : 0.35 * Math.min(w, 5);
  // Follow the land: the culture hints a player has seen ("Steppe peoples speak of your
  // herds", GDD §4) are public to that player, so the AI may lean toward the peoples its own
  // play attracts — the same cue a human gets. It never reads the hidden affinity numbers.
  const hint = me(ai).hintsShown[def.culture] ?? 0;
  s += hint >= 100 ? HINT_LEAN * 2 : hint >= 50 ? HINT_LEAN : 0;
  // Plan a hybrid (GDD §6): a figure of a culture that pairs with one we already hold, while
  // that culture is still short of the hybrid's weight, is worth more than another figure of
  // our heaviest culture (AI civs become hybrid cultures too, GDD §9).
  const ageIdx = AGES.indexOf(ai.state.age);
  let plan = 0;
  for (const h of ai.content.hybrids) {
    if (!h.cultures.includes(def.culture) || AGES.indexOf(h.age) > ageIdx + 1) continue;
    const other = h.cultures[0] === def.culture ? h.cultures[1] : h.cultures[0];
    if ((weights[other] ?? 0) < 1) continue;
    const short = (weights[def.culture] ?? 0) < h.minWeight;
    plan = Math.max(plan, (short ? HYBRID_PLAN_BONUS : 0.6) * (1 + 0.5 * pe.w.collector));
  }
  s += plan;
  // Wave 13 (fewer offers, ~7 figures by the first transition): spread plans reach no hybrid,
  // so the AI commits to one — the hybrid whose two cultures it is closest to — and favours
  // both of its cultures until each has the weight.
  const target = targetHybrid(ai, weights);
  if (target && target.cultures.includes(def.culture) && (weights[def.culture] ?? 0) < target.minWeight) s += HYBRID_TARGET_BONUS;
  if (def.uses.includes('cabinet') && seatKinds.includes(def.kind)) s += 0.8;
  s += def.consumeValue * 0.1;
  s += hash01(`${ai.state.seed}|${ai.player}|fig|${def.id}`) * 0.3;
  return s;
};

const answerOffer = (ai: AiCtx, offer: Offer): void => {
  const weights = queries.cultureWeights(ai.state, ai.player, ai.content);
  const seats = openSeatKinds(ai);
  const ranked = offer.candidates
    .map((id) => ({ id, def: figureOf(ai.content, id) }))
    .filter((x): x is { id: string; def: Figure } => x.def !== undefined)
    .map((x) => ({ id: x.id, score: offerFigureScore(ai, x.def, weights, seats) }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  // Skip rarely (GDD §4 step 4): a points offer with nothing the AI cares about, ~1 in 12.
  const best = ranked[0];
  const skippable = offer.deed === null && offer.source !== 'legend';
  if (skippable && best && best.score < 2 && hashStr(`${ai.state.seed}|${offer.id}|skip`) % 12 === 0) {
    if (exec(ai, { type: 'chooseOffer', offer: offer.id, figure: null }, true)) return;
  }
  for (const c of ranked) if (exec(ai, { type: 'chooseOffer', offer: offer.id, figure: c.id }, true)) return;
  exec(ai, { type: 'chooseOffer', offer: offer.id, figure: null }, true);
};

export const answerOffers = (ai: AiCtx): void => {
  for (let guard = 0; guard < 8; guard++) {
    const offer = ai.state.offers.find((o) => o.player === ai.player);
    if (!offer) return;
    const before = ai.state.offers.length;
    answerOffer(ai, offer);
    if (ai.state.offers.some((o) => o.id === offer.id) && ai.state.offers.length === before) return;
  }
};

// --- Crisis --------------------------------------------------------------------------

export const answerCrisis = (ai: AiCtx): void => {
  const { state } = ai;
  const crisis = state.crisis;
  if (!crisis || !crisis.awaiting.includes(ai.player)) return;
  const def = ai.content.crises.find((c) => c.id === crisis.id);
  const stage = def?.stages[crisis.stage - 1];
  if (!stage) return;
  const p = me(ai);
  const scored = stage.options.map((o) => {
    let s = modifiersScore(o.modifiers, ai.persona);
    for (const [k, v] of Object.entries(o.stock)) {
      const delta = v ?? 0;
      const have = p.stock[k as keyof typeof p.stock] ?? 0;
      if (delta < 0 && have < -delta) s -= 10;
      else s += delta / 15;
    }
    return { id: o.id, s };
  });
  scored.sort((a, b) => b.s - a.s);
  for (const o of scored) if (exec(ai, { type: 'chooseCrisisResponse', option: o.id }, true)) return;
};

// --- Government ----------------------------------------------------------------------

export const governmentScore = (ai: AiCtx, govId: string): number => {
  const gov = ai.content.governments.find((g) => g.id === govId);
  if (!gov) return -Infinity;
  const pe = ai.persona;
  let s = modifiersScore(gov.modifiers, pe);
  const kinds: string[] = [];
  for (const id of Object.keys(ai.state.figures)) {
    const f = ai.state.figures[id];
    if (!f || f.owner !== ai.player) continue;
    if (f.location.state !== 'based' && f.location.state !== 'seated') continue;
    const def = figureOf(ai.content, id);
    if (def && def.uses.includes('cabinet')) kinds.push(def.kind);
  }
  for (const slotId of gov.cabinetSlots) {
    const slot = ai.content.cabinetSlots.find((x) => x.id === slotId);
    if (!slot) continue;
    if (kinds.some((k) => slot.accepts.includes(k as never))) s += 1.2;
    let pref = 0;
    for (const k of slot.accepts) pref = Math.max(pref, pe.kind[k]);
    s += 0.4 * pref;
  }
  return s + hash01(`${ai.state.seed}|${ai.player}|gov|${govId}`) * 0.5;
};

export const chooseGovernment = (ai: AiCtx): void => {
  const p = me(ai);
  if (p.government !== null && ai.state.phase !== 'transition') return;
  const options = queries.governmentOptions(ai.state, ai.player, ai.content);
  if (options.length === 0) return;
  if (p.government !== null && options.includes(p.government)) return;
  const best = options.slice().sort((a, b) => governmentScore(ai, b) - governmentScore(ai, a))[0];
  if (best) exec(ai, { type: 'setGovernment', government: best }, true);
};

// --- Research ------------------------------------------------------------------------

interface Unlocks {
  buildings: string[];
  units: string[];
  wonders: string[];
}
const unlockCache = new WeakMap<ContentBundle, Record<string, Unlocks>>();
const unlocksOf = (content: ContentBundle, tech: string): Unlocks => {
  let map = unlockCache.get(content);
  if (!map) {
    map = {};
    const get = (id: string): Unlocks => (map![id] ??= { buildings: [], units: [], wonders: [] });
    for (const b of content.buildings) if (b.requiresTech) get(b.requiresTech).buildings.push(b.id);
    for (const u of content.units) if (u.requiresTech) get(u.requiresTech).units.push(u.id);
    for (const w of content.wonders) if (w.requiresTech) get(w.requiresTech).wonders.push(w.id);
    unlockCache.set(content, map);
  }
  return map[tech] ?? { buildings: [], units: [], wonders: [] };
};

/** Research value per own unit that a tech's unit would upgrade (capped at 6 units). */
export const UPGRADE_TECH_VALUE_PER_UNIT = 0.6;

export const buildingValue = (content: ContentBundle, id: string, pe: Persona): number => {
  const b = content.buildings.find((x) => x.id === id);
  if (!b) return 0;
  let v = 0;
  for (const [k, amount] of Object.entries(b.yields)) v += (amount ?? 0) * (pe.yieldW[k as keyof Persona['yieldW']] ?? 1);
  for (const [k, amount] of Object.entries(b.gp)) v += (amount ?? 0) * 0.6 * (pe.gp[k as keyof Persona['gp']] ?? 1);
  v += modifiersScore(b.modifiers as Modifier[], pe) * 0.5;
  if (b.defense > 0) v += 0.5 + 0.5 * pe.w.warmonger;
  return v;
};

const techScore = (ai: AiCtx, id: string, cost: number, focus: LegacyTrack): number => {
  const { content } = ai;
  const pe = ai.persona;
  const tech = content.techs.find((t) => t.id === id);
  if (!tech) return -Infinity;
  const u = unlocksOf(content, id);
  let v = 1 + modifiersScore(tech.modifiers, pe);
  for (const b of u.buildings) v += 0.5 + 0.4 * buildingValue(content, b, pe);
  for (let i = 0; i < u.wonders.length; i++) v += 0.5 + 1.2 * pe.w.builder + (focus === 'culture' ? 1 : 0);
  for (const uid of u.units) {
    const def = content.units.find((x) => x.id === uid);
    if (!def) continue;
    // Units we already field upgrade for free in our land once this tech is known (src/sim/units
    // unitUpkeep). Fun audit pass 2: ~40% of AI unit-turns in the classical age were past-age
    // units waiting on an upgrade tech nobody researched.
    const upgraders = Object.values(ai.state.units).filter((x) => x.owner === ai.player && content.units.find((d) => d.id === x.type)?.upgradesTo === uid).length;
    v += UPGRADE_TECH_VALUE_PER_UNIT * Math.min(6, upgraders);
    if (def.canTrade) v += 0.8 + 0.6 * (pe.w.opportunist + pe.w.seafarer);
    else if (def.unitClass === 'naval') v += 0.2 + 0.5 * pe.w.seafarer;
    else v += 0.5 + 0.8 * pe.w.warmonger;
  }
  // Science focus maximizes nodes completed: cheaper nodes first.
  const exp = focus === 'science' ? 1.25 : 1;
  // Leftover nodes of a past age are cheap but count for nothing this age (no meter, no
  // milestone): catch up only on what they unlock (e.g. merchants), at a weighted price.
  if (tech.age !== ai.state.age) {
    if (u.units.length + u.buildings.length === 0) return -Infinity;
    cost *= 4;
  }
  return v / Math.pow(Math.max(1, cost), exp) + hash01(`${ai.state.seed}|${ai.player}|tech|${id}`) * 0.001;
};

export const chooseResearch = (ai: AiCtx, focus: LegacyTrack): void => {
  for (const tree of ['tech', 'civic'] as const) {
    if (me(ai).research[tree].current !== null) continue;
    const options = queries.researchOptions(ai.state, ai.player, tree, ai.content);
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const o of options) {
      const s = techScore(ai, o.id, o.cost, focus);
      if (s > bestScore) {
        bestScore = s;
        best = o.id;
      }
    }
    if (best) exec(ai, { type: 'setResearch', tree, id: best });
  }
};
