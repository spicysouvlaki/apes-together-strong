/**
 * Menu, Saves and Settings modals (shell-owned kinds 'menu', 'saves', 'settings').
 */
import { useEffect } from 'preact/hooks';
import type { SaveMeta } from '@contracts/sim-api';
import { MANUAL_SLOT_COUNT } from '../../platform/saves';
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN } from '../../platform/settings';
import {
  askConfirm,
  closeModal,
  deleteSave,
  game,
  loadGame,
  lookup,
  openModal,
  refreshSaves,
  route,
  saveGame,
  saves,
  selection,
} from '../store';
import { AGE_NAME } from './format';
import { loading, patchSettings, settings } from './shell-state';

function Header({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div class="screen-header">
      <h1>{title}</h1>
      <button class="btn btn-ghost" aria-label={onBack ? 'Back' : 'Close'} onClick={onBack ?? closeModal}>
        {onBack ? '‹ Back' : '✕'}
      </button>
    </div>
  );
}

export const quitToTitle = (): void => {
  closeModal();
  selection.value = { unit: null, settlement: null, tile: null };
  game.value = null;
  route.value = 'title';
};

export function MenuPanel() {
  return (
    <div class="screen" role="dialog" aria-label="Menu">
      <Header title="Menu" />
      <div class="screen-body menu-list">
        <button class="btn btn-primary" onClick={closeModal}>
          Resume
        </button>
        <button class="btn" onClick={() => openModal({ kind: 'saves' })}>
          Save / Load
        </button>
        <button class="btn" onClick={() => openModal({ kind: 'chronicle' })}>
          Chronicle
        </button>
        <button class="btn" onClick={() => openModal({ kind: 'settings' })}>
          Settings
        </button>
        <button
          class="btn"
          onClick={() =>
            askConfirm({
              title: 'Quit to the title screen?',
              body: 'Your game was autosaved at the start of this turn. Moves since then are lost unless you save.',
              confirmLabel: 'Quit',
              onConfirm: quitToTitle,
            })
          }
        >
          Quit to title
        </button>
      </div>
    </div>
  );
}

const describe = (m: SaveMeta): string => {
  const who = m.civName ?? `${lookup.leaders[m.leader]?.name ?? 'Leader'}`;
  const when = new Date(m.savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${who} · Turn ${m.turn} · ${AGE_NAME[m.age]} · ${when}`;
};

const doLoad = (slot: string): void => {
  const go = (): void => {
    loading.value = 'Loading…';
    closeModal();
    loadGame(slot);
  };
  if (route.value === 'game') {
    askConfirm({ title: 'Load this save?', body: 'Unsaved progress in the current game is lost.', confirmLabel: 'Load', onConfirm: go });
  } else go();
};

export function SavesPanel() {
  useEffect(() => refreshSaves(), []);
  const list = saves.value;
  const inGame = route.value === 'game' && game.value !== null;
  const autos = list.filter((s) => s.slot.startsWith('auto:')).sort((a, b) => b.savedAt - a.savedAt);
  const bySlot = new Map(list.map((s) => [s.slot, s]));
  const back = inGame ? () => openModal({ kind: 'menu' }) : undefined;
  return (
    <div class="screen" role="dialog" aria-label="Saves">
      <Header title={inGame ? 'Save / Load' : 'Load game'} onBack={back} />
      <div class="screen-body">
        <div class="section-title">Autosaves</div>
        {autos.length === 0 && <div class="small muted">No autosaves yet.</div>}
        {autos.map((m) => (
          <div class="card row" key={m.slot}>
            <div class="grow small">{describe(m)}</div>
            <button class="btn" onClick={() => doLoad(m.slot)}>
              Load
            </button>
          </div>
        ))}
        <div class="section-title">Slots</div>
        {Array.from({ length: MANUAL_SLOT_COUNT }, (_, i) => {
          const slot = `slot:${i}`;
          const m = bySlot.get(slot);
          return (
            <div class="card save-slot" key={slot}>
              <div class="small">
                <strong>Slot {i + 1}</strong> {m ? <span class="muted">· {describe(m)}</span> : <span class="muted">· Empty</span>}
              </div>
              <div class="row mt4">
                {inGame && (
                  <button
                    class="btn"
                    onClick={() =>
                      m
                        ? askConfirm({ title: `Overwrite slot ${i + 1}?`, confirmLabel: 'Overwrite', onConfirm: () => saveGame(slot) })
                        : saveGame(slot)
                    }
                  >
                    Save here
                  </button>
                )}
                {m && (
                  <button class="btn" onClick={() => doLoad(slot)}>
                    Load
                  </button>
                )}
                {m && (
                  <button
                    class="btn btn-ghost danger-text"
                    aria-label={`Delete slot ${i + 1}`}
                    onClick={() =>
                      askConfirm({
                        title: `Delete slot ${i + 1}?`,
                        body: 'This save cannot be recovered.',
                        confirmLabel: 'Delete',
                        danger: true,
                        onConfirm: () => deleteSave(slot),
                      })
                    }
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const s = settings.value;
  const back = route.value === 'game' ? () => openModal({ kind: 'menu' }) : undefined;
  return (
    <div class="screen" role="dialog" aria-label="Settings">
      <Header title="Settings" onBack={back} />
      <div class="screen-body">
        <div class="section-title">Text size</div>
        <div class="card">
          <div class="row">
            <input
              class="grow"
              type="range"
              min={TEXT_SCALE_MIN}
              max={TEXT_SCALE_MAX}
              step={5}
              value={s.textScale}
              aria-label="Text size"
              onInput={(e) => patchSettings({ textScale: Number((e.target as HTMLInputElement).value) })}
            />
            <span class="chip">{s.textScale}%</span>
          </div>
        </div>
        <div class="section-title">Comfort</div>
        <label class="card row toggle">
          <span class="grow">Reduce motion</span>
          <input type="checkbox" checked={s.reduceMotion} onChange={(e) => patchSettings({ reduceMotion: (e.target as HTMLInputElement).checked })} />
        </label>
        <label class="card row toggle">
          <span class="grow">
            Colorblind patterns
            <div class="small muted">Adds patterns to banners and borders where supported.</div>
          </span>
          <input
            type="checkbox"
            checked={s.colorblindPatterns}
            onChange={(e) => patchSettings({ colorblindPatterns: (e.target as HTMLInputElement).checked })}
          />
        </label>
      </div>
    </div>
  );
}
