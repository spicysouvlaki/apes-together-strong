/**
 * "What they would do for you, now" (wave 13 playtest: offers felt like interruptions with little
 * choice). For each candidate, three short lines from rules the sim already exposes, never new
 * rules: the cabinet seat they would fill and what it changes (CabinetSeat + the figure's own
 * modifiers), how they move your culture weight toward traditions and hybrids (cultureWeights +
 * the refinement tiers, GDD §6), and what passing keeps (the skip refund, GDD §4). Pure.
 */
import type { ContentBundle, Figure, Tradition } from '@contracts/content-schemas';
import type { CabinetSeat, CultureId, GameState, Offer, PlayerId } from '@contracts/sim-api';
import { slotAccepts } from '../../../emergence/cabinet';
import { SKIP_REFUND_SHARE } from '../../../emergence/constants';
import { TIER_WEIGHT } from '../../../sim/ages/constants';
import { ageIndex } from '../../../sim/ages/util';
import { describeActivate, describeModifiers, GP_LABEL, type NameLookup } from './describe';

export interface PitchLine {
  /** 'seat' | 'field' | 'deed' | 'culture' | 'pass' (picks the icon). */
  kind: 'seat' | 'field' | 'deed' | 'culture' | 'pass';
  text: string;
  /** A real gain now (bold) rather than a later possibility. */
  strong?: boolean;
}

export interface PitchInputs {
  state: GameState;
  me: PlayerId;
  offer: Offer;
  def: Figure;
  seats: readonly CabinetSeat[];
  weights: Record<CultureId, number>;
  content: ContentBundle;
  l: NameLookup;
}

const seatName = (content: ContentBundle, key: string): string => content.cabinetSlots.find((s) => s.id === key.split('#')[0])?.name ?? 'cabinet';
const figName = (content: ContentBundle, id: string): string =>
  (content.figures.find((f) => f.id === id)?.name ?? 'someone').replace(/\s*\([^)]*\)\s*$/, '').replace(/^(A|An|The) /, (m) => m.toLowerCase());
const cultureOf = (content: ContentBundle, id: CultureId): { name: string; adjective: string } => content.cultures.find((c) => c.id === id) ?? { name: id, adjective: id };
const firstEffect = (text: string): string => text.split('; ')[0] ?? text;

/** What their cabinet seat (or field role, or deed) does for this player right now. */
export const seatLine = (x: PitchInputs): PitchLine => {
  const { def, seats, state, me, content, l } = x;
  const p = state.players[me];
  if (def.uses.includes('cabinet')) {
    const bonus = def.cabinetModifiers.length ? firstEffect(describeModifiers(def.cabinetModifiers, l).join('; ')) : 'counts double toward your culture';
    if (!p?.government) return { kind: 'seat', text: `No government yet, so no seat: once you choose one, ${bonus.charAt(0).toLowerCase()}${bonus.slice(1)}.` };
    const fitting = seats.filter((s) => slotAccepts(content, s.key, def));
    const free = fitting.find((s) => s.figure === null && s.availableTurn <= state.turn);
    if (free) return { kind: 'seat', text: `Fills your empty ${seatName(content, free.key)} seat: ${bonus}.`, strong: true };
    const soon = fitting.find((s) => s.figure === null);
    if (soon) return { kind: 'seat', text: `${seatName(content, soon.key)} seat free on turn ${soon.availableTurn}: then ${bonus.charAt(0).toLowerCase()}${bonus.slice(1)}.` };
    const held = fitting.find((s) => s.figure !== null);
    if (held?.figure) return { kind: 'seat', text: `${figName(content, held.figure).replace(/^./, (c) => c.toUpperCase())} holds your ${seatName(content, held.key)} seat: they would wait at home, or swap in for ${bonus.charAt(0).toLowerCase()}${bonus.slice(1)}.` };
    // No fitting seat in this government: fall through to the field or the deed.
  }
  if (def.uses.includes('unit')) {
    const aura = def.unitModifiers.length ? firstEffect(describeModifiers(def.unitModifiers, l, { unitSubject: 'them and adjacent units' }).join('; ')) : 'a strong unit of their own';
    return { kind: 'field', text: `Takes the field: ${aura}.`, strong: def.uses.length === 1 || !def.uses.includes('cabinet') };
  }
  if (def.activate) return { kind: 'deed', text: `One great deed: ${describeActivate(def.activate.effect, def.activate.amount)}.`, strong: true };
  return { kind: 'seat', text: 'Your government has no seat for them yet: they would wait at home.' };
};

/** Traditions of `culture` the player could take by the next refinement, by tier weight. */
const traditionsAt = (content: ContentBundle, culture: CultureId, weight: number, upToAge: number): Tradition[] =>
  content.traditions.filter((t) => t.culture === culture && TIER_WEIGHT[t.tier] === weight && ageIndex(t.age) <= upToAge);

const names = (list: readonly { name: string }[], max = 2): string => {
  const n = list.slice(0, max).map((x) => x.name);
  return list.length > max ? `${n.join(', ')}…` : n.join(' and ');
};

/** How recruiting them moves culture weight, and what that opens at the next refinement. */
export const cultureLine = (x: PitchInputs): PitchLine => {
  const { def, weights, content, state, me } = x;
  const c = def.culture;
  const from = weights[c] ?? 0;
  const to = from + 1;
  const adj = cultureOf(content, c).adjective;
  const upTo = ageIndex(state.age) + 1; // refinement happens as the age turns
  const opened = traditionsAt(content, c, to, upTo);
  const hybrids = content.hybrids.filter((h) => {
    if (!h.cultures.includes(c) || ageIndex(h.age) > upTo || state.players[me]?.hybrids.includes(h.id)) return false;
    const other = h.cultures[0] === c ? h.cultures[1] : h.cultures[0];
    return to >= h.minWeight && from < h.minWeight && (weights[other] ?? 0) >= h.minWeight;
  });
  const head = from === 0 ? `Your first ${adj} figure` : `${adj} weight ${from} to ${to}`;
  if (hybrids.length > 0) return { kind: 'culture', text: `${head}: the hybrid ${names(hybrids, 1)} opens at the next refinement.`, strong: true };
  if (opened.length > 0) return { kind: 'culture', text: `${head}: ${adj} ${opened[0]?.tier === 'custom' ? 'customs' : opened[0]?.tier === 'institution' ? 'institutions' : 'signatures'} open at the next refinement (${names(opened)}).`, strong: true };
  const next = (['custom', 'institution', 'signature'] as const).map((t) => TIER_WEIGHT[t]).find((w) => w > to);
  const pair = content.hybrids.find((h) => h.cultures.includes(c) && ageIndex(h.age) <= upTo && to < h.minWeight);
  if (next !== undefined) return { kind: 'culture', text: `${head}, ${next - to} short of ${adj} ${next === TIER_WEIGHT.institution ? 'institutions' : 'signatures'}${pair ? ` and hybrids like ${pair.name}` : ''}.` };
  return { kind: 'culture', text: `${head}: deepens what you already carry.` };
};

/** The heaviest culture (ties: content order), as the refinement discount reads it. */
const heaviest = (weights: Record<CultureId, number>, content: ContentBundle): CultureId | null => {
  let best: CultureId | null = null;
  let w = 0;
  for (const c of content.cultures) {
    const v = weights[c.id] ?? 0;
    if (v > w) {
      best = c.id;
      w = v;
    }
  }
  return best;
};

/** What declining keeps, when declining keeps anything. */
export const passLine = (x: PitchInputs): PitchLine => {
  const { offer, def, weights, content, state, me } = x;
  if (offer.source === 'deed') return { kind: 'pass', text: 'Passing loses them for good: a deed calls each figure once.' };
  if (offer.source === 'legend') return { kind: 'pass', text: 'Passing keeps this age’s one legend slot open for another.' };
  const before = heaviest(weights, content);
  const after = heaviest({ ...weights, [def.culture]: (weights[def.culture] ?? 0) + 1 }, content);
  if (before && after && before !== after) {
    return { kind: 'pass', text: `Passing keeps ${cultureOf(content, before).adjective} your heaviest culture (its refinements stay discounted).` };
  }
  const p = state.players[me];
  const pool = offer.source;
  const refund = p ? Math.round(SKIP_REFUND_SHARE * (p.gpThreshold[pool] ?? 0)) : 0;
  return { kind: 'pass', text: `Passing banks +${refund} ${GP_LABEL[pool].toLowerCase()} points toward the next offer${p ? ` (${Math.floor((p.gp[pool] ?? 0) + refund)} of ${Math.round(p.gpThreshold[pool] ?? 0)})` : ''}; they may join a rival.` };
};

export const offerPitch = (x: PitchInputs): PitchLine[] => [seatLine(x), cultureLine(x), passLine(x)];
