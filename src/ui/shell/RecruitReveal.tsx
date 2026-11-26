/**
 * The recruit reveal: the medallion strikes like a coin, your banner dips, the culture's crest
 * glows; "<Name> joins your court". Under 1.2 s, skipped by a tap, still under reduce motion.
 * Then one tap for the best next step (seat / deploy / keep at home).
 */
import { useEffect, useState } from 'preact/hooks';
import { content, dispatch, game, lookup, me, myPlayer, myTurn, openModal, pushToast, q } from '../store';
import { CultureCrest, FigurePortrait, PlayerBanner } from '../art/game-art';
import { Icon } from '../art/Icon';
import { describeActivate, describeModifiers, inSentence, KIND_LABEL, shortName } from '../screens/shared/describe';
import { seatLabel } from '../screens/figure';
import { closeRecruitReveal, nextSteps, recruitReveal, REVEAL_MS, type NextStep, type SeatGap } from './recruit-reveal';
import { settings } from './shell-state';
import { CABINET_COOLDOWN_TURNS } from '../../emergence/constants';
import { followFigure } from './MapView';

const stepLabel = (s: NextStep, settlementName: (id: string) => string): string => {
  switch (s.kind) {
    case 'seat':
      return `Seat as ${seatLabel(s.slot)}`;
    case 'deploy':
      return `Deploy at ${settlementName(s.settlement)}`;
    case 'government':
      return 'Choose a government';
    case 'cabinet':
      return 'Open the cabinet';
    case 'activate':
      return 'Use their deed now';
    case 'home':
      return 'Keep at home for now';
  }
};

/** The concrete payoff of each step, from the figure's own modifiers (never a vague promise). */
const stepNote = (s: NextStep, seatBonus: string, fieldBonus: string, deed: string): string => {
  switch (s.kind) {
    case 'seat':
      return seatBonus ? `${seatBonus}, every turn.` : 'Their seat bonus works every turn.';
    case 'deploy':
      return fieldBonus ? `Takes the field: ${fieldBonus}.` : 'They take the field, lifting the units beside them.';
    case 'government':
      return `A government opens cabinet seats; then seat them${seatBonus ? ` (${seatBonus})` : ''}.`;
    case 'cabinet':
      // No direct swap in the rules: unseating empties the seat for a while (GDD §3).
      return `Every fitting seat is taken. To seat them${seatBonus ? ` (${seatBonus})` : ''}, unseat someone; the seat stays empty ${CABINET_COOLDOWN_TURNS} turns.`;
    case 'activate':
      return `${deed}, then they retire to the Hall of Ancestors.`;
    case 'home':
      return 'You can seat or deploy them later from Figures.';
  }
};

const stepIcon = (s: NextStep) =>
  s.kind === 'seat' || s.kind === 'cabinet' ? 'seat' : s.kind === 'deploy' ? 'deploy' : s.kind === 'government' ? 'cabinet' : s.kind === 'activate' ? 'activate' : 'found';

export function RecruitReveal() {
  const r = recruitReveal.value;
  const reduce = settings.value.reduceMotion;
  const [prompt, setPrompt] = useState(false);
  useEffect(() => {
    setPrompt(reduce);
    if (!r || reduce) return undefined;
    const t = setTimeout(() => setPrompt(true), REVEAL_MS);
    return () => clearTimeout(t);
  }, [r?.n, reduce]);
  useEffect(() => {
    if (!r) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRecruitReveal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [r?.n]);
  const g = game.value;
  const p = myPlayer.value;
  const my = me.value;
  // A rival got them first (the snapshot says so): no celebration for someone who did not come;
  // the ticker already says "joined a rival" (playtest 4, Hua Mulan).
  const takenByRival = !!r && !!g && !!my && !!g.figures[r.figure] && g.figures[r.figure]?.owner !== my;
  useEffect(() => {
    if (takenByRival) closeRecruitReveal();
  }, [takenByRival]);
  if (!r || !g || !p || !my || takenByRival) return null;
  const def = lookup.figures[r.figure];
  if (!def) return null;
  const fs = g.figures[r.figure];
  const mine = fs?.owner === my;
  const actions = mine ? q.figureActions(g, r.figure, content) : null;
  const capital = Object.values(g.settlements).find((s) => s.owner === my && s.isCapital)?.id ?? null;
  // Why no seat is free: no government yet, or someone already holds every fitting seat.
  const gap: SeatGap =
    !mine || !def.uses.includes('cabinet') || (actions?.seat.length ?? 0) > 0 || p.anarchyTurns > 0
      ? null
      : p.government === null
        ? q.governmentOptions(g, my, content).length > 0
          ? 'no-government'
          : null
        : Object.keys(p.cabinet).some((k) => !!p.cabinet[k] && !!lookup.cabinetSlots[k.split('#')[0] ?? '']?.accepts.includes(def.kind))
          ? 'seat-taken'
          : null;
  const steps = mine ? nextSteps(def, actions, capital, gap) : [];
  const seatBonus = describeModifiers(def.cabinetModifiers, lookup).join('; ');
  const fieldBonus = describeModifiers(def.unitModifiers, lookup, { unitSubject: 'them and adjacent units' }).join('; ');
  const deed = def.activate ? describeActivate(def.activate.effect, def.activate.amount) : '';
  // Why the obvious step is missing ("No free seat…"), in the sim's own words.
  const blockedNote =
    steps.length > 0 && steps.every((s) => s.kind === 'home') && gap === null
      ? ((def.uses.includes('cabinet') ? actions?.blocked.seat : undefined) ?? (def.uses.includes('unit') ? actions?.blocked.deploy : undefined) ?? null)
      : null;
  const name = (id: string): string => g.settlements[id]?.name ?? 'your city';
  const canAct = myTurn.value;

  const run = (s: NextStep): void => {
    if (s.kind === 'seat') dispatch({ type: 'seatFigure', figure: r.figure, slot: s.slot });
    else if (s.kind === 'deploy') {
      dispatch({ type: 'deployFigure', figure: r.figure, settlement: s.settlement });
      followFigure(r.figure);
    } else if (s.kind === 'activate') {
      dispatch({ type: 'activateFigure', figure: r.figure });
      // The deed lands silently in the sim; say what it did (playtest 3).
      pushToast(`${shortName(def.name)}: ${deed}. They retire to the Hall of Ancestors.`, 'culture');
    }
    else if (s.kind === 'government') openModal({ kind: 'government' });
    else if (s.kind === 'cabinet') openModal({ kind: 'cabinet' });
    closeRecruitReveal();
  };

  return (
    <div
      class={`reveal${prompt ? ' is-prompt' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${def.name} joins your court`}
      onClick={() => !prompt && setPrompt(true)}
      key={r.n}
    >
      <div class="reveal-stage" aria-hidden="true">
        <span class="reveal-glow" />
        <span class="reveal-banner">
          <PlayerBanner player={p} width={64} wave />
        </span>
        <span class="reveal-crest">
          <CultureCrest culture={def.culture} size={40} />
        </span>
        <span class="reveal-coin">
          <FigurePortrait figure={def.id} size="lg" />
        </span>
        <span class="reveal-sparks">
          {Array.from({ length: 10 }, (_, k) => (
            <i style={{ '--a': `${k * 36}deg`, '--d': `${(k % 3) * 40}ms` }} />
          ))}
        </span>
      </div>
      <h2 class="reveal-title">
        {shortName(def.name)} <span>joins your court</span>
      </h2>
      <div class="reveal-sub">
        {lookup.cultures[def.culture]?.name ?? ''} · {KIND_LABEL[def.kind]}
      </div>
      {prompt && (
        <div class="reveal-next card" onClick={(e) => e.stopPropagation()}>
          <div class="reveal-next-head">What first?</div>
          {steps.length === 0 && <p class="small muted">They are on their way to your capital.</p>}
          {blockedNote && <p class="small muted reveal-blocked">{blockedNote}</p>}
          {steps.map((s, k) => (
            <button
              class={`btn ${k === 0 && s.kind !== 'home' ? 'btn-primary' : s.kind === 'home' ? 'btn-ghost' : ''} reveal-step`}
              disabled={(s.kind === 'seat' || s.kind === 'deploy' || s.kind === 'activate') && !canAct}
              onClick={() => run(s)}
            >
              <Icon name={stepIcon(s)} />
              <span class="grow">
                {stepLabel(s, name)}
                <span class="reveal-step-note">{stepNote(s, seatBonus, fieldBonus, deed)}</span>
              </span>
            </button>
          ))}
          <button
            class="btn btn-ghost reveal-see"
            onClick={() => {
              closeRecruitReveal();
              openModal({ kind: 'figure', figure: def.id });
            }}
          >
            See {inSentence(shortName(def.name))} <Icon name="chevron" size="sm" />
          </button>
        </div>
      )}
      {!prompt && <div class="reveal-skip small">Tap to continue</div>}
    </div>
  );
}
