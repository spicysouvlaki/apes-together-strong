/**
 * Where the player stands (wave 13 playtest: finished 3rd at 380 vs 545 with nothing during play
 * saying they were behind). Reads the Legacy score (GDD §8) the sim already computes for every
 * player, ranks the living, and names only rivals the player has met (an unmet people is "a
 * people you have not met"). The breakdown mirrors sim/ages/score.ts term by term so the Legacy
 * screen can say where a leader's points come from. Pure.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameState, MilestoneProgress, PlayerId } from '@contracts/sim-api';
import {
  LEGACY_POINTS_PER_TIER,
  SCORE_PER_FIGURE,
  SCORE_PER_HYBRID,
  SCORE_PER_SEATED_FIGURE,
  SCORE_PER_SIGNATURE_EXTRA,
  SCORE_PER_TRADITION,
} from '../../sim/ages/constants';

export interface StandingRow {
  id: PlayerId;
  score: number;
  met: boolean;
  me: boolean;
}

export interface Standing {
  /** 1-based place among living players (ties share the better place). */
  rank: number;
  of: number;
  score: number;
  /** The best-placed other player, when they are ahead of or level with the player. */
  leader: { id: PlayerId; score: number; met: boolean } | null;
  /** Points behind the leader (0 when level); null when the player leads. */
  behind: number | null;
  /** Points ahead of the runner-up when the player leads alone. */
  ahead: number | null;
  rows: StandingRow[];
}

export const ordinal = (n: number): string => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  const d = n % 10;
  return `${n}${d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}`;
};

/**
 * Rank the living players by score. `scoreOf` and `met` are SimQueries.score and hasMet bound
 * by the caller. Returns null when the player is not in the game.
 */
export const standingOf = (
  state: GameState,
  me: PlayerId,
  scoreOf: (id: PlayerId) => number,
  met: (id: PlayerId) => boolean,
): Standing | null => {
  if (!state.players[me]) return null;
  const rows: StandingRow[] = state.playerOrder
    .filter((id) => id === me || state.players[id]?.alive !== false)
    .map((id) => ({ id, score: scoreOf(id), met: id === me || met(id), me: id === me }))
    .sort((a, b) => b.score - a.score || (a.me ? -1 : b.me ? 1 : 0) || (a.met === b.met ? 0 : a.met ? -1 : 1));
  const mine = rows.find((r) => r.me);
  if (!mine) return null;
  const rank = 1 + rows.filter((r) => r.score > mine.score).length;
  const others = rows.filter((r) => !r.me);
  const best = others[0] ?? null;
  const leader = best && best.score >= mine.score ? { id: best.id, score: best.score, met: best.met } : null;
  return {
    rank,
    of: rows.length,
    score: mine.score,
    leader,
    behind: leader ? leader.score - mine.score : null,
    ahead: !leader && best ? mine.score - best.score : leader ? null : 0,
    rows,
  };
};

/** "2nd of 3" */
export const placeText = (s: Pick<Standing, 'rank' | 'of'>): string => `${ordinal(s.rank)} of ${s.of}`;

/** A rival's name if met, else a neutral phrase (never reveals who they are). */
export const rivalName = (met: boolean, name: string): string => (met ? name : 'a people you have not met');

/**
 * The full standing sentence: "2nd of 3 · 40 behind the Navigator's people",
 * "1st of 3 · 12 ahead", "Level with the Builder's people for 1st".
 */
export const standingLine = (s: Standing, nameOf: (id: PlayerId) => string): string => {
  if (s.of <= 1) return `Score ${s.score}`;
  if (s.leader && s.behind === 0) return `${placeText(s)} · level with ${rivalName(s.leader.met, nameOf(s.leader.id))}`;
  if (s.leader && s.behind !== null) return `${placeText(s)} · ${s.behind} behind ${rivalName(s.leader.met, nameOf(s.leader.id))}`;
  return `${placeText(s)} · ${s.ahead ?? 0} ahead`;
};

/** Two short lines for the HUD tag: "2nd of 3" / "40 behind". */
export const standingTag = (s: Standing): { place: string; gap: string } => ({
  place: s.of <= 1 ? 'Score' : placeText(s),
  gap: s.of <= 1 ? String(s.score) : s.behind !== null ? (s.behind === 0 ? 'level' : `${s.behind} behind`) : `${s.ahead ?? 0} ahead`,
});

// --- Where the points come from (mirrors sim/ages/score.ts) ---------------------------------------

export interface ScorePart {
  key: 'legacy' | 'figures' | 'seated' | 'traditions' | 'signatures' | 'hybrids';
  label: string;
  count: number;
  points: number;
}

export const scoreBreakdown = (state: GameState, player: PlayerId, content: Pick<ContentBundle, 'traditions'>): ScorePart[] => {
  const p = state.players[player];
  if (!p) return [];
  let figures = 0;
  let seated = 0;
  for (const f of Object.values(state.figures)) {
    if (f.owner !== player || f.location.state === 'consumed') continue;
    figures++;
    if (f.location.state === 'seated') seated++;
  }
  const signatures = p.traditions.filter((id) => content.traditions.find((t) => t.id === id)?.tier === 'signature').length;
  const parts: ScorePart[] = [
    { key: 'legacy', label: 'Legacy milestones', count: p.milestones.length, points: Math.round(p.legacyPoints) },
    { key: 'figures', label: 'Famous people kept', count: figures, points: figures * SCORE_PER_FIGURE },
    { key: 'seated', label: 'Seated in a cabinet', count: seated, points: seated * SCORE_PER_SEATED_FIGURE },
    { key: 'traditions', label: 'Traditions', count: p.traditions.length, points: p.traditions.length * SCORE_PER_TRADITION },
    { key: 'signatures', label: 'Signature bonus', count: signatures, points: signatures * SCORE_PER_SIGNATURE_EXTRA },
    { key: 'hybrids', label: 'Hybrids', count: p.hybrids.length, points: p.hybrids.length * SCORE_PER_HYBRID },
  ];
  return parts.filter((x) => x.points > 0 || x.key === 'legacy' || x.key === 'figures');
};

/** The part where `them` leads `me` by the most: "Most of their lead is famous people kept (+30)". */
export const biggestEdge = (mine: readonly ScorePart[], theirs: readonly ScorePart[]): { label: string; diff: number } | null => {
  let best: { label: string; diff: number } | null = null;
  for (const t of theirs) {
    const m = mine.find((x) => x.key === t.key)?.points ?? 0;
    const diff = t.points - m;
    if (diff > 0 && (!best || diff > best.diff)) best = { label: t.label, diff };
  }
  return best;
};

// --- The player's nearest gains ---------------------------------------------------------------

export interface Gain {
  text: string;
  points: number;
  /** Steps left (milestones) or 1 for one-action gains. */
  left: number;
}

/**
 * The closest score the player can still add: the next tier of each milestone (with its legacy
 * points), a figure at home who could take a free seat (+seat bonus), each kept figure.
 * `seatable` = based figures with a free seat right now (SimQueries.figureActions).
 */
export const nearestGains = (rows: readonly MilestoneProgress[], seatable: number, max = 3): Gain[] => {
  const out: Gain[] = [];
  for (const m of rows) {
    if (m.achieved >= 3) continue;
    const next = m.thresholds[m.achieved] ?? m.thresholds[2];
    const left = Math.ceil(next - m.value);
    if (left <= 0) continue;
    const label = (m.description.split(':')[0] ?? m.description).trim();
    const points = LEGACY_POINTS_PER_TIER[m.achieved] ?? 0;
    out.push({ text: `${left} more for a ${m.track} milestone: ${label.charAt(0).toLowerCase()}${label.slice(1)} ${Math.floor(m.value)}/${next}`, points, left });
  }
  if (seatable > 0) out.push({ text: `Seat ${seatable === 1 ? 'the figure' : `the ${seatable} figures`} waiting at home`, points: seatable * SCORE_PER_SEATED_FIGURE, left: 1 });
  return out.sort((a, b) => a.left - b.left || b.points - a.points || (a.text < b.text ? -1 : 1)).slice(0, max);
};
