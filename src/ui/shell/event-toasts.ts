/**
 * Translates SimEvents into toasts and renderer flashes for the human player. Pure: names come
 * in through `EventNames` (built from content + the latest snapshot by app-wiring.ts), so this
 * runs in Node tests. Events about other players are shown only when the human should know
 * (world news like wonders, wars, crises, eliminations); never anything affinity-derived.
 */
import type { Hex } from '@contracts/hex';
import type { GameState, PlayerId, SimEvent } from '@contracts/sim-api';
import type { Modal, Toast } from '../store';

export interface ToastSpec {
  text: string;
  tone: Toast['tone'];
  action: Modal | null;
  /** Where it happened: tapping the toast centers the map there. */
  at?: Hex;
}

export interface EventNames {
  owner(id: PlayerId): string;
  figure(id: string): string;
  settlement(id: string): { name: string; owner: PlayerId; at?: Hex } | null;
  /** Unit, building or wonder (one shared namespace). */
  item(id: string): string;
  research(id: string): string;
  /** `${milestoneId}:${tier}` -> player-facing description. */
  milestone(key: string): string;
  crisis(id: string): string;
  deed(id: string): string;
  /** Display name of a unit by id (it may have died: look in the previous snapshot too). */
  unit?(id: string): string | null;
}

/** "Raiders’ warrior", "Rome’s warrior". */
export const possessive = (name: string): string => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

/** Combat seen by the human: what happened to our unit (or walls), in plain words. */
const combatToast = (ev: Extract<SimEvent, { type: 'combat' }>, me: PlayerId, n: EventNames): ToastSpec | null => {
  const unitName = (id: string | null): string => (id ? (n.unit?.(id) ?? 'unit') : 'walls');
  if (ev.attackerOwner === me) {
    const target = `${possessive(n.owner(ev.defenderOwner))} ${ev.defender ? unitName(ev.defender) : 'walls'}`;
    const plural = !ev.defender; // "walls"
    const result = ev.defenderDied
      ? `${target} ${plural ? 'were breached' : 'was destroyed'}`
      : `${target} lost ${Math.round(ev.damageToDefender)} HP`;
    const cost = ev.attackerDied ? `; our ${unitName(ev.attacker)} fell` : ev.damageToAttacker > 0 ? `; ours lost ${Math.round(ev.damageToAttacker)}` : '';
    return { text: `${result}${cost}.`, tone: ev.attackerDied ? 'bad' : 'good', action: null, at: ev.at };
  }
  if (ev.defenderOwner === me) {
    const ours = ev.defender ? `our ${unitName(ev.defender)}` : 'our walls';
    const what = ev.defenderDied
      ? `${ours} ${ev.defender ? 'was destroyed' : 'were breached'}`
      : `${ours} lost ${Math.round(ev.damageToDefender)} HP`;
    const back = ev.attackerDied ? ' The attacker fell.' : '';
    return { text: `${n.owner(ev.attackerOwner)} attacked: ${what}.${back}`, tone: 'bad', action: null, at: ev.at };
  }
  return null;
};

export const eventToToast = (ev: SimEvent, me: PlayerId, n: EventNames): ToastSpec | null => {
  switch (ev.type) {
    case 'combat':
      return combatToast(ev, me, n);
    case 'cultureHint':
      return ev.player === me ? { text: ev.text, tone: 'culture', action: null } : null;
    case 'offerCreated':
      return ev.player === me
        ? { text: 'Someone famous wants to join you.', tone: 'culture', action: { kind: 'offer', offer: ev.offer } }
        : null;
    case 'figureRecruited':
      return ev.player === me
        ? { text: `${n.figure(ev.figure)} joined you.`, tone: 'good', action: { kind: 'figure', figure: ev.figure } }
        : null;
    case 'figureJoinedRival':
      // `player` is who lost the figure, `rival` who got them.
      return ev.player === me ? { text: `${n.figure(ev.figure)} joined a rival.`, tone: 'bad', action: null } : null;
    case 'figureCaptured':
      if (ev.to === me) return { text: `${n.figure(ev.figure)} is now with us.`, tone: 'good', action: { kind: 'figure', figure: ev.figure } };
      if (ev.from === me) return { text: `${n.figure(ev.figure)} was taken by ${n.owner(ev.to)}.`, tone: 'bad', action: null };
      return null;
    case 'researchCompleted':
      return ev.player === me
        ? { text: `${ev.tree === 'tech' ? 'Researched' : 'Adopted'} ${n.research(ev.id)}.`, tone: 'good', action: { kind: 'tree', tree: ev.tree } }
        : null;
    case 'productionCompleted': {
      if (ev.player !== me) return null;
      const s = n.settlement(ev.settlement);
      return {
        text: `${s?.name ?? 'A city'} finished ${n.item(ev.item)}.`,
        tone: 'good',
        action: { kind: 'city', settlement: ev.settlement },
      };
    }
    case 'wonderBuilt':
      return ev.player === me
        ? { text: `${n.item(ev.wonder)} is complete!`, tone: 'good', action: { kind: 'city', settlement: ev.settlement } }
        : { text: `${n.owner(ev.player)} built ${n.item(ev.wonder)}.`, tone: 'info', action: null };
    case 'settlementGrew': {
      const s = n.settlement(ev.settlement);
      return s && s.owner === me ? withAt({ text: `${s.name} grew to ${ev.population}.`, tone: 'info', action: null }, s.at) : null;
    }
    case 'settlementFounded':
      return null; // the founder saw it happen; rivals' foundings are not news
    case 'settlementCaptured': {
      const st = n.settlement(ev.settlement);
      const name = st?.name ?? 'A settlement';
      if (ev.to === me) return { text: `We took ${name}!`, tone: 'good', action: { kind: 'city', settlement: ev.settlement } };
      if (ev.from === me) return withAt({ text: `${name} fell to ${n.owner(ev.to)}.`, tone: 'bad', action: null }, st?.at);
      return null;
    }
    case 'warDeclared':
      if (ev.on === me) return { text: `${n.owner(ev.by)} declared war on us!`, tone: 'bad', action: { kind: 'diplomacy' } };
      if (ev.by === me) return { text: `We are at war with ${n.owner(ev.on)}.`, tone: 'bad', action: { kind: 'diplomacy' } };
      return { text: `${n.owner(ev.by)} declared war on ${n.owner(ev.on)}.`, tone: 'info', action: null };
    case 'peaceMade':
      if (ev.a === me || ev.b === me) {
        const other = ev.a === me ? ev.b : ev.a;
        return { text: `Peace with ${n.owner(other)}.`, tone: 'good', action: { kind: 'diplomacy' } };
      }
      return null;
    case 'milestoneReached':
      return ev.player === me ? { text: `Milestone: ${n.milestone(ev.milestone)}.`, tone: 'good', action: { kind: 'legacy' } } : null;
    case 'crisisStarted':
      return { text: `Crisis: ${n.crisis(ev.crisis)} has begun.`, tone: 'bad', action: { kind: 'crisis' } };
    case 'crisisStage':
      return { text: `${n.crisis(ev.crisis)} deepens (stage ${ev.stage}).`, tone: 'bad', action: { kind: 'crisis' } };
    case 'deedCompleted':
      return ev.player === me
        ? { text: `Deed done: ${n.deed(ev.deed)}. ${n.figure(ev.figure)} takes notice.`, tone: 'culture', action: null }
        : { text: `${n.owner(ev.player)} achieved ${n.deed(ev.deed)}.`, tone: 'info', action: null };
    case 'playerEliminated':
      return ev.player === me
        ? { text: 'Our people have been conquered.', tone: 'bad', action: null }
        : { text: `${n.owner(ev.player)} has fallen.`, tone: 'info', action: null };
    case 'notice':
      return ev.player === null || ev.player === me ? { text: ev.text, tone: 'info', action: null } : null;
    case 'tradeRouteOpened': {
      if (ev.player !== me) return null;
      const to = n.settlement(ev.to);
      return withAt({ text: `Trade route opened to ${to?.name ?? 'a far city'}: gold every turn.`, tone: 'good', action: null }, to?.at);
    }
    case 'ageStarted':
      // Shown when the transition screen closes (toasts wait under full screens).
      return { text: `The ${AGE_WORD[ev.age]} age begins. New figures, new trees, a new meter.`, tone: 'culture', action: null };
    default:
      return null;
  }
};

const AGE_WORD: Record<string, string> = { ancient: 'Ancient', classical: 'Classical', exploration: 'Exploration', modern: 'Modern' };

const withAt = (t: ToastSpec, at: Hex | undefined): ToastSpec => (at ? { ...t, at } : t);

export type FlashKindSpec = 'combat' | 'found' | 'capture' | 'recruit';

/** Where to flash the map for an event, if anywhere. Uses the snapshot that came with it. */
export const eventFlash = (ev: SimEvent, state: GameState): { hex: Hex; kind: FlashKindSpec } | null => {
  switch (ev.type) {
    case 'combat':
      return { hex: ev.at, kind: 'combat' };
    case 'settlementFounded': {
      const s = state.settlements[ev.settlement];
      return s ? { hex: s.at, kind: 'found' } : null;
    }
    case 'settlementCaptured': {
      const s = state.settlements[ev.settlement];
      return s ? { hex: s.at, kind: 'capture' } : null;
    }
    case 'figureRecruited': {
      const f = state.figures[ev.figure];
      const loc = f?.location;
      if (loc?.state === 'based') {
        const s = state.settlements[loc.settlement];
        return s ? { hex: s.at, kind: 'recruit' } : null;
      }
      if (loc?.state === 'unit') {
        const u = state.units[loc.unit];
        return u ? { hex: u.at, kind: 'recruit' } : null;
      }
      return null;
    }
    default:
      return null;
  }
};

/** How long a toast stays up. Culture hints are the emotional beat; give them time. */
export const toastDuration = (tone: Toast['tone']): number => (tone === 'culture' ? 8000 : tone === 'bad' ? 6000 : 4000);

/**
 * Importance of a toast, lower = more important. Threats you must act on first (war on us, a
 * crisis), then a figure waiting for an answer, then other losses, culture hints, our successes,
 * world news last.
 */
export const toastPriority = (t: ToastSpec): number => {
  if (t.tone === 'bad' && t.action) return 0;
  if (t.tone === 'culture' && t.action) return 1;
  if (t.tone === 'bad') return 2;
  if (t.tone === 'culture') return 3;
  if (t.tone === 'good' && t.action) return 4;
  if (t.tone === 'good') return 5;
  return 6;
};

/** At most this many toasts on screen at once. */
export const MAX_TOASTS = 3;

/**
 * Orders one batch of toasts (e.g. everything that happened since the player's last turn) by
 * importance, keeping arrival order within a level, and folds the overflow into one summary line
 * so a busy turn start is not a wall of banners. Pure.
 */
export const rankToasts = (specs: readonly ToastSpec[], max: number = MAX_TOASTS): ToastSpec[] => {
  // Two toasts that open the same screen say the same thing ("crisis began", "stage 1"): keep the first.
  const seen = new Set<string>();
  const unique = specs.filter((t) => {
    if (!t.action || (t.action.kind !== 'crisis' && t.action.kind !== 'offer')) return true;
    const k = JSON.stringify(t.action);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const sorted = unique
    .map((t, i) => ({ t, i }))
    .sort((a, b) => toastPriority(a.t) - toastPriority(b.t) || a.i - b.i)
    .map((x) => x.t);
  if (sorted.length <= max) return sorted;
  const shown = sorted.slice(0, Math.max(0, max - 1));
  const rest = sorted.length - shown.length;
  return [...shown, { text: `+${rest} more ${rest === 1 ? 'update' : 'updates'} this turn.`, tone: 'info', action: { kind: 'log' } }];
};

/** Two modals are "the same place" for a toast's purposes (opening one answers the toast). */
export const sameModal = (a: Modal, b: Modal): boolean => JSON.stringify(a) === JSON.stringify(b);
