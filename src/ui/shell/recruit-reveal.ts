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

export type NextStep =
  | { kind: 'seat'; slot: string }
  | { kind: 'deploy'; settlement: string }
  /** No government yet: its cabinet has the seats, so the useful step is choosing one. */
  | { kind: 'government' }
  /** A fitting seat exists but someone holds it: the cabinet is where to swap. */
  | { kind: 'cabinet' }
  /** Their one-time deed, when it can be used now (offered after seat/deploy). */
  | { kind: 'activate' }
  | { kind: 'home' };

/** Why a cabinet figure has no seat right now (null when one is free or the figure is not for the cabinet). */
export type SeatGap = 'no-government' | 'seat-taken' | null;

/**
 * Best next steps, best first, ending with "keep at home". Commanders take the field first;
 * everyone else takes a cabinet seat first (their seat bonus works every turn). When no seat is
 * free, the step that opens one comes instead (playtest 3: the first recruit often offered only
 * "Keep at home", a dead end before the player had a government).
 */
export const nextSteps = (
  def: { kind: FigureKind; uses: readonly FigureUse[] },
  actions: { seat: readonly string[]; deploy: readonly string[]; canActivate?: boolean } | null,
  capital: string | null,
  gap: SeatGap = null,
): NextStep[] => {
  const out: NextStep[] = [];
  const seat = def.uses.includes('cabinet') ? actions?.seat[0] : undefined;
  const deployList = def.uses.includes('unit') ? (actions?.deploy ?? []) : [];
  const deployAt = capital && deployList.includes(capital) ? capital : deployList[0];
  const seatStep: NextStep | null = seat ? { kind: 'seat', slot: seat } : null;
  const deployStep: NextStep | null = deployAt ? { kind: 'deploy', settlement: deployAt } : null;
  const military = def.kind === 'general';
  for (const s of military ? [deployStep, seatStep] : [seatStep, deployStep]) if (s) out.push(s);
  if (!seatStep && def.uses.includes('cabinet')) {
    if (gap === 'no-government') out.push({ kind: 'government' });
    else if (gap === 'seat-taken') out.push({ kind: 'cabinet' });
  }
  if (def.uses.includes('activate') && actions?.canActivate) out.push({ kind: 'activate' });
  out.push({ kind: 'home' });
  return out;
};
