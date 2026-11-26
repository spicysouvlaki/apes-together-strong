/**
 * Tech and civic trees, governments (GDD §7 "Trees", "Governments").
 * Science feeds the tech tree, culture income feeds the civic tree.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameState, PlayerId, ResearchOption } from '@contracts/sim-api';
import { syncCabinet } from '../emergence';
import { addAgeProgress } from './ages';
import { AGE_INDEX, ANARCHY_TURNS, TREE_COMPLETE_AGE_PROGRESS } from './constants';
import type { SimCtx } from './ctx';
import { ruleAge } from './lookup';

export type Tree = 'tech' | 'civic';

export const researchOptionsFor = (
  state: GameState,
  player: PlayerId,
  tree: Tree,
  content: ContentBundle,
  income?: number,
): ResearchOption[] => {
  const p = state.players[player];
  if (!p) return [];
  const known = new Set(p.techs);
  const slot = p.research[tree];
  const out: ResearchOption[] = [];
  for (const t of content.techs) {
    // Unfinished nodes of earlier ages stay researchable at their original cost (otherwise a
    // skipped ancient node like Trade locks merchants out forever). They never count toward
    // the new age's tree-completion meter bonus or the techsResearched milestone, which both
    // count current-age nodes only.
    if (t.tree !== tree || AGE_INDEX[t.age] > AGE_INDEX[state.age] || known.has(t.id)) continue;
    if (!t.requires.every((r) => known.has(r))) continue;
    const perTurn = income ?? (tree === 'tech' ? p.income.science : p.income.culture);
    const left = Math.max(0, t.cost - (slot.current === t.id ? slot.progress : 0));
    out.push({ id: t.id, cost: t.cost, turns: perTurn > 0 ? Math.ceil(left / perTurn) : null });
  }
  return out;
};

export const setResearch = (ctx: SimCtx, player: PlayerId, tree: Tree, id: string): string | null => {
  const p = ctx.state.players[player];
  if (!p) return 'That player is not in this game.';
  if (!researchOptionsFor(ctx.state, player, tree, ctx.content).some((o) => o.id === id)) return 'That cannot be researched yet.';
  // Progress is a single counter per tree; switching keeps it (simplification).
  p.research[tree].current = id;
  return null;
};

/** Add one turn of points to a tree and complete the node if paid for. */
export const advanceResearch = (ctx: SimCtx, player: PlayerId, tree: Tree, points: number): void => {
  const { state, content } = ctx;
  const p = state.players[player];
  if (!p) return;
  const slot = p.research[tree];
  slot.progress = Math.round((slot.progress + Math.max(0, points)) * 100) / 100;
  if (slot.current === null) return;
  const node = content.techs.find((t) => t.id === slot.current);
  if (!node || p.techs.includes(node.id)) {
    slot.current = null;
    return;
  }
  if (slot.progress < node.cost) return;
  slot.progress = Math.round((slot.progress - node.cost) * 100) / 100;
  slot.current = null;
  p.techs.push(node.id);
  ctx.events.push({ type: 'researchCompleted', player, tree, id: node.id });
  // GDD §5: +4 age meter when a whole tree of the current age is done (fires once: the last node).
  const treeNodes = content.techs.filter((t) => t.tree === tree && t.age === state.age);
  if (node.age === state.age && treeNodes.every((t) => p.techs.includes(t.id))) addAgeProgress(ctx, TREE_COMPLETE_AGE_PROGRESS);
};

/**
 * Governments of the current (or, during a transition, the next) age. GDD §7: "Civics unlock
 * governments" — a government named by some tree node's `unlock government` effect needs one
 * of those nodes researched; governments no node unlocks are open from the start of their age.
 */
export const governmentOptionsFor = (state: GameState, player: PlayerId, content: ContentBundle): string[] => {
  const p = state.players[player];
  if (!p) return [];
  const age = ruleAge(state);
  return content.governments
    .filter((g) => g.age === age)
    .filter((g) => {
      const unlockers = governmentUnlockers(content)[g.id];
      return !unlockers || unlockers.some((t) => p.techs.includes(t));
    })
    .map((g) => g.id);
};

const unlockerCache = new WeakMap<ContentBundle, Record<string, string[]>>();
/** government id -> ids of tree nodes whose modifiers unlock it. */
const governmentUnlockers = (content: ContentBundle): Record<string, string[]> => {
  let map = unlockerCache.get(content);
  if (!map) {
    map = {};
    for (const t of content.techs) {
      for (const m of t.modifiers) {
        if (m.effect.kind === 'unlock' && m.effect.what === 'government') (map[m.effect.id] ??= []).push(t.id);
      }
    }
    unlockerCache.set(content, map);
  }
  return map;
};

/** Free when there is no government yet or during the transition; otherwise 2 turns of anarchy (GDD §7). */
export const setGovernment = (ctx: SimCtx, player: PlayerId, government: string): string | null => {
  const { state, content } = ctx;
  const p = state.players[player];
  if (!p) return 'That player is not in this game.';
  if (p.government === government) return 'That is already your government.';
  if (!governmentOptionsFor(state, player, content).includes(government)) return 'That government is not available yet.';
  const free = p.government === null || state.phase === 'transition';
  p.government = government;
  p.anarchyTurns = free ? 0 : ANARCHY_TURNS;
  syncCabinet(ctx, player);
  return null;
};
