/**
 * Age end, transition and game end (GDD §5 "Transition", §6, §8).
 *
 * RP carry-over: GDD §6 counts "50% of unspent RP" among RP earned at a transition. Because
 * consumed figures add their value to `refinementPoints` as soon as they are consumed (and must
 * not be halved), the halving is applied when a transition CLOSES: whatever a player leaves
 * unspent is halved then, and arrives at the next transition alongside consumed values.
 */
import type { Age } from '@contracts/content-schemas';
import type { PlayerId, TransitionRecap } from '@contracts/sim-api';
import { onAgeStarted, retireFigures, syncCabinet } from '../../emergence';
import type { SimCtx } from '../ctx';
import {
  CATCH_UP_RP,
  RP_CARRY_FRACTION,
  RP_MILESTONE_CAP,
  RP_PER_MILESTONE,
  RP_PER_RETIRED_FIGURE,
} from './constants';
import { legacyPointsFor, milestonesOfAge } from './milestones';
import { nameOptions, setCivName } from './naming';
import { score } from './score';
import { addChronicle, ageName, livingPlayers, nextAge } from './util';

const median = (values: readonly number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/** RP earned at a transition, excluding carried points (see file comment). */
export const transitionRp = (milestoneCount: number, retiredCount: number, belowMedian: boolean): number =>
  Math.min(RP_MILESTONE_CAP, RP_PER_MILESTONE * milestoneCount) +
  RP_PER_RETIRED_FIGURE * retiredCount +
  (belowMedian ? CATCH_UP_RP : 0);

/** Meter hit 100 in a non-final age: recap, retire figures, open the refinement screen. */
export const beginTransition = (ctx: SimCtx): void => {
  const { state, content } = ctx;
  const to = nextAge(state.age);
  if (!to) return;
  const from = state.age;
  state.crisis = null;
  const living = livingPlayers(state);
  for (const p of Object.values(state.players)) {
    p.crisisChoices = [];
    p.effects = p.effects.filter((e) => e.untilTurn !== -1);
  }
  // Scores before figures retire (seated figures still count), for the catch-up test.
  for (const p of living) p.score = score(state, p.id, content);
  const med = median(living.map((p) => p.score));

  const recap: Record<PlayerId, TransitionRecap> = {};
  for (const p of living) {
    const reached = milestonesOfAge(p.milestones, from, content);
    const retired = retireFigures(ctx, p.id);
    const rpEarned = transitionRp(reached.length, retired.length, p.score < med);
    p.refinementPoints += rpEarned;
    recap[p.id] = {
      legacyPointsEarned: reached.reduce((sum, e) => sum + legacyPointsFor(e), 0),
      rpEarned,
      milestones: reached,
      retiredFigures: retired,
      nameOptions: nameOptions(state, p.id, content),
      signaturesBought: 0,
      hybridsBought: 0,
      done: false,
    };
    p.score = score(state, p.id, content);
    addChronicle(state, p.id, 'age', from, `The ${ageName(from)} age ended.`);
  }
  state.phase = 'transition';
  state.transition = { fromAge: from, toAge: to, recap };
  ctx.events.push({ type: 'transitionStarted', from, to });
};

/**
 * Meter hit 100 in the final age — or the game ended early (no human left alive, or one
 * civilization standing; see sim/combat `checkGameOver`): highest score among the living wins,
 * ties to the earlier player in turn order.
 */
export const endGame = (ctx: SimCtx, why?: string): void => {
  const { state, content } = ctx;
  state.crisis = null;
  const scores: Record<string, number> = {};
  for (const id of state.playerOrder) {
    const p = state.players[id];
    if (!p) continue;
    p.score = score(state, id, content);
    scores[id] = p.score;
  }
  let winner: string | null = null;
  for (const p of livingPlayers(state)) {
    if (winner === null || p.score > (scores[winner] ?? 0)) winner = p.id;
  }
  winner ??= state.playerOrder[0] ?? '';
  const age = ageName(state.age);
  state.phase = 'ended';
  state.result = { winner, scores, reason: why ?? `Highest legacy score when the ${age} age ended` };
  ctx.events.push({ type: 'gameEnded', winner });
  const ranked = [...state.playerOrder].filter((id) => scores[id] !== undefined);
  for (const id of state.playerOrder) {
    const p = state.players[id];
    if (!p) continue;
    const rank = ranked.filter((o) => (scores[o] ?? 0) > (scores[id] ?? 0)).length + 1;
    const name = p.civName ?? 'This people';
    const who = name.charAt(0).toUpperCase() + name.slice(1);
    addChronicle(
      state,
      id,
      'age',
      state.age,
      `${why ? `${why}.` : `The ${age} age closed and the chronicle ended.`} ${who} finished with a legacy score of ${p.score} (rank ${rank} of ${ranked.length}).`,
    );
  }
};

export const finishTransition = (ctx: SimCtx, player: PlayerId): string | null => {
  const { state, content } = ctx;
  const t = state.transition;
  const recap = t?.recap[player];
  if (state.phase !== 'transition' || !t || !recap) return 'There is no age transition under way.';
  if (recap.done) return 'You have already finished this transition.';
  const p = state.players[player];
  if (!p) return 'That player is not in this game.';

  if (!p.civName) {
    const name = recap.nameOptions[0];
    if (name) setCivName(ctx, player, name);
  }
  const gov = content.governments.find((g) => g.id === p.government);
  if (!gov || gov.age !== t.toAge) {
    const first = content.governments.find((g) => g.age === t.toAge);
    if (first) {
      p.government = first.id;
      p.anarchyTurns = 0;
      syncCabinet(ctx, player);
    }
  }
  recap.done = true;

  const living = livingPlayers(state);
  if (!living.every((lp) => t.recap[lp.id]?.done ?? true)) return null;
  startAge(ctx, t.toAge);
  return null;
};

/** Every living player finished refining: soft-reset per-age player state and resume play. */
const startAge = (ctx: SimCtx, age: Age): void => {
  const { state } = ctx;
  state.age = age;
  state.ageProgress = 0;
  state.transition = null;
  state.phase = 'playing';
  const living = livingPlayers(state);
  for (const p of living) {
    p.research = { tech: { current: null, progress: 0 }, civic: { current: null, progress: 0 } };
    p.stats.battlesWonThisAge = 0;
    p.refinementPoints = Math.floor(p.refinementPoints * RP_CARRY_FRACTION);
    onAgeStarted(ctx, p.id);
    addChronicle(state, p.id, 'age', age, `The ${ageName(age)} age began.`);
  }
  state.currentPlayer = living[0]?.id ?? state.currentPlayer;
  ctx.events.push({ type: 'ageStarted', age });
};
