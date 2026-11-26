/**
 * "The story so far": a short card when a saved game is resumed (see resume-recap.ts). Who your
 * people are, what happened last, and one button back to the map. Never blocks a decision: it
 * closes on any tap outside, and it waits under full screens.
 */
import { content, game, me, modal, ownerName, q } from '../store';
import { buildPeople } from '../screens/shared/people';
import { PlayerBanner } from '../art/game-art';
import { Icon } from '../art/Icon';
import { recapLines, resumeRecap } from './resume-recap';
import { AutoFocusButton } from './AutoFocusButton';
import { useGuardedBackdrop } from './moment-guard';

const AGE_NAME: Record<string, string> = { ancient: 'Ancient', classical: 'Classical', exploration: 'Exploration', modern: 'Modern' };

export function ResumeRecap() {
  const r = resumeRecap.value;
  const g = game.value;
  const my = me.value;
  const visible = !!r && !!g && !!my && g.phase === 'playing' && !modal.value;
  const onBackdrop = useGuardedBackdrop(visible ? `${r?.seed}:${r?.turn}` : null, () => {
    resumeRecap.value = null;
  });
  if (!r || !g || !my || !visible) return null;
  const p = g.players[my];
  if (!p) return null;
  const v = buildPeople(g, my, q.cultureWeights(g, my, content), content);
  const lines = recapLines(p.chronicle, 4);
  // A war is the one thing a returning player must not miss (its slip fired before the reload).
  const wars = g.playerOrder.filter((id) => id !== my && g.players[id]?.alive !== false && q.atWar(g, my, id));
  const close = (): void => {
    resumeRecap.value = null;
  };
  const name = v?.name ? v.name.charAt(0).toUpperCase() + v.name.slice(1) : 'Your people, not yet named';
  return (
    <div class="confirm-backdrop recap-backdrop" onClick={onBackdrop}>
      <section class="confirm card recap" role="dialog" aria-modal="true" aria-label="The story so far" onClick={(e) => e.stopPropagation()}>
        <div class="recap-head">
          <PlayerBanner player={p} width={44} />
          <div class="grow">
            <div class="recap-kicker">The story so far</div>
            <h2 class="sheet-title">{name}</h2>
            <div class="small muted">
              Turn {g.turn} · {AGE_NAME[g.age] ?? g.age} age
            </div>
          </div>
        </div>
        {v && v.cultures.length > 0 && <p class="recap-becoming">{v.becoming}</p>}
        {wars.length > 0 && (
          <p class="recap-war" role="alert">
            <Icon name="war" size="sm" /> At war with {wars.map((id) => ownerName(id)).join(' and ')}.
          </p>
        )}
        {lines.length > 0 && (
          <ul class="recap-lines">
            {lines.map((l) => (
              <li key={`${l.turn}:${l.text}`}>
                <span class="recap-turn tnum" aria-label={`Turn ${l.turn}:`}>T{l.turn}</span> {l.text}
              </li>
            ))}
          </ul>
        )}
        <AutoFocusButton class="btn btn-primary recap-go" onClick={close}>
          <Icon name="play" /> Back to it
        </AutoFocusButton>
      </section>
    </div>
  );
}
