/** The turn log (modal 'log'): recent events as plain sentences, newest turn first. */
import { closeModal } from '../store';
import { useEscape } from './use-escape';
import { turnLog } from './shell-state';
import { Icon } from '../art/Icon';

export function TurnLog() {
  const entries = turnLog.value;
  const turns = [...new Set(entries.map((e) => e.turn))].sort((a, b) => b - a);
  // Escape closes it, like every other sheet and screen (wave 13).
  useEscape(closeModal);
  return (
    <section class="sheet log-sheet" role="dialog" aria-label="Recent events">
      <div class="row">
        <h2 class="sheet-title grow">Recent events</h2>
        <button class="btn btn-ghost btn-icon" aria-label="Close" onClick={closeModal}>
          <Icon name="close" />
        </button>
      </div>
      {entries.length === 0 && <p class="small muted">Nothing has happened yet this session.</p>}
      {turns.map((t) => (
        <div key={t}>
          <div class="section-title">Turn {t}</div>
          <ul class="log-list">
            {entries
              .filter((e) => e.turn === t)
              .map((e, i) => (
                <li key={i} class={`log-item tone-${e.tone}`}>
                  {e.text}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
