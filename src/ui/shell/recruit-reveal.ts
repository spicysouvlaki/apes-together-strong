/**
 * The recruit reveal (GDD §4: recruiting is the signature beat). After "Welcome" a short
 * celebration plays, then one tap offers the best next step for that figure. The steps come
 * from SimQueries.figureActions (what is legal now); this module only orders them. Pure apart
 * from the signal.
 */
import { signal } from '@preact/signals';
import type { FigureKind } from '@contracts/content-schemas';

type FigureUse = 'unit' | 'cabinet' | 'activate';

export interface RevealState {
  figure: string;
  /** Increments per reveal so the animation restarts for a second recruit in a row. */
  n: number;
}

export const recruitReveal = signal<RevealState | null>(null);
let counter = 0;

export const showRecruitReveal = (figure: string): void => {
  recruitReveal.value = { figure, n: ++counter };
};
export const closeRecruitReveal = (): void => {
  recruitReveal.value = null;
};

/** The celebration's length; the prompt appears after it (or at once on a tap / reduce motion). */
export const REVEAL_MS = 1100;

export type NextStep = { kind: 'seat'; slot: string } | { kind: 'deploy'; settlement: string } | { kind: 'home' };

/**
 * Best next steps, best first, ending with "keep at home". Commanders take the field first;
 * everyone else takes a cabinet seat first (their seat bonus works every turn).
 */
export const nextSteps = (
  def: { kind: FigureKind; uses: readonly FigureUse[] },
  actions: { seat: readonly string[]; deploy: readonly string[] } | null,
  capital: string | null,
): NextStep[] => {
  const out: NextStep[] = [];
  const seat = def.uses.includes('cabinet') ? actions?.seat[0] : undefined;
  const deployList = def.uses.includes('unit') ? (actions?.deploy ?? []) : [];
  const deployAt = capital && deployList.includes(capital) ? capital : deployList[0];
  const seatStep: NextStep | null = seat ? { kind: 'seat', slot: seat } : null;
  const deployStep: NextStep | null = deployAt ? { kind: 'deploy', settlement: deployAt } : null;
  const military = def.kind === 'general';
  for (const s of military ? [deployStep, seatStep] : [seatStep, deployStep]) if (s) out.push(s);
  out.push({ kind: 'home' });
  return out;
};
