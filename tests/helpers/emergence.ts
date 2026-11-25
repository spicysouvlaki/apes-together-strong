/**
 * Hand-built GameState factory and sibling-module fakes for emergence tests.
 *
 * The fakes stand in for sim-core / ages functions the emergence engine calls, so the
 * engine is testable before (and independently of) those modules:
 *
 *   vi.mock('../src/sim/units', () => import('./helpers/emergence'));
 *   vi.mock('../src/sim/stats', () => import('./helpers/emergence'));
 *   vi.mock('../src/sim/ages', () => import('./helpers/emergence'));
 *
 * This file must not import src/emergence (it is itself the mock target of modules that
 * src/emergence imports).
 */
import { GP_KINDS, YIELDS, type ContentBundle, type Figure, type GpKind, type StatMeasure, type YieldType } from '@contracts/content-schemas';
import { axialToOffset, offsetToAxial, hexesInRange, type Hex } from '@contracts/hex';
import type {
  FigureId,
  GameState,
  PlayerId,
  PlayerState,
  Settlement,
  SettlementId,
  Tile,
  UnitId,
} from '@contracts/sim-api';
import type { SimCtx } from '../../src/sim/ctx';
import { seedRng } from '../../src/sim/rng';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** statValue fake: values keyed `${player}:${measure}:${param ?? ''}`; default 0. */
export const fakeStats: Record<string, number> = {};
export const statValue = (
  _state: GameState,
  player: PlayerId,
  measure: StatMeasure,
  param: string | undefined,
  _content: ContentBundle,
): number => fakeStats[`${player}:${measure}:${param ?? ''}`] ?? 0;

/** addAgeProgress fake: records amounts. */
export const ageProgressCalls: number[] = [];
export const addAgeProgress = (ctx: SimCtx, amount: number): void => {
  ageProgressCalls.push(amount);
  ctx.state.ageProgress = Math.min(100, ctx.state.ageProgress + amount);
};

/** spawnUnit fake: places the unit exactly at `at` (no stacking rules). */
export const spawnUnit = (
  ctx: SimCtx,
  owner: PlayerId,
  typeId: string,
  at: Hex,
  figure: FigureId | null = null,
): UnitId | null => {
  const def = ctx.content.units.find((u) => u.id === typeId);
  if (!def) return null;
  const id = `u${ctx.state.nextId++}`;
  ctx.state.units[id] = {
    id,
    owner,
    type: typeId,
    unitClass: def.unitClass,
    at: { q: at.q, r: at.r },
    hp: 100,
    movesLeft: def.moves,
    fortified: false,
    hasAttacked: false,
    figure,
  };
  return id;
};

export const removeUnit = (ctx: SimCtx, unit: UnitId): void => {
  delete ctx.state.units[unit];
};

export const resetFakes = (): void => {
  for (const k of Object.keys(fakeStats)) delete fakeStats[k];
  ageProgressCalls.length = 0;
};

// ---------------------------------------------------------------------------
// State factory
// ---------------------------------------------------------------------------

const zeroYields = (): Record<YieldType, number> => {
  const out = {} as Record<YieldType, number>;
  for (const y of YIELDS) out[y] = 0;
  return out;
};

export const makePlayer = (id: PlayerId, content: ContentBundle, tiles: number, over: Partial<PlayerState> = {}): PlayerState => {
  const affinity: Record<string, number> = {};
  const hintsShown: Record<string, number> = {};
  for (const c of content.cultures) {
    affinity[c.id] = 0;
    hintsShown[c.id] = 0;
  }
  const gp = {} as Record<GpKind, number>;
  const gpThreshold = {} as Record<GpKind, number>;
  for (const k of GP_KINDS) {
    gp[k] = 0;
    gpThreshold[k] = 60;
  }
  return {
    id,
    isHuman: false,
    leader: 'none',
    dream: 'none',
    colors: { primary: '#000000', secondary: '#ffffff' },
    skinTone: 0,
    alive: true,
    civName: null,
    stock: zeroYields(),
    income: zeroYields(),
    happiness: 0,
    affinity,
    hintsShown,
    gp,
    gpThreshold,
    legendSlotUsed: false,
    government: null,
    anarchyTurns: 0,
    cabinet: {},
    cabinetCooldown: {},
    seatedTurns: {},
    traditions: [],
    hybrids: [],
    techs: [],
    research: { tech: { current: null, progress: 0 }, civic: { current: null, progress: 0 } },
    milestones: [],
    legacyPoints: 0,
    refinementPoints: 0,
    score: 0,
    effects: [],
    stats: {
      battlesWonThisTurn: 0,
      citiesCapturedThisTurn: 0,
      battlesWon: 0,
      battlesWonThisAge: 0,
      citiesCaptured: 0,
      unitsLost: 0,
      wondersBuilt: 0,
      figuresRecruited: 0,
      figuresActivated: 0,
      envoysSent: 0,
      siegeTurnsHeld: 0,
    },
    explored: new Array<number>(tiles).fill(0),
    crisisChoices: [],
    chronicle: [],
    ...over,
  };
};

export interface StateOptions {
  width?: number;
  height?: number;
  players?: PlayerId[];
  seed?: number;
  age?: GameState['age'];
  /** Terrain for each tile by offset coords; default grassland. */
  terrain?: (col: number, row: number) => Partial<Tile>;
}

export const makeState = (content: ContentBundle, opts: StateOptions = {}): GameState => {
  const width = opts.width ?? 20;
  const height = opts.height ?? 20;
  const tiles: Tile[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const h = offsetToAxial({ col, row });
      tiles.push({
        q: h.q,
        r: h.r,
        terrain: 'grassland',
        feature: null,
        resource: null,
        river: false,
        elevation: 0,
        climate: 'temperate',
        owner: null,
        settlement: null,
        continent: 1,
        ...(opts.terrain ? opts.terrain(col, row) : {}),
      });
    }
  }
  const ids = opts.players ?? ['p1', 'p2'];
  const players: Record<PlayerId, PlayerState> = {};
  for (const id of ids) players[id] = makePlayer(id, content, tiles.length);
  const seed = opts.seed ?? 1;
  return {
    version: 2,
    seed,
    speed: 'standard',
    mapSize: 'small',
    finalAge: 'classical',
    turn: 1,
    age: opts.age ?? 'ancient',
    phase: 'playing',
    currentPlayer: ids[0] ?? 'p1',
    ageProgress: 0,
    rng: seedRng(seed),
    nextId: 1,
    map: { width, height, tiles },
    playerOrder: ids,
    players,
    settlements: {},
    units: {},
    figures: {},
    offers: [],
    deedsDone: [],
    wonders: {},
    cityStates: {},
    tradeRoutes: [],
    wars: {},
    crisis: null,
    transition: null,
    result: null,
  };
};

export const makeCtx = (state: GameState, content: ContentBundle): SimCtx => ({ state, content, events: [] });

export const tileOf = (state: GameState, h: Hex): Tile | undefined => {
  const { col, row } = axialToOffset(h);
  if (col < 0 || row < 0 || col >= state.map.width || row >= state.map.height) return undefined;
  return state.map.tiles[row * state.map.width + col];
};

/** Hex at offset coords. */
export const at = (col: number, row: number): Hex => offsetToAxial({ col, row });

export const addSettlement = (
  state: GameState,
  owner: PlayerId,
  hex: Hex,
  over: Partial<Settlement> = {},
): Settlement => {
  const id: SettlementId = over.id ?? `s${state.nextId++}`;
  const isFirst = !Object.values(state.settlements).some((s) => s.owner === owner);
  const s: Settlement = {
    id,
    owner,
    originalOwner: owner,
    name: id,
    namedFor: 'greek',
    at: hex,
    kind: 'city',
    population: 1,
    foodStored: 0,
    isCapital: isFirst,
    foundedTurn: state.turn,
    buildings: [],
    hp: 100,
    maxHp: 100,
    siegeTurns: 0,
    production: { item: null, progress: 0 },
    ...over,
  };
  state.settlements[id] = s;
  const t = tileOf(state, hex);
  if (t) {
    t.settlement = id;
    t.owner = owner;
  }
  return s;
};

/** Give `owner` every tile within `radius` of `center` (inside the map). */
export const claim = (state: GameState, owner: PlayerId, center: Hex, radius: number): void => {
  for (const h of hexesInRange(center, radius)) {
    const t = tileOf(state, h);
    if (t && (t.owner === null || t.owner === owner)) t.owner = owner;
  }
};

export const addUnit = (state: GameState, content: ContentBundle, owner: PlayerId, type: string, hex: Hex): UnitId => {
  const ctx = makeCtx(state, content);
  const id = spawnUnit(ctx, owner, type, hex, null);
  if (!id) throw new Error(`no unit type ${type}`);
  return id;
};

// ---------------------------------------------------------------------------
// Scripted culture scenarios (M2 emergence check, docs/WORKSTREAMS.md)
// ---------------------------------------------------------------------------

/** A hand-built "home signals" play profile for one culture. */
export interface CultureProfile {
  culture: string;
  age: GameState['age'];
  climate: Tile['climate'];
  /** Relative land terrain shares. */
  terrain: Record<string, number>;
  /** Chance per land tile of a feature, by feature id. */
  features?: Record<string, number>;
  /** Chance per land tile of a resource, by resource id (first match wins). */
  resources?: Record<string, number>;
  /** How many of the (up to 5) settlements sit on the coast. */
  coastal: number;
  river?: boolean;
  /** Income multipliers on a generic ramp (1 = average). */
  focus?: Partial<Record<YieldType, number>>;
  /** Unit types fielded, as [type, count at turn 25]. */
  units?: [string, number][];
  /** A battle won every N turns. */
  battleEvery?: number;
  tradeRoutesBy?: number;
  wonderTurn?: number;
  techsPer10?: number;
  envoysPer10?: number;
  exploredAt25?: number;
}

const hash01 = (a: number, b: number, c: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 7, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

const pickShare = (shares: Record<string, number>, roll: number): string => {
  const keys = Object.keys(shares);
  let total = 0;
  for (const k of keys) total += shares[k] ?? 0;
  let r = roll * total;
  for (const k of keys) {
    r -= shares[k] ?? 0;
    if (r < 0) return k;
  }
  return keys[keys.length - 1] ?? 'grassland';
};

const WATER_COLS = 3;
const SITES: [number, number][] = [
  [WATER_COLS, 5],
  [WATER_COLS, 12],
  [WATER_COLS + 6, 8],
  [WATER_COLS + 7, 15],
  [WATER_COLS + 12, 11],
];
const FOUND_TURNS = [1, 6, 11, 16, 21];

export const scenarioState = (content: ContentBundle, profile: CultureProfile, seed: number): GameState => {
  const coastalSites = SITES.slice(0, profile.coastal);
  const inlandSites = SITES.slice(profile.coastal).map(([c, r]): [number, number] => [c + 2, r]);
  const sites = [...coastalSites, ...inlandSites];
  const state = makeState(content, {
    width: 24,
    height: 22,
    players: ['p1', 'p2'],
    seed,
    age: profile.age,
    terrain: (col, row) => {
      if (col < WATER_COLS) return { terrain: col === WATER_COLS - 1 ? 'coast' : 'ocean', climate: profile.climate, continent: 0 };
      const terrain = pickShare(profile.terrain, hash01(col, row, seed));
      let feature: string | null = null;
      for (const [f, chance] of Object.entries(profile.features ?? {})) {
        if (hash01(col, row, seed + 101 + f.length) < chance) {
          feature = f;
          break;
        }
      }
      let resource: string | null = null;
      const rolls = hash01(col, row, seed + 977);
      let acc = 0;
      for (const [res, chance] of Object.entries(profile.resources ?? {})) {
        acc += chance;
        if (rolls < acc) {
          resource = res;
          break;
        }
      }
      return { terrain, feature, resource, climate: profile.climate };
    },
  });
  // A trade partner city-state of the first city-state culture, far to the east.
  const cs = content.cityStates[0];
  if (cs) {
    const s = addSettlement(state, `cs:${cs.id}`, at(21, 18), { id: 'cs_settlement', namedFor: cs.culture, isCapital: false });
    state.cityStates[cs.id] = { id: cs.id, settlement: s.id, envoys: {}, suzerain: null, alive: true };
  }
  scenarioSites.set(state, sites);
  return state;
};

const scenarioSites = new WeakMap<GameState, [number, number][]>();

/** Advance the scripted world to `turn` (1-based) before the emergence tick. */
export const scenarioStep = (state: GameState, content: ContentBundle, profile: CultureProfile, turn: number): void => {
  const sites = scenarioSites.get(state) ?? [];
  const p = state.players.p1 as PlayerState;
  state.turn = turn;
  sites.forEach(([col, row], i) => {
    const founded = FOUND_TURNS[i] ?? 99;
    if (turn < founded) return;
    const hex = at(col, row);
    let s = Object.values(state.settlements).find((x) => x.owner === 'p1' && x.at.q === hex.q && x.at.r === hex.r);
    if (!s) {
      s = addSettlement(state, 'p1', hex, { namedFor: profile.culture });
      const t = tileOf(state, hex);
      if (t && profile.river) t.river = true;
    }
    const age = turn - founded;
    claim(state, 'p1', hex, age >= 8 ? 2 : 1);
    s.population = 1 + Math.floor(age / 4);
  });
  const ramp = (base: number, slope: number, y: YieldType): number => (base + slope * turn) * (profile.focus?.[y] ?? 1);
  p.income.science = ramp(2, 0.25, 'science');
  p.income.culture = ramp(1.5, 0.2, 'culture');
  p.income.faith = ramp(1, 0.1, 'faith');
  p.income.gold = ramp(3, 0.3, 'gold');
  p.income.production = ramp(3, 0.4, 'production');
  p.income.influence = ramp(0.5, 0.05, 'influence');
  p.income.food = 4;

  // Units: ramp each listed type toward its turn-25 count, stationed at the capital.
  const capital = Object.values(state.settlements).find((x) => x.owner === 'p1' && x.isCapital);
  for (const [type, n] of profile.units ?? [['warrior_band', 2]]) {
    const want = Math.max(1, Math.round((n * Math.min(turn, 25)) / 25));
    const have = Object.values(state.units).filter((u) => u.owner === 'p1' && u.type === type).length;
    for (let i = have; i < want && capital; i++) addUnit(state, content, 'p1', type, capital.at);
  }
  p.stats.battlesWonThisTurn = profile.battleEvery && turn % profile.battleEvery === 0 ? 1 : 0;
  p.stats.battlesWon += p.stats.battlesWonThisTurn;

  if (profile.tradeRoutesBy !== undefined && turn >= profile.tradeRoutesBy && capital) {
    const n = turn >= profile.tradeRoutesBy + 8 ? 2 : 1;
    while (state.tradeRoutes.filter((r) => r.owner === 'p1').length < n) {
      state.tradeRoutes.push({ id: `tr${state.nextId++}`, owner: 'p1', from: capital.id, to: 'cs_settlement' });
    }
  }
  if (profile.wonderTurn !== undefined && turn >= profile.wonderTurn && capital) {
    const w = content.wonders.find((x) => x.culture === profile.culture) ?? content.wonders[0];
    if (w && !state.wonders[w.id]) {
      state.wonders[w.id] = { owner: 'p1', settlement: capital.id, turn };
      p.stats.wondersBuilt++;
    }
  }
  const techs = content.techs.filter((t) => t.age === state.age).map((t) => t.id);
  p.techs = techs.slice(0, Math.floor(((profile.techsPer10 ?? 2) * turn) / 10));
  p.stats.envoysSent = Math.floor(((profile.envoysPer10 ?? 0) * turn) / 10);
  const explored = Math.round((((profile.exploredAt25 ?? 15) * Math.min(turn, 25)) / 25 / 100) * p.explored.length);
  for (let i = 0; i < p.explored.length; i++) p.explored[i] = i < explored ? 1 : 0;
};

/** Home-signal play profiles for the 8 first-playable cultures. */
export const CULTURE_PROFILES: CultureProfile[] = [
  {
    culture: 'egyptian',
    age: 'ancient',
    climate: 'arid',
    terrain: { floodplain: 4, desert: 4, plains: 1.5, grassland: 0.5 },
    features: { marsh: 0.05, oasis: 0.02 },
    resources: { wheat: 0.07, stone: 0.05, dates: 0.03, gold_ore: 0.02, incense: 0.02 },
    coastal: 1,
    river: true,
    focus: { faith: 2, production: 1.3 },
    wonderTurn: 14,
    units: [['warrior_band', 2], ['slinger', 1]],
  },
  {
    culture: 'greek',
    age: 'ancient',
    climate: 'temperate',
    terrain: { grassland: 3, plains: 3, mountain: 1 },
    features: { hills: 0.4 },
    resources: { olives: 0.05, wine: 0.03, fish: 0.03, stone: 0.02 },
    coastal: 5,
    focus: { science: 1.6, culture: 1.8 },
    units: [['warrior_band', 2], ['war_canoe', 2]],
    techsPer10: 4,
    envoysPer10: 1,
  },
  {
    culture: 'chinese',
    age: 'ancient',
    climate: 'temperate',
    terrain: { grassland: 5, floodplain: 1.5, plains: 2, mountain: 0.7 },
    features: { hills: 0.1, marsh: 0.03 },
    resources: { tea: 0.06, silk: 0.06, salt: 0.02, iron: 0.02 },
    coastal: 0,
    river: true,
    focus: { science: 1.4, culture: 1.4, food: 1.5 },
    units: [['warrior_band', 3], ['slinger', 2]],
    techsPer10: 3,
  },
  {
    culture: 'arab',
    age: 'ancient',
    climate: 'arid',
    terrain: { desert: 7, plains: 1.5, steppe: 0.5 },
    features: { oasis: 0.06 },
    resources: { incense: 0.06, dates: 0.04, horses: 0.01 },
    coastal: 1,
    focus: { gold: 1.8 },
    tradeRoutesBy: 8,
    units: [['warrior_band', 2], ['merchant', 1]],
    envoysPer10: 1,
  },
  {
    culture: 'norse',
    age: 'ancient',
    climate: 'boreal',
    terrain: { grassland: 3, tundra: 3, mountain: 0.5 },
    features: { forest: 0.45 },
    resources: { furs: 0.05, amber: 0.03, deer: 0.03, fish: 0.03, iron: 0.02 },
    coastal: 4,
    units: [['warrior_band', 3], ['war_canoe', 3]],
    battleEvery: 6,
    exploredAt25: 25,
  },
  {
    culture: 'inuit',
    age: 'classical',
    climate: 'polar',
    terrain: { tundra: 4, snow: 4 },
    resources: { furs: 0.06, walrus_ivory: 0.03, whales: 0.02, fish: 0.04 },
    coastal: 5,
    focus: { faith: 1.3, science: 0.7, production: 0.6 },
    units: [['scout', 1], ['warrior_band', 1]],
    exploredAt25: 20,
  },
  {
    culture: 'mongol',
    age: 'ancient',
    climate: 'temperate',
    terrain: { steppe: 6.5, plains: 1.5, grassland: 1, desert: 0.5 },
    resources: { horses: 0.09, cattle: 0.04 },
    coastal: 0,
    units: [['chariot', 5], ['warrior_band', 1]],
    battleEvery: 4,
  },
  {
    culture: 'spanish',
    age: 'ancient',
    climate: 'temperate',
    terrain: { plains: 5, grassland: 1, mountain: 1.2 },
    features: { hills: 0.3 },
    resources: { iron: 0.06, gold_ore: 0.02, wine: 0.02, copper: 0.02, horses: 0.02 },
    coastal: 2,
    focus: { gold: 1.4 },
    units: [['warrior_band', 4], ['slinger', 1]],
    battleEvery: 8,
    exploredAt25: 30,
  },
];

// ---------------------------------------------------------------------------
// Fixed test content: real cultures/units/slots/governments, but a stable figure roster so
// unit tests do not move while content/figures.json grows.
// ---------------------------------------------------------------------------

export const testFigure = (
  id: string,
  culture: string,
  kind: Figure['kind'],
  over: Partial<Figure> = {},
): Figure => ({
  id,
  name: id,
  culture,
  age: 'ancient',
  kind,
  archetype: false,
  uses: ['cabinet'],
  cabinetSlots: [],
  cabinetModifiers: [],
  unitModifiers: [],
  consumeValue: 3,
  bio: 'Test figure.',
  source: 'test',
  ...over,
});

export const TEST_FIGURES: Figure[] = [
  testFigure('eg_general', 'egyptian', 'general', { uses: ['unit', 'cabinet'] }),
  testFigure('eg_statesman', 'egyptian', 'statesman'),
  testFigure('eg_builder', 'egyptian', 'builder', { uses: ['activate', 'cabinet'], activate: { effect: 'rush_wonder', amount: 50 } }),
  testFigure('gr_general', 'greek', 'general', { uses: ['unit', 'cabinet'] }),
  testFigure('gr_statesman', 'greek', 'statesman'),
  testFigure('gr_thinker', 'greek', 'thinker', { uses: ['activate', 'cabinet'], activate: { effect: 'science_burst', amount: 60 } }),
  testFigure('mo_general', 'mongol', 'general', { uses: ['unit', 'cabinet'] }),
  testFigure('mo_statesman', 'mongol', 'statesman'),
  testFigure('ch_statesman', 'chinese', 'statesman'),
  testFigure('ar_statesman', 'arab', 'statesman'),
  testFigure('no_statesman', 'norse', 'statesman'),
  testFigure('sp_statesman', 'spanish', 'statesman'),
  testFigure('no_explorer', 'norse', 'explorer', { uses: ['unit', 'cabinet'] }),
  testFigure('gr_legend', 'greek', 'legend', { uses: ['activate'], activate: { effect: 'explore_reveal', amount: 2 } }),
  testFigure('eg_deed_general', 'egyptian', 'general', { uses: ['unit', 'cabinet'], deed: 'test_siege' }),
  testFigure('in_statesman', 'inuit', 'statesman', { age: 'classical' }),
];

export const testContent = (base: ContentBundle, over: Partial<ContentBundle> = {}): ContentBundle => ({
  ...base,
  figures: TEST_FIGURES,
  deeds: [
    {
      id: 'test_siege',
      name: 'Test siege',
      description: 'You held a city through a long siege.',
      trigger: { measure: 'siegeTurnsHeld', count: 5 },
    },
  ],
  ...over,
});
