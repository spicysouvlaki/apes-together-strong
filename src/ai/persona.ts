/**
 * AI personality (GDD §9): the leader's `aiAgendaBias` plus two agendas derived
 * deterministically from the game seed and player id. Agendas only bias utility weights;
 * every rival plays by the same rules and the same information.
 */
import type { ContentBundle, FigureKind, GpKind, LegacyTrack, Modifier, YieldType } from '@contracts/content-schemas';
import type { GameState, PlayerId } from '@contracts/sim-api';
import { hashStr } from './util';

export const AGENDAS = ['collector', 'seafarer', 'zealot', 'opportunist', 'builder', 'expansionist', 'scholar', 'warmonger'] as const;
export type Agenda = (typeof AGENDAS)[number];

export interface Persona {
  agendas: Agenda[];
  /** 0–2 per agenda: leader bias and derived agendas each add 1. */
  w: Record<Agenda, number>;
  /** Preference per figure kind (≈0–3). */
  kind: Record<FigureKind, number>;
  /** Value of one point of each yield. */
  yieldW: Record<YieldType, number>;
  /** Preference per great-people pool (for gpPoints modifiers). */
  gp: Record<GpKind, number>;
  /** Affinity for each legacy track (strategic focus). */
  track: Record<LegacyTrack, number>;
}

const isAgenda = (s: string): s is Agenda => (AGENDAS as readonly string[]).includes(s);

export const makePersona = (state: GameState, player: PlayerId, content: ContentBundle): Persona => {
  const p = state.players[player];
  const leader = content.leaders.find((l) => l.id === p?.leader);
  const agendas: Agenda[] = (leader?.aiAgendaBias ?? []).filter(isAgenda);
  // Two more agendas from the seed and the player id, distinct from each other (they may
  // repeat a leader agenda, which then counts double).
  const derived: Agenda[] = [];
  for (let i = 0; derived.length < 2 && i < 16; i++) {
    const a = AGENDAS[hashStr(`${state.seed}|${player}|agenda|${i}`) % AGENDAS.length] as Agenda;
    if (!derived.includes(a)) derived.push(a);
  }
  agendas.push(...derived);
  const w = {} as Record<Agenda, number>;
  for (const a of AGENDAS) w[a] = 0;
  for (const a of agendas) w[a] += 1;

  const kind: Record<FigureKind, number> = {
    general: 0.5 + 1.5 * w.warmonger,
    statesman: 0.8 + 1.2 * w.opportunist + 0.6 * w.expansionist + 0.4 * w.collector,
    thinker: 0.8 + 1.5 * w.scholar,
    spiritual: 0.5 + 1.5 * w.zealot,
    builder: 0.7 + 1.5 * w.builder,
    explorer: 0.4 + 1.3 * w.seafarer + 0.5 * w.expansionist,
    legend: 2,
  };
  const yieldW: Record<YieldType, number> = {
    food: 1.2 + 0.4 * w.expansionist + 0.2 * w.seafarer,
    production: 1.2 + 0.5 * w.builder + 0.3 * w.warmonger,
    gold: 0.8 + 0.5 * w.opportunist + 0.4 * w.seafarer,
    science: 1 + 0.8 * w.scholar,
    culture: 0.9 + 0.4 * w.builder + 0.4 * w.collector,
    faith: 0.5 + 1.2 * w.zealot,
    happiness: 0.8 + 0.4 * w.expansionist,
    influence: 0.6 + 0.6 * w.opportunist + 0.4 * w.collector,
  };
  const gp: Record<GpKind, number> = {
    military: kind.general,
    statesman: kind.statesman,
    thought: kind.thinker,
    faith: kind.spiritual,
    building: kind.builder,
    exploration: kind.explorer,
  };
  const track: Record<LegacyTrack, number> = {
    science: 0.5 + w.scholar + 0.3 * w.builder,
    military: 0.3 + w.warmonger + 0.5 * w.expansionist,
    culture: 0.4 + w.builder + 0.5 * w.zealot,
    legacy: 0.6 + w.collector + 0.5 * w.opportunist,
  };
  return { agendas, w, kind, yieldW, gp, track };
};

const COST_TARGET_WEIGHT = (pe: Persona): Record<string, number> => ({
  unit: 0.6 + 0.8 * pe.w.warmonger,
  building: 1,
  wonder: 0.4 + 1 * pe.w.builder,
  settler: 0.6 + 0.8 * pe.w.expansionist,
  tradition: 0.6 + 0.6 * pe.w.collector,
  upgrade: 0.5,
});

/**
 * Rough utility of one modifier for this personality. Used for governments, research,
 * crisis responses, cabinet choices and traditions; it only has to rank options sensibly.
 */
export const modifierScore = (m: Modifier, pe: Persona): number => {
  const e = m.effect;
  const cond = m.when ? 0.6 : 1;
  switch (e.kind) {
    case 'yield': {
      const scale = m.scope === 'tile' ? 2 : m.scope === 'settlement' ? 2 : 1;
      return cond * ((e.add ?? 0) * pe.yieldW[e.yield] * scale + ((e.percent ?? 0) / 8) * pe.yieldW[e.yield]);
    }
    case 'combat':
      return cond * e.add * 0.3 * (1 + pe.w.warmonger);
    case 'movement':
      return cond * e.add * 0.8;
    case 'gpPoints':
      return (e.percent / 20) * pe.gp[e.gp];
    case 'affinityGain':
      return e.percent / 40;
    case 'cost':
      return cond * (-e.percent / 12) * (COST_TARGET_WEIGHT(pe)[e.target] ?? 0.5);
    case 'cabinetSlot':
      return 1.5;
    case 'settlementCap':
      return e.add * 2 * (1 + 0.5 * pe.w.expansionist);
    case 'tradeRoutes':
      return e.add * (0.8 + 0.6 * (pe.w.seafarer + pe.w.opportunist));
    case 'vision':
      return e.add * 0.3;
    case 'unlock':
      return e.what === 'embark' ? 0.4 + pe.w.seafarer : 0.4;
    case 'ignoreCold':
      return 0.5;
  }
};

export const modifiersScore = (mods: readonly Modifier[], pe: Persona): number => {
  let s = 0;
  for (const m of mods) s += modifierScore(m, pe);
  return s;
};
