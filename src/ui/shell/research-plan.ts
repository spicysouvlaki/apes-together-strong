/**
 * The research plan (wave 13 playtest: about 30 research picks a game, each two taps and an idle
 * prompt). The player marks up to PLAN_MAX next nodes per tree; when a tree goes idle at the start
 * of their turn, the first planned node the sim offers (`researchOptions`) is sent with
 * `setResearch` and a toast says so. UI-only, like standing orders: kept in localStorage per game
 * seed, never in GameState. The pure parts are tested in tests/ui-wave13.test.ts.
 */
import { effect, signal } from '@preact/signals';
import type { GameState, PlayerId } from '@contracts/sim-api';
import { content, dispatch, game, lookup, me, pushToast, q } from '../store';

export type Tree = 'tech' | 'civic';
export interface ResearchPlan {
  tech: string[];
  civic: string[];
}

/** Up to this many planned nodes per tree. */
export const PLAN_MAX = 3;
export const EMPTY_PLAN: ResearchPlan = { tech: [], civic: [] };
const KEY = 'apes.research-plan.v1';
const STORED_GAMES_MAX = 8;

/** Add `id` to the end of a tree's plan, or remove it when already planned. Full plans are unchanged. */
export const togglePlanned = (plan: ResearchPlan, tree: Tree, id: string): ResearchPlan => {
  const list = plan[tree];
  if (list.includes(id)) return { ...plan, [tree]: list.filter((x) => x !== id) };
  if (list.length >= PLAN_MAX) return plan;
  return { ...plan, [tree]: [...list, id] };
};

/** Drop nodes already researched (or being researched) from a plan; same object when nothing changed. */
export const prunePlan = (plan: ResearchPlan, done: readonly string[], current: Record<Tree, string | null>): ResearchPlan => {
  const keep = (tree: Tree) => plan[tree].filter((id) => !done.includes(id) && current[tree] !== id);
  const tech = keep('tech');
  const civic = keep('civic');
  return tech.length === plan.tech.length && civic.length === plan.civic.length ? plan : { tech, civic };
};

/** The first planned node the sim offers now, or null (a locked one waits its turn). */
export const nextPlanned = (planned: readonly string[], options: readonly { id: string }[]): string | null =>
  planned.find((id) => options.some((o) => o.id === id)) ?? null;

/** Picks to send at turn start: one per idle tree with an offered planned node. */
export const planPicks = (
  plan: ResearchPlan,
  idle: Record<Tree, boolean>,
  options: Record<Tree, readonly { id: string }[]>,
): { tree: Tree; id: string }[] =>
  (['tech', 'civic'] as const).flatMap((tree) => {
    if (!idle[tree]) return [];
    const id = nextPlanned(plan[tree], options[tree]);
    return id ? [{ tree, id }] : [];
  });

/** "Now researching Bronze Working" / "Now adopting Code of Laws (planned)". */
export const nowLine = (tree: Tree, name: string): string => `${tree === 'tech' ? 'Now researching' : 'Now studying'} ${name}, as planned.`;

// --- Storage -------------------------------------------------------------------------------------

const parseList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, PLAN_MAX) : []);

export const parsePlan = (v: unknown): ResearchPlan => {
  if (!v || typeof v !== 'object') return { tech: [], civic: [] };
  const o = v as Partial<Record<Tree, unknown>>;
  return { tech: parseList(o.tech), civic: parseList(o.civic) };
};

export const readStoredPlan = (raw: unknown, seed: number): ResearchPlan => {
  const games = raw && typeof raw === 'object' ? (raw as { games?: unknown }).games : null;
  if (!games || typeof games !== 'object') return { tech: [], civic: [] };
  return parsePlan((games as Record<string, unknown>)[`s${seed}`]);
};

/** The store with `seed`'s plan replaced (moved to the newest place; old games trimmed). */
export const storePlan = (raw: unknown, seed: number, plan: ResearchPlan): { games: Record<string, ResearchPlan> } => {
  const prev = raw && typeof raw === 'object' ? (raw as { games?: unknown }).games : null;
  const games: Record<string, ResearchPlan> = {};
  if (prev && typeof prev === 'object') for (const [k, v] of Object.entries(prev as Record<string, unknown>)) if (k !== `s${seed}`) games[k] = parsePlan(v);
  games[`s${seed}`] = { tech: [...plan.tech], civic: [...plan.civic] };
  const keys = Object.keys(games);
  for (const k of keys.slice(0, Math.max(0, keys.length - STORED_GAMES_MAX))) delete games[k];
  return { games };
};

// --- Signals and the runner --------------------------------------------------------------------

export const researchPlan = signal<ResearchPlan>(EMPTY_PLAN);

export const togglePlan = (tree: Tree, id: string): void => {
  researchPlan.value = togglePlanned(researchPlan.value, tree, id);
};

/**
 * Called by app-wiring at the start of the player's turn: start the next planned node in each idle
 * tree. Returns how many commands were sent (a snapshot follows each).
 */
export const runResearchPlan = (state: GameState, my: PlayerId): number => {
  const p = state.players[my];
  if (!p) return 0;
  const plan = prunePlan(researchPlan.peek(), p.techs, { tech: p.research.tech.current, civic: p.research.civic.current });
  const picks = planPicks(
    plan,
    { tech: p.research.tech.current === null, civic: p.research.civic.current === null },
    { tech: q.researchOptions(state, my, 'tech', content), civic: q.researchOptions(state, my, 'civic', content) },
  );
  let next = plan;
  for (const pick of picks) {
    dispatch({ type: 'setResearch', tree: pick.tree, id: pick.id });
    next = { ...next, [pick.tree]: next[pick.tree].filter((x) => x !== pick.id) };
    pushToast(nowLine(pick.tree, lookup.techs[pick.id]?.name ?? pick.id), 'good', { kind: 'tree', tree: pick.tree });
  }
  if (next !== researchPlan.peek()) researchPlan.value = next;
  return picks.length;
};

let started = false;
/** Load the plan for the current game, keep it pruned and saved. Called once from initApp. */
export const initResearchPlan = (): void => {
  if (started) return;
  started = true;
  let seed: number | null = null;
  effect(() => {
    const g = game.value;
    const my = me.value;
    if (!g || !my) {
      seed = null;
      return;
    }
    const p = g.players[my];
    if (g.seed !== seed) {
      seed = g.seed;
      let stored: ResearchPlan = EMPTY_PLAN;
      try {
        const raw = localStorage.getItem(KEY);
        stored = readStoredPlan(raw ? JSON.parse(raw) : null, g.seed);
      } catch {
        // Storage blocked: the plan lasts for this session.
      }
      researchPlan.value = stored;
    }
    if (p) {
      const pruned = prunePlan(researchPlan.peek(), p.techs, { tech: p.research.tech.current, civic: p.research.civic.current });
      if (pruned !== researchPlan.peek()) researchPlan.value = pruned;
    }
  });
  effect(() => {
    const plan = researchPlan.value;
    if (seed === null) return;
    try {
      const raw = localStorage.getItem(KEY);
      localStorage.setItem(KEY, JSON.stringify(storePlan(raw ? JSON.parse(raw) : null, seed, plan)));
    } catch {
      // Storage blocked.
    }
  });
};
