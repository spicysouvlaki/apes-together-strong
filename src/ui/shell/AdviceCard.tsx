/**
 * The guide's parchment slip above the bottom controls (GDD §11 onboarding). Non-modal: it never
 * blocks the map or the controls, and one tap dismisses it. The chronicler speaks until a figure
 * sits in the cabinet; then that advisor gives the same advice, with their portrait.
 */
import { content, game, me, myTurn, selection, thinking } from '../store';
import { advisorFor } from './advice';
import { advice, dismissAdvice } from './guide-state';
import { Icon } from '../art/Icon';
import { FigurePortrait } from '../art/game-art';

export function AdviceCard() {
  const a = advice.value;
  const g = game.value;
  const my = me.value;
  if (!a || !g || !my || !myTurn.value || thinking.value !== null) return null;
  // With a unit sheet open, room is short: only tips about that sheet's buttons stay.
  if (selection.value.unit && a.target !== 'found' && a.target !== 'explore') return null;
  const adv = advisorFor(g, my, content);
  if (selection.value.unit) {
    // Compact slip above a unit sheet: one short line, same voice.
    return (
      <aside class="advice advice-compact" aria-label="Advice">
        <span class="advice-quill" aria-hidden="true">
          <Icon name="chronicle" size="sm" />
        </span>
        <p class="advice-text">{a.short ?? a.text}</p>
        <button class="advice-close" aria-label="Dismiss this tip" onClick={dismissAdvice}>
          <Icon name="close" size="sm" />
        </button>
      </aside>
    );
  }
  const who = adv ? `${adv.name}, your ${adv.seat}` : 'The Chronicler';
  return (
    <aside class="advice" aria-live="polite" aria-label={`Advice from ${who}`}>
      <div class="advice-who">
        {adv ? (
          <FigurePortrait figure={adv.figure} size="xs" />
        ) : (
          <span class="advice-quill" aria-hidden="true">
            <Icon name="chronicle" size="sm" />
          </span>
        )}
        <span class="advice-name">{who}</span>
        <button class="advice-close" aria-label="Dismiss this tip" onClick={dismissAdvice}>
          <Icon name="close" size="sm" />
        </button>
      </div>
      <p class="advice-text">{a.text}</p>
    </aside>
  );
}
