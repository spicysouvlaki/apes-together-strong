/**
 * Sim events -> what the viewer hears. Pure and unit-tested.
 *
 * Own events play at full level; rivals' events only when they matter to the viewer (war on
 * us, our city taken, a rival's wonder as a soft distant cue); everything else is silent.
 * A batch is collapsed (ten `settlementGrew` = one soft tick), ordered by importance and
 * spaced 120–250 ms apart with a ~3 s cap, so a busy turn start sounds like a phrase.
 */
import type { PlayerId, SettlementId, SimEvent } from '@contracts/sim-api';
import { RECIPES } from './recipes';
import type { Sfx } from './types';

export interface PlannedSound {
  sfx: Sfx;
  delayMs: number;
  /** 0..1, multiplies the sound's own level. */
  gain: number;
  /** Heard from afar: muffled and wetter. */
  distant: boolean;
}

export interface PlanOptions {
  /**
   * Owner of a settlement, from the latest snapshot. `settlementGrew` carries no player, so
   * without this lookup growth is silent (we never leak a rival's growth).
   */
  settlementOwner?: (id: SettlementId) => PlayerId | null | undefined;
  maxSounds?: number;
  maxSpanMs?: number;
  /**
   * The sound that just played (the previous batch's last). If this batch would open with the
   * same sound, the next one goes first, so the player never hears the same sound twice in a row.
   */
  avoidFirst?: Sfx;
}

/** A sound an event asks for. `prio`: lower = more important. */
export interface Cue {
  sfx: Sfx;
  prio: number;
  gain: number;
  distant?: boolean;
}

type EventType = SimEvent['type'];
type Handler<K extends EventType> = (ev: Extract<SimEvent, { type: K }>, me: PlayerId | null, o: PlanOptions) => Cue | Cue[] | null;

const cue = (sfx: Sfx, prio: number, gain = 1, distant = false): Cue => ({ sfx, prio, gain, distant });

/**
 * One entry per SimEvent type; the mapped type makes a new event type a compile error until
 * it is mapped here (and the test enumerates the keys).
 */
export const EVENT_CUES: { [K in EventType]: Handler<K> } = {
  turnStarted: () => cue('turnStart', 8, 0.8),
  offerCreated: (e, me) => (e.player === me ? cue('offer', 1) : null),
  figureRecruited: (e, me) => (e.player === me ? cue('recruit', 1) : null),
  // `player` lost the figure to `rival`.
  figureJoinedRival: (e, me) => (e.player === me ? cue('unitLost', 3, 0.6) : null),
  figureRetired: (e, me) => (e.player === me ? cue('close', 6, 0.8) : null),
  figureCaptured: (e, me) => (e.to === me ? cue('victory', 2) : e.from === me ? cue('unitLost', 2) : null),
  deedCompleted: (e, me) => (e.player === me ? cue('activate', 3) : null),
  cultureHint: (e, me) => (e.player === me ? cue('hint', 3) : null),
  settlementFounded: (e, me) => (e.player === me ? cue('found', 4) : null),
  settlementGrew: (e, me, o) => {
    const owner = o.settlementOwner?.(e.settlement);
    return owner !== undefined && owner !== null && owner === me ? cue('tap', 9, 0.7) : null;
  },
  settlementCaptured: (e, me) => (e.to === me ? cue('victory', 1) : e.from === me ? cue('war', 0, 0.9) : null),
  productionCompleted: (e, me) => (e.player === me ? cue('build', 4) : null),
  wonderBuilt: (e, me) => (e.player === me ? cue('wonder', 1) : cue('wonder', 7, 0.3, true)),
  researchCompleted: (e, me) => (e.player === me ? cue('research', 4) : null),
  combat: (e, me) => {
    if (e.attackerOwner !== me && e.defenderOwner !== me) return null;
    const out: Cue[] = [];
    // The sim does not say melee or ranged; an attacker that took no damage and did not
    // fight walls is almost always a ranged attack.
    const ranged = e.damageToAttacker === 0 && !e.attackerDied && e.defender !== null;
    out.push(cue(ranged ? 'ranged' : 'attack', 5, e.attackerOwner === me ? 1 : 0.8));
    const myLoss = (e.attackerOwner === me && e.attackerDied) || (e.defenderOwner === me && e.defenderDied);
    const theirLoss = (e.attackerOwner === me && e.defenderDied) || (e.defenderOwner === me && e.attackerDied);
    if (myLoss) out.push(cue('unitLost', 2));
    else if (theirLoss) out.push(cue('victory', 3, 0.7));
    return out;
  },
  warDeclared: (e, me) => (e.on === me ? cue('war', 0) : e.by === me ? cue('war', 1, 0.9) : null),
  peaceMade: (e, me) => (e.a === me || e.b === me ? cue('peace', 2) : null),
  envoySent: (e, me) => (e.player === me ? cue('envoy', 5) : null),
  suzerainChanged: (e, me) => (e.suzerain !== null && e.suzerain === me ? cue('adopt', 4, 0.7) : null),
  tradeRouteOpened: (e, me) => (e.player === me ? cue('coin', 6) : null),
  milestoneReached: (e, me) => (e.player === me ? cue('milestone', 2) : null),
  crisisStarted: () => cue('crisis', 1),
  crisisStage: () => cue('crisis', 2, 0.7),
  traditionAdopted: (e, me) => (e.player === me ? cue('adopt', 3) : null),
  hybridAdopted: (e, me) => (e.player === me ? cue('adopt', 3) : null),
  civNamed: (e, me) => (e.player === me ? cue('milestone', 2, 0.8) : null),
  ageProgress: () => null,
  // ageEnd then ageStart: the IV -> i cadence (spaced specially below).
  ageEnded: () => cue('ageEnd', 1),
  transitionStarted: () => null,
  ageStarted: () => cue('ageStart', 1.1),
  playerEliminated: (e, me) => (e.player === me ? cue('defeat', 0) : cue('war', 7, 0.3, true)),
  gameEnded: (e, me) => (me === null ? null : e.winner === me ? cue('wonder', 0) : cue('defeat', 0)),
  notice: () => null,
};

/** A busy turn start is a short phrase: at most 5 sounds, done in about 3 s. */
export const DEFAULT_MAX_SOUNDS = 5;
export const DEFAULT_MAX_SPAN_MS = 3000;
export const MIN_GAP_MS = 120;
export const MAX_GAP_MS = 250;
/** Room after a big or fanfare sound (offer, war, wonder…) so the next one does not smear it. */
export const BIG_GAP_MS = 400;
/** The new age's chord gets this long on its own before anything else in the batch. */
export const AFTER_CADENCE_MS = 1000;
/** No sound may start so late that it rings past the span by more than this (cadence excepted). */
export const TAIL_ALLOWANCE_MS = 600;
/** ageEnd's G chord rings this long before ageStart answers on D. */
export const CADENCE_GAP_MS = 1100;

const cuesFor = (ev: SimEvent, me: PlayerId | null, o: PlanOptions): Cue[] => {
  const h = EVENT_CUES[ev.type] as Handler<EventType>;
  const c = h(ev as never, me, o);
  return c === null ? [] : Array.isArray(c) ? c : [c];
};

/** Gap after a sound: longer sounds earn a bit more room before the next one. */
export const gapAfter = (sfx: Sfx): number => {
  const r = RECIPES[sfx];
  if (sfx === 'ageStart') return AFTER_CADENCE_MS;
  if (r.tier === 'big' || r.tier === 'fanfare') return BIG_GAP_MS;
  return Math.round(Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, r.dur * 1000 * 0.3)));
};

export const planEvents = (events: readonly SimEvent[], viewer: PlayerId | null, o: PlanOptions = {}): PlannedSound[] => {
  // Collapse duplicates: one entry per sfx, most important prio, loudest gain (+ a little
  // for the count), audible from near if any instance was near.
  const merged = new Map<Sfx, { cue: Cue; count: number; order: number }>();
  let order = 0;
  for (const ev of events) {
    for (const c of cuesFor(ev, viewer, o)) {
      const m = merged.get(c.sfx);
      if (!m) merged.set(c.sfx, { cue: { ...c, distant: c.distant ?? false }, count: 1, order: order++ });
      else {
        m.count += 1;
        m.cue = {
          sfx: c.sfx,
          prio: Math.min(m.cue.prio, c.prio),
          gain: Math.max(m.cue.gain, c.gain),
          distant: (m.cue.distant ?? false) && (c.distant ?? false),
        };
      }
    }
  }
  const ranked = [...merged.values()]
    .map((m) => ({ ...m, cue: { ...m.cue, gain: Math.min(1, m.cue.gain * (1 + 0.08 * Math.min(4, m.count - 1))) } }))
    .sort((a, b) => a.cue.prio - b.cue.prio || a.order - b.order);
  // Keep the cadence together: ageStart always directly answers ageEnd.
  const endIdx = ranked.findIndex((m) => m.cue.sfx === 'ageEnd');
  const startIdx = ranked.findIndex((m) => m.cue.sfx === 'ageStart');
  if (endIdx >= 0 && startIdx >= 0 && startIdx !== endIdx + 1) {
    const [start] = ranked.splice(startIdx, 1);
    if (start) ranked.splice(ranked.findIndex((m) => m.cue.sfx === 'ageEnd') + 1, 0, start);
  }

  // Never open with the sound that just ended the previous batch.
  if (o.avoidFirst && ranked.length > 1 && ranked[0]?.cue.sfx === o.avoidFirst) {
    const second = ranked[1];
    // Keep the cadence pair together: ageEnd is never displaced from before ageStart.
    if (second && second.cue.sfx !== 'ageStart') {
      ranked[1] = ranked[0];
      ranked[0] = second;
    }
  }

  const maxSounds = o.maxSounds ?? DEFAULT_MAX_SOUNDS;
  const maxSpan = o.maxSpanMs ?? DEFAULT_MAX_SPAN_MS;
  const out: PlannedSound[] = [];
  let t = 0;
  for (const { cue: c } of ranked) {
    if (out.length >= maxSounds) break;
    const prev = out[out.length - 1];
    const cadence = prev?.sfx === 'ageEnd' && c.sfx === 'ageStart';
    const at = prev ? t + (cadence ? CADENCE_GAP_MS : gapAfter(prev.sfx)) : 0;
    if (at > maxSpan) break;
    // A long sound late in the phrase would ring on well past it: leave it out.
    if (prev && !cadence && at + RECIPES[c.sfx].dur * 1000 > maxSpan + TAIL_ALLOWANCE_MS) continue;
    t = at;
    out.push({ sfx: c.sfx, delayMs: t, gain: c.gain, distant: c.distant ?? false });
  }
  return out;
};
