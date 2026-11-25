/** The shared age meter (GDD §5 "Age meter"). */
import type { SimCtx } from '../ctx';
import { AGE_METER_MAX, METER_PER_TURN, METER_PRECISION, METER_REFERENCE_PLAYERS } from './constants';
import { livingPlayers } from './util';

const round = (v: number): number => Math.round(v * METER_PRECISION) / METER_PRECISION;

const bump = (ctx: SimCtx, amount: number): void => {
  const { state } = ctx;
  if (state.phase !== 'playing') return;
  const next = round(Math.min(AGE_METER_MAX, Math.max(0, state.ageProgress + amount)));
  if (next === state.ageProgress) return;
  state.ageProgress = next;
  ctx.events.push({ type: 'ageProgress', value: next });
};

/**
 * Add to the meter from a player's achievement (milestone, wonder, figure, tree), clamped
 * 0–100; only while playing. Emits `ageProgress` when it moves. Two scales (autoplay tuning,
 * GDD §5 "~35 / ~50 / ~75 turns per age"):
 * - game speed, like the per-turn tick, so Quick and Epic ages keep their proportions;
 * - with more living players than METER_REFERENCE_PLAYERS the gain shrinks proportionally,
 *   so a 5- or 7-player game does not burn through ages faster than the 3-player default.
 */
export const addAgeProgress = (ctx: SimCtx, amount: number): void => {
  const living = livingPlayers(ctx.state).length;
  const players = living > METER_REFERENCE_PLAYERS ? METER_REFERENCE_PLAYERS / living : 1;
  const speed = METER_PER_TURN[ctx.state.speed] / METER_PER_TURN.standard;
  bump(ctx, amount * players * speed);
};

/** The world phase's per-turn tick, scaled by game speed (never by player count). */
export const tickAgeMeter = (ctx: SimCtx): void => bump(ctx, METER_PER_TURN[ctx.state.speed]);
