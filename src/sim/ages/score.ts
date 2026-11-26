/** Legacy score (GDD §8). */
import type { ContentBundle } from '@contracts/content-schemas';
import type { GameState, PlayerId } from '@contracts/sim-api';
import {
  SCORE_PER_FIGURE,
  SCORE_PER_HYBRID,
  SCORE_PER_SEATED_FIGURE,
  SCORE_PER_SIGNATURE_EXTRA,
  SCORE_PER_TRADITION,
} from './constants';

/** The parts of a player's score (wave 13: the UI shows standing during play). Sums to `total`. */
export interface ScoreBreakdown {
  /** Legacy points from milestones (GDD §8 tracks). */
  legacy: number;
  /** SCORE_PER_FIGURE per figure still owned (retired ancestors count; consumed do not). */
  figures: number;
  /** SCORE_PER_SEATED_FIGURE per figure seated right now. */
  seated: number;
  /** SCORE_PER_TRADITION per tradition, plus SCORE_PER_SIGNATURE_EXTRA per signature. */
  traditions: number;
  /** SCORE_PER_HYBRID per hybrid. */
  hybrids: number;
  total: number;
}

export const scoreBreakdown = (state: GameState, player: PlayerId, content: ContentBundle): ScoreBreakdown => {
  const out: ScoreBreakdown = { legacy: 0, figures: 0, seated: 0, traditions: 0, hybrids: 0, total: 0 };
  const p = state.players[player];
  if (!p) return out;
  out.legacy = p.legacyPoints;
  for (const id of Object.keys(state.figures)) {
    const f = state.figures[id];
    if (!f || f.owner !== player || f.location.state === 'consumed') continue;
    out.figures += SCORE_PER_FIGURE;
    if (f.location.state === 'seated') out.seated += SCORE_PER_SEATED_FIGURE;
  }
  for (const id of p.traditions) {
    out.traditions += SCORE_PER_TRADITION;
    if (content.traditions.find((t) => t.id === id)?.tier === 'signature') out.traditions += SCORE_PER_SIGNATURE_EXTRA;
  }
  out.hybrids = p.hybrids.length * SCORE_PER_HYBRID;
  out.total = out.legacy + out.figures + out.seated + out.traditions + out.hybrids;
  return out;
};

/**
 * 10 per figure still owned (any state except consumed; retired ancestors count) + 15 per
 * tradition (+25 more for a signature) + 40 per hybrid + 5 per seated figure + legacy points.
 */
export const score = (state: GameState, player: PlayerId, content: ContentBundle): number => scoreBreakdown(state, player, content).total;
