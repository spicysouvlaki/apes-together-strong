/**
 * A longer aim for a quiet turn (wave 13 playtest: early turns with no decision felt dead, the
 * guide said only "End Turn"). When nothing needs an answer, one slip above the controls names
 * the nearest thing worth working toward: an envoy you can afford, a milestone one step away, a
 * wonder a city could raise soon, an uncharted direction for your scout, else the nearest
 * milestone. Pure: the caller gathers `AimInputs` from the snapshot and SimQueries.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameState, PlayerId, SimQueries, UnitId } from '@contracts/sim-api';
import { isCityStateOwner } from '@contracts/sim-api';
import { hexOfIndex } from '../../sim/lookup';
import type { Modal } from '../store';
import { nearestGoals, type Goal } from './endgame-goals';
import { canExplore } from './orders';

export interface AimInputs {
  influence: number;
  /** City-states the player knows of (their city seen), with the next envoy's price. */
  cityStates: { id: string; name: string; cost: number; suzerainIsMe: boolean; mine: number; lead: number }[];
  goals: readonly Goal[];
  /** Wonders a city of the player's could start, quickest first. */
  wonders: { settlement: string; city: string; name: string; turns: number }[];
  /** The least-charted direction around home, when much is still blank. */
  uncharted: { dir: string; share: number } | null;
  /** A unit that may explore and has moves left (scout first). */
  explorer: UnitId | null;
}

export type AimAction = { kind: 'modal'; modal: Modal } | { kind: 'unit'; unit: UnitId };

export interface Aim {
  id: 'envoy' | 'milestone' | 'wonder' | 'explore';
  text: string;
  action: AimAction;
}

/** A wonder counts as "within reach" at this many turns or fewer. */
export const WONDER_AIM_TURNS = 15;
/** Below this share of a direction charted, it is worth a scout. */
export const UNCHARTED_SHARE = 0.3;

export const pickAim = (x: AimInputs): Aim | null => {
  const envoy = x.cityStates
    .filter((c) => !c.suzerainIsMe && c.cost <= x.influence)
    .sort((a, b) => a.lead - b.lead || a.cost - b.cost || (a.name < b.name ? -1 : 1))[0];
  if (envoy) {
    const lead = envoy.lead <= 1 ? 'and become its suzerain' : `${envoy.lead} envoys make you its suzerain`;
    return { id: 'envoy', text: `Send an envoy to ${envoy.name} (${envoy.cost} influence, you have ${Math.floor(x.influence)}): ${lead}.`, action: { kind: 'modal', modal: { kind: 'diplomacy' } } };
  }
  // One step away and already under way ("wonders built 0/1" is not close: a wonder is far off).
  const close = x.goals.find((g) => g.left === 1 && g.value > 0);
  if (close) return { id: 'milestone', text: close.text.charAt(0).toUpperCase() + close.text.slice(1), action: { kind: 'modal', modal: { kind: 'legacy' } } };
  const wonder = x.wonders.find((w) => w.turns <= WONDER_AIM_TURNS);
  if (wonder) return { id: 'wonder', text: `${wonder.city} could raise ${wonder.name} in ${wonder.turns} turns.`, action: { kind: 'modal', modal: { kind: 'city', settlement: wonder.settlement } } };
  if (x.uncharted && x.explorer) return { id: 'explore', text: `The ${x.uncharted.dir} is still blank parchment: send your explorer ${x.uncharted.dir}.`, action: { kind: 'unit', unit: x.explorer } };
  const goal = x.goals.find((g) => g.value > 0) ?? x.goals[0];
  if (goal) return { id: 'milestone', text: goal.text.charAt(0).toUpperCase() + goal.text.slice(1), action: { kind: 'modal', modal: { kind: 'legacy' } } };
  return null;
};

const DIRS = ['north', 'east', 'south', 'west'] as const;

/** Share of tiles charted in each compass quarter around `home` (axial hexes, pointy top). */
export const chartedByDirection = (state: GameState, me: PlayerId, home: { q: number; r: number }): Record<(typeof DIRS)[number], number> => {
  const seen = { north: 0, east: 0, south: 0, west: 0 };
  const all = { north: 0, east: 0, south: 0, west: 0 };
  const explored = state.players[me]?.explored ?? [];
  const hx = home.q + home.r / 2;
  for (let i = 0; i < state.map.tiles.length; i++) {
    const h = hexOfIndex(state.map, i);
    const dx = h.q + h.r / 2 - hx;
    const dy = (h.r - home.r) * 0.866;
    if (dx === 0 && dy === 0) continue;
    const dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : dy > 0 ? 'south' : 'north';
    all[dir]++;
    if (explored[i]) seen[dir]++;
  }
  const out = { north: 1, east: 1, south: 1, west: 1 };
  for (const d of DIRS) out[d] = all[d] > 0 ? seen[d] / all[d] : 1;
  return out;
};

/** Gather the aim inputs from a snapshot. */
export const aimInputs = (
  state: GameState,
  me: PlayerId,
  content: ContentBundle,
  q: SimQueries,
  /** Units already under a standing order (they are busy). */
  ordered: ReadonlySet<string> = new Set(),
): AimInputs | null => {
  const p = state.players[me];
  if (!p) return null;
  const cityStates: AimInputs['cityStates'] = [];
  for (const cs of Object.values(state.cityStates)) {
    if (!cs.alive) continue;
    const s = state.settlements[cs.settlement];
    if (!s || !isCityStateOwner(s.owner)) continue;
    const idx = s.at.r * state.map.width + (s.at.q + (s.at.r - (s.at.r & 1)) / 2);
    if (!p.explored[idx]) continue;
    const mine = cs.envoys[me] ?? 0;
    const top = Math.max(0, ...Object.entries(cs.envoys).filter(([id]) => id !== me).map(([, n]) => n));
    const lead = Math.max(3, top + 1) - mine;
    cityStates.push({ id: cs.id, name: content.cityStates.find((c) => c.id === cs.id)?.name ?? s.name, cost: q.envoyCost(state, me, cs.id, content), suzerainIsMe: cs.suzerain === me, mine, lead });
  }
  const wonders: AimInputs['wonders'] = [];
  for (const s of Object.values(state.settlements)) {
    if (s.owner !== me || s.kind !== 'city') continue;
    const building = s.production.item;
    if (building && content.wonders.some((w) => w.id === building)) continue;
    for (const o of q.productionOptions(state, s.id, content)) {
      if (o.kind !== 'wonder' || o.turns === null) continue;
      wonders.push({ settlement: s.id, city: s.name, name: content.wonders.find((w) => w.id === o.item)?.name ?? o.item, turns: o.turns });
    }
  }
  wonders.sort((a, b) => a.turns - b.turns || (a.name < b.name ? -1 : 1));
  const home = Object.values(state.settlements).find((s) => s.owner === me && s.isCapital)?.at ?? null;
  let uncharted: AimInputs['uncharted'] = null;
  if (home) {
    const shares = chartedByDirection(state, me, home);
    const worst = DIRS.map((d) => ({ dir: d, share: shares[d] })).sort((a, b) => a.share - b.share)[0];
    if (worst && worst.share < UNCHARTED_SHARE) uncharted = worst;
  }
  const explorers = Object.values(state.units)
    .filter((u) => {
      // Only civilian explorers: sending the city's one soldier away is not advice.
      const def = content.units.find((d) => d.id === u.type);
      return u.owner === me && u.movesLeft > 0 && !u.figure && !ordered.has(u.id) && def?.unitClass === 'civilian' && canExplore(def);
    })
    .sort((a, b) => (a.type === 'scout' ? -1 : 0) - (b.type === 'scout' ? -1 : 0) || (a.id < b.id ? -1 : 1));
  return {
    influence: p.stock.influence,
    cityStates,
    goals: nearestGoals(q.milestones(state, me, content), 3),
    wonders,
    uncharted,
    explorer: explorers[0]?.id ?? null,
  };
};
