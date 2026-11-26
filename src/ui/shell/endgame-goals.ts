/**
 * What still counts before the Chronicle (wave 11 playtest: turns 98–105 had "nothing to aim
 * for"). In the closing stretch of the final age the HUD names the nearest legacy milestones from
 * SimQueries.milestones ("1 more for a culture milestone: wonders built 1/2"). Pure.
 */
import type { Age } from '@contracts/content-schemas';
import type { MilestoneProgress } from '@contracts/sim-api';

/** From this age-meter value in the final age the goals show (the crisis is under way by then). */
export const ENDGAME_GOALS_FROM = 70;

export interface Goal {
  id: string;
  track: string;
  /** "Wonders built" */
  label: string;
  value: number;
  next: number;
  left: number;
  /** "1 more for a culture milestone (wonders built 1/2)" */
  text: string;
}

/** The milestones closest to their next tier: fewest steps left first, then the smaller share of the way. */
export const nearestGoals = (rows: readonly MilestoneProgress[], max = 2): Goal[] =>
  rows
    .flatMap((m): Goal[] => {
      if (m.achieved >= 3) return [];
      const next = m.thresholds[m.achieved] ?? m.thresholds[2];
      const left = Math.ceil(next - m.value);
      if (left <= 0) return [];
      const label = (m.description.split(':')[0] ?? m.description).trim();
      const lower = label.charAt(0).toLowerCase() + label.slice(1);
      return [{ id: m.id, track: m.track, label, value: m.value, next, left, text: `${left} more for a ${m.track} milestone (${lower} ${Math.floor(m.value)}/${next})` }];
    })
    .sort((a, b) => a.left - b.left || a.left / a.next - b.left / b.next || (a.id < b.id ? -1 : 1))
    .slice(0, max);

/** Show the goals now? Only in the final age's closing stretch, while it is still being played. */
export const showGoals = (age: Age, finalAge: Age, meter: number, phase: string): boolean =>
  phase === 'playing' && age === finalAge && meter >= ENDGAME_GOALS_FROM;
