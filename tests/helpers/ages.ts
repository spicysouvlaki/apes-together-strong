/**
 * Fixtures and sibling fakes for the ages tests. Test files mock the sibling modules with
 * this module itself, e.g.
 *   vi.mock('../src/emergence', async () => await import('./helpers/ages'));
 *   vi.mock('../src/sim/stats', async () => await import('./helpers/ages'));
 *   vi.mock('../src/sim/units', async () => await import('./helpers/ages'));
 * so the fakes below stand in for statValue, cultureWeights, retireFigures, onAgeStarted,
 * syncCabinet and spawnUnit. Rule tests use the small fixture content here, not real content.
 */
import { vi } from 'vitest';
import type {
  ContentBundle,
  Crisis,
  Hybrid,
  LegacyMilestone,
  StatMeasure,
  Tradition,
} from '@contracts/content-schemas';
import { offsetToAxial, type Hex } from '@contracts/hex';
import type {
  CultureId,
  FigureId,
  FigureState,
  GameState,
  PlayerId,
  PlayerState,
  Settlement,
  SimEvent,
  Tile,
  UnitId,
} from '@contracts/sim-api';
import type { SimCtx } from '../../src/sim/ctx';
import { seedRng } from '../../src/sim/rng';

// ---------------------------------------------------------------------------
// Fakes for sibling modules
// ---------------------------------------------------------------------------

/** statValue fake: tests set `fakeStats[player][measure]`. */
export const fakeStats: Record<PlayerId, Partial<Record<StatMeasure, number>>> = {};

export const statValue = (
  _state: GameState,
  player: PlayerId,
  measure: StatMeasure,
  _param: string | undefined,
  _content: ContentBundle,
): number => fakeStats[player]?.[measure] ?? 0;

/** cultureWeights fake per GDD §6: figures owned per culture + seated turns / 10. */
export const cultureWeights = (state: GameState, player: PlayerId, content: ContentBundle): Record<CultureId, number> => {
  const out: Record<CultureId, number> = {};
  for (const f of Object.values(state.figures)) {
    if (f.owner !== player) continue;
    const def = content.figures.find((x) => x.id === f.id);
    if (def) out[def.culture] = (out[def.culture] ?? 0) + 1;
  }
  const p = state.players[player];
  for (const [c, turns] of Object.entries(p?.seatedTurns ?? {})) out[c] = (out[c] ?? 0) + turns / 10;
  return out;
};

export const retireFigures = (ctx: SimCtx, player: PlayerId): FigureId[] => {
  const out: FigureId[] = [];
  for (const f of Object.values(ctx.state.figures)) {
    if (f.owner !== player || f.location.state === 'consumed' || f.location.state === 'retired') continue;
    f.location = { state: 'retired' };
    out.push(f.id);
    ctx.events.push({ type: 'figureRetired', figure: f.id, player });
  }
  const p = ctx.state.players[player];
  if (p) for (const k of Object.keys(p.cabinet)) p.cabinet[k] = null;
  return out;
};

export const onAgeStarted = vi.fn((_ctx: SimCtx, _player: PlayerId): void => undefined);
export const syncCabinet = vi.fn((_ctx: SimCtx, _player: PlayerId): void => undefined);

export const spawnUnit = vi.fn(
  (ctx: SimCtx, owner: PlayerId, typeId: string, at: Hex, figure: FigureId | null = null): UnitId | null => {
    const def = ctx.content.units.find((u) => u.id === typeId);
    if (!def) return null;
    const id = `u${ctx.state.nextId++}`;
    ctx.state.units[id] = {
      id,
      owner,
      type: typeId,
      unitClass: def.unitClass,
      at,
      hp: 100,
      movesLeft: def.moves,
      fortified: false,
      hasAttacked: false,
      figure,
    };
    return id;
  },
);

export const resetFakes = (): void => {
  for (const k of Object.keys(fakeStats)) delete fakeStats[k];
  onAgeStarted.mockClear();
  syncCabinet.mockClear();
  spawnUnit.mockClear();
};

// ---------------------------------------------------------------------------
// Fixture content
// ---------------------------------------------------------------------------

const history = { note: 'A short history note.', source: 'Test fixture' };
const yieldMod = (y: 'gold' | 'science' | 'culture', add: number) => ({
  scope: 'empire' as const,
  effect: { kind: 'yield' as const, yield: y, add },
});

export const tradition = (t: Partial<Tradition> & Pick<Tradition, 'id' | 'culture' | 'tier'>): Tradition => ({
  name: t.id,
  age: 'ancient',
  cost: { custom: 3, institution: 6, signature: 10 }[t.tier],
  requires: [],
  modifiers: [yieldMod('culture', 1)],
  description: '',
  history: { ...history, note: `${t.id} note` },
  ...t,
});

export const hybrid = (h: Partial<Hybrid> & Pick<Hybrid, 'id' | 'cultures'>): Hybrid => ({
  name: h.id,
  age: 'classical',
  cost: 8,
  minWeight: 3,
  modifiers: [yieldMod('science', 1)],
  description: '',
  history: { ...history, note: `${h.id} note` },
  ...h,
});

const option = (id: string, extra: Partial<Crisis['stages'][number]['options'][number]> = {}) => ({
  id,
  label: id,
  description: `${id} description`,
  modifiers: [],
  stock: {},
  ...extra,
});

export const crisis = (id: string, age: Crisis['age'], behaviors: Crisis['behaviors']): Crisis => ({
  id,
  name: id,
  age,
  description: `${id} description`,
  pressure: [],
  behaviors,
  stages: [
    { at: 70, text: 's1', options: [option(`${id}_a1`, { stock: { gold: -30 } }), option(`${id}_b1`, { modifiers: [yieldMod('gold', 2)] })] },
    { at: 80, text: 's2', options: [option(`${id}_a2`), option(`${id}_b2`)] },
    { at: 90, text: 's3', options: [option(`${id}_a3`), option(`${id}_b3`)] },
  ],
});

export const milestone = (m: Partial<LegacyMilestone> & Pick<LegacyMilestone, 'id' | 'age' | 'measure'>): LegacyMilestone => ({
  track: 'legacy',
  thresholds: [2, 4, 6],
  description: 'Do {n} things',
  ...m,
});

const culture = (id: string, name: string, adjective: string) => ({
  id,
  name,
  adjective,
  firstPlayable: true,
  architecture: 'a',
  musicStem: 'm',
  cityNames: ['A', 'B', 'C', 'D'],
});

const figure = (id: string, cultureId: string) => ({
  id,
  name: id,
  culture: cultureId,
  age: 'ancient' as const,
  kind: 'thinker' as const,
  archetype: false,
  uses: ['cabinet' as const],
  cabinetSlots: [],
  cabinetModifiers: [],
  unitModifiers: [],
  consumeValue: 2,
  bio: '',
  source: 'fixture',
});

const unit = (id: string, age: 'ancient' | 'classical', unitClass: 'infantry' | 'commander', strength: number) => ({
  id,
  name: id,
  age,
  unitClass,
  strength,
  moves: 2,
  cost: 20,
  canFound: false,
  canTrade: false,
  siegeBonus: 0,
  vision: 2,
});

export const fixtureContent = (): ContentBundle => ({
  cultures: [culture('greek', 'Greek', 'Hellenic'), culture('chinese', 'Chinese', 'Sinic'), culture('mongol', 'Mongol', 'Steppe')],
  figures: [figure('fig_greek_1', 'greek'), figure('fig_greek_2', 'greek'), figure('fig_chinese_1', 'chinese')],
  traditions: [
    tradition({ id: 'symposium', culture: 'greek', tier: 'custom' }),
    tradition({ id: 'agora', culture: 'greek', tier: 'institution', requires: ['symposium'] }),
    tradition({ id: 'academy', culture: 'greek', tier: 'signature', requires: ['agora'], age: 'classical' }),
    tradition({ id: 'olympics', culture: 'greek', tier: 'signature', requires: ['agora'] }),
    tradition({ id: 'tea', culture: 'chinese', tier: 'custom', age: 'classical' }),
    tradition({ id: 'printing', culture: 'chinese', tier: 'custom', age: 'exploration' }),
  ],
  hybrids: [
    hybrid({ id: 'silk_road', name: 'Silk Road', cultures: ['greek', 'chinese'] }),
    hybrid({ id: 'steppe_court', name: 'Steppe Court', cultures: ['chinese', 'mongol'] }),
    hybrid({ id: 'far_future', cultures: ['greek', 'mongol'], age: 'exploration' }),
  ],
  signals: [],
  terrain: [
    { id: 'grassland', name: 'Grassland', yields: {}, moveCost: 1, defense: 0, water: false, color: '#00aa00' },
    { id: 'ocean', name: 'Ocean', yields: {}, moveCost: 1, defense: 0, water: true, color: '#0000aa' },
    { id: 'mountain', name: 'Mountain', yields: {}, moveCost: null, defense: 0, water: false, color: '#888888' },
  ],
  resources: [],
  leaders: [{ id: 'leader_a', name: 'Leader A', ability: '', modifiers: [yieldMod('gold', 1)], aiAgendaBias: [] }],
  dreams: [
    { id: 'pax', native: 'Pax', romanized: 'Pax', language: 'Latin', meaning: 'peace', modifiers: [yieldMod('gold', 1)] },
  ],
  governments: [
    { id: 'chiefdom', name: 'Chiefdom', age: 'ancient', cabinetSlots: ['elder'], policySlots: 1, modifiers: [] },
    { id: 'monarchy', name: 'Monarchy', age: 'classical', cabinetSlots: ['chancellor'], policySlots: 2, modifiers: [] },
    { id: 'republic', name: 'Republic', age: 'classical', cabinetSlots: ['chancellor'], policySlots: 2, modifiers: [] },
  ],
  cabinetSlots: [],
  units: [
    unit('warrior_band', 'ancient', 'infantry', 20),
    unit('spearman', 'classical', 'infantry', 30),
    unit('figure_general', 'ancient', 'commander', 20),
  ],
  buildings: [],
  wonders: [],
  techs: [],
  deeds: [],
  cityStates: [],
  crises: [crisis('collapse', 'ancient', ['raiders']), crisis('plague', 'classical', ['popLoss'])],
  legacy: [
    milestone({ id: 'anc_legacy', age: 'ancient', measure: 'figuresRecruited' }),
    milestone({ id: 'anc_military', age: 'ancient', measure: 'settlementCount', track: 'military', thresholds: [3, 5, 7] }),
    milestone({ id: 'cls_legacy', age: 'classical', measure: 'culturesRefined' }),
  ],
});

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------

export const makePlayer = (id: PlayerId, over: Partial<PlayerState> = {}): PlayerState => ({
  id,
  isHuman: id === 'p1',
  leader: 'leader_a',
  dream: 'pax',
  colors: { primary: '#ffffff', secondary: '#000000' },
  skinTone: 0,
  alive: true,
  civName: null,
  stock: { food: 0, production: 0, gold: 100, science: 0, culture: 0, faith: 0, happiness: 0, influence: 0 },
  income: { food: 0, production: 0, gold: 0, science: 0, culture: 0, faith: 0, happiness: 0, influence: 0 },
  happiness: 5,
  affinity: {},
  hintsShown: {},
  gp: { military: 0, statesman: 0, thought: 0, faith: 0, building: 0, exploration: 0 },
  gpThreshold: { military: 60, statesman: 60, thought: 60, faith: 60, building: 60, exploration: 60 },
  legendSlotUsed: false,
  government: 'chiefdom',
  anarchyTurns: 0,
  cabinet: {},
  cabinetCooldown: {},
  seatedTurns: {},
  traditions: [],
  hybrids: [],
  techs: [],
  research: { tech: { current: 't1', progress: 5 }, civic: { current: 'c1', progress: 3 } },
  milestones: [],
  legacyPoints: 0,
  refinementPoints: 0,
  score: 0,
  effects: [],
  stats: {
    battlesWonThisTurn: 0,
    citiesCapturedThisTurn: 0,
    battlesWon: 0,
    battlesWonThisAge: 4,
    citiesCaptured: 0,
    unitsLost: 0,
    wondersBuilt: 0,
    figuresRecruited: 0,
    figuresActivated: 0,
    envoysSent: 0,
    siegeTurnsHeld: 0,
  },
  explored: [],
  crisisChoices: [],
  chronicle: [],
  ...over,
});

export const MAP_W = 16;
export const MAP_H = 16;

export const makeState = (playerIds: PlayerId[] = ['p1', 'p2', 'p3'], over: Partial<GameState> = {}): GameState => {
  const tiles: Tile[] = [];
  for (let row = 0; row < MAP_H; row++) {
    for (let col = 0; col < MAP_W; col++) {
      const h = offsetToAxial({ col, row });
      tiles.push({
        ...h,
        terrain: 'grassland',
        feature: null,
        resource: null,
        river: false,
        elevation: 0,
        climate: 'temperate',
        owner: null,
        settlement: null,
        continent: 1,
      });
    }
  }
  const players: Record<PlayerId, PlayerState> = {};
  for (const id of playerIds) players[id] = makePlayer(id);
  return {
    version: 2,
    seed: 1,
    speed: 'standard',
    mapSize: 'small',
    finalAge: 'classical',
    turn: 10,
    age: 'ancient',
    phase: 'playing',
    currentPlayer: playerIds[0] ?? 'p1',
    ageProgress: 0,
    rng: seedRng(42),
    nextId: 1,
    map: { width: MAP_W, height: MAP_H, tiles },
    playerOrder: [...playerIds],
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
    ...over,
  };
};

export const tileIndexAt = (state: GameState, h: Hex): number => {
  const i = state.map.tiles.findIndex((t) => t.q === h.q && t.r === h.r);
  if (i < 0) throw new Error(`no tile at ${h.q},${h.r}`);
  return i;
};

/** Add a settlement at offset (col,row); marks that tile owned. */
export const addSettlement = (
  state: GameState,
  id: string,
  owner: PlayerId,
  col: number,
  row: number,
  over: Partial<Settlement> = {},
): Settlement => {
  const at = offsetToAxial({ col, row });
  const s: Settlement = {
    id,
    owner,
    originalOwner: owner,
    name: id,
    namedFor: 'greek',
    at,
    kind: 'city',
    population: 4,
    foodStored: 0,
    isCapital: false,
    foundedTurn: 0,
    buildings: [],
    hp: 100,
    maxHp: 100,
    siegeTurns: 0,
    production: { item: 'warrior_band', progress: 40 },
    ...over,
  };
  state.settlements[id] = s;
  const tile = state.map.tiles[tileIndexAt(state, at)];
  if (tile) {
    tile.owner = owner;
    tile.settlement = id;
  }
  return s;
};

export const addFigure = (state: GameState, id: FigureId, owner: PlayerId, location: FigureState['location']): void => {
  state.figures[id] = { id, owner, recruitedTurn: 1, recruitedAge: 'ancient', reason: 'test', activated: false, location };
};

/** Give a player culture weight via seated turns (fake weights = seatedTurns / 10). */
export const setWeights = (state: GameState, player: PlayerId, weights: Record<CultureId, number>): void => {
  const p = state.players[player];
  if (!p) throw new Error(player);
  p.seatedTurns = {};
  for (const [c, w] of Object.entries(weights)) p.seatedTurns[c] = w * 10;
};

export const makeCtx = (state: GameState, content: ContentBundle = fixtureContent()): SimCtx => ({
  state,
  content,
  events: [] as SimEvent[],
});

export const eventsOf = <T extends SimEvent['type']>(ctx: SimCtx, type: T): Extract<SimEvent, { type: T }>[] =>
  ctx.events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

export const player = (state: GameState, id: PlayerId): PlayerState => {
  const p = state.players[id];
  if (!p) throw new Error(`no player ${id}`);
  return p;
};
