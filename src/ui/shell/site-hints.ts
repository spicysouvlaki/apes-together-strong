/**
 * Plain-words description of a founding site for the settler sheet (GDD §7 "Settlements").
 * Pure. The sim decides where founding is legal (q.canFound) and how good a site is
 * (q.settleSites); this only names the visible features behind that score: fresh water,
 * coast, hills, resources in the first two rings.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import { hexDistance, hexesInRange, hexNeighbors, type Hex } from '@contracts/hex';
import type { GameState } from '@contracts/sim-api';
import { tileAt } from './hexutil';

export interface SiteFacts {
  river: boolean;
  coast: boolean;
  hills: boolean;
  /** Resource names within two tiles, luxuries first. */
  resources: string[];
  /** Terrain name of the tile itself. */
  terrain: string;
}

export const siteFacts = (state: GameState, at: Hex, content: ContentBundle): SiteFacts | null => {
  const t = tileAt(state.map, at);
  if (!t) return null;
  const terrain = (id: string) => content.terrain.find((x) => x.id === id);
  const coast = hexNeighbors(at).some((n) => {
    const nt = tileAt(state.map, n);
    return !!nt && !!terrain(nt.terrain)?.water;
  });
  const found: { name: string; rank: number }[] = [];
  for (const h of hexesInRange(at, 2)) {
    const rt = tileAt(state.map, h);
    if (!rt?.resource) continue;
    const r = content.resources.find((x) => x.id === rt.resource);
    if (!r || found.some((f) => f.name === r.name)) continue;
    found.push({ name: r.name, rank: r.class === 'luxury' ? 0 : r.class === 'strategic' ? 1 : 2 });
  }
  found.sort((a, b) => a.rank - b.rank);
  return {
    river: t.river,
    coast,
    hills: t.feature === 'hills',
    resources: found.map((f) => f.name),
    terrain: terrain(t.terrain)?.name ?? t.terrain,
  };
};

const list = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** "river, coast, Wine and Iron nearby" style summary; empty string when nothing stands out. */
export const siteSummary = (f: SiteFacts, maxResources = 3): string => {
  const parts: string[] = [];
  if (f.river) parts.push('fresh water from a river');
  if (f.coast) parts.push('the coast');
  if (f.hills) parts.push('hills to defend');
  if (f.resources.length > 0) parts.push(`${list(f.resources.slice(0, maxResources))} nearby`);
  return list(parts);
};

const DIRS: readonly [number, string][] = [
  [0, 'east'],
  [60, 'north-east'],
  [120, 'north-west'],
  [180, 'west'],
  [240, 'south-west'],
  [300, 'south-east'],
];

/** Compass word from one hex to another (pointy-top axial; north is up). */
export const directionWord = (from: Hex, to: Hex): string => {
  const x = Math.sqrt(3) * (to.q - from.q + (to.r - from.r) / 2);
  const y = -1.5 * (to.r - from.r);
  if (x === 0 && y === 0) return 'here';
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  let best = DIRS[0] as [number, string];
  let bestD = 999;
  for (const d of DIRS) {
    const diff = Math.min(Math.abs(deg - d[0]), 360 - Math.abs(deg - d[0]));
    if (diff < bestD) {
      bestD = diff;
      best = d;
    }
  }
  return best[1];
};

/** "3 tiles north-east". */
export const whereWord = (from: Hex, to: Hex): string => {
  const d = hexDistance(from, to);
  return d === 0 ? 'right here' : `${d} ${d === 1 ? 'tile' : 'tiles'} ${directionWord(from, to)}`;
};

const SHORT_DIR: Record<string, string> = {
  east: 'E',
  'north-east': 'NE',
  'north-west': 'NW',
  west: 'W',
  'south-west': 'SW',
  'south-east': 'SE',
  here: '',
};

/** "3 NE" for compact buttons. */
export const shortWhere = (from: Hex, to: Hex): string => `${hexDistance(from, to)} ${SHORT_DIR[directionWord(from, to)] ?? ''}`.trim();
