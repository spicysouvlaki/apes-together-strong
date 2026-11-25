/**
 * The terrain ids the generator's climate rules produce (GDD §7 "Map"). The ids are the
 * pipeline's vocabulary, but every one is checked against content/terrain.json at generation
 * time — including its `water` flag — so a renamed or missing terrain fails loudly instead of
 * producing tiles that reference nothing.
 */
import type { ContentBundle, Terrain } from '@contracts/content-schemas';

export interface TerrainRoles {
  grassland: string;
  plains: string;
  desert: string;
  floodplain: string;
  tundra: string;
  snow: string;
  steppe: string;
  mountain: string;
  coast: string;
  ocean: string;
}

const LAND_ROLES = ['grassland', 'plains', 'desert', 'floodplain', 'tundra', 'snow', 'steppe', 'mountain'] as const;
const WATER_ROLES = ['coast', 'ocean'] as const;

export const resolveTerrainRoles = (content: ContentBundle): TerrainRoles => {
  const byId = new Map<string, Terrain>(content.terrain.map((t) => [t.id, t]));
  const need = (id: string, water: boolean): string => {
    const t = byId.get(id);
    if (!t) throw new Error(`mapgen: content/terrain.json has no terrain "${id}"`);
    if (t.water !== water) throw new Error(`mapgen: terrain "${id}" must have water=${String(water)}`);
    return id;
  };
  const roles = {} as Record<string, string>;
  for (const id of LAND_ROLES) roles[id] = need(id, false);
  for (const id of WATER_ROLES) roles[id] = need(id, true);
  return roles as unknown as TerrainRoles;
};

/** Feature ids (fixed list from the Tile contract comment in src/contracts/sim-api.ts). */
export const FEATURES = {
  forest: 'forest',
  hills: 'hills',
  jungle: 'jungle',
  marsh: 'marsh',
  oasis: 'oasis',
} as const;
