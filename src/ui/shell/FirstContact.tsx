/**
 * "A new people": the first-contact card (wave 11). Their banner, their name, the leader's kind
 * and ability, what they said, and one button to Nations. Waits under full screens and the
 * resume recap like the other moments; any tap outside or "Later" lets it go.
 */
import { content, game, lookup, modal, openModal, ownerName } from '../store';
import { PlayerBanner } from '../art/game-art';
import { Icon } from '../art/Icon';
import { firstContacts, POSTURE_LINE, postureOf } from './first-contact';
import { resumeRecap } from './resume-recap';
import { recruitReveal } from './recruit-reveal';
import { AutoFocusButton } from './AutoFocusButton';
import { leaderTitle } from '../screens/shared/chronicle-story';
import { useGuardedBackdrop } from './moment-guard';

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function FirstContact() {
  const m = firstContacts.value[0];
  const g = game.value;
  const visible = !!m && !!g && g.phase === 'playing' && !modal.value && !resumeRecap.value && !recruitReveal.value;
  // A tap already on its way (to End Turn) must not close the card unseen (wave 13).
  const onBackdrop = useGuardedBackdrop(visible ? m?.player : null, () => {
    firstContacts.value = firstContacts.value.slice(1);
  });
  if (!m || !g || !visible) return null;
  const p = g.players[m.player];
  if (!p) {
    firstContacts.value = firstContacts.value.slice(1);
    return null;
  }
  const leader = lookup.leaders[p.leader];
  const next = (): void => {
    firstContacts.value = firstContacts.value.slice(1);
  };
  const name = cap(ownerName(m.player));
  return (
    <div class="confirm-backdrop recap-backdrop" onClick={onBackdrop}>
      <section class="confirm card recap contact-card" role="dialog" aria-modal="true" aria-label={`First contact: ${name}`} onClick={(e) => e.stopPropagation()}>
        <div class="recap-head">
          <PlayerBanner player={p} width={44} />
          <div class="grow">
            <div class="recap-kicker">First contact</div>
            <h2 class="sheet-title">{name}</h2>
            {leader && <div class="small muted">Led by {leaderTitle(leader.name)}</div>}
          </div>
        </div>
        <blockquote class="contact-quote">“{m.quote}”</blockquote>
        {leader && (
          <p class="small contact-leader">
            <b>{leader.name}:</b> {leader.ability}
          </p>
        )}
        <p class="small muted contact-posture">{POSTURE_LINE[postureOf(g, m.player, content)]}</p>
        <div class="row confirm-buttons">
          <button class="btn grow" onClick={next}>
            Later
          </button>
          <AutoFocusButton
            class="btn btn-primary grow"
            aria-label="Open Nations"
            onClick={() => {
              next();
              openModal({ kind: 'diplomacy' });
            }}
          >
            <Icon name="nations" /> Nations
          </AutoFocusButton>
        </div>
      </section>
    </div>
  );
}
