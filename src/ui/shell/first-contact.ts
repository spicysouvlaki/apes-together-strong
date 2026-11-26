/**
 * First contact as a moment (wave 11 playtest: meeting a rival scrolled by as one ticker line).
 * The sim voices it as a `notice` with kind 'firstContact' and the rival's own words
 * ("The Conqueror of Avarga: “…”"); the UI finds who spoke from that speaker prefix, then shows
 * who they are, what kind of leader leads them, and a way to Nations. Pure except the signal.
 */
import { signal } from '@preact/signals';
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameState, PlayerId, SimEvent } from '@contracts/sim-api';
import { posture, speakerName, type Posture } from '../../sim/voice';

export interface FirstContactMoment {
  player: PlayerId;
  /** What they said, without the speaker prefix. */
  quote: string;
}

/** Moments waiting to be shown, oldest first (two rivals met in one turn both get theirs). */
export const firstContacts = signal<FirstContactMoment[]>([]);

/** The quoted words of a voiced notice ("X: “words”" -> "words"). */
export const quoteOf = (text: string): string => {
  const m = /:\s*“(.*)”\s*$/.exec(text);
  return m?.[1] ?? text;
};

/** The rival who spoke a voiced notice: the longest matching speaker name wins. */
export const speakerOf = (state: GameState, text: string, me: PlayerId, content: ContentBundle): PlayerId | null => {
  let best: { id: PlayerId; len: number } | null = null;
  for (const id of state.playerOrder) {
    if (id === me) continue;
    const name = speakerName(state, id, content);
    if (text.startsWith(`${name}:`) && (!best || name.length > best.len)) best = { id, len: name.length };
  }
  return best?.id ?? null;
};

/** First-contact moments in a batch of events for `me` (resolved against `states`, newest first). */
export const contactMoments = (events: readonly SimEvent[], me: PlayerId, states: readonly (GameState | null)[], content: ContentBundle): FirstContactMoment[] => {
  const out: FirstContactMoment[] = [];
  for (const ev of events) {
    if (ev.type !== 'notice' || ev.kind !== 'firstContact' || (ev.player !== null && ev.player !== me)) continue;
    let who: PlayerId | null = null;
    for (const s of states) if (!who && s) who = speakerOf(s, ev.text, me, content);
    if (who && !out.some((m) => m.player === who)) out.push({ player: who, quote: quoteOf(ev.text) });
  }
  return out;
};

/** What their leader's temperament means for you, in a few words (sim/voice.ts postures). */
export const POSTURE_LINE: Record<Posture, string> = {
  aggressor: 'A warlike people: keep a guard on the border you share.',
  rival: 'A rival for land and favour: expect a race for sites and city-states.',
  trader: 'Open to trade: a merchant could carry goods to their cities.',
  wary: 'Wary but peaceful: they keep their distance and their word.',
};

export const postureOf = (state: GameState, player: PlayerId, content: ContentBundle): Posture => posture(state, player, content);

/**
 * A rival leader speaking outside first contact (wave 13: the war warning before an AI declares,
 * borders, peace, wonders): the notice starts with their speaker name. Such a notice is shown as
 * a small slip in that leader's voice, with their banner, and is never folded into "+N more".
 * Matches on the speaker name exactly as first contact does, so it works whatever `kind` the sim
 * gives it ('other' this wave).
 */
export const voicedNotice = (ev: SimEvent, me: PlayerId, states: readonly (GameState | null)[], content: ContentBundle): FirstContactMoment | null => {
  if (ev.type !== 'notice' || ev.kind === 'firstContact' || (ev.player !== null && ev.player !== me)) return null;
  for (const s of states) {
    const who = s ? speakerOf(s, ev.text, me, content) : null;
    if (who) return { player: who, quote: quoteOf(ev.text) };
  }
  return null;
};

/** The speaker part of a voiced notice ("The Conqueror of Avarga: “…”" -> "The Conqueror of Avarga"). */
export const speakerPart = (text: string): string => {
  const i = text.indexOf(':');
  return i > 0 ? text.slice(0, i) : '';
};
