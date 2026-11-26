/**
 * Renderer dev harness: http://localhost:5173/render-demo.html
 *
 * Builds a fake 48x30 GameState from its own seeded noise (independent of src/sim/mapgen.ts),
 * with settlements and units for three players, a city-state and raiders, partial fog, and
 * tap-to-select. Query params:
 *   ?real=1          use the sim's generateMap if it is implemented (falls back otherwise)
 *   ?size=standard   64x40 (also: large 80x50)
 *   ?seed=123        noise seed
 *   ?reveal=1        start with fog off (viewer null)
 *   ?reduceMotion=1
 *   ?patterns=1      colorblind patterns on
 *   ?quality=low     low render quality (no micro-detail, shadows or water animation)
 *   ?age=classical   materials shift by age
 *   ?bench=1         scripted pan/zoom across all zoom bands; reports frame times per band
 * Scenario extras: p1 is at war with p2 (red rims/rings), a fortified unit, a damaged city,
 * a p1 trade route, ready-unit hints, and the "Scout" button walks a unit away so the rival
 * city it saw turns into a fog-of-war ghost.
 * Not part of the game bundle.
 */
import { Resource, Terrain, type ContentBundle } from '@contracts/content-schemas';
import { hexDistance, hexEquals, hexesInRange, offsetToAxial, type Hex } from '@contracts/hex';
import type { GameState, MapState, PlayerState, Settlement, Tile, Unit, UnitId } from '@contracts/sim-api';
import '@fontsource-variable/fraunces';
import { loadContent, rawContent } from '../content';
import { createRenderer, type Renderer } from './index';
import { tileIndex } from './layout';

// --- tiny seeded noise (demo only) ------------------------------------------------------------

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const valueNoise = (w: number, h: number, cell: number, rnd: () => number): ((x: number, y: number) => number) => {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = Array.from({ length: gw * gh }, () => rnd());
  const at = (i: number, j: number): number => grid[j * gw + i] ?? 0;
  const s = (t: number): number => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = s(fx - i);
    const ty = s(fy - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
    return a + (b - a) * ty;
  };
};

// --- content ---------------------------------------------------------------------------------

const getContent = (): ContentBundle => {
  try {
    return loadContent();
  } catch (e) {
    // Other workstreams may have content mid-edit; the renderer only needs terrain + resources.
    console.warn('render-demo: full content failed to parse, using terrain/resources only', e);
    const partial = {
      terrain: Terrain.array().parse(rawContent.terrain),
      resources: Resource.array().parse(rawContent.resources),
    };
    return partial as unknown as ContentBundle;
  }
};

// --- fake map ---------------------------------------------------------------------------------

const has = (content: ContentBundle, id: string): boolean => content.terrain.some((t) => t.id === id);

const fakeMap = (width: number, height: number, seed: number, content: ContentBundle): MapState => {
  const rnd = mulberry32(seed);
  const elev = valueNoise(width, height, 7, rnd);
  const detail = valueNoise(width, height, 3, rnd);
  const moist = valueNoise(width, height, 6, rnd);
  const pickT = (...ids: string[]): string => ids.find((id) => has(content, id)) ?? content.terrain[0]?.id ?? 'grassland';
  const tiles: Tile[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const h = offsetToAxial({ col, row });
      const nx = col / (width - 1) - 0.5;
      const ny = row / (height - 1) - 0.5;
      const edge = 1 - Math.min(1, Math.hypot(nx * 1.25, ny * 1.4) * 1.35);
      const e = elev(col, row) * 0.6 + detail(col, row) * 0.25 + edge * 0.45 - 0.12;
      const m = moist(col, row);
      const lat = Math.abs(ny) * 2; // 0 equator .. 1 pole
      let terrain: string;
      let feature: string | null = null;
      let elevation = 0;
      let climate: Tile['climate'] = 'temperate';
      if (lat > 0.85) climate = 'polar';
      else if (lat > 0.65) climate = 'boreal';
      else if (lat < 0.2) climate = 'tropical';
      else if (lat < 0.4 && m < 0.45) climate = 'arid';
      if (e < 0.3) terrain = pickT('ocean');
      else if (e < 0.38) terrain = pickT('coast');
      else if (e > 0.78) {
        terrain = pickT('mountain');
        elevation = 2;
      } else {
        if (climate === 'polar') terrain = pickT('snow', 'tundra');
        else if (climate === 'boreal') terrain = pickT('tundra');
        else if (climate === 'arid') terrain = m < 0.3 ? pickT('desert') : pickT('steppe', 'plains');
        else if (climate === 'tropical') terrain = m > 0.5 ? pickT('grassland') : pickT('plains');
        else terrain = m > 0.5 ? pickT('grassland') : pickT('plains');
        if (e > 0.66) {
          feature = 'hills';
          elevation = 1;
        } else if (m > 0.62 && climate !== 'arid' && climate !== 'polar') {
          feature = climate === 'tropical' ? 'jungle' : 'forest';
        } else if (m > 0.55 && e < 0.42) {
          feature = 'marsh';
        } else if (climate === 'arid' && rnd() < 0.04) {
          feature = 'oasis';
        }
      }
      const isWater = content.terrain.find((t) => t.id === terrain)?.water ?? false;
      const river = !isWater && feature !== 'hills' && e > 0.4 && e < 0.55 && m > 0.45 && m < 0.52;
      if (river && terrain === pickT('desert')) terrain = pickT('floodplain', 'desert');
      const candidates = content.resources.filter((r) => r.terrains.includes(terrain));
      const resource = candidates.length > 0 && rnd() < 0.09 ? (candidates[Math.floor(rnd() * candidates.length)]?.id ?? null) : null;
      tiles.push({
        ...h,
        terrain,
        feature,
        resource,
        river,
        elevation,
        climate,
        owner: null,
        settlement: null,
        continent: isWater ? 0 : 1,
      });
    }
  }
  return { width, height, tiles };
};

// --- fake state -------------------------------------------------------------------------------

const YIELD0 = { food: 0, production: 0, gold: 0, science: 0, culture: 0, faith: 0, happiness: 0, influence: 0 };
const GP0 = { military: 0, statesman: 0, thought: 0, faith: 0, building: 0, exploration: 0 };

const fakePlayer = (id: string, primary: string, secondary: string, tiles: number): PlayerState => ({
  id,
  isHuman: id === 'p1',
  leader: 'demo',
  dream: 'demo',
  colors: { primary, secondary },
  skinTone: 0,
  alive: true,
  civName: null,
  stock: { ...YIELD0 },
  income: { ...YIELD0 },
  happiness: 0,
  affinity: {},
  hintsShown: {},
  gp: { ...GP0 },
  gpThreshold: { ...GP0 },
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

interface Built {
  state: GameState;
  content: ContentBundle;
}

const isLand = (content: ContentBundle, t: Tile | undefined): boolean => {
  if (!t) return false;
  const def = content.terrain.find((x) => x.id === t.terrain);
  return !!def && !def.water && def.moveCost !== null;
};

const buildState = (map: MapState, content: ContentBundle, seed: number, starts?: Hex[]): GameState => {
  const n = map.width * map.height;
  const rnd = mulberry32(seed ^ 0x5bd1e995);
  const players: Record<string, PlayerState> = {
    p1: fakePlayer('p1', '#2f6fd6', '#f4d35e', n),
    p2: fakePlayer('p2', '#c4453c', '#f7efe0', n),
    p3: fakePlayer('p3', '#7b4fb3', '#e9e1ff', n),
  };
  const at = (h: Hex): Tile | undefined => map.tiles[tileIndex(h, map.width, map.height)];
  const landNear = (target: Hex, taken: Hex[]): Hex => {
    for (let r = 0; r < 12; r++) {
      for (const h of hexesInRange(target, r)) {
        const t = at(h);
        if (isLand(content, t) && taken.every((x) => hexDistance(x, h) >= 3)) return h;
      }
    }
    return target;
  };
  const W = map.width;
  const H = map.height;
  const anchors: [string, number, number][] = [
    ['p1', 0.3, 0.45],
    ['p2', 0.68, 0.35],
    ['p3', 0.55, 0.7],
    ['cs:demo', 0.45, 0.25],
  ];
  const settlements: Record<string, Settlement> = {};
  const taken: Hex[] = [];
  // Real culture motif kits (content/cultures.json `architecture`): p1 Egyptian with Greek
  // traditions (a hybrid look), p2 Spanish with the Al-Andalus hybrid, p3 Chinese, a Norse
  // city-state. ?age= switches the age (materials shift).
  const cultureOf: Record<string, string> = { p1: 'egyptian', p2: 'spanish', p3: 'chinese', 'cs:demo': 'norse' };
  const tradOf = (culture: string, n: number): string[] =>
    (content.traditions ?? []).filter((t) => t.culture === culture).slice(0, n).map((t) => t.id);
  if (players.p1) players.p1.traditions = [...tradOf('egyptian', 2), ...tradOf('greek', 3)];
  if (players.p2) players.p2.hybrids = (content.hybrids ?? []).filter((h) => h.cultures.includes('spanish')).slice(0, 1).map((h) => h.id);
  if (players.p3) players.p3.traditions = tradOf('mongol', 2);
  const names: Record<string, string[]> = {
    p1: ['Uruk', 'Eridu', 'Lagash'],
    p2: ['Memphis', 'Thebes'],
    p3: ['Harappa', 'Lothal', 'Dholavira'],
    'cs:demo': ['Byblos'],
  };
  let sid = 0;
  for (const [owner, fx, fy] of anchors) {
    const list = names[owner] ?? [];
    list.forEach((name, k) => {
      const base = starts?.[sid] ?? offsetToAxial({ col: Math.round(W * fx) + k * 4 - 3, row: Math.round(H * fy) + (k % 2) * 3 });
      const hex = landNear(base, taken);
      taken.push(hex);
      const id = `s${sid++}`;
      const kind: Settlement['kind'] = k === 0 || k === 2 ? 'city' : 'town';
      settlements[id] = {
        id,
        owner,
        originalOwner: owner,
        name,
        namedFor: cultureOf[owner] ?? 'demo',
        at: hex,
        kind,
        population: kind === 'city' ? 3 + Math.floor(rnd() * 8) : 1 + Math.floor(rnd() * 4),
        foodStored: 0,
        isCapital: k === 0 && !owner.startsWith('cs:'),
        foundedTurn: 1,
        buildings: [],
        hp: 100,
        maxHp: 100,
        siegeTurns: 0,
        production: { item: null, progress: 0 },
      };
      for (const h of hexesInRange(hex, kind === 'city' ? 2 : 1)) {
        const t = at(h);
        if (t && t.owner === null) t.owner = owner;
      }
      const t = at(hex);
      if (t) t.settlement = id;
    });
  }

  const units: Record<string, Unit> = {};
  let uid = 0;
  const occupied: Hex[] = [];
  const addUnit = (owner: string, type: string, unitClass: Unit['unitClass'], near: Hex, extra: Partial<Unit> = {}): void => {
    let spot = near;
    for (let r = 0; r < 6; r++) {
      const found = hexesInRange(near, r).find((h) => {
        const t = at(h);
        const water = content.terrain.find((x) => x.id === t?.terrain)?.water ?? false;
        const ok = unitClass === 'naval' ? water : isLand(content, t);
        return ok && !occupied.some((o) => hexEquals(o, h));
      });
      if (found) {
        spot = found;
        break;
      }
    }
    occupied.push(spot);
    const id = `u${uid++}`;
    units[id] = { id, owner, type, unitClass, at: spot, hp: 100, movesLeft: 2, fortified: false, hasAttacked: false, figure: null, ...extra };
  };
  const cap = (owner: string): Hex => Object.values(settlements).find((s) => s.owner === owner)?.at ?? { q: 10, r: 10 };
  for (const p of ['p1', 'p2', 'p3']) {
    const c = cap(p);
    addUnit(p, 'warrior_band', 'infantry', { q: c.q + 1, r: c.r });
    addUnit(p, 'slinger', 'ranged', { q: c.q - 1, r: c.r + 1 });
    addUnit(p, 'chariot', 'cavalry', { q: c.q + 2, r: c.r - 1 });
    addUnit(p, 'settler', 'civilian', { q: c.q, r: c.r + 2 });
  }
  const c1 = cap('p1');
  addUnit('p1', 'ram', 'siege', { q: c1.q + 3, r: c1.r + 1 }, { hp: 45 });
  addUnit('p1', 'figure_general', 'commander', { q: c1.q - 2, r: c1.r }, { figure: 'demo_figure' });
  addUnit('p1', 'war_canoe', 'naval', { q: c1.q - 4, r: c1.r + 2 });
  addUnit('p1', 'scout', 'infantry', { q: c1.q + 5, r: c1.r - 2 }, { hp: 80, fortified: true });
  // Stacked civilian + military on one tile.
  const cap1 = cap('p1');
  addUnit('p1', 'builder', 'civilian', cap1);
  const stackAt = Object.values(units).find((u) => u.owner === 'p1' && u.unitClass === 'infantry')?.at;
  if (stackAt) {
    const id = `u${uid++}`;
    units[id] = { id, owner: 'p1', type: 'settler', unitClass: 'civilian', at: stackAt, hp: 100, movesLeft: 2, fortified: false, hasAttacked: false, figure: null };
  }
  addUnit('p2', 'spearman', 'infantry', { q: c1.q + 6, r: c1.r - 2 }, { hp: 20 });
  addUnit('raiders', 'warrior_band', 'infantry', { q: c1.q + 4, r: c1.r + 3 });

  // A damaged rival city (walls hp < maxHp) and a p1 trade route between its first two cities.
  const p2City = Object.values(settlements).find((s) => s.owner === 'p2' && s.kind === 'city');
  if (p2City) p2City.hp = 55;
  const p1s = Object.values(settlements).filter((s) => s.owner === 'p1');
  const tradeRoutes = p1s.length >= 2 && p1s[0] && p1s[1] ? [{ id: 'tr1', owner: 'p1', from: p1s[0].id, to: p1s[1].id }] : [];
  return {
    version: 2,
    seed,
    speed: 'standard',
    mapSize: 'small',
    finalAge: 'classical',
    difficulty: 'normal',
    turn: 12,
    age: (['ancient', 'classical', 'exploration', 'modern'] as const).find((a) => a === new URLSearchParams(location.search).get('age')) ?? 'ancient',
    phase: 'playing',
    currentPlayer: 'p1',
    ageProgress: 20,
    rng: [1, 2, 3, 4],
    nextId: 100,
    map,
    playerOrder: ['p1', 'p2', 'p3'],
    players,
    settlements,
    units,
    figures: {},
    offers: [],
    deedsDone: [],
    wonders: Object.fromEntries(
      (
        [
          ['great_pyramid', 'p1'],
          ['parthenon', 'p1'],
          ['great_wall', 'p3'],
          ['house_of_wisdom', 'p2'],
        ] as const
      ).flatMap(([w, owner]) => {
        const cap = Object.values(settlements).find((x) => x.owner === owner && x.isCapital);
        return cap ? [[w, { owner, settlement: cap.id, turn: 5 }]] : [];
      }),
    ),
    cityStates: {},
    tradeRoutes,
    wars: { 'p1|p2': 5 },
    crisis: null,
    transition: null,
    result: null,
  };
};

/** Demo fog: sight radius 2 around p1 units/settlements; explored radius 7 (kept across moves). */
const computeFog = (state: GameState, viewer: string): number[] => {
  const { width, height } = state.map;
  const p = state.players[viewer];
  if (!p) return [];
  const visible = new Set<number>();
  const sources: Hex[] = [
    ...Object.values(state.units).filter((u) => u.owner === viewer).map((u) => u.at),
    ...Object.values(state.settlements).filter((s) => s.owner === viewer).map((s) => s.at),
  ];
  for (const s of sources) {
    for (const h of hexesInRange(s, 2)) {
      const i = tileIndex(h, width, height);
      if (i >= 0) visible.add(i);
    }
    for (const h of hexesInRange(s, 7)) {
      const i = tileIndex(h, width, height);
      if (i >= 0) p.explored[i] = 1;
    }
  }
  return [...visible].sort((a, b) => a - b);
};

const hexLine = (a: Hex, b: Hex): Hex[] => {
  const n = hexDistance(a, b);
  const out: Hex[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const fq = a.q + (b.q - a.q) * t + 1e-6;
    const fr = a.r + (b.r - a.r) * t + 1e-6;
    const fs = -fq - fr;
    let q = Math.round(fq);
    let r = Math.round(fr);
    const s = Math.round(fs);
    if (Math.abs(q - fq) > Math.abs(r - fr) && Math.abs(q - fq) > Math.abs(s - fs)) q = -r - s;
    else if (Math.abs(r - fr) > Math.abs(s - fs)) r = -q - s;
    out.push({ q, r });
  }
  return out;
};

// --- main -------------------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const sizes: Record<string, [number, number]> = { small: [48, 30], standard: [64, 40], large: [80, 50] };
const [W, H] = sizes[params.get('size') ?? 'small'] ?? [48, 30];
const seed = Number(params.get('seed') ?? 7) || 7;
const notes: string[] = [];

/** Real sim game (game=1): the opening exactly as a new player sees it. */
let simApi: typeof import('../sim/index') | null = null;
let simQueries: typeof import('../sim/queries') | null = null;

const build = async (): Promise<Built> => {
  const content = getContent();
  if (params.get('game') === '1') {
    simApi = await import('../sim/index');
    simQueries = await import('../sim/queries');
    const colors = [
      { primary: '#2f5d8a', secondary: '#e9d9a6' },
      { primary: '#a33b2b', secondary: '#f1e3c0' },
      { primary: '#4e7d3a', secondary: '#efe2c2' },
    ];
    const players = colors.map((c, k) => ({
      id: `p${k + 1}`,
      isHuman: k === 0,
      leader: content.leaders[k % content.leaders.length]?.id ?? '',
      dream: content.dreams[k % content.dreams.length]?.id ?? '',
      colors: c,
      skinTone: Number(params.get('skin') ?? k * 2),
    }));
    const { state } = simApi.createGame({ seed, mapSize: (params.get('size') ?? 'small') as GameState['mapSize'], speed: 'standard', players }, content);
    notes.push('real game');
    return { state, content };
  }
  if (params.get('real') === '1') {
    try {
      const { generateMap } = await import('../sim/mapgen');
      const { seedRng } = await import('../sim/rng');
      const size = (params.get('size') ?? 'small') as GameState['mapSize'];
      const g = generateMap(size, 3, content, { rng: seedRng(seed) });
      notes.push('real mapgen');
      return { state: buildState(g.map, content, seed, g.starts), content };
    } catch (e) {
      notes.push(`real mapgen unavailable (${e instanceof Error ? e.message : String(e)}); using demo noise`);
    }
  }
  return { state: buildState(fakeMap(W, H, seed, content), content, seed), content };
};

const main = async (): Promise<void> => {
  const canvas = document.getElementById('map') as HTMLCanvasElement;
  const statsEl = document.getElementById('stats') as HTMLElement;
  const infoEl = document.getElementById('info') as HTMLElement;
  const { state: initial, content } = await build();
  let state = initial;
  let viewer: string | null = params.get('reveal') === '1' ? null : 'p1';
  let patterns = params.get('patterns') === '1';
  const renderer: Renderer = createRenderer(canvas, content, {
    reduceMotion: params.get('reduceMotion') === '1',
    patterns,
    quality: params.get('quality') === 'low' ? 'low' : 'high',
    // The demo HUD is small: top stats, bottom button row.
    safeArea: { top: 70, bottom: 70 },
  });
  (window as unknown as { renderer: Renderer }).renderer = renderer;
  Object.defineProperty(window, 'demoState', { get: () => state });

  let band = 'close';
  const push = (): void => {
    const visible = simQueries ? [...simQueries.queries.visibleTiles(state, 'p1', content)] : computeFog(state, 'p1');
    renderer.setState(state, viewer, viewer === null ? [] : visible);
    renderer.setHints({ readyUnits: Object.values(state.units).filter((u) => u.owner === 'p1' && u.movesLeft > 0).map((u) => u.id) });
  };
  push();
  renderer.onZoomBand((b) => (band = b));

  let selected: UnitId | null = null;
  let reach: Hex[] = [];
  let attack: Hex[] = [];
  let pending: Hex | null = null;

  const select = (id: UnitId | null): void => {
    selected = id;
    pending = null;
    const u = id ? state.units[id] : undefined;
    if (!u) {
      reach = [];
      attack = [];
    } else {
      const occupied = Object.values(state.units).map((x) => x.at);
      reach = hexesInRange(u.at, 2).filter((h) => {
        const t = state.map.tiles[tileIndex(h, state.map.width, state.map.height)];
        return !hexEquals(h, u.at) && isLand(content, t) && !occupied.some((o) => hexEquals(o, h));
      });
      attack = Object.values(state.units)
        .filter((x) => x.owner !== u.owner && hexDistance(x.at, u.at) <= 2)
        .map((x) => x.at);
    }
    renderer.setSelection({ unit: id, tile: u ? u.at : null, reachable: reach, attackable: attack, path: [] });
  };

  renderer.onTap((hex) => {
    infoEl.textContent = `tap ${hex.q},${hex.r}`;
    const unit = Object.values(state.units).find((u) => hexEquals(u.at, hex) && u.owner === 'p1');
    const sel = selected ? state.units[selected] : undefined;
    if (sel && reach.some((h) => hexEquals(h, hex))) {
      if (pending && hexEquals(pending, hex)) {
        // Second tap on the same target: move (new snapshot object, like the worker sends).
        state = { ...state, units: { ...state.units, [sel.id]: { ...sel, at: hex, movesLeft: 0 } } };
        push();
        select(sel.id);
      } else {
        pending = hex;
        renderer.setSelection({ tile: hex, path: hexLine(sel.at, hex) });
      }
      return;
    }
    if (sel && attack.some((h) => hexEquals(h, hex))) {
      renderer.flash(hex, 'combat');
      return;
    }
    if (unit) {
      select(unit.id);
      return;
    }
    select(null);
    renderer.setSelection({ tile: hex });
  });
  renderer.onLongPress((hex) => {
    infoEl.textContent = `long-press ${hex.q},${hex.r}`;
    renderer.flash(hex, 'found');
  });

  const btn = (id: string, fn: () => void): void => {
    document.getElementById(id)?.addEventListener('click', fn);
  };
  btn('fog', () => {
    viewer = viewer === null ? 'p1' : null;
    push();
  });
  btn('capital', () => {
    const c = Object.values(state.settlements).find((s) => s.owner === 'p1' && s.isCapital);
    if (c) renderer.focus(c.at);
  });
  btn('flash', () => {
    const u = Object.values(state.units).find((x) => x.owner === 'raiders');
    if (u) renderer.flash(u.at, 'combat');
  });
  btn('patterns', () => {
    patterns = !patterns;
    renderer.setPatterns(patterns);
  });
  // Walk the scout back home: rival cities it saw stay as fog-of-war ghosts.
  let scoutAway = false;
  btn('scout', () => {
    const scout = Object.values(state.units).find((u) => u.owner === 'p1' && u.type === 'scout');
    const home = Object.values(state.settlements).find((s) => s.owner === 'p1' && s.isCapital);
    if (!scout || !home) return;
    const far = Object.values(state.settlements).find((s) => s.owner === 'p2');
    scoutAway = !scoutAway && !!far;
    const dest = scoutAway && far ? far.at : home.at;
    state = { ...state, units: { ...state.units, [scout.id]: { ...scout, at: { q: dest.q + 1, r: dest.r } } } };
    push();
    infoEl.textContent = `scout -> ${dest.q},${dest.r}`;
  });

  // Bench: a scripted pan + zoom sweep through every zoom band; reports per-band frame stats.
  let benchRaf = 0;
  const runBench = (): void => {
    if (benchRaf) {
      cancelAnimationFrame(benchRaf);
      benchRaf = 0;
      return;
    }
    const PHASES: { name: string; zoom: number; ms: number }[] = [
      // Factors from the closest zoom (normalized distance 5): 3 -> 15 (close), 6 -> 30
      // (regional), 16 -> 80 (strategic).
      { name: 'close', zoom: 3, ms: 3000 },
      { name: 'regional', zoom: 6, ms: 3000 },
      { name: 'strategic', zoom: 16, ms: 3000 },
    ];
    const results: string[] = [];
    let phase = 0;
    let t0 = performance.now();
    let last = t0;
    let frames = 0;
    let sum = 0;
    let worst = 0;
    let cpu = 0;
    let draws = 0;
    // Reset to a known zoom (fully in, then out by the phase factor).
    const setZoom = (factor: number): void => {
      renderer.zoomBy(1 / 64);
      renderer.zoomBy(factor);
    };
    setZoom(PHASES[0]?.zoom ?? 1);
    const loop = (): void => {
      const tNow = performance.now();
      const p = PHASES[phase];
      if (!p) return;
      const dt = tNow - last;
      last = tNow;
      if (frames > 0) {
        sum += dt;
        worst = Math.max(worst, dt);
        cpu += renderer.stats().frameMs;
        draws = Math.max(draws, renderer.stats().drawCalls);
      }
      frames++;
      const t = (tNow - t0) / 1000;
      const col = Math.round(state.map.width / 2 + Math.cos(t * 0.9) * state.map.width * 0.3);
      const row = Math.round(state.map.height / 2 + Math.sin(t * 1.1) * state.map.height * 0.3);
      renderer.focus(offsetToAxial({ col, row }), { instant: true });
      if (tNow - t0 >= p.ms) {
        const n = Math.max(1, frames - 1);
        results.push(`${p.name} (${band}): ${(sum / n).toFixed(1)} ms avg, ${worst.toFixed(0)} worst, cpu ${(cpu / n).toFixed(2)} ms, ${draws} draws`);
        phase++;
        const next = PHASES[phase];
        if (!next) {
          benchRaf = 0;
          const text = `bench ${state.map.width}x${state.map.height}: ${results.join(' | ')}`;
          infoEl.textContent = text;
          console.log(text);
          (window as unknown as { benchResult: string }).benchResult = text;
          return;
        }
        setZoom(next.zoom);
        t0 = tNow;
        frames = 0;
        sum = 0;
        worst = 0;
        cpu = 0;
        draws = 0;
      }
      benchRaf = requestAnimationFrame(loop);
    };
    benchRaf = requestAnimationFrame(loop);
  };
  btn('bench', runBench);
  btn('quality', () => {
    renderer.setQuality(renderer.getQuality() === 'high' ? 'low' : 'high');
    infoEl.textContent = `quality ${renderer.getQuality()}`;
  });
  if (params.get('bench') === '1') setTimeout(runBench, 500);

  // game=1 helpers (console): found with the settler, end turns (AIs just pass).
  const apply = (player: string, command: Parameters<NonNullable<typeof simApi>['applyCommand']>[2]): boolean => {
    if (!simApi) return false;
    const res = simApi.applyCommand(state, player, command, content);
    if (res.ok) state = res.state;
    else console.warn(res.error);
    return res.ok;
  };
  const demoApi = {
    found: (): void => {
      const s = Object.values(state.units).find((u) => u.owner === 'p1' && u.type === 'settler');
      if (s && apply('p1', { type: 'foundSettlement', unit: s.id })) {
        push();
        const at = Object.values(state.settlements).find((x) => x.owner === 'p1')?.at;
        if (at) renderer.flash(at, 'found');
      }
    },
    endTurns: (k = 1): void => {
      for (let t = 0; t < k; t++) {
        for (let guard = 0; guard < 8; guard++) {
          const cur = state.currentPlayer;
          if (!apply(cur, { type: 'endTurn' })) break;
          if (state.currentPlayer === 'p1') break;
        }
      }
      push();
    },
    move: (id: string, q: number, r: number): void => {
      if (apply('p1', { type: 'moveUnit', unit: id, to: { q, r } })) push();
    },
  };
  (window as unknown as { demo: typeof demoApi }).demo = demoApi;

  // Motion inspection (works even when the tab is hidden and rAF is throttled): freeze the
  // clock, step it by hand and composite canvas crops at chosen times into a film strip.
  //   film(() => renderer.flash(hex, 'combat'), [30, 90, 200, 400], [x, y, w, h])  (canvas px)
  const debugFrame = (renderer as unknown as { debugFrame: () => unknown }).debugFrame;
  let frozen: number | null = null;
  const realNow = performance.now.bind(performance);
  const film = (start: () => void, times: number[], rect: [number, number, number, number]): string => {
    if (frozen === null) {
      frozen = realNow();
      performance.now = () => frozen ?? realNow();
    }
    debugFrame();
    start();
    const [x0, y0, w, h] = rect;
    const cols = 3;
    const out = document.createElement('canvas');
    out.width = w * cols;
    out.height = h * Math.ceil(times.length / cols);
    const ctx = out.getContext('2d');
    let acc = 0;
    times.forEach((t, k) => {
      frozen = (frozen ?? 0) + (t - acc);
      acc = t;
      debugFrame();
      ctx?.drawImage(canvas, x0, y0, w, h, (k % cols) * w, Math.floor(k / cols) * h, w, h);
      if (ctx) {
        ctx.fillStyle = '#000';
        ctx.font = '20px sans-serif';
        ctx.fillText(`${t}ms`, (k % cols) * w + 6, Math.floor(k / cols) * h + 22);
      }
    });
    let img = document.getElementById('film') as HTMLImageElement | null;
    if (!img) {
      img = document.createElement('img');
      img.id = 'film';
      document.body.appendChild(img);
    }
    img.style.cssText = `position:fixed;left:0;top:0;width:${out.width / 2}px;height:${out.height / 2}px;z-index:10;pointer-events:none`;
    img.src = out.toDataURL();
    return `${out.width}x${out.height}`;
  };
  const unfreeze = (): void => {
    frozen = null;
    performance.now = realNow;
    document.getElementById('film')?.remove();
  };
  Object.assign(window, { film, unfreeze });

  setInterval(() => {
    const s = renderer.stats();
    statsEl.textContent = `${s.fps} fps · ${s.frameMs} ms · ${s.drawCalls} draws · ${(s.triangles / 1000).toFixed(0)}k tris · ${band}${notes.length ? ' · ' + notes.join('; ') : ''}`;
  }, 400);
};

main().catch((e: unknown) => {
  const el = document.getElementById('stats');
  if (el) el.textContent = `demo failed: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
