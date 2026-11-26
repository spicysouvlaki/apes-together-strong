/**
 * The guide's memory and the tip on screen (selection: advice.ts). Progress is kept per game
 * seed in localStorage, so a reload or a load of the same game does not repeat tips; "Skip the
 * guide" and "Replay the guide" live in Settings.
 */
import { computed, effect, signal } from '@preact/signals';
import { content, game, me, q, route, selection } from '../store';
import { STEP_IDS, goalsMet, hasGoal, isPaced, nextAdvice, type Advice, type GuideTarget } from './advice';
import { orders } from './standing-orders';

const KEY = 'apes.guide.v1';
/** Games remembered (oldest dropped). */
const MAX_GAMES = 8;

interface GameMemory {
  seen: string[];
  lastTipTurn: number;
}
export interface GuideStore {
  disabled: boolean;
  games: Record<string, GameMemory>;
}

/** Coerce stored JSON into a GuideStore; unknown tip ids are dropped. */
export const parseGuideStore = (raw: unknown): GuideStore => {
  const out: GuideStore = { disabled: false, games: {} };
  if (!raw || typeof raw !== 'object') return out;
  const v = raw as Partial<GuideStore>;
  out.disabled = v.disabled === true;
  if (v.games && typeof v.games === 'object') {
    const entries = Object.entries(v.games as Record<string, Partial<GameMemory>>).slice(-MAX_GAMES);
    for (const [seed, m] of entries) {
      if (!m || typeof m !== 'object' || !seed.startsWith('s')) continue;
      const seen = Array.isArray(m.seen) ? m.seen.filter((x): x is string => typeof x === 'string' && STEP_IDS.includes(x)) : [];
      const lastTipTurn = typeof m.lastTipTurn === 'number' && Number.isFinite(m.lastTipTurn) ? m.lastTipTurn : -1;
      out.games[seed] = { seen, lastTipTurn };
    }
  }
  return out;
};

const load = (): GuideStore => {
  try {
    const raw = localStorage.getItem(KEY);
    return parseGuideStore(raw ? JSON.parse(raw) : null);
  } catch {
    return parseGuideStore(null);
  }
};

export const guide = signal<GuideStore>(load());

const save = (s: GuideStore): void => {
  guide.value = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: progress lasts for this session.
  }
};

const memoryOf = (seed: number | undefined): GameMemory => (seed === undefined ? undefined : guide.value.games[`s${seed}`]) ?? { seen: [], lastTipTurn: -1 };

const patchMemory = (seed: number, patch: Partial<GameMemory>): void => {
  const s = guide.peek();
  const games = { ...s.games };
  delete games[`s${seed}`]; // re-insert last so the most recent game survives trimming
  games[`s${seed}`] = { ...memoryOf(seed), ...patch };
  save({ ...s, games });
};

/** The tip currently held on screen (keeps its place on a paced turn). */
const currentId = signal<string | null>(null);

export const advice = computed<Advice | null>(() => {
  const g = game.value;
  const my = me.value;
  if (!g || !my || route.value !== 'game' || guide.value.disabled) return null;
  const mem = memoryOf(g.seed);
  const sel = selection.value.unit;
  const u = sel ? g.units[sel] : undefined;
  return nextAdvice(
    g,
    my,
    { seen: mem.seen, lastTipTurn: mem.lastTipTurn, current: currentId.value },
    { selectedUnitType: u && u.owner === my ? u.type : null, ordered: Object.keys(orders.value) },
    content,
    q,
  );
});

/** The control the current tip points at (pulses). */
export const guideTarget = computed<GuideTarget | null>(() => advice.value?.target ?? null);

/** ` guide-pulse` when `target` is what the current tip points at. */
export const guideClass = (target: GuideTarget, also?: GuideTarget | null): string => {
  const t = guideTarget.value;
  return t && (t === target || (also !== undefined && also !== null && t === also)) ? ' guide-pulse' : '';
};

export const markSeen = (id: string): void => {
  const g = game.peek();
  if (!g) return;
  const mem = memoryOf(g.seed);
  if (mem.seen.includes(id)) return;
  patchMemory(g.seed, { seen: [...mem.seen, id] });
};

export const dismissAdvice = (): void => {
  const a = advice.peek();
  if (a) markSeen(a.id);
};

export const skipGuide = (): void => save({ ...guide.peek(), disabled: true });

/** Turn the guide back on and forget this game's progress. */
export const replayGuide = (): void => {
  const s = guide.peek();
  const g = game.peek();
  const games = { ...s.games };
  if (g) delete games[`s${g.seed}`];
  save({ disabled: false, games });
  currentId.value = null;
};

let started = false;
/**
 * A tip counts as seen once it was on screen and then its situation passed, another tip took
 * its place, or its turn ended. Paced tips stamp the turn they first appeared.
 */
export const initGuide = (): void => {
  if (started) return;
  started = true;
  let shown: { id: string; seed: number; turn: number } | null = null;
  effect(() => {
    const a = advice.value;
    const g = game.value;
    if (!g) {
      shown = null;
      return;
    }
    if (shown && (shown.seed !== g.seed || shown.id !== a?.id || shown.turn !== g.turn)) {
      if (shown.seed === g.seed && !hasGoal(shown.id)) markSeen(shown.id);
      shown = null;
    }
    const my = me.value;
    if (my) {
      const seen = memoryOf(g.seed).seen;
      for (const id of goalsMet(g, my, { selectedUnitType: null, ordered: [] }, content, q)) if (!seen.includes(id)) markSeen(id);
    }
    // Hold the tip in place before stamping the pacing turn, or the stamp would pace it away.
    currentId.value = a?.id ?? null;
    if (a && !shown) {
      shown = { id: a.id, seed: g.seed, turn: g.turn };
      if (isPaced(a.id) && memoryOf(g.seed).lastTipTurn < g.turn) patchMemory(g.seed, { lastTipTurn: g.turn });
    }
  });
};
