/**
 * Mood grading and "moments" detected between snapshots (GDD §11 art pass 3). Pure: no three.
 *
 * A grade is [r, g, b, saturation]: a channel multiply applied after lighting and haze (in
 * materials.ts finish), so every lit layer shifts together like a single painted sheet. Ages
 * get their own light (ancient: warm ochre dawn; classical: clearer golden noon; later ages
 * cooler and crisper); a crisis cools and flattens the grade and thickens the haze.
 */
import { AGES, type Age } from '@contracts/content-schemas';
import type { GameState, PlayerId } from '@contracts/sim-api';

export type Grade = readonly [number, number, number, number];

export const AGE_GRADES: Readonly<Record<Age, Grade>> = {
  ancient: [1.035, 1.0, 0.93, 0.97],
  classical: [1.03, 1.012, 0.965, 1.05],
  exploration: [1.0, 1.0, 1.0, 1.02],
  modern: [0.985, 1.0, 1.025, 0.96],
};

/** Crisis: cooler, lower-contrast air (multiplies onto the age grade). */
export const CRISIS_GRADE: Grade = [0.94, 0.97, 1.035, 0.8];
/** Haze multiplier while a crisis is active. */
export const CRISIS_HAZE = 1.3;

export interface Mood {
  age: Age;
  crisis: boolean;
}

export const gradeFor = (mood: Mood): Grade => {
  const a = AGE_GRADES[mood.age] ?? AGE_GRADES.ancient;
  if (!mood.crisis) return a;
  return [a[0] * CRISIS_GRADE[0], a[1] * CRISIS_GRADE[1], a[2] * CRISIS_GRADE[2], a[3] * CRISIS_GRADE[3]];
};

export const moodOf = (state: Pick<GameState, 'age' | 'crisis'>): Mood => ({
  age: (AGES as readonly string[]).includes(state.age) ? state.age : 'ancient',
  crisis: state.crisis !== null && state.crisis !== undefined,
});

export const sameMood = (a: Mood, b: Mood): boolean => a.age === b.age && a.crisis === b.crisis;

/** Moments the renderer fires on its own when it sees them between two snapshots. */
export type Moment =
  | { kind: 'wonder'; settlement: string }
  | { kind: 'recruit'; settlement: string }
  | { kind: 'age'; age: Age };

/**
 * Compare consecutive snapshots of the same game. Wonders completed anywhere visible to the
 * caller's filter (the renderer passes all; it skips hexes it cannot see), a figure recruited by
 * the viewer (flourish at their capital), and an age change. Nothing fires on the first snapshot.
 */
export const detectMoments = (
  prev: Pick<GameState, 'seed' | 'age' | 'wonders' | 'players' | 'settlements'> | null,
  next: Pick<GameState, 'seed' | 'age' | 'wonders' | 'players' | 'settlements'>,
  viewer: PlayerId | null,
): Moment[] => {
  if (!prev || prev.seed !== next.seed) return [];
  const out: Moment[] = [];
  for (const id of Object.keys(next.wonders ?? {}).sort()) {
    if (prev.wonders?.[id]) continue;
    const w = next.wonders[id];
    if (w) out.push({ kind: 'wonder', settlement: w.settlement });
  }
  if (viewer !== null) {
    const a = prev.players[viewer]?.stats?.figuresRecruited ?? 0;
    const b = next.players[viewer]?.stats?.figuresRecruited ?? 0;
    if (b > a) {
      const cap = Object.values(next.settlements).find((s) => s.owner === viewer && s.isCapital);
      if (cap) out.push({ kind: 'recruit', settlement: cap.id });
    }
  }
  if (prev.age !== next.age) out.push({ kind: 'age', age: next.age });
  return out;
};

/** Age-transition sweep and page-settle timings (ms). */
export const SWEEP_MS = 2600;
export const SETTLE_MS = 1400;

/** 0 -> 1 -> 0 bump for the page settle (eased; t in 0..1). */
export const settlePulse = (t: number): number => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t) * (1 - t * 0.4));
