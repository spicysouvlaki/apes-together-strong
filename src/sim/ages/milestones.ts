/** Legacy milestones (GDD §8 table): award tiers as stats cross thresholds. */
import type { ContentBundle, LegacyMilestone } from '@contracts/content-schemas';
import type { GameState, MilestoneProgress, PlayerId } from '@contracts/sim-api';
import type { SimCtx } from '../ctx';
import { statValue } from '../stats';
import { LEGACY_POINTS_PER_TIER, METER_PER_MILESTONE } from './constants';
import { addAgeProgress } from './meter';
import { score } from './score';

export const milestoneKey = (id: string, tier: number): string => `${id}:${tier}`;

/**
 * Value of a milestone's measure. Rule: legacy milestones are per-age achievements (GDD §8
 * is a per-age table), so counters that would otherwise carry over from earlier ages are
 * scoped to the current age here: battles won (`stats.battlesWonThisAge`) and figures
 * activated this age (every figure retires at a transition, so an activated figure recruited
 * this age was activated this age). Everything else uses
 * `statValue` unchanged — deeds keep lifetime counters, which suits once-per-world story beats.
 */
export const milestoneValue = (state: GameState, player: PlayerId, m: LegacyMilestone, content: ContentBundle): number => {
  const p = state.players[player];
  if (!p) return 0;
  switch (m.measure) {
    case 'battlesWon':
      return p.stats.battlesWonThisAge;
    case 'figuresActivated': {
      let n = 0;
      for (const id of Object.keys(state.figures)) {
        const f = state.figures[id];
        if (f && f.owner === player && f.activated && f.recruitedAge === state.age) n++;
      }
      return n;
    }
    default:
      return statValue(state, player, m.measure, m.param, content);
  }
};

/** Tiers (1–3) of `id` the player holds. */
const achievedTiers = (milestones: readonly string[], id: string): number => {
  let n = 0;
  for (let tier = 1; tier <= 3; tier++) if (milestones.includes(milestoneKey(id, tier))) n++;
  return n;
};

/** Legacy points a milestone entry `${id}:${tier}` is worth. */
export const legacyPointsFor = (entry: string): number => {
  const tier = Number(entry.slice(entry.lastIndexOf(':') + 1));
  return LEGACY_POINTS_PER_TIER[tier - 1] ?? 0;
};

export const updateMilestones = (ctx: SimCtx, player: PlayerId): void => {
  const { state, content } = ctx;
  const p = state.players[player];
  if (!p || !p.alive) return;
  if (state.phase === 'playing') {
    for (const m of content.legacy) {
      if (m.age !== state.age) continue;
      const value = milestoneValue(state, player, m, content);
      for (let tier = 1; tier <= 3; tier++) {
        const key = milestoneKey(m.id, tier);
        const threshold = m.thresholds[tier - 1] as number;
        if (value < threshold || p.milestones.includes(key)) continue;
        p.milestones.push(key);
        p.legacyPoints += LEGACY_POINTS_PER_TIER[tier - 1] ?? 0;
        ctx.events.push({ type: 'milestoneReached', player, milestone: key, track: m.track });
        addAgeProgress(ctx, METER_PER_MILESTONE);
      }
    }
  }
  p.score = score(state, player, content);
};

/** Progress rows for the current age's milestones. `{n}` shows the next threshold to reach. */
export const milestones = (state: GameState, player: PlayerId, content: ContentBundle): MilestoneProgress[] => {
  const p = state.players[player];
  if (!p) return [];
  const out: MilestoneProgress[] = [];
  for (const m of content.legacy) {
    if (m.age !== state.age) continue;
    const achieved = achievedTiers(p.milestones, m.id);
    const shown = m.thresholds[Math.min(achieved, 2)] as number;
    out.push({
      id: m.id,
      track: m.track,
      description: m.description.replace('{n}', String(shown)),
      value: milestoneValue(state, player, m, content),
      thresholds: [m.thresholds[0], m.thresholds[1], m.thresholds[2]],
      achieved,
    });
  }
  return out;
};

/** Milestone entries the player reached during `age` (for the transition recap). */
export const milestonesOfAge = (playerMilestones: readonly string[], age: string, content: ContentBundle): string[] => {
  const ids = new Set(content.legacy.filter((m) => m.age === age).map((m) => m.id));
  return playerMilestones.filter((e) => ids.has(e.slice(0, e.lastIndexOf(':'))));
};
