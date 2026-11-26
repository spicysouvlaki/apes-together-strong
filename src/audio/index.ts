/**
 * Audio engine public surface (GDD §11 "Audio"). Main thread only.
 * Everything is synthesised with the Web Audio API (no audio files), so it works offline and
 * costs nothing to precache. The UI calls these; signatures are fixed.
 *
 * Browsers only allow sound after a user gesture: the UI calls `audio.unlock()` from the
 * first tap (calling it on every tap is cheap and recovers from iOS interruptions), and every
 * other call is a safe no-op until then (and in Node, workers and tests).
 *
 * Modules: types (API), theory (the shared key), recipes (the Sfx palette as data), synth
 * (layers -> nodes), graph (buses, reverb, limiter), planner (events -> sounds), composer +
 * voices + ambience (the generative bed), engine (lifecycle, voices, settings).
 */
import { WebAudioEngine } from './engine';
import type { AudioEngine } from './types';

export type { AmbienceScene, AudioEngine, AudioSettings, Sfx } from './types';
export { planEvents, type PlannedSound, type PlanOptions } from './planner';
export { SFX_LIST } from './recipes';

const engine = new WebAudioEngine();

export const audio: AudioEngine = {
  unlock: () => engine.unlock(),
  play: (sfx) => engine.play(sfx),
  playEvents: (events, viewer) => engine.playEvents(events, viewer),
  setAmbience: (scene) => engine.setAmbience(scene),
  setSettings: (settings) => engine.setSettings(settings),
  suspend: () => engine.suspend(),
  resume: () => engine.resume(),
};

/**
 * Optional: give the event planner a settlement-owner lookup from the latest snapshot so the
 * player's own `settlementGrew` events make a soft tick (they carry no player id).
 */
export const setAudioPlanOptions = (o: import('./planner').PlanOptions): void => engine.setPlanOptions(o);

/** Debug counters (demo page). */
export const audioStats = () => engine.stats();

/** The engine itself, for the dev-only demo page's soak and mix tools. */
export const audioEngine = engine;
