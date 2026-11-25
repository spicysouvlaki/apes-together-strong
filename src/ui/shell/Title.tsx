/**
 * Title screen: New game, Continue (newest autosave), Load, Settings.
 */
import { loadGame, openModal, route, saves } from '../store';
import { loading } from './shell-state';

export function Title() {
  const list = saves.value;
  const newest = [...list].sort((a, b) => b.savedAt - a.savedAt)[0];
  const auto = list.find((s) => s.slot === 'auto:0') ?? newest;
  const busy = loading.value;
  return (
    <main class="title-screen">
      <div class="title-art" aria-hidden="true">
        ⬢
      </div>
      <h1 class="title-name">Apes Together Strong</h1>
      <p class="title-tag muted">Build a civilization from the people your play attracts.</p>
      <div class="title-buttons">
        {auto && (
          <button
            class="btn btn-primary"
            disabled={!!busy}
            onClick={() => {
              loading.value = 'Loading…';
              loadGame(auto.slot);
            }}
          >
            Continue · Turn {auto.turn}
          </button>
        )}
        <button class={`btn${auto ? '' : ' btn-primary'}`} disabled={!!busy} onClick={() => (route.value = 'setup')}>
          New game
        </button>
        <button class="btn" disabled={!!busy || list.length === 0} onClick={() => openModal({ kind: 'saves' })}>
          Load
        </button>
        <button class="btn" onClick={() => openModal({ kind: 'settings' })}>
          Settings
        </button>
      </div>
      {busy && (
        <p class="muted" role="status">
          {busy}
        </p>
      )}
    </main>
  );
}
