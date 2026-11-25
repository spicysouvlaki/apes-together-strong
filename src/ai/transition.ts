/**
 * The refinement screen for rivals (GDD §5 "Transition", §6): buy the best affordable
 * traditions and hybrids (hybrids and the heaviest culture's ladder first), take the first
 * proposed name, choose a government of the new age, then finish.
 */
import type { CultureId } from '@contracts/sim-api';
import { SCORE_PER_HYBRID, SCORE_PER_SIGNATURE_EXTRA, SCORE_PER_TRADITION } from '../sim/ages/constants';
import { queries } from '../sim/queries';
import { exec, me, step, type AiCtx } from './ctx';
import { chooseGovernment } from './decisions';
import { modifiersScore } from './persona';

const heaviest = (weights: Record<CultureId, number>): CultureId | null => {
  let best: CultureId | null = null;
  let bestW = 0;
  for (const [c, w] of Object.entries(weights)) {
    if (w > bestW) {
      bestW = w;
      best = c;
    }
  }
  return best;
};

const buyRefinements = (ai: AiCtx): void => {
  const { content, player } = ai;
  for (let guard = 0; guard < 16; guard++) {
    const weights = queries.cultureWeights(ai.state, player, content);
    const top = heaviest(weights);
    const refined = new Set<string>();
    for (const id of me(ai).traditions) {
      const t = content.traditions.find((x) => x.id === id);
      if (t) refined.add(t.culture);
    }
    let best: { id: string; kind: 'tradition' | 'hybrid' } | null = null;
    let bestValue = -Infinity;
    for (const o of queries.refinementOptions(ai.state, player, content)) {
      if (!o.available) continue;
      let v: number;
      if (o.kind === 'hybrid') {
        const h = content.hybrids.find((x) => x.id === o.id);
        if (!h) continue;
        v = SCORE_PER_HYBRID + 2 * modifiersScore(h.modifiers, ai.persona) + 6;
      } else {
        const t = content.traditions.find((x) => x.id === o.id);
        if (!t) continue;
        v = SCORE_PER_TRADITION + (t.tier === 'signature' ? SCORE_PER_SIGNATURE_EXTRA : 0) + 2 * modifiersScore(t.modifiers, ai.persona);
        if (!refined.has(t.culture)) v += 6; // "refine N cultures" legacy milestone
        if (t.culture === top) v += 4; // climb the heaviest culture's ladder
        v += Math.min(6, weights[t.culture] ?? 0) * 0.3;
      }
      const ratio = v / Math.max(1, o.cost);
      if (ratio > bestValue || (ratio === bestValue && best !== null && o.id < best.id)) {
        bestValue = ratio;
        best = { id: o.id, kind: o.kind };
      }
    }
    if (!best) return;
    const ok =
      best.kind === 'hybrid'
        ? exec(ai, { type: 'adoptHybrid', hybrid: best.id }, true)
        : exec(ai, { type: 'adoptTradition', tradition: best.id }, true);
    if (!ok) return;
  }
};

export const runTransition = (ai: AiCtx): void => {
  const recap = ai.state.transition?.recap[ai.player];
  if (!recap || recap.done) return;
  step(ai, buyRefinements);
  step(ai, (a) => {
    const name = a.state.transition?.recap[a.player]?.nameOptions[0];
    if (name) exec(a, { type: 'nameCiv', name }, true);
  });
  step(ai, chooseGovernment);
  exec(ai, { type: 'finishTransition' }, true);
};
