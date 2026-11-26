/**
 * The recruit reveal: the medallion strikes like a coin, your banner dips, the culture's crest
 * glows; "<Name> joins your court". Under 1.2 s, skipped by a tap, still under reduce motion.
 * Then one tap for the best next step (seat / deploy / keep at home).
 */
import { useEffect, useState } from 'preact/hooks';
import { content, dispatch, game, lookup, me, myPlayer, myTurn, openModal, q } from '../store';
import { CultureCrest, FigurePortrait, PlayerBanner } from '../art/game-art';
import { Icon } from '../art/Icon';
import { KIND_LABEL, shortName } from '../screens/shared/describe';
import { seatLabel } from '../screens/figure';
import { closeRecruitReveal, nextSteps, recruitReveal, REVEAL_MS, type NextStep } from './recruit-reveal';
import { settings } from './shell-state';
import { followFigure } from './MapView';

const stepLabel = (s: NextStep, settlementName: (id: string) => string): string =>
  s.kind === 'seat' ? `Seat as ${seatLabel(s.slot)}` : s.kind === 'deploy' ? `Deploy at ${settlementName(s.settlement)}` : 'Keep at home for now';

const stepNote = (s: NextStep): string =>
  s.kind === 'seat' ? 'Their seat bonus works every turn.' : s.kind === 'deploy' ? 'They take the field, lifting the units beside them.' : 'You can seat or deploy them later from Figures.';

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
  if (!r || !g || !p || !my) return null;
  const def = lookup.figures[r.figure];
  if (!def) return null;
  const fs = g.figures[r.figure];
  const mine = fs?.owner === my;
  const actions = mine ? q.figureActions(g, r.figure, content) : null;
  const capital = Object.values(g.settlements).find((s) => s.owner === my && s.isCapital)?.id ?? null;
  const steps = mine ? nextSteps(def, actions, capital) : [];
  // Why the obvious step is missing ("No free seat…"), in the sim's own words.
  const blockedNote =
    steps.length > 0 && steps.every((s) => s.kind === 'home')
      ? ((def.uses.includes('cabinet') ? actions?.blocked.seat : undefined) ?? (def.uses.includes('unit') ? actions?.blocked.deploy : undefined) ?? null)
      : null;
  const name = (id: string): string => g.settlements[id]?.name ?? 'your city';
  const canAct = myTurn.value;

  const run = (s: NextStep): void => {
    if (s.kind === 'seat') dispatch({ type: 'seatFigure', figure: r.figure, slot: s.slot });
    else if (s.kind === 'deploy') {
      dispatch({ type: 'deployFigure', figure: r.figure, settlement: s.settlement });
      followFigure(r.figure);
    }
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
              disabled={s.kind !== 'home' && !canAct}
              onClick={() => run(s)}
            >
              <Icon name={s.kind === 'seat' ? 'seat' : s.kind === 'deploy' ? 'deploy' : 'found'} />
              <span class="grow">
                {stepLabel(s, name)}
                <span class="reveal-step-note">{stepNote(s)}</span>
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
            See {shortName(def.name)} <Icon name="chevron" size="sm" />
          </button>
        </div>
      )}
      {!prompt && <div class="reveal-skip small">Tap to continue</div>}
    </div>
  );
}
