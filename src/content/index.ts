/**
 * Content loader (workstream 7). Imports every content/*.json, parses it with the schemas in
 * src/contracts/content-schemas.ts and exports one frozen ContentBundle. Cross-reference
 * checks live in scripts/validate-content.ts (npm run validate:content).
 */
import { ContentBundle } from '@contracts/content-schemas';
import cabinetSlots from '@content/cabinet_slots.json';
import cityStates from '@content/city_states.json';
import crises from '@content/crises.json';
import cultures from '@content/cultures.json';
import deeds from '@content/deeds.json';
import dreams from '@content/dreams.json';
import figures from '@content/figures.json';
import governments from '@content/governments.json';
import hybrids from '@content/hybrids.json';
import buildings from '@content/buildings.json';
import leaders from '@content/leaders.json';
import legacy from '@content/legacy.json';
import resources from '@content/resources.json';
import signals from '@content/signals.json';
import techs from '@content/techs.json';
import terrain from '@content/terrain.json';
import traditions from '@content/traditions.json';
import units from '@content/units.json';
import wonders from '@content/wonders.json';

export const rawContent = {
  cultures,
  figures,
  traditions,
  hybrids,
  signals,
  terrain,
  resources,
  leaders,
  dreams,
  governments,
  cabinetSlots,
  units,
  buildings,
  wonders,
  techs,
  deeds,
  cityStates,
  crises,
  legacy,
};

let cached: ContentBundle | null = null;

/** Parse (once) and return the content bundle. Throws a readable ZodError on bad data. */
export const loadContent = (): ContentBundle => {
  if (!cached) cached = ContentBundle.parse(rawContent);
  return cached;
};

/** Build an id -> entry lookup for any content list. */
export const byId = <T extends { id: string }>(list: readonly T[]): Record<string, T> => {
  const out: Record<string, T> = {};
  for (const item of list) out[item.id] = item;
  return out;
};
