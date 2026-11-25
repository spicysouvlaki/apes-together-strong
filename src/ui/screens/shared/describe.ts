/**
 * Player-facing words for content data: modifiers, activate effects, culture colors.
 * Pure (no DOM, no signals) so it is unit-tested in Node (tests/ui-screens.test.ts).
 * Numbers shown here come from content or sim constants, never from hidden affinity.
 */
import type {
  ActivateEffect,
  Condition,
  ContentBundle,
  Effect,
  Figure,
  FigureKind,
  GpKind,
  Modifier,
  UnitClass,
  YieldType,
} from '@contracts/content-schemas';
import {
  ACTIVATE_DEFAULT_AMOUNT,
  ANCESTOR_YIELD,
  CONSUME_BURST_PER_VALUE,
  CONSUME_BURST_TURNS,
  MAIN_YIELD,
} from '../../../emergence/constants';

/** Minimal id -> {name} lookups describeModifier needs (the store's `lookup` satisfies it). */
export interface NameLookup {
  terrain: Record<string, { name: string }>;
  resources: Record<string, { name: string }>;
  cabinetSlots: Record<string, { name: string }>;
  units: Record<string, { name: string }>;
  buildings: Record<string, { name: string }>;
  wonders: Record<string, { name: string }>;
  governments: Record<string, { name: string }>;
  cultures: Record<string, { name: string; adjective: string }>;
}

/** Build a NameLookup straight from a content bundle (tests, demo). */
export const nameLookup = (content: ContentBundle): NameLookup => {
  const by = <T extends { id: string }>(list: readonly T[]): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const x of list) out[x.id] = x;
    return out;
  };
  return {
    terrain: by(content.terrain),
    resources: by(content.resources),
    cabinetSlots: by(content.cabinetSlots),
    units: by(content.units),
    buildings: by(content.buildings),
    wonders: by(content.wonders),
    governments: by(content.governments),
    cultures: by(content.cultures),
  };
};

export const humanize = (id: string): string => id.replace(/_/g, ' ');
export const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const ageLabel = (age: string): string => capitalize(age);

const listOr = (items: readonly string[]): string => {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
};

export const YIELD_LABEL: Record<YieldType, string> = {
  food: 'food',
  production: 'production',
  gold: 'gold',
  science: 'science',
  culture: 'culture',
  faith: 'faith',
  happiness: 'happiness',
  influence: 'influence',
};

export const GP_LABEL: Record<GpKind, string> = {
  military: 'military',
  statesman: 'statesman',
  thought: 'thought',
  faith: 'faith',
  building: 'building',
  exploration: 'exploration',
};

export const KIND_LABEL: Record<FigureKind, string> = {
  general: 'General',
  statesman: 'Statesman',
  thinker: 'Thinker',
  spiritual: 'Spiritual leader',
  builder: 'Builder',
  explorer: 'Explorer',
  legend: 'Legend',
};

const CLASS_PLURAL: Record<UnitClass, string> = {
  infantry: 'infantry',
  ranged: 'ranged units',
  cavalry: 'cavalry',
  siege: 'siege units',
  naval: 'naval units',
  civilian: 'civilians',
  commander: 'commanders',
};

const COST_TARGET: Record<Extract<Effect, { kind: 'cost' }>['target'], string> = {
  unit: 'Units',
  building: 'Buildings',
  wonder: 'Wonders',
  settler: 'Settlers',
  tradition: 'Traditions',
  upgrade: 'Town upgrades',
};

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
const plural = (n: number, one: string, many: string): string => (Math.abs(n) === 1 ? one : many);

const terrainName = (id: string, l: NameLookup): string => (l.terrain[id]?.name ?? humanize(id)).toLowerCase();
const resourceName = (id: string, l: NameLookup): string => l.resources[id]?.name ?? capitalize(humanize(id));
const nameOf = (rec: Record<string, { name: string }>, id: string): string => rec[id]?.name ?? capitalize(humanize(id));

/** The core effect phrase, without scope/condition qualifiers. */
export const describeEffect = (e: Effect, l: NameLookup): string => {
  switch (e.kind) {
    case 'yield': {
      const y = YIELD_LABEL[e.yield];
      const parts: string[] = [];
      if (e.add !== undefined && e.add !== 0) parts.push(`${signed(e.add)} ${y}`);
      if (e.percent !== undefined && e.percent !== 0) parts.push(`${signed(e.percent)}% ${y}`);
      return parts.length ? parts.join(' and ') : `No change to ${y}`;
    }
    case 'combat':
      return `${signed(e.add)} combat strength${e.vs ? ` against ${CLASS_PLURAL[e.vs]}` : ''}`;
    case 'movement':
      return `${signed(e.add)} movement`;
    case 'gpPoints':
      return `${signed(e.percent)}% ${GP_LABEL[e.gp]} great-people points`;
    case 'affinityGain': {
      const who = e.culture ? `${l.cultures[e.culture]?.name ?? capitalize(humanize(e.culture))} people are` : 'Famous people are';
      return `${who} drawn to you ${Math.abs(e.percent)}% ${e.percent >= 0 ? 'faster' : 'slower'}`;
    }
    case 'cost':
      return `${COST_TARGET[e.target]} cost ${Math.abs(e.percent)}% ${e.percent <= 0 ? 'less' : 'more'}`;
    case 'cabinetSlot':
      return `Extra ${nameOf(l.cabinetSlots, e.slot)} seat`;
    case 'settlementCap':
      return `${signed(e.add)} settlement cap`;
    case 'tradeRoutes':
      return `${signed(e.add)} ${plural(e.add, 'trade route', 'trade routes')}`;
    case 'vision':
      return `${signed(e.add)} vision`;
    case 'unlock':
      switch (e.what) {
        case 'unit':
          return `Unlocks the ${nameOf(l.units, e.id)}`;
        case 'building':
          return `Unlocks the ${nameOf(l.buildings, e.id)}`;
        case 'wonder':
          return `Unlocks ${nameOf(l.wonders, e.id)}`;
        case 'government':
          return `Unlocks ${nameOf(l.governments, e.id)}`;
        case 'improvement':
          return `Unlocks the ${humanize(e.id)} improvement`;
        case 'embark':
          return 'Land units can embark onto water';
      }
      return 'Unlocks something new';
    case 'ignoreCold':
      return 'No cold penalties';
  }
};

/** Where the modifier applies ("on tundra or snow tiles", "in coastal settlements"). */
const placePhrase = (scope: Modifier['scope'], w: Condition, l: NameLookup): string[] => {
  const out: string[] = [];
  const terrains = [...(w.terrain ?? []).map((t) => terrainName(t, l)), ...(w.feature ?? []).map(humanize)];
  const climates = w.climate ?? [];
  if (scope === 'tile') {
    const adj: string[] = [];
    if (w.coastal) adj.push('coastal');
    if (w.river) adj.push('river');
    if (climates.length) adj.push(listOr(climates));
    if (terrains.length) adj.push(listOr(terrains));
    if (w.resource?.length) adj.push(listOr(w.resource.map((r) => resourceName(r, l))));
    out.push(adj.length ? `on ${adj.join(' ')} tiles` : 'on every worked tile');
  } else if (scope === 'settlement') {
    const adj: string[] = [];
    if (w.coastal) adj.push('coastal');
    if (w.river) adj.push('river');
    if (climates.length) adj.push(listOr(climates));
    const noun = w.capital ? 'the capital' : w.settlementKind === 'town' ? 'towns' : w.settlementKind === 'city' ? 'cities' : 'settlements';
    if (w.capital) out.push(adj.length ? `in the capital if ${adj.join(' ')}` : 'in the capital');
    else out.push(adj.length || noun !== 'settlements' ? `in ${[...adj, noun].join(' ')}` : 'in every settlement');
    if (terrains.length) out.push(`on ${listOr(terrains)}`);
    if (w.resource?.length) out.push(`with ${listOr(w.resource.map((r) => resourceName(r, l)))}`);
  } else {
    // unit / empire: terrain and climate describe where the unit stands.
    if (terrains.length) out.push(`on ${listOr(terrains)}`);
    if (climates.length) out.push(`in ${listOr(climates)} lands`);
    if (w.resource?.length) out.push(`near ${listOr(w.resource.map((r) => resourceName(r, l)))}`);
    if (w.coastal) out.push('on the coast');
    if (w.river) out.push('by rivers');
    if (w.capital) out.push('in the capital');
    if (w.settlementKind) out.push(`in ${w.settlementKind}s`);
  }
  if (w.adjacentTerrain?.length) out.push(`next to ${listOr(w.adjacentTerrain.map((t) => terrainName(t, l)))}`);
  if (w.cityMinPop !== undefined && w.cityMaxPop !== undefined) out.push(`with ${w.cityMinPop}–${w.cityMaxPop} population`);
  else if (w.cityMinPop !== undefined) out.push(`with ${w.cityMinPop}+ population`);
  else if (w.cityMaxPop !== undefined) out.push(`with at most ${w.cityMaxPop} population`);
  if (w.minTradeRoutes !== undefined) out.push(`with ${w.minTradeRoutes}+ ${plural(w.minTradeRoutes, 'trade route', 'trade routes')}`);
  if (w.atWar === true) out.push('while at war');
  if (w.atWar === false) out.push('while at peace');
  if (w.age?.length) out.push(`during the ${listOr(w.age.map(ageLabel))} age`);
  return out;
};

/** Effects whose wording already names its subject; no "for all units" etc. */
const SELF_SUBJECT = new Set<Effect['kind']>(['cost', 'cabinetSlot', 'unlock', 'ignoreCold', 'affinityGain', 'settlementCap', 'tradeRoutes', 'gpPoints']);

/**
 * Turn any Modifier into a short phrase: "+15% gold", "+2 food on floodplain tiles",
 * "+5 combat strength for cavalry", "Units cost 20% less", "Extra Laureate seat".
 */
export const describeModifier = (mod: Modifier, l: NameLookup, opts: { unitSubject?: string } = {}): string => {
  const w: Condition = mod.when ?? {};
  let text = describeEffect(mod.effect, l);
  if (mod.scope === 'unit' && !SELF_SUBJECT.has(mod.effect.kind)) {
    text += w.unitClass?.length ? ` for ${listOr(w.unitClass.map((c) => CLASS_PLURAL[c]))}` : ` for ${opts.unitSubject ?? 'all units'}`;
  } else if (w.unitClass?.length) {
    text += ` for ${listOr(w.unitClass.map((c) => CLASS_PLURAL[c]))}`;
  }
  // Empire yields with no condition read cleanly on their own ("+15% gold").
  const place = placePhrase(mod.scope, w, l);
  const skipBarePlace = mod.scope === 'settlement' && SELF_SUBJECT.has(mod.effect.kind) && !mod.when;
  if (place.length && !skipBarePlace) text += ` ${place.join(' ')}`;
  return text;
};

export const describeModifiers = (mods: readonly Modifier[], l: NameLookup, opts: { unitSubject?: string } = {}): string[] =>
  mods.map((m) => describeModifier(m, l, opts));

/** What a figure's one-time activate does, in words. */
export const describeActivate = (effect: string, amount: number | undefined): string => {
  const known = effect in ACTIVATE_DEFAULT_AMOUNT;
  const n = amount ?? (known ? ACTIVATE_DEFAULT_AMOUNT[effect as ActivateEffect] : 0);
  switch (effect as ActivateEffect) {
    case 'rush_wonder':
      return `Adds ${n}% of a wonder's cost to the wonder their city is building`;
    case 'production_burst':
      return `+${n} production toward what their city is building`;
    case 'culture_burst':
      return `+${n} culture`;
    case 'science_burst':
      return `+${n} science`;
    case 'gold_burst':
      return `+${n} gold`;
    case 'faith_burst':
      return `+${n} faith`;
    case 'influence_burst':
      return `+${n} influence`;
    case 'explore_reveal':
      return `Reveals the land within ${n} tiles of your settlements and units`;
    case 'free_unit':
      return `Raises ${n === 1 ? 'a free military unit' : `${n} free military units`} in your capital`;
    case 'heal_units':
      return `Heals all your units by ${n} HP`;
    case 'grow_city':
      return `+${n} population in their city`;
  }
  return capitalize(humanize(effect));
};

/** Hall of Ancestors income for a retired figure of this kind ("+1 science per turn"). */
export const ancestorYield = (kind: FigureKind): string => `+${ANCESTOR_YIELD} ${YIELD_LABEL[MAIN_YIELD[kind]]} per turn`;
export const mainYieldOf = (kind: FigureKind): YieldType => MAIN_YIELD[kind];

/** Stable hue per culture id (stand-in art: colored-initial portraits). */
export const cultureHue = (cultureId: string): number => {
  let h = 2166136261;
  for (let i = 0; i < cultureId.length; i++) {
    h ^= cultureId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
};
/**
 * Hue for a culture: evenly spaced by its position in content when `order` is given (so the
 * launch cultures never collide), else the hash. Stable either way.
 */
export const cultureHueIn = (cultureId: string, order: readonly string[]): number => {
  const i = order.indexOf(cultureId);
  return i < 0 ? cultureHue(cultureId) : Math.round((i * 360) / Math.max(1, order.length) + 20) % 360;
};
export const cultureColor = (cultureId: string, order: readonly string[] = []): string => `hsl(${cultureHueIn(cultureId, order)} 42% 40%)`;
export const cultureTint = (cultureId: string, order: readonly string[] = []): string => `hsl(${cultureHueIn(cultureId, order)} 45% 90%)`;

/** Initials for a portrait card: "Thutmose III" -> "T", "A Thule umiak captain" -> "TU". */
export const initials = (name: string): string => {
  const words = name
    .replace(/^(A|An|The)\s+/, '')
    .split(/\s+/)
    .filter((w) => /^[\p{L}]/u.test(w) && !/^[IVXLC]+$/.test(w));
  const first = words[0]?.charAt(0) ?? '?';
  const second = words.length > 1 && /^\p{Lu}/u.test(words[1] ?? '') ? (words[1]?.charAt(0) ?? '') : '';
  return (first + second).toUpperCase();
};

export interface FigureUse {
  label: string;
  text: string;
}

/** Concrete uses of a figure in words, for cards (GDD §3 "Figure states and actions"). */
export const figureUses = (def: Figure, l: NameLookup): FigureUse[] => {
  const out: FigureUse[] = [];
  if (def.uses.includes('cabinet')) {
    const seats = def.cabinetSlots.map((s) => nameOf(l.cabinetSlots, s));
    const bonus = def.cabinetModifiers.length ? describeModifiers(def.cabinetModifiers, l).join('; ') : 'Counts double for culture weight';
    out.push({ label: seats.length ? `In the cabinet (${listOr(seats)} seat)` : 'In the cabinet', text: bonus });
  }
  if (def.uses.includes('unit')) {
    // Deployed figures' unitModifiers apply to their own unit and adjacent friendly units (sim/units.ts aura).
    const bonus = def.unitModifiers.length
      ? describeModifiers(def.unitModifiers, l, { unitSubject: 'them and adjacent units' }).join('; ')
      : 'Takes the field as a unit';
    out.push({ label: 'Deployed as a unit', text: bonus });
  }
  if (def.uses.includes('activate') && def.activate) {
    out.push({ label: 'Activated once', text: `${describeActivate(def.activate.effect, def.activate.amount)}, then retires` });
  }
  out.push({ label: 'If consumed', text: consumeText(def) });
  return out;
};

/** "3 refinement points (for traditions at the next age), or +6 gold per turn for 10 turns". */
export const consumeText = (def: Figure): string =>
  `${def.consumeValue} refinement points (spent on traditions when the age ends), or ${consumeBurstText(def)}`;

export const consumeBurstText = (def: Figure): string =>
  `+${def.consumeValue * CONSUME_BURST_PER_VALUE} ${YIELD_LABEL[MAIN_YIELD[def.kind]]} per turn for ${CONSUME_BURST_TURNS} turns`;
