/**
 * UI side of the audio (GDD §11 "Audio"): unlock on the first tap, settings, sim events,
 * interface sounds and the ambient bed. The engine lives in src/audio (fixed API, a safe no-op
 * until it is ready); this file only decides *when* to call it.
 *
 * One interface sound per tap: a delegated listener plays 'tap' for any button, unless
 * something more specific claimed that tap (opening a screen, seating a figure, ending the
 * turn…). Sounds that a sim event already covers (recruit, adopt, envoy, war) are left to
 * `playEvents` so nothing plays twice.
 */
import { effect } from '@preact/signals';
import type { Age } from '@contracts/content-schemas';
import type { Command } from '@contracts/sim-api';
import { audio, type Sfx } from '../audio';
import { content, game, me, modal, q, route, selection } from './store';
import { settings } from './shell/shell-state';

let claimed = false;

/** Play an interface sound and claim the current tap (so the generic 'tap' is skipped). */
export const uiSound = (sfx: Sfx): void => {
  claimed = true;
  audio.play(sfx);
};

/** Interface sounds for commands the UI sends that no sim event voices. */
export const COMMAND_SFX: Partial<Record<Command['type'], Sfx>> = {
  endTurn: 'endTurn',
  seatFigure: 'seat',
  unseatFigure: 'close',
  activateFigure: 'activate',
  buyItem: 'coin',
  upgradeSettlement: 'coin',
  deployFigure: 'open',
  recallFigure: 'close',
  setProduction: 'select',
  setResearch: 'select',
  fortify: 'select',
};

export const commandSound = (cmd: Command): void => {
  const sfx = COMMAND_SFX[cmd.type];
  if (sfx) uiSound(sfx);
};

/** Normalised culture weights (0..1, heaviest = 1) for the ambience tint. */
export const normalizeWeights = (w: Record<string, number>): Record<string, number> => {
  const max = Math.max(0, ...Object.values(w));
  const out: Record<string, number> = {};
  if (max <= 0) return out;
  for (const [k, v] of Object.entries(w)) if (v > 0) out[k] = Math.round((v / max) * 100) / 100;
  return out;
};

export const initUiAudio = (): void => {
  // Browsers allow sound only after a gesture.
  const unlock = (): void => {
    audio.unlock();
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  // Generic tap: decided after the click's handlers ran (they may claim it).
  document.addEventListener(
    'click',
    (e) => {
      const btn = (e.target as Element | null)?.closest?.('button, [role="radio"], [role="tab"], label.toggle');
      claimed = false;
      if (!btn || (btn as HTMLButtonElement).disabled) return;
      queueMicrotask(() => {
        if (!claimed) audio.play('tap');
        claimed = false;
      });
    },
    true,
  );

  effect(() => {
    const s = settings.value;
    audio.setSettings({ sfxVolume: s.sfxVolume, musicVolume: s.musicVolume, muted: s.muted });
  });

  // Screens and sheets opening and closing.
  let lastModal: string | null = null;
  effect(() => {
    const m = modal.value;
    const kind = m ? m.kind : null;
    if (kind === lastModal) return;
    const was = lastModal;
    lastModal = kind;
    // The Chronicle has its own sting (the story's payoff); the transition is voiced by the
    // sim's ageEnded/ageStarted cadence, so it opens silently (no doubled sounds).
    if (kind === 'chronicle') uiSound('chronicle');
    else if (kind === 'transition') claimed = true;
    else if (kind && !was) uiSound('open');
    else if (!kind && was) uiSound('close');
    else if (kind) uiSound('open');
  });

  // Unit selection on the map.
  let lastUnit: string | null = null;
  effect(() => {
    const u = selection.value.unit;
    if (u === lastUnit) return;
    if (u) audio.play('select');
    else if (lastUnit) audio.play('deselect');
    lastUnit = u;
  });

  // Ambient bed: per age, tinted by culture weight, darker in a crisis; calm on the title.
  let ambienceKey = '';
  effect(() => {
    const r = route.value;
    const g = game.value;
    const my = me.value;
    let scene: { age: Age | null; cultures?: Record<string, number>; crisis?: boolean };
    if (r !== 'game' || !g) scene = { age: 'ancient', cultures: {}, crisis: false };
    else {
      const weights = my ? normalizeWeights(q.cultureWeights(g, my, content)) : {};
      scene = { age: g.age, cultures: weights, crisis: g.crisis !== null };
    }
    const key = JSON.stringify(scene);
    if (key === ambienceKey) return;
    ambienceKey = key;
    audio.setAmbience(scene);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') audio.suspend();
    else audio.resume();
  });
};
