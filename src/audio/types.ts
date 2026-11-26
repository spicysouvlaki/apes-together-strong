/**
 * Public audio types (GDD §11 "Audio"). Kept apart from index.ts so the pure modules
 * (recipes, planner, composer) can import them without pulling in the engine.
 */
import type { Age } from '@contracts/content-schemas';
import type { PlayerId, SimEvent } from '@contracts/sim-api';

/** One-shot interface and game sounds. */
export type Sfx =
  | 'tap' // any button
  | 'select' // unit or tile selected
  | 'deselect'
  | 'open' // sheet or screen opens
  | 'close'
  | 'error' // rejected command
  | 'move' // unit moves
  | 'found' // settlement founded
  | 'build' // production completed
  | 'wonder'
  | 'research' // tech or civic completed
  | 'attack' // melee hit
  | 'ranged'
  | 'unitLost'
  | 'victory' // battle won / city captured
  | 'offer' // a famous person arrives
  | 'recruit' // figure welcomed
  | 'seat' // figure seated
  | 'activate' // figure's deed
  | 'hint' // culture hint toast
  | 'coin' // purchase
  | 'envoy'
  | 'war'
  | 'peace'
  | 'crisis'
  | 'milestone'
  | 'adopt' // tradition or hybrid adopted
  | 'ageEnd'
  | 'ageStart'
  | 'endTurn'
  | 'turnStart'
  | 'defeat'
  | 'chronicle';

export interface AudioSettings {
  /** 0–100 */
  sfxVolume: number;
  /** 0–100 */
  musicVolume: number;
  muted: boolean;
}

export interface AmbienceScene {
  age: Age | null;
  cultures?: Record<string, number>;
  crisis?: boolean;
}

export interface AudioEngine {
  /** Create/resume the AudioContext. Call from a user gesture; idempotent. */
  unlock(): void;
  play(sfx: Sfx): void;
  /**
   * Play the right sounds for a batch of sim events as heard by `viewer` (own events loud,
   * rivals' quiet or silent), de-duplicated and spaced so a busy turn does not clip.
   */
  playEvents(events: readonly SimEvent[], viewer: PlayerId | null): void;
  /**
   * Set the ambient bed: a quiet generative loop per age, tinted by the player's culture
   * weights (ids from content/cultures.json -> 0..1) and darker while a crisis is active.
   * `null` age stops the ambience (title screen may pass 'ancient').
   */
  setAmbience(scene: { age: Age | null; cultures?: Record<string, number>; crisis?: boolean }): void;
  setSettings(settings: AudioSettings): void;
  /** Pause everything when the tab is hidden; resume when shown. */
  suspend(): void;
  resume(): void;
}
