/**
 * Settlement-site evaluation (GDD §7 "Settlements", §9 "per-unit scoring"): the one score
 * behind the settler hints (`queries.settleSites`) and the AI's choice of sites. A site is
 * worth what its first two rings would give: tile yields (food and production first), fresh
 * water, coast, luxuries the player does not own yet, strategic resources and hills, minus
 * tiles already claimed and closeness to enemies at war.
 *
 * Only public information is used: tile terrain and resources, borders, settlements, wars.
 */
import { YIELDS, type ContentBundle, type Modifier } from '@contracts/content-schemas';
import { hexDistance, type Hex } from '@contracts/hex';
import type { GameState, PlayerId, Unit } from '@contracts/sim-api';
import { isHostile } from './combat';
import {
  SETTLE_SITE_MAX,
  SETTLE_SITE_RANGE,
  SITE_LAND_PENALTY,
  SITE_MAX_WATER,
  SITE_MIN_LAND,
  SITE_OUTER_RING_SHARE,
  SITE_SCORE_RADIUS,
  SITE_WAR_RADIUS,
  SITE_WATER_PENALTY,
  SITE_WATER_SHARE,
  SITE_WEIGHTS,
  type SiteWeights,
} from './constants';
import { ci, hexOfIndex, isWater, round2, tileIndex } from './lookup';
import { empireModifiers } from './modifiers';
import { canFoundAt } from './settlements';
import { tileYield } from './yields';

/** Luxury resource ids already inside the player's borders. */
export const ownedLuxuries = (state: GameState, player: PlayerId, content: ContentBundle): string[] => {
  const res = ci(content).resources;
  const out: string[] = [];
  for (const t of state.map.tiles) {
    if (t.owner !== player || !t.resource) continue;
    const r = res[t.resource];
    if (r?.class === 'luxury' && !out.includes(r.id)) out.push(r.id);
  }
  return out;
};

/**
 * Build a scorer for `player`'s candidate sites (higher is better; ~15–40 for typical land).
 * Tile values and the player's modifiers are computed once and shared by every call, so
 * scoring a few hundred candidates stays well under a millisecond or two.
 * Does not check legality: combine with `canFoundAt`.
 */
export const siteScorer = (
  state: GameState,
  player: PlayerId,
  content: ContentBundle,
  weights: SiteWeights = SITE_WEIGHTS,
): ((idx: number) => number) => {
  const { map } = state;
  const mods: Modifier[] = state.players[player] ? empireModifiers(state, player, content) : [];
  const res = ci(content).resources;
  const owned = ownedLuxuries(state, player, content);
  const values = new Float64Array(map.tiles.length).fill(Number.NaN);
  const tileValue = (i: number): number => {
    const cached = values[i] as number;
    if (!Number.isNaN(cached)) return cached;
    const t = map.tiles[i];
    let v = 0;
    if (t) {
      const y = tileYield(state, t, player, content, mods);
      for (const k of YIELDS) if (k !== 'happiness') v += y[k] * weights.yield[k];
    }
    v = Math.max(0, v);
    values[i] = v;
    return v;
  };
  // Settlements of everyone the player is at war with (raiders own none).
  const hostile: Hex[] = [];
  if (weights.rivalAtWar !== 0) {
    for (const id of Object.keys(state.settlements)) {
      const s = state.settlements[id];
      if (s && s.owner !== player && isHostile(state, player, s.owner)) hostile.push(s.at);
    }
  }

  return (idx: number): number => {
    const center = map.tiles[idx];
    if (!center) return 0;
    const at = hexOfIndex(map, idx);
    const R = SITE_SCORE_RADIUS;
    let score = 0;
    let water = 0;
    let land = 0;
    let coastal = false;
    let overlap = 0;
    const newLux: string[] = [];
    for (let dq = -R; dq <= R; dq++) {
      for (let dr = Math.max(-R, -dq - R); dr <= Math.min(R, -dq + R); dr++) {
        if (dq === 0 && dr === 0) continue;
        const i = tileIndex(map, { q: at.q + dq, r: at.r + dr });
        const t = i < 0 ? undefined : map.tiles[i];
        if (!t) continue;
        if (t.owner !== null) overlap++;
        // Someone else's tiles never come to this settlement.
        if (t.owner !== null && t.owner !== player) continue;
        const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
        const w = isWater(t, content);
        if (w) {
          water++;
          if (d === 1) coastal = true;
        } else land++;
        score += tileValue(i) * (d === 1 ? 1 : SITE_OUTER_RING_SHARE) * (w ? SITE_WATER_SHARE : 1);
        if (t.resource) {
          const r = res[t.resource];
          if (r?.class === 'luxury' && !owned.includes(r.id) && !newLux.includes(r.id)) newLux.push(r.id);
          if (r?.class === 'strategic') score += weights.strategic;
        }
      }
    }
    score += newLux.length * weights.newLuxury;
    if (center.river) score += weights.river;
    if (coastal) score += weights.coast;
    if (center.feature === 'hills') score += weights.hills;
    // Mostly-water sites stay small; slivers of land between water or borders too.
    if (water > SITE_MAX_WATER) score -= (water - SITE_MAX_WATER) * SITE_WATER_PENALTY;
    if (land < SITE_MIN_LAND) score -= (SITE_MIN_LAND - land) * SITE_LAND_PENALTY;
    score -= overlap * weights.overlap;
    for (const h of hostile) {
      const d = hexDistance(h, at);
      if (d <= SITE_WAR_RADIUS) score -= (SITE_WAR_RADIUS + 1 - d) * weights.rivalAtWar;
    }
    return score;
  };
};

/**
 * Legal sites the owner has explored within SETTLE_SITE_RANGE of a settler-type unit, best
 * first (ties: map order), at most SETTLE_SITE_MAX. Empty for units that cannot found.
 */
export const settleSitesFor = (state: GameState, unit: Unit, content: ContentBundle): { hex: Hex; score: number }[] => {
  const p = state.players[unit.owner];
  if (!p || !ci(content).units[unit.type]?.canFound) return [];
  const score = siteScorer(state, unit.owner, content);
  const found: { idx: number; hex: Hex; score: number }[] = [];
  const R = SETTLE_SITE_RANGE;
  for (let dq = -R; dq <= R; dq++) {
    for (let dr = Math.max(-R, -dq - R); dr <= Math.min(R, -dq + R); dr++) {
      const hex = { q: unit.at.q + dq, r: unit.at.r + dr };
      const idx = tileIndex(state.map, hex);
      if (idx < 0 || !p.explored[idx]) continue;
      if (!canFoundAt(state, unit.owner, hex, content)) continue;
      found.push({ idx, hex, score: round2(score(idx)) });
    }
  }
  found.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return found.slice(0, SETTLE_SITE_MAX).map(({ hex, score: s }) => ({ hex, score: s }));
};
