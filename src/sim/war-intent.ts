/**
 * War warnings, objectives and peace terms (GDD §7 "Diplomacy", §9 "operational: war goals";
 * wave 13 playtest: "the Navigator declared war at T46 and T81 with zero visible warning", and
 * "wars resolve themselves: the AI picks at an unguarded town and sues for peace ~10 turns
 * later; nothing I decided mattered").
 *
 * - Warning: an AI's `declareWar` on a human first becomes a threat (`warIntent`): the AI
 *   names the city it wants in its own voice and says how to answer (guard it, or pay), and
 *   only a `declareWar` sent WAR_WARNING_TURNS later starts the war. Before then the AI may
 *   stand down (`makePeace` with no war: it reconsidered), the human may buy the threat off
 *   (`makePeace` with no war: tribute in influence), and an intent nobody acts on lapses.
 * - Objective: the threatened city becomes the war's announced goal (`warGoal`); the AI
 *   commits its army to it (src/ai/war.ts `committedWarTarget`).
 * - Peace terms: when peace is made, the side clearly behind in the war (captures and units
 *   lost since it began) pays the other gold.
 *
 * All memory is modifier-free `TimedEffect` markers on the players (plain JSON; old saves
 * simply have none).
 */
import type { ContentBundle } from '@contracts/content-schemas';
import { hexDistance } from '@contracts/hex';
import type { GameState, PlayerId, Settlement, SettlementId } from '@contracts/sim-api';
import {
  PEACE_SCORE_PER_CAPTURE,
  PEACE_TERMS_MIN_MARGIN,
  PEACE_TRIBUTE_BASE,
  PEACE_TRIBUTE_MAX,
  PEACE_TRIBUTE_MAX_SHARE,
  PEACE_TRIBUTE_PER_POINT,
  STOOD_DOWN_SOURCE,
  STOOD_DOWN_TURNS,
  WAR_GOAL_SOURCE,
  WAR_INTENT_GRACE_TURNS,
  WAR_INTENT_SOURCE,
  WAR_TALLY_SOURCE,
  WAR_TRIBUTE_INFLUENCE,
  WAR_WARNING_TURNS,
} from './constants';
import type { SimCtx } from './ctx';
import { tileAt } from './lookup';
import { speak } from './voice';

/** Lasts the whole game (the age-end sweep only drops effects with untilTurn −1). */
const FOREVER = Number.MAX_SAFE_INTEGER;

export interface WarIntent {
  /** The AI that threatened. */
  by: PlayerId;
  /** The threatened player. */
  target: PlayerId;
  /** The city it named. */
  objective: SettlementId;
  /** First turn on which the AI may declare. */
  due: number;
}

const isAi = (state: GameState, id: PlayerId): boolean => state.players[id]?.alive === true && state.players[id]?.isHuman === false;
const isHuman = (state: GameState, id: PlayerId): boolean => state.players[id]?.alive === true && state.players[id]?.isHuman === true;

/** Turns between a warning and the war (by difficulty). */
export const warningTurns = (state: GameState): number => WAR_WARNING_TURNS[state.difficulty] ?? WAR_WARNING_TURNS.normal;

const parseIntent = (by: PlayerId, source: string): WarIntent | null => {
  if (!source.startsWith(WAR_INTENT_SOURCE)) return null;
  const [target, objective, due] = source.slice(WAR_INTENT_SOURCE.length).split(':');
  const d = Number(due);
  if (!target || !objective || !Number.isFinite(d)) return null;
  return { by, target, objective, due: d };
};

/** Open threats made by `ai` (normally at most one). */
export const warIntentsBy = (state: GameState, ai: PlayerId): WarIntent[] => {
  const out: WarIntent[] = [];
  for (const e of state.players[ai]?.effects ?? []) {
    const i = parseIntent(ai, e.source);
    if (i) out.push(i);
  }
  return out;
};

export const warIntentOf = (state: GameState, ai: PlayerId, target: PlayerId): WarIntent | null =>
  warIntentsBy(state, ai).find((i) => i.target === target) ?? null;

/**
 * Every open threat against `player`, soonest first. Public: the threatened player was told.
 * The UI reads this to show "war in N turns over <city>" and the tribute button.
 */
export const threatsAgainst = (state: GameState, player: PlayerId): WarIntent[] => {
  const out: WarIntent[] = [];
  for (const id of state.playerOrder) for (const i of warIntentsBy(state, id)) if (i.target === player) out.push(i);
  return out.sort((a, b) => a.due - b.due || (a.by < b.by ? -1 : 1));
};

/** The announced objective of `player`'s war on `enemy`, if any (and still standing). */
export const warGoalOf = (state: GameState, player: PlayerId, enemy: PlayerId): SettlementId | null => {
  const prefix = `${WAR_GOAL_SOURCE}${enemy}:`;
  const e = state.players[player]?.effects.find((x) => x.source.startsWith(prefix));
  return e ? e.source.slice(prefix.length) : null;
};

/** True while `ai` has promised to leave `target` alone (stood down or paid off). */
export const stoodDownFrom = (state: GameState, ai: PlayerId, target: PlayerId): boolean =>
  state.players[ai]?.effects.some((e) => e.source === STOOD_DOWN_SOURCE + target && e.untilTurn >= state.turn) === true;

/**
 * The city an AI names when it threatens `target`: the target's settlement closest to the
 * AI's own (on a landmass the AI holds a settlement on, when there is one), preferring towns
 * to the capital. Public information only; src/ai/war.ts targets the same city.
 */
export const warObjectiveFor = (state: GameState, ai: PlayerId, target: PlayerId): Settlement | null => {
  const own: Settlement[] = [];
  const theirs: Settlement[] = [];
  for (const id of Object.keys(state.settlements).sort()) {
    const s = state.settlements[id];
    if (s?.owner === ai) own.push(s);
    else if (s?.owner === target) theirs.push(s);
  }
  if (own.length === 0 || theirs.length === 0) return null;
  const continents = new Set(own.map((s) => tileAt(state.map, s.at)?.continent ?? -1));
  const sameLand = theirs.filter((s) => continents.has(tileAt(state.map, s.at)?.continent ?? -1));
  let best: Settlement | null = null;
  let bestScore = Infinity;
  for (const s of sameLand.length > 0 ? sameLand : theirs) {
    let d = Infinity;
    for (const o of own) d = Math.min(d, hexDistance(o.at, s.at));
    const score = d + (s.isCapital ? 3 : 0) - (s.kind === 'town' ? 1 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
};

const removeSources = (state: GameState, player: PlayerId, keep: (source: string) => boolean): void => {
  const p = state.players[player];
  if (p) p.effects = p.effects.filter((e) => keep(e.source));
};

const cityName = (state: GameState, sid: SettlementId): string | undefined => state.settlements[sid]?.name;

/**
 * An AI's `declareWar` on a human, with no threat yet: warn instead (returns true). Returns
 * false when the declaration should go ahead (a threat that is due; or this is not an AI
 * declaring on a human).
 */
export const warnInsteadOfWar = (ctx: SimCtx, ai: PlayerId, target: PlayerId): boolean => {
  const { state } = ctx;
  if (!isAi(state, ai) || !isHuman(state, target)) return false;
  const open = warIntentOf(state, ai, target);
  if (open) return state.turn < open.due;
  const objective = warObjectiveFor(state, ai, target);
  if (!objective) return false;
  const turns = warningTurns(state);
  const due = state.turn + turns;
  state.players[ai]?.effects.push({
    source: `${WAR_INTENT_SOURCE}${target}:${objective.id}:${due}`,
    untilTurn: due + WAR_INTENT_GRACE_TURNS,
    modifiers: [],
  });
  // The notice names the objective (`settlement`) and the turns left (`amount`).
  speak(ctx, ai, target, 'warWarning', { c: objective.name }, { settlement: objective.id, amount: turns });
  return true;
};

/** Error text for a `declareWar` that only re-sent an open threat (the AI is told to wait). */
export const threatPendingError = (state: GameState, ai: PlayerId, target: PlayerId): string | null => {
  const open = warIntentOf(state, ai, target);
  if (!open || state.turn >= open.due) return null;
  return `You have warned them; war may be declared from turn ${open.due}.`;
};

/** The war began: the threat becomes the war's announced goal; both sides note their counters. */
export const onWarDeclared = (state: GameState, by: PlayerId, on: PlayerId): void => {
  const intent = warIntentOf(state, by, on);
  removeSources(state, by, (s) => !s.startsWith(`${WAR_INTENT_SOURCE}${on}:`) && !s.startsWith(`${WAR_GOAL_SOURCE}${on}:`));
  if (intent && state.settlements[intent.objective]?.owner === on) {
    state.players[by]?.effects.push({ source: `${WAR_GOAL_SOURCE}${on}:${intent.objective}`, untilTurn: FOREVER, modifiers: [] });
  }
  for (const [a, b] of [
    [by, on],
    [on, by],
  ] as const) {
    const p = state.players[a];
    if (!p) continue;
    p.effects = p.effects.filter((e) => !e.source.startsWith(`${WAR_TALLY_SOURCE}${b}:`));
    p.effects.push({ source: `${WAR_TALLY_SOURCE}${b}:${p.stats.battlesWon}:${p.stats.unitsLost}`, untilTurn: FOREVER, modifiers: [] });
  }
};

/**
 * The threat is withdrawn. `how`: 'standDown' — the AI reconsidered (or the threat lapsed);
 * 'appeased' — the threatened player paid tribute. Either way no new threat for STOOD_DOWN_TURNS.
 */
export const withdrawThreat = (ctx: SimCtx, ai: PlayerId, target: PlayerId, how: 'standDown' | 'appeased'): void => {
  const { state } = ctx;
  const intent = warIntentOf(state, ai, target);
  if (!intent) return;
  removeSources(state, ai, (s) => !s.startsWith(`${WAR_INTENT_SOURCE}${target}:`) && s !== STOOD_DOWN_SOURCE + target);
  state.players[ai]?.effects.push({ source: STOOD_DOWN_SOURCE + target, untilTurn: state.turn + STOOD_DOWN_TURNS, modifiers: [] });
  speak(ctx, ai, target, how, { c: cityName(state, intent.objective) ?? 'your city' }, { settlement: intent.objective });
};

/**
 * `makePeace` between two players who are not at war. The threatening AI stands down; the
 * threatened human pays WAR_TRIBUTE_INFLUENCE to buy the threat off. Returns null when it was
 * handled, an error text when it could not be, or undefined when there is no threat at all
 * (the caller then gives its usual "not at war" answer).
 */
export const answerThreat = (ctx: SimCtx, player: PlayerId, other: PlayerId): string | null | undefined => {
  const { state } = ctx;
  if (warIntentOf(state, player, other)) {
    withdrawThreat(ctx, player, other, 'standDown');
    return null;
  }
  if (!warIntentOf(state, other, player)) return undefined;
  const p = state.players[player];
  if (!p) return 'That player is not in this game.';
  if (p.stock.influence < WAR_TRIBUTE_INFLUENCE)
    return `Buying them off costs ${WAR_TRIBUTE_INFLUENCE} influence; you have ${Math.floor(p.stock.influence)}.`;
  p.stock.influence -= WAR_TRIBUTE_INFLUENCE;
  withdrawThreat(ctx, other, player, 'appeased');
  return null;
};

/** Start of `ai`'s turn: threats past their grace lapse with a stand-down line (no silent expiry). */
export const lapseThreats = (ctx: SimCtx, ai: PlayerId): void => {
  const { state } = ctx;
  for (const e of state.players[ai]?.effects.slice() ?? []) {
    const i = parseIntent(ai, e.source);
    if (!i) continue;
    const gone = !state.players[i.target]?.alive;
    if (gone || e.untilTurn < state.turn) withdrawThreat(ctx, ai, i.target, 'standDown');
  }
};

// --- Peace terms -------------------------------------------------------------------------

const tallyOf = (state: GameState, player: PlayerId, enemy: PlayerId): { battlesWon: number; unitsLost: number } | null => {
  const prefix = `${WAR_TALLY_SOURCE}${enemy}:`;
  const e = state.players[player]?.effects.find((x) => x.source.startsWith(prefix));
  if (!e) return null;
  const [won, lost] = e.source.slice(prefix.length).split(':').map(Number);
  return { battlesWon: won ?? 0, unitsLost: lost ?? 0 };
};

/** Settlements `a` took from `b` since turn `since` (read from both chronicles). */
const capturesSince = (state: GameState, a: PlayerId, b: PlayerId, since: number): number => {
  const lost = new Set<string>();
  for (const e of state.players[b]?.chronicle ?? []) if (e.turn >= since && e.kind === 'war' && e.text.endsWith(' was lost.')) lost.add(`${e.turn}|${e.ref}`);
  let n = 0;
  for (const e of state.players[a]?.chronicle ?? []) if (e.turn >= since && e.kind === 'war' && e.text.endsWith(' was taken.') && lost.has(`${e.turn}|${e.ref}`)) n++;
  return n;
};

/**
 * Each side's war score since the war began: PEACE_SCORE_PER_CAPTURE per settlement taken
 * from the other, plus 1 per unit the other lost (counted from the war's start; any foe).
 * Public: both sides saw every battle.
 */
export const warScore = (state: GameState, a: PlayerId, b: PlayerId, began: number): Record<PlayerId, number> => {
  const lostSince = (x: PlayerId, y: PlayerId): number => {
    const t = tallyOf(state, x, y);
    return t ? Math.max(0, (state.players[x]?.stats.unitsLost ?? 0) - t.unitsLost) : 0;
  };
  return {
    [a]: PEACE_SCORE_PER_CAPTURE * capturesSince(state, a, b, began) + lostSince(b, a),
    [b]: PEACE_SCORE_PER_CAPTURE * capturesSince(state, b, a, began) + lostSince(a, b),
  };
};

/** Gold the side behind would pay at peace now (0 when the war is close), and who pays whom. */
export const peaceTerms = (state: GameState, a: PlayerId, b: PlayerId): { payer: PlayerId; payee: PlayerId; gold: number } | null => {
  const began = state.wars[a < b ? `${a}|${b}` : `${b}|${a}`];
  if (began === undefined || !state.players[a] || !state.players[b]) return null;
  const score = warScore(state, a, b, began);
  const margin = (score[a] ?? 0) - (score[b] ?? 0);
  if (Math.abs(margin) < PEACE_TERMS_MIN_MARGIN) return null;
  const payer = margin > 0 ? b : a;
  const payee = margin > 0 ? a : b;
  const purse = Math.max(0, state.players[payer]?.stock.gold ?? 0);
  const gold = Math.floor(Math.min(PEACE_TRIBUTE_BASE + PEACE_TRIBUTE_PER_POINT * Math.abs(margin), PEACE_TRIBUTE_MAX, purse * PEACE_TRIBUTE_MAX_SHARE));
  return gold > 0 ? { payer, payee, gold } : null;
};

/** Peace was made (call before the war entry is deleted): settle the terms, clear the war's memory. */
export const settlePeace = (ctx: SimCtx, a: PlayerId, b: PlayerId, content: ContentBundle): void => {
  const { state } = ctx;
  void content;
  const terms = peaceTerms(state, a, b);
  if (terms) {
    const payer = state.players[terms.payer];
    const payee = state.players[terms.payee];
    if (payer && payee) {
      payer.stock.gold -= terms.gold;
      payee.stock.gold += terms.gold;
      ctx.events.push({
        type: 'notice',
        player: terms.payer,
        kind: 'treasury',
        amount: -terms.gold,
        text: `Peace terms: having lost more of the war, your people paid ${terms.gold} gold to make peace.`,
      });
      ctx.events.push({
        type: 'notice',
        player: terms.payee,
        kind: 'treasury',
        amount: terms.gold,
        text: `Peace terms: having won more of the war, your people received ${terms.gold} gold with the peace.`,
      });
    }
  }
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    removeSources(state, x, (s) => !s.startsWith(`${WAR_GOAL_SOURCE}${y}:`) && !s.startsWith(`${WAR_TALLY_SOURCE}${y}:`));
  }
};
