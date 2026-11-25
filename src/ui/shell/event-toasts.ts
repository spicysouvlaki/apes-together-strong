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
}

export interface EventNames {
  owner(id: PlayerId): string;
  figure(id: string): string;
  settlement(id: string): { name: string; owner: PlayerId } | null;
  /** Unit, building or wonder (one shared namespace). */
  item(id: string): string;
  research(id: string): string;
  /** `${milestoneId}:${tier}` -> player-facing description. */
  milestone(key: string): string;
  crisis(id: string): string;
  deed(id: string): string;
}

export const eventToToast = (ev: SimEvent, me: PlayerId, n: EventNames): ToastSpec | null => {
  switch (ev.type) {
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
      return s && s.owner === me ? { text: `${s.name} grew to ${ev.population}.`, tone: 'info', action: null } : null;
    }
    case 'settlementFounded':
      return null; // the founder saw it happen; rivals' foundings are not news
    case 'settlementCaptured': {
      const name = n.settlement(ev.settlement)?.name ?? 'A settlement';
      if (ev.to === me) return { text: `We took ${name}!`, tone: 'good', action: { kind: 'city', settlement: ev.settlement } };
      if (ev.from === me) return { text: `${name} fell to ${n.owner(ev.to)}.`, tone: 'bad', action: null };
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
    case 'ageStarted':
      return null; // the transition screen covers it
    default:
      return null;
  }
};

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
