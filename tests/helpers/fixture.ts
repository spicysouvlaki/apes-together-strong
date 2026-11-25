/**
 * Hand-built content and GameState factory for sim-core rule tests, so they need neither
 * map generation nor the real (growing) content files. Numbers here are test values only.
 *
 * Tests that want isolation from src/emergence and src/sim/ages mock them in the test file;
 * this module only imports sim-core modules.
 */
import { GP_KINDS, YIELDS, type ContentBundle, type GpKind, type YieldType } from '@contracts/content-schemas';
import { offsetToAxial, type Hex } from '@contracts/hex';
import type { GameState, PlayerId, PlayerState, Settlement, Tile, Unit } from '@contracts/sim-api';
import type { SimCtx } from '../../src/sim/ctx';
import { tileAt } from '../../src/sim/lookup';
import { seedRng } from '../../src/sim/rng';
import { createSettlement } from '../../src/sim/settlements';
import { UNIT_MAX_HP } from '../../src/sim/constants';

const history = { note: 'Test.', source: 'test fixture' };

export const fixtureContent = (): ContentBundle => ({
  cultures: [
    { id: 'alpha', name: 'Alpha', adjective: 'Alphan', firstPlayable: true, architecture: 'a', musicStem: 'a', cityNames: ['A1', 'A2', 'A3', 'A4'] },
    { id: 'beta', name: 'Beta', adjective: 'Betan', firstPlayable: true, architecture: 'b', musicStem: 'b', cityNames: ['B1', 'B2', 'B3', 'B4'] },
  ],
  figures: [],
  traditions: [],
  hybrids: [],
  signals: [],
  terrain: [
    { id: 'grassland', name: 'Grassland', yields: { food: 2 }, moveCost: 1, defense: 0, water: false, color: '#00ff00' },
    { id: 'plains', name: 'Plains', yields: { food: 1, production: 1 }, moveCost: 1, defense: 0, water: false, color: '#ffff00' },
    { id: 'desert', name: 'Desert', yields: { production: 1 }, moveCost: 1, defense: 0, water: false, color: '#ffcc00' },
    { id: 'mountain', name: 'Mountain', yields: {}, moveCost: null, defense: 0, water: false, color: '#888888' },
    { id: 'coast', name: 'Coast', yields: { food: 1, gold: 1 }, moveCost: null, defense: 0, water: true, color: '#0000ff' },
  ],
  resources: [
    { id: 'wheat', name: 'Wheat', class: 'bonus', yields: { food: 1 }, terrains: ['grassland'], revealAge: 'ancient' },
    { id: 'silk', name: 'Silk', class: 'luxury', yields: { gold: 2, happiness: 2 }, terrains: ['grassland'], revealAge: 'ancient' },
    { id: 'horses', name: 'Horses', class: 'strategic', yields: { production: 1 }, terrains: ['plains'], revealAge: 'ancient' },
  ],
  leaders: [{ id: 'plain', name: 'Plain', ability: 'none', modifiers: [{ scope: 'empire', effect: { kind: 'vision', add: 0 } }], aiAgendaBias: [] }],
  dreams: [{ id: 'quiet', native: 'Q', romanized: 'Q', language: 'Test', meaning: 'Q', modifiers: [{ scope: 'empire', effect: { kind: 'vision', add: 0 } }] }],
  governments: [
    { id: 'chiefdom', name: 'Chiefdom', age: 'ancient', cabinetSlots: ['elder'], policySlots: 2, modifiers: [] },
    {
      id: 'despotism',
      name: 'Despotism',
      age: 'ancient',
      cabinetSlots: ['elder'],
      policySlots: 2,
      modifiers: [{ scope: 'empire', effect: { kind: 'cost', target: 'unit', percent: -50 } }],
    },
    { id: 'monarchy', name: 'Monarchy', age: 'classical', cabinetSlots: ['elder'], policySlots: 3, modifiers: [] },
  ],
  cabinetSlots: [{ id: 'elder', name: 'Elder', accepts: ['statesman'] }],
  units: [
    { id: 'settler', name: 'Settler', age: 'ancient', unitClass: 'civilian', strength: 0, moves: 2, cost: 60, canFound: true, canTrade: false, siegeBonus: 0, vision: 2 },
    { id: 'scout', name: 'Scout', age: 'ancient', unitClass: 'civilian', strength: 0, moves: 3, cost: 20, canFound: false, canTrade: false, siegeBonus: 0, vision: 3 },
    { id: 'merchant', name: 'Merchant', age: 'ancient', unitClass: 'civilian', strength: 0, moves: 2, cost: 40, canFound: false, canTrade: true, siegeBonus: 0, vision: 2 },
    { id: 'warrior', name: 'Warrior', age: 'ancient', unitClass: 'infantry', strength: 20, moves: 2, cost: 30, canFound: false, canTrade: false, siegeBonus: 0, upgradesTo: 'spearman', vision: 2 },
    { id: 'slinger', name: 'Slinger', age: 'ancient', unitClass: 'ranged', strength: 15, rangedStrength: 20, range: 2, moves: 2, cost: 35, canFound: false, canTrade: false, siegeBonus: 0, vision: 2 },
    { id: 'ram', name: 'Ram', age: 'ancient', unitClass: 'siege', strength: 20, moves: 2, cost: 50, canFound: false, canTrade: false, siegeBonus: 15, vision: 2 },
    { id: 'chariot', name: 'Chariot', age: 'ancient', unitClass: 'cavalry', strength: 25, moves: 3, cost: 50, requiresResource: 'horses', canFound: false, canTrade: false, siegeBonus: 0, vision: 2 },
    { id: 'canoe', name: 'Canoe', age: 'ancient', unitClass: 'naval', strength: 20, moves: 3, cost: 40, canFound: false, canTrade: false, siegeBonus: 0, vision: 2 },
    { id: 'spearman', name: 'Spearman', age: 'ancient', unitClass: 'infantry', strength: 30, moves: 2, cost: 60, requiresTech: 'bronze', canFound: false, canTrade: false, siegeBonus: 0, vision: 2 },
    { id: 'general', name: 'Commander', age: 'ancient', unitClass: 'commander', strength: 25, moves: 3, cost: 1, figureKind: 'general', canFound: false, canTrade: false, siegeBonus: 0, vision: 2 },
  ],
  buildings: [
    { id: 'granary', name: 'Granary', age: 'ancient', cost: 40, yields: { food: 2 }, gp: {}, modifiers: [], requiresTech: 'pottery', defense: 0, description: '' },
    { id: 'walls', name: 'Walls', age: 'ancient', cost: 50, yields: {}, gp: {}, modifiers: [], defense: 50, description: '' },
    { id: 'shrine', name: 'Shrine', age: 'ancient', cost: 30, yields: { faith: 2, happiness: 1 }, gp: {}, modifiers: [], defense: 0, description: '' },
    { id: 'harbor', name: 'Harbor', age: 'ancient', cost: 40, yields: { gold: 2 }, gp: {}, modifiers: [], requires: { coastal: true }, defense: 0, description: '' },
  ],
  wonders: [
    { id: 'pyramid', name: 'Pyramid', age: 'ancient', cost: 100, culture: 'beta', affinity: 20, yields: { culture: 2 }, gp: {}, modifiers: [], description: '', history },
  ],
  techs: [
    { id: 'pottery', name: 'Pottery', tree: 'tech', age: 'ancient', cost: 20, requires: [], col: 0, row: 0, modifiers: [], description: '' },
    { id: 'bronze', name: 'Bronze', tree: 'tech', age: 'ancient', cost: 30, requires: ['pottery'], col: 1, row: 0, modifiers: [], description: '' },
    { id: 'laws', name: 'Laws', tree: 'civic', age: 'ancient', cost: 20, requires: [], col: 0, row: 0, modifiers: [], description: '' },
    { id: 'iron', name: 'Iron', tree: 'tech', age: 'classical', cost: 100, requires: [], col: 0, row: 0, modifiers: [], description: '' },
  ],
  deeds: [],
  cityStates: [
    {
      id: 'cs_one',
      name: 'One City',
      culture: 'beta',
      type: 'trade',
      suzerainModifiers: [{ scope: 'empire', effect: { kind: 'yield', yield: 'gold', add: 3 } }],
      description: '',
      history,
    },
  ],
  crises: [],
  legacy: [],
});

const zeroYields = (): Record<YieldType, number> => {
  const out = {} as Record<YieldType, number>;
  for (const y of YIELDS) out[y] = 0;
  return out;
};

const zeroGp = (v: number): Record<GpKind, number> => {
  const out = {} as Record<GpKind, number>;
  for (const k of GP_KINDS) out[k] = v;
  return out;
};

export const fixturePlayer = (id: PlayerId, tiles: number): PlayerState => ({
  id,
  isHuman: id === 'p1',
  leader: 'plain',
  dream: 'quiet',
  colors: { primary: '#ff0000', secondary: '#ffffff' },
  skinTone: 0,
  alive: true,
  civName: null,
  stock: zeroYields(),
  income: zeroYields(),
  happiness: 0,
  affinity: {},
  hintsShown: {},
  gp: zeroGp(0),
  gpThreshold: zeroGp(60),
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
});

/** A `width × height` map of `terrain` (default grassland), players p1..pN, nothing else. */
export const fixtureState = (opts: { width?: number; height?: number; players?: number; terrain?: string; seed?: number } = {}): GameState => {
  const width = opts.width ?? 12;
  const height = opts.height ?? 10;
  const tiles: Tile[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const h = offsetToAxial({ col, row });
      tiles.push({
        q: h.q,
        r: h.r,
        terrain: opts.terrain ?? 'grassland',
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
  const ids = Array.from({ length: opts.players ?? 2 }, (_, i) => `p${i + 1}`);
  const players: Record<PlayerId, PlayerState> = {};
  for (const id of ids) players[id] = fixturePlayer(id, tiles.length);
  return {
    version: 2,
    seed: opts.seed ?? 1,
    speed: 'standard',
    mapSize: 'small',
    finalAge: 'classical',
    turn: 1,
    age: 'ancient',
    phase: 'playing',
    currentPlayer: ids[0] ?? 'p1',
    ageProgress: 0,
    rng: seedRng(opts.seed ?? 1),
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

/** Hex at offset (col, row). */
export const at = (col: number, row: number): Hex => offsetToAxial({ col, row });

export const ctxOf = (state: GameState, content: ContentBundle): SimCtx => ({ state, content, events: [] });

export const setTile = (state: GameState, h: Hex, patch: Partial<Tile>): Tile => {
  const t = tileAt(state.map, h);
  if (!t) throw new Error(`no tile at ${h.q},${h.r}`);
  Object.assign(t, patch);
  return t;
};

/** Place a unit directly (no stacking checks). */
export const addUnit = (state: GameState, owner: PlayerId, type: string, h: Hex, content: ContentBundle, patch: Partial<Unit> = {}): Unit => {
  const def = content.units.find((u) => u.id === type);
  if (!def) throw new Error(`unknown unit ${type}`);
  const id = `u${state.nextId++}`;
  const u: Unit = {
    id,
    owner,
    type,
    unitClass: def.unitClass,
    at: { q: h.q, r: h.r },
    hp: UNIT_MAX_HP,
    movesLeft: def.moves,
    fortified: false,
    hasAttacked: false,
    figure: null,
    ...patch,
  };
  state.units[id] = u;
  return u;
};

/** Place a settlement directly (claims tiles like founding does). */
export const addSettlement = (
  state: GameState,
  owner: PlayerId,
  h: Hex,
  opts: Partial<{ name: string; kind: 'town' | 'city'; isCapital: boolean; population: number }> = {},
): Settlement =>
  createSettlement(state, owner, h, {
    name: opts.name ?? `S${state.nextId}`,
    namedFor: 'alpha',
    kind: opts.kind ?? 'city',
    isCapital: opts.isCapital ?? true,
    population: opts.population ?? 1,
  });
