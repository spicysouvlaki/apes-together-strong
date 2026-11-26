/**
 * Menu, Saves and Settings modals (shell-owned kinds 'menu', 'saves', 'settings').
 */
import { useEffect } from 'preact/hooks';
import type { SaveMeta } from '@contracts/sim-api';
import { PLAYER_SLOT_COUNT, RESUME_SLOT, continueSave } from './saves-logic';
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN } from '../../platform/settings';
import { exportGame, importGame } from '../../platform/transfer';
import {
  askConfirm,
  closeModal,
  deleteSave,
  game,
  loadGame,
  lookup,
  openModal,
  pushToast,
  refreshSaves,
  route,
  saveGame,
  saves,
  selection,
} from '../store';
import { AGE_NAME } from './format';
import { loading, patchSettings, settings } from './shell-state';
import { Icon } from '../art/Icon';
import { guide, replayGuide, skipGuide } from './guide-state';

function Header({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div class="screen-header">
      {onBack && (
        <button class="btn btn-ghost btn-icon" aria-label="Back" onClick={onBack}>
          <Icon name="back" />
        </button>
      )}
      <h1>{title}</h1>
      {!onBack && (
        <button class="btn btn-ghost btn-icon" aria-label="Close" onClick={closeModal}>
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}

export const quitToTitle = (): void => {
  closeModal();
  selection.value = { unit: null, settlement: null, tile: null };
  game.value = null;
  route.value = 'title';
};

const DIFFICULTY_NAME: Record<string, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

/** This game's difficulty, map, speed and seed (read-only). */
function GameFacts() {
  const g = game.value;
  if (!g) return null;
  return (
    <p class="small muted menu-facts">
      {DIFFICULTY_NAME[g.difficulty] ?? g.difficulty} difficulty · {g.mapSize} map · {g.speed} speed · seed {g.seed}
    </p>
  );
}

export function MenuPanel() {
  return (
    <div class="screen" role="dialog" aria-label="Menu">
      <Header title="Menu" />
      <div class="screen-body menu-list">
        <button class="btn btn-primary" onClick={closeModal}>
          <Icon name="play" /> Resume
        </button>
        <button class="btn" onClick={() => openModal({ kind: 'saves' })}>
          <Icon name="save" /> Save / Load
        </button>
        <button class="btn" onClick={() => openModal({ kind: 'chronicle' })}>
          <Icon name="chronicle" /> Chronicle
        </button>
        <button class="btn" onClick={() => openModal({ kind: 'codex' })}>
          <Icon name="help" /> How to play
        </button>
        <button class="btn" onClick={() => openModal({ kind: 'log' })}>
          <Icon name="turn" /> Recent events
        </button>
        <button class="btn" onClick={() => openModal({ kind: 'settings' })}>
          <Icon name="settings" /> Settings
        </button>
        <MuteButton />
        <GameFacts />
        <button
          class="btn"
          onClick={() =>
            askConfirm({
              title: 'Quit to the title screen?',
              body: 'Your game is saved automatically after every move. Continue picks it up where you left off.',
              confirmLabel: 'Quit',
              onConfirm: quitToTitle,
            })
          }
        >
          <Icon name="quit" /> Quit to title
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

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Downloads the newest save as a .json file (safety net against Safari clearing site data). */
const doExport = (slot: string): void => {
  exportGame(slot).then(
    (name) => pushToast(`Exported ${name}. Keep it in Files to restore this game later.`, 'good'),
    (err: unknown) => pushToast(`Export failed: ${errorText(err)}`, 'bad'),
  );
};

/** Picks a .json save, stores it in the reserved slot, then loads it like any save. */
const doImport = (): void => {
  importGame().then(
    (slot) => {
      if (slot) doLoad(slot);
    },
    (err: unknown) => pushToast(`Import failed: ${errorText(err)}`, 'bad'),
  );
};

export function SavesPanel() {
  useEffect(() => refreshSaves(), []);
  const list = saves.value;
  const inGame = route.value === 'game' && game.value !== null;
  const autos = list.filter((s) => s.slot.startsWith('auto:')).sort((a, b) => b.savedAt - a.savedAt);
  const resume = list.find((s) => s.slot === RESUME_SLOT);
  // In a game, auto:0 is its latest state; on the title screen, what Continue would load.
  const newest = inGame ? (list.find((s) => s.slot === 'auto:0') ?? null) : continueSave(list);
  const save = (slot: string, n: number): void => {
    saveGame(slot);
    pushToast(`Saved to slot ${n}.`, 'good');
  };
  const bySlot = new Map(list.map((s) => [s.slot, s]));
  const back = inGame ? () => openModal({ kind: 'menu' }) : undefined;
  return (
    <div class="screen" role="dialog" aria-label="Saves">
      <Header title={inGame ? 'Save / Load' : 'Load game'} onBack={back} />
      <div class="screen-body">
        <div class="section-title">Autosaves</div>
        <p class="small muted mt4">The newest is updated after every move; the others are from the start of your recent turns.</p>
        {autos.length === 0 && !resume && <div class="small muted">No autosaves yet.</div>}
        {resume && (
          <div class="card row">
            <div class="grow small">
              <strong>Imported</strong> · {describe(resume)}
            </div>
            <button class="btn" onClick={() => doLoad(resume.slot)}>
              Load
            </button>
          </div>
        )}
        {autos.map((m) => (
          <div class="card row" key={m.slot}>
            <div class="grow small">{describe(m)}</div>
            <button class="btn" onClick={() => doLoad(m.slot)}>
              Load
            </button>
          </div>
        ))}
        <div class="section-title">Slots</div>
        {Array.from({ length: PLAYER_SLOT_COUNT }, (_, i) => {
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
                    aria-label={`Save to slot ${i + 1}`}
                    onClick={() =>
                      m
                        ? askConfirm({ title: `Overwrite slot ${i + 1}?`, confirmLabel: 'Overwrite', onConfirm: () => save(slot, i + 1) })
                        : save(slot, i + 1)
                    }
                  >
                    Save here
                  </button>
                )}
                {m && (
                  <button class="btn" aria-label={`Load slot ${i + 1}`} onClick={() => doLoad(slot)}>
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
        <div class="section-title">Backup</div>
        <p class="small muted mt4">Export a copy to Files in case the browser clears this site's data; import one to restore it.</p>
        <div class="row mt4">
          {newest && (
            <button class="btn" onClick={() => doExport(newest.slot)}>
              <Icon name="save" /> Export
            </button>
          )}
          <button class="btn" onClick={doImport}>
            <Icon name="load" /> Import
          </button>
        </div>
      </div>
    </div>
  );
}

/** Sound on/off, persisted (settings.muted). Also reachable from Settings. */
export function MuteButton() {
  const muted = settings.value.muted;
  return (
    <button class="btn" aria-pressed={muted} onClick={() => patchSettings({ muted: !muted })}>
      <Icon name={muted ? 'soundOff' : 'soundOn'} /> {muted ? 'Sound is off' : 'Sound is on'}
    </button>
  );
}

const Volume = ({ label, value, onInput, disabled }: { label: string; value: number; onInput: (v: number) => void; disabled: boolean }) => (
  <div class="card row">
    <span class="settings-label">{label}</span>
    <input
      class="grow"
      type="range"
      min={0}
      max={100}
      step={5}
      value={value}
      disabled={disabled}
      aria-label={label}
      onInput={(e) => onInput(Number((e.target as HTMLInputElement).value))}
    />
    <span class="chip">{value}%</span>
  </div>
);

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
        <div class="section-title">Sound</div>
        <label class="card row toggle">
          <span class="grow settings-label">Mute all sound</span>
          <input type="checkbox" aria-label="Mute all sound" checked={s.muted} onChange={(e) => patchSettings({ muted: (e.target as HTMLInputElement).checked })} />
        </label>
        <Volume label="Effects" value={s.sfxVolume} disabled={s.muted} onInput={(v) => patchSettings({ sfxVolume: v })} />
        <Volume label="Ambience" value={s.musicVolume} disabled={s.muted} onInput={(v) => patchSettings({ musicVolume: v })} />
        <div class="section-title">Guide</div>
        <GuideSettings />
        <div class="section-title">Comfort</div>
        <label class="card row toggle">
          <span class="grow settings-label">Reduce motion</span>
          <input type="checkbox" aria-label="Reduce motion" checked={s.reduceMotion} onChange={(e) => patchSettings({ reduceMotion: (e.target as HTMLInputElement).checked })} />
        </label>
        <label class="card row toggle">
          <span class="grow">
            <span class="settings-label">Colorblind patterns</span>
            <div class="small muted">Adds patterns to banners and borders where supported.</div>
          </span>
          <input
            type="checkbox"
            aria-label="Colorblind patterns"
            checked={s.colorblindPatterns}
            onChange={(e) => patchSettings({ colorblindPatterns: (e.target as HTMLInputElement).checked })}
          />
        </label>
      </div>
    </div>
  );
}

/** Skip or replay the in-game guide (progress is per game). */
function GuideSettings() {
  const off = guide.value.disabled;
  const inGame = route.value === 'game' && game.value !== null;
  return (
    <div class="card">
      <div class="small">
        {off ? 'The guide is off.' : 'The guide offers one short tip at a time over your first turns.'}
      </div>
      <div class="row mt8">
        {!off && (
          <button
            class="btn"
            onClick={() => {
              skipGuide();
              pushToast('Guide skipped. You can replay it here any time.', 'info');
            }}
          >
            Skip the guide
          </button>
        )}
        <button
          class="btn"
          onClick={() => {
            replayGuide();
            pushToast(inGame ? 'The guide starts over for this game.' : 'The guide is back on.', 'info');
          }}
        >
          Replay the guide
        </button>
      </div>
    </div>
  );
}
