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
import { hexDistance, hexNeighbors, type Hex } from '@contracts/hex';
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
import { ci, hexOfIndex, isWater, round2, stackLayer, tileIndex } from './lookup';
import { empireModifiers } from './modifiers';
import { canFoundAt } from './settlements';
import { canEmbarkPlayer, terrainAllows, visibleTileSet } from './units';
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
 * Where a settler could get to and stand (the same terrain, exploration and stacking rules as
 * `planPath`, without the per-target search, so the hints stay cheap): explored tiles its
 * terrain rules connect to `start`, not through or onto a foreign unit its owner can see,
 * and — for the destination — not onto another own unit of the same stacking layer.
 */
const reachableSites = (state: GameState, unit: Unit, start: number, content: ContentBundle): Uint8Array => {
  const n = state.map.tiles.length;
  const ok = new Uint8Array(n);
  const def = ci(content).units[unit.type];
  const explored = state.players[unit.owner]?.explored;
  if (!def || !explored || start < 0) return ok;
  const embark = def.unitClass !== 'naval' && canEmbarkPlayer(state, unit.owner, content);
  const visible = new Uint8Array(n);
  for (const i of visibleTileSet(state, unit.owner, content)) visible[i] = 1;
  const foreign = new Uint8Array(n);
  const sameLayer = new Uint8Array(n);
  const layer = stackLayer(unit);
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (!u || u.id === unit.id) continue;
    const i = tileIndex(state.map, u.at);
    if (i < 0) continue;
    if (u.owner !== unit.owner) {
      if (visible[i]) foreign[i] = 1;
    } else if (stackLayer(u) === layer) sameLayer[i] = 1;
  }
  const seen = new Uint8Array(n);
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const i = stack.pop() as number;
    if (!sameLayer[i]) ok[i] = 1;
    for (const nh of hexNeighbors(hexOfIndex(state.map, i))) {
      const ni = tileIndex(state.map, nh);
      if (ni < 0 || seen[ni] || !explored[ni] || foreign[ni]) continue;
      const tile = state.map.tiles[ni];
      if (!tile || !terrainAllows(state, unit.owner, def, tile, content, embark)) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return ok;
};

/**
 * Legal sites the owner has explored within SETTLE_SITE_RANGE of a settler-type unit that it
 * can reach and stand on (the rules of `queries.pathTo`), best first (ties: map order),
 * at most SETTLE_SITE_MAX. Empty for units that cannot found.
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
  // Only sites the settler can actually reach and stand on (playtest: tiles held by another
  // unit of the same layer, or land with no route, were ranked). Its own tile always counts.
  // A route found here is one `pathTo` finds too (same terrain, exploration and unit rules).
  const start = tileIndex(state.map, unit.at);
  const reach = reachableSites(state, unit, start, content);
  const out: { hex: Hex; score: number }[] = [];
  for (const f of found) {
    if (out.length >= SETTLE_SITE_MAX) break;
    if (f.idx !== start && !reach[f.idx]) continue;
    out.push({ hex: f.hex, score: f.score });
  }
  return out;
};
