/** The shared age meter (GDD §5 "Age meter"). */
import type { SimCtx } from '../ctx';
import { AGE_METER_MAX, METER_PER_TURN, METER_PRECISION } from './constants';

const round = (v: number): number => Math.round(v * METER_PRECISION) / METER_PRECISION;

/** Add to the meter, clamped 0–100; only while playing. Emits `ageProgress` when it moves. */
export const addAgeProgress = (ctx: SimCtx, amount: number): void => {
  const { state } = ctx;
  if (state.phase !== 'playing') return;
  const next = round(Math.min(AGE_METER_MAX, Math.max(0, state.ageProgress + amount)));
  if (next === state.ageProgress) return;
  state.ageProgress = next;
  ctx.events.push({ type: 'ageProgress', value: next });
};

/** The world phase's per-turn tick, scaled by game speed. */
export const tickAgeMeter = (ctx: SimCtx): void => addAgeProgress(ctx, METER_PER_TURN[ctx.state.speed]);
