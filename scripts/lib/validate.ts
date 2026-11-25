/**
 * Content validation (workstream 6): per-entry schema checks plus cross-references.
 * Pure: takes the raw parsed JSON of every content file and returns a list of problems
 * (empty = valid). Used by scripts/validate-content.ts and tests/content.test.ts.
 *
 * Each problem reads `<file> [<id>] <path>: <problem>` so content authors can find it fast.
 */
import type { z } from 'zod';
import {
  ACTIVATE_EFFECTS,
  AGES,
  CLIMATES,
  CabinetSlot,
  CityStateDef,
  Crisis,
  Culture,
  Deed,
  Dream,
  Figure,
  Government,
  Hybrid,
  LegacyMilestone,
  Leader,
  Resource,
  Signal,
  Tech,
  Terrain,
  Tradition,
  UNIT_CLASSES,
  UnitDef,
  Building,
  Wonder,
  type Age,
  type Condition,
  type Modifier,
} from '../../src/contracts/content-schemas';

/** Bundle key -> file name in /content and the schema of one entry. */
export const CONTENT_FILES = {
  cultures: { file: 'cultures.json', schema: Culture },
  figures: { file: 'figures.json', schema: Figure },
  traditions: { file: 'traditions.json', schema: Tradition },
  hybrids: { file: 'hybrids.json', schema: Hybrid },
  signals: { file: 'signals.json', schema: Signal },
  terrain: { file: 'terrain.json', schema: Terrain },
  resources: { file: 'resources.json', schema: Resource },
  leaders: { file: 'leaders.json', schema: Leader },
  dreams: { file: 'dreams.json', schema: Dream },
  governments: { file: 'governments.json', schema: Government },
  cabinetSlots: { file: 'cabinet_slots.json', schema: CabinetSlot },
  units: { file: 'units.json', schema: UnitDef },
  buildings: { file: 'buildings.json', schema: Building },
  wonders: { file: 'wonders.json', schema: Wonder },
  techs: { file: 'techs.json', schema: Tech },
  deeds: { file: 'deeds.json', schema: Deed },
  cityStates: { file: 'city_states.json', schema: CityStateDef },
  crises: { file: 'crises.json', schema: Crisis },
  legacy: { file: 'legacy.json', schema: LegacyMilestone },
} as const;

export type ContentKey = keyof typeof CONTENT_FILES;
export const CONTENT_KEYS = Object.keys(CONTENT_FILES) as ContentKey[];

/** Raw JSON per bundle key (whatever JSON.parse gave). */
export type RawContent = Partial<Record<ContentKey, unknown>>;

type Parsed = { [K in ContentKey]: z.infer<(typeof CONTENT_FILES)[K]['schema']>[] };

/** Tile features are a fixed list in the sim (sim-api `Tile.feature`). */
export const FEATURES = ['forest', 'hills', 'jungle', 'marsh', 'oasis'] as const;

const TIER_RANK = { custom: 0, institution: 1, signature: 2 } as const;

const fmtPath = (path: readonly PropertyKey[]): string =>
  path.length === 0 ? '(entry)' : path.map((p) => (typeof p === 'number' ? `[${p}]` : String(p))).join('.');

const entryLabel = (entry: unknown, index: number): string => {
  if (entry && typeof entry === 'object' && 'id' in entry && typeof (entry as { id: unknown }).id === 'string') {
    return (entry as { id: string }).id;
  }
  return `#${index}`;
};

/** Stage 1: parse each entry on its own so one bad entry doesn't hide the rest. */
const parseAll = (raw: RawContent, problems: string[]): Parsed => {
  const out = {} as Record<ContentKey, unknown[]>;
  for (const key of CONTENT_KEYS) {
    const { file, schema } = CONTENT_FILES[key];
    const value = raw[key];
    out[key] = [];
    if (value === undefined) {
      problems.push(`${file}: file missing`);
      continue;
    }
    if (!Array.isArray(value)) {
      problems.push(`${file}: top level must be an array`);
      continue;
    }
    value.forEach((entry: unknown, i: number) => {
      const res = schema.safeParse(entry);
      if (res.success) {
        out[key].push(res.data);
      } else {
        for (const issue of res.error.issues) {
          problems.push(`${file} [${entryLabel(entry, i)}] ${fmtPath(issue.path)}: ${issue.message}`);
        }
      }
    });
  }
  return out as Parsed;
};

/** All modifiers of an entry, with their path for error messages. */
interface FoundModifier {
  path: string;
  modifier: Modifier;
}

const modifiersOf = (key: ContentKey, entry: Record<string, unknown>): FoundModifier[] => {
  const found: FoundModifier[] = [];
  const add = (path: string, list: unknown): void => {
    if (!Array.isArray(list)) return;
    list.forEach((m, i) => found.push({ path: `${path}[${i}]`, modifier: m as Modifier }));
  };
  switch (key) {
    case 'figures':
      add('cabinetModifiers', entry.cabinetModifiers);
      add('unitModifiers', entry.unitModifiers);
      break;
    case 'cityStates':
      add('suzerainModifiers', entry.suzerainModifiers);
      break;
    case 'crises': {
      add('pressure', entry.pressure);
      const stages = (entry as z.infer<typeof Crisis>).stages;
      stages.forEach((s, si) => s.options.forEach((o, oi) => add(`stages[${si}].options[${oi}].modifiers`, o.modifiers)));
      break;
    }
    default:
      add('modifiers', entry.modifiers);
  }
  return found;
};

export const validateContent = (raw: RawContent): string[] => {
  const problems: string[] = [];
  const c = parseAll(raw, problems);
  const p = (file: string, id: string, path: string, msg: string): void => {
    problems.push(`${file} [${id}] ${path}: ${msg}`);
  };

  // --- Id sets and uniqueness -------------------------------------------------
  const ids = {} as Record<ContentKey, Set<string>>;
  for (const key of CONTENT_KEYS) {
    const seen = new Set<string>();
    for (const e of c[key] as { id: string }[]) {
      if (seen.has(e.id)) p(CONTENT_FILES[key].file, e.id, 'id', 'duplicate id');
      seen.add(e.id);
    }
    ids[key] = seen;
  }
  // Units, buildings and wonders are all production items: one namespace.
  for (const [a, b] of [
    ['units', 'buildings'],
    ['units', 'wonders'],
    ['buildings', 'wonders'],
  ] as const) {
    for (const id of ids[a]) {
      if (ids[b].has(id)) p(CONTENT_FILES[b].file, id, 'id', `also used in ${CONTENT_FILES[a].file} (production items share one id namespace)`);
    }
  }

  const cultures = ids.cultures;
  const needCulture = (file: string, id: string, path: string, culture: string): void => {
    if (!cultures.has(culture)) p(file, id, path, `unknown culture "${culture}"`);
  };
  const terrainIds = ids.terrain;
  const featureIds = new Set<string>(FEATURES);
  const climateIds = new Set<string>(CLIMATES);
  const unitClassIds = new Set<string>(UNIT_CLASSES);

  // --- Modifiers and conditions everywhere ------------------------------------
  const checkCondition = (file: string, id: string, path: string, when: Condition | undefined): void => {
    if (!when) return;
    for (const t of when.terrain ?? []) if (!terrainIds.has(t)) p(file, id, `${path}.terrain`, `unknown terrain "${t}"`);
    for (const t of when.adjacentTerrain ?? []) if (!terrainIds.has(t)) p(file, id, `${path}.adjacentTerrain`, `unknown terrain "${t}"`);
    for (const f of when.feature ?? []) if (!featureIds.has(f)) p(file, id, `${path}.feature`, `unknown feature "${f}" (one of ${FEATURES.join(', ')})`);
    for (const r of when.resource ?? []) if (!ids.resources.has(r)) p(file, id, `${path}.resource`, `unknown resource "${r}"`);
    for (const cl of when.climate ?? []) if (!climateIds.has(cl)) p(file, id, `${path}.climate`, `unknown climate "${cl}"`);
  };
  for (const key of CONTENT_KEYS) {
    const file = CONTENT_FILES[key].file;
    for (const entry of c[key] as Record<string, unknown>[]) {
      const id = String(entry.id);
      for (const { path, modifier } of modifiersOf(key, entry)) {
        checkCondition(file, id, `${path}.when`, modifier.when);
        const eff = modifier.effect;
        if (eff.kind === 'unlock') {
          const target =
            eff.what === 'unit' ? ids.units : eff.what === 'building' ? ids.buildings : eff.what === 'wonder' ? ids.wonders : eff.what === 'government' ? ids.governments : null;
          if (target && !target.has(eff.id)) p(file, id, `${path}.effect.id`, `unlock of unknown ${eff.what} "${eff.id}"`);
        } else if (eff.kind === 'cabinetSlot') {
          if (!ids.cabinetSlots.has(eff.slot)) p(file, id, `${path}.effect.slot`, `unknown cabinet slot "${eff.slot}"`);
        } else if (eff.kind === 'affinityGain' && eff.culture !== undefined) {
          needCulture(file, id, `${path}.effect.culture`, eff.culture);
        }
      }
    }
  }
  for (const b of c.buildings) checkCondition('buildings.json', b.id, 'requires', b.requires);
  for (const w of c.wonders) checkCondition('wonders.json', w.id, 'requires', w.requires);

  // --- Figures ----------------------------------------------------------------
  const slotById = new Map(c.cabinetSlots.map((s) => [s.id, s]));
  const deedFigures = new Map<string, string[]>();
  for (const f of c.figures) {
    const F = 'figures.json';
    needCulture(F, f.id, 'culture', f.culture);
    f.cabinetSlots.forEach((s, i) => {
      const slot = slotById.get(s);
      if (!slot) p(F, f.id, `cabinetSlots[${i}]`, `unknown cabinet slot "${s}"`);
      else if (!slot.accepts.includes(f.kind)) p(F, f.id, `cabinetSlots[${i}]`, `slot "${s}" does not accept kind "${f.kind}"`);
    });
    if (f.activate && !(ACTIVATE_EFFECTS as readonly string[]).includes(f.activate.effect)) {
      p(F, f.id, 'activate.effect', `unknown activate effect "${f.activate.effect}" (one of ${ACTIVATE_EFFECTS.join(', ')})`);
    }
    if (f.uses.includes('activate') && !f.activate) p(F, f.id, 'activate', 'uses includes "activate" but no activate effect is defined');

    const articleName = /^An? /.test(f.name);
    const archetypeBio = f.bio.startsWith('Archetype.');
    const legendBio = f.bio.startsWith('Legend.');
    if (f.archetype && !articleName) p(F, f.id, 'name', 'archetype names must start with "A " or "An "');
    if (!f.archetype && articleName) p(F, f.id, 'archetype', `name "${f.name}" reads as an archetype; set archetype: true or rename`);
    if (f.archetype && !archetypeBio) p(F, f.id, 'bio', 'archetype bios must start with "Archetype."');
    if (f.kind === 'legend' && !legendBio) p(F, f.id, 'bio', 'legend bios must start with "Legend."');
    if (!f.archetype && archetypeBio) p(F, f.id, 'bio', 'bio starts with "Archetype." but archetype is not true');
    if (f.kind !== 'legend' && legendBio) p(F, f.id, 'bio', 'bio starts with "Legend." but kind is not "legend"');

    if (f.deed !== undefined) {
      if (!ids.deeds.has(f.deed)) p(F, f.id, 'deed', `unknown deed "${f.deed}"`);
      deedFigures.set(f.deed, [...(deedFigures.get(f.deed) ?? []), f.id]);
    }
  }
  for (const d of c.deeds) {
    const figs = deedFigures.get(d.id) ?? [];
    if (figs.length !== 1) p('deeds.json', d.id, 'id', `must be named by exactly one figure's "deed" (found ${figs.length}${figs.length ? `: ${figs.join(', ')}` : ''})`);
  }

  // --- Traditions and hybrids ---------------------------------------------------
  const tradById = new Map(c.traditions.map((t) => [t.id, t]));
  for (const t of c.traditions) {
    needCulture('traditions.json', t.id, 'culture', t.culture);
    t.requires.forEach((r, i) => {
      const req = tradById.get(r);
      const path = `requires[${i}]`;
      if (!req) return p('traditions.json', t.id, path, `unknown tradition "${r}"`);
      if (req.culture !== t.culture) p('traditions.json', t.id, path, `"${r}" is ${req.culture}, not ${t.culture}`);
      if (TIER_RANK[req.tier] >= TIER_RANK[t.tier]) p('traditions.json', t.id, path, `"${r}" (${req.tier}) must be a lower tier than ${t.tier}`);
    });
  }
  for (const h of c.hybrids) {
    h.cultures.forEach((cu, i) => needCulture('hybrids.json', h.id, `cultures[${i}]`, cu));
    if (h.cultures[0] === h.cultures[1]) p('hybrids.json', h.id, 'cultures', 'the two cultures must differ');
  }

  // --- Signals, wonders, city-states -------------------------------------------
  const PARAM_SETS: Record<string, { set: Set<string>; what: string }> = {
    ownedTerrain: { set: terrainIds, what: 'terrain' },
    ownedFeature: { set: featureIds, what: 'feature' },
    ownedResource: { set: ids.resources, what: 'resource' },
    ownedClimate: { set: climateIds, what: 'climate' },
    unitsOfClass: { set: unitClassIds, what: 'unit class' },
  };
  const checkParam = (file: string, id: string, path: string, measure: string, param: string | undefined): void => {
    const need = PARAM_SETS[measure];
    if (!need) return;
    if (param === undefined) p(file, id, path, `measure "${measure}" needs a ${need.what} param`);
    else if (!need.set.has(param)) p(file, id, path, `unknown ${need.what} "${param}" for measure "${measure}"`);
  };
  for (const s of c.signals) {
    for (const cu of Object.keys(s.weights)) needCulture('signals.json', s.id, `weights.${cu}`, cu);
    checkParam('signals.json', s.id, 'param', s.measure, s.param);
  }
  for (const d of c.deeds) checkParam('deeds.json', d.id, 'trigger.param', d.trigger.measure, d.trigger.param);
  for (const w of c.wonders) needCulture('wonders.json', w.id, 'culture', w.culture);
  for (const cs of c.cityStates) needCulture('city_states.json', cs.id, 'culture', cs.culture);

  // --- Governments -------------------------------------------------------------
  for (const g of c.governments) {
    g.cabinetSlots.forEach((s, i) => {
      if (!ids.cabinetSlots.has(s)) p('governments.json', g.id, `cabinetSlots[${i}]`, `unknown cabinet slot "${s}"`);
    });
  }

  // --- Techs, units, buildings, wonders ------------------------------------------
  const techById = new Map(c.techs.map((t) => [t.id, t]));
  const needTech = (file: string, id: string, tech: string | undefined): void => {
    if (tech !== undefined && !techById.has(tech)) p(file, id, 'requiresTech', `unknown tech "${tech}"`);
  };
  const cells = new Map<string, string>();
  for (const t of c.techs) {
    t.requires.forEach((r, i) => {
      const req = techById.get(r);
      if (!req) return p('techs.json', t.id, `requires[${i}]`, `unknown tech "${r}"`);
      if (req.tree !== t.tree) p('techs.json', t.id, `requires[${i}]`, `"${r}" is in the ${req.tree} tree, not ${t.tree}`);
      if (req.age !== t.age) p('techs.json', t.id, `requires[${i}]`, `"${r}" is ${req.age}, not ${t.age}`);
    });
    const cell = `${t.tree}/${t.age}/${t.col}/${t.row}`;
    const other = cells.get(cell);
    if (other) p('techs.json', t.id, 'col/row', `same tree cell as "${other}" (${cell})`);
    else cells.set(cell, t.id);
  }
  // Cycle check (DFS with colors) over known edges.
  const color = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, stack: string[]): void => {
    const st = color.get(id) ?? 0;
    if (st === 2) return;
    if (st === 1) {
      const cycle = [...stack.slice(stack.indexOf(id)), id];
      p('techs.json', id, 'requires', `dependency cycle: ${cycle.join(' -> ')}`);
      return;
    }
    color.set(id, 1);
    for (const r of techById.get(id)?.requires ?? []) if (techById.has(r)) visit(r, [...stack, id]);
    color.set(id, 2);
  };
  for (const t of c.techs) visit(t.id, []);

  for (const u of c.units) {
    needTech('units.json', u.id, u.requiresTech);
    if (u.upgradesTo !== undefined && !ids.units.has(u.upgradesTo)) p('units.json', u.id, 'upgradesTo', `unknown unit "${u.upgradesTo}"`);
    if (u.requiresResource !== undefined && !ids.resources.has(u.requiresResource)) p('units.json', u.id, 'requiresResource', `unknown resource "${u.requiresResource}"`);
    if (u.rangedStrength !== undefined && u.range === undefined) p('units.json', u.id, 'range', 'rangedStrength needs a range');
  }
  for (const b of c.buildings) needTech('buildings.json', b.id, b.requiresTech);
  for (const w of c.wonders) needTech('wonders.json', w.id, w.requiresTech);

  // Figure stand-in units: exactly one per kind used, general + explorer always.
  const unitsByKind = new Map<string, string[]>();
  for (const u of c.units) if (u.figureKind) unitsByKind.set(u.figureKind, [...(unitsByKind.get(u.figureKind) ?? []), u.id]);
  const kindsNeeded = new Set<string>(['general', 'explorer']);
  for (const f of c.figures) if (f.uses.includes('unit')) kindsNeeded.add(f.kind);
  for (const [kind, list] of unitsByKind) if (list.length > 1) p('units.json', list.join(','), 'figureKind', `more than one unit def for figure kind "${kind}"`);
  for (const kind of kindsNeeded) if (!unitsByKind.has(kind)) p('units.json', '-', 'figureKind', `no unit def for figure kind "${kind}"`);
  if (!c.units.some((u) => u.canFound)) p('units.json', '-', 'canFound', 'at least one unit must be able to found settlements');

  // --- Resources -----------------------------------------------------------------
  for (const r of c.resources) {
    r.terrains.forEach((t, i) => {
      if (!terrainIds.has(t)) p('resources.json', r.id, `terrains[${i}]`, `unknown terrain "${t}"`);
    });
  }

  // --- Crises and legacy -----------------------------------------------------------
  const crisisAges = new Map<Age, string>();
  for (const cr of c.crises) {
    // GDD §5: crises end Ancient, Classical and Exploration; the Modern age ends the game.
    if (cr.age === 'modern') p('crises.json', cr.id, 'age', 'no crisis ends the modern age (GDD §5)');
    const other = crisisAges.get(cr.age);
    if (other) p('crises.json', cr.id, 'age', `"${other}" already ends the ${cr.age} age`);
    else crisisAges.set(cr.age, cr.id);
    let last = 0;
    cr.stages.forEach((s, i) => {
      if (!(s.at > last && s.at < 100)) p('crises.json', cr.id, `stages[${i}].at`, `must be ascending and between 0 and 100 (got ${s.at})`);
      last = s.at;
    });
    const optionIds = cr.stages.flatMap((s) => s.options.map((o) => o.id));
    if (new Set(optionIds).size !== optionIds.length) p('crises.json', cr.id, 'stages', 'response option ids must be unique within a crisis');
  }
  const trackAge = new Map<string, string>();
  for (const m of c.legacy) {
    const k = `${m.age}/${m.track}`;
    const other = trackAge.get(k);
    if (other) p('legacy.json', m.id, 'track', `"${other}" already covers ${m.track} in the ${m.age} age`);
    else trackAge.set(k, m.id);
    const [a, b, d] = m.thresholds;
    if (!(a < b && b < d)) p('legacy.json', m.id, 'thresholds', 'must be strictly ascending');
    checkParam('legacy.json', m.id, 'param', m.measure, m.param);
  }

  return problems;
};

/** Counts per file and figures per culture × age, for the CLI summary. */
export const contentSummary = (raw: RawContent): { counts: Record<string, number>; figures: Record<string, Record<Age, number>> } => {
  const counts: Record<string, number> = {};
  for (const key of CONTENT_KEYS) {
    const v = raw[key];
    counts[CONTENT_FILES[key].file] = Array.isArray(v) ? v.length : 0;
  }
  const figures: Record<string, Record<Age, number>> = {};
  const list = Array.isArray(raw.figures) ? (raw.figures as { culture?: unknown; age?: unknown }[]) : [];
  for (const f of list) {
    const cu = typeof f.culture === 'string' ? f.culture : '?';
    const age = f.age as Age;
    if (!(AGES as readonly string[]).includes(age)) continue;
    const row = (figures[cu] ??= { ancient: 0, classical: 0, exploration: 0, modern: 0 });
    row[age] += 1;
  }
  return { counts, figures };
};
