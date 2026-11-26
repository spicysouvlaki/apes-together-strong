/**
 * All map content as instanced layers: the diorama board (beveled land prisms with strata
 * sides, a water sheet, parchment fog, the board plinth), rivers, relief, vegetation,
 * micro-detail, resources, territory, settlements built from culture motif kits, figurine
 * units, labels, highlights, trade routes, strategic icons and event juice.
 *
 * Update model: `update()` refills every layer from a snapshot (O(tiles + entities), a few ms,
 * only on new snapshots). GPU buffers are allocated once per map size and grow only when entity
 * counts outgrow them. Per-frame passes (`drawUnits`, `drawSettlementPieces`, particles) run
 * only while something animates. Art direction: palette.ts; shaders: materials.ts.
 */
import {
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  DataTexture,
  RGBAFormat,
  UnsignedByteType,
  LinearFilter,
  ClampToEdgeWrapping,
  type BufferGeometry,
  type Camera,
  type Material,
  type PerspectiveCamera,
} from 'three';
import { AGES, type ContentBundle } from '@contracts/content-schemas';
import { HEX_DIRECTIONS, hexDistance, type Hex } from '@contracts/hex';
import { CITY_STATE_PREFIX, RAIDER_PLAYER, warKey, type GameState, type PlayerId, type SettlementId, type UnitId } from '@contracts/sim-api';
import {
  FOG_EXPLORED,
  FOG_UNEXPLORED,
  FOG_VISIBLE,
  PALETTE,
  classifyFog,
  hashString,
  mix,
  ownerColors,
  parseHexColor,
  propColor,
  type FogClass,
  type Rgb,
} from '../colors';
import { BASE_Y, FOG_TOP, WATER_TOP, tileTop } from '../heights';
import { hexAtIndex, hexToWorld, mapBounds, tileIndex, worldToHex } from '../layout';
import { labelSpec, sealSpec, wallFraction, type LabelSpec } from '../labels';
import type { ZoomBand } from '../camera-math';
import { DIR_BUCKET, buildBorderMesh, computeBorderEdges, createBorderMeshData, createEdgeList, type BorderColors } from '../borders';
import { BorderMesh } from './border-mesh';
import { computeRiverSegments, type RiverSegment } from '../rivers';
import { GhostMemory, type GhostSettlement } from '../ghosts';
import { patternFor } from '../patterns';
import { RESOURCE_CLASS_STYLE, gradeTerrainColors, resourceClassOf, type ResourceClass } from '../terrain-style';
import { ART, SKIN_TONES, SURFACE, artDirectTerrain, packedSkin, scaleRgb, surfaceKind, tileVariation, type SurfaceKind } from '../palette';
import { hashTile, microDensity, scatterInHex, treeCount, unit01, type RenderQuality } from '../scatter';
import { PIECE_KINDS, buildCultureIndex, kitStyle, motifWeights, settlementLayout, type CultureIndex, type Piece, type PieceKind } from '../architecture';
import { districtPieces, districtPlan, districtSmoke, type DistrictKind, type DistrictNeighbor } from '../districts';
import { fillMapField, waterDistance } from '../textures';
import {
  RESOURCE_PROPS,
  TILE_RADIUS,
  baseRingGeometry,
  broadleafGeometry,
  coniferGeometry,
  discGeometry,
  driftGeometry,
  duneGeometry,
  SITE_STAKE_TOP,
  surveyStakeGeometry,
  flatDiscGeometry,
  flowerGeometry,
  hexFlatGeometry,
  hexRingGeometry,
  hillMoundGeometry,
  jungleGeometry,
  landTileGeometry,
  mountainGeometry,
  palmGeometry,
  piecesGeometry,
  plinthGeometry,
  readyMarkerGeometry,
  reedGeometry,
  resourcePropGeometry,
  resourceShapeGeometry,
  ribbonGeometry,
  riverNodeGeometry,
  rockGeometry,
  shieldGeometry,
  tuftGeometry,
  boxGeometry,
  birdGeometry,
  boatGeometry,
  type ResourcePropKind,
} from './geometry';
import { FIGURES, FIGURE_TOP, figureFor, figureGeometry, unitBaseGeometry, type FigureKind } from './figurines';
import { Instances } from './instances';
import { LabelLayer } from './label-layer';
import { createPatternUniforms, type PatternUniforms } from './pattern-material';
import {
  SOFT,
  createSceneUniforms,
  landMaterial,
  parchmentMaterial,
  propMaterial,
  riverMaterial,
  softMaterial,
  waterMaterial,
  wispMaterial,
  type SceneUniforms,
} from './materials';

export interface Selection {
  unit: UnitId | null;
  tile: Hex | null;
  reachable: Hex[];
  attackable: Hex[];
  path: Hex[];
  /** Indices i into `path` where a new turn starts (tick on the edge path[i-1] -> path[i]). */
  pathTurns: number[];
}

/** A recommended settling site (rank 1 = best). */
export interface SiteMark {
  hex: Hex;
  rank: number;
}

/**
 * Stake offset inside the site tile: left and a little toward the camera, just outside a
 * centred unit's base ring, so the seal on top floats over its own tile (a stake at the back
 * would put the seal over the tile behind). Resources sit back-right.
 */
const SITE_SPOT: [number, number] = [-0.46, 0.14];

interface LabelEntry {
  id: SettlementId;
  spec: LabelSpec;
  x: number;
  y: number;
  z: number;
  priority: number;
  tile: number;
}

export type FlashKind = 'combat' | 'found' | 'capture' | 'recruit' | 'wonder' | 'age';

/** GDD §7: "One military unit per tile, 100 HP." */
const UNIT_MAX_HP = 100;
const MOVE_MS = 240;
const FLASH_MS = 700;
const FLASH_POOL = 6;
const POP_MS = 650;
const SHAKE_MS = 360;
const FLOURISH_MS = 900;
/** Figurines read better a bit larger than their geometry's nominal size. */
const UNIT_SCALE = 2.2;
/** Selected-unit ring pulses this long after a selection change, then rests (battery). */
const PULSE_MS = 1800;
const PARTICLES = 64;

const RIVER_WIDTH = 0.26;
/** Inked road/track dashes: spacing and dash length (world units). */
const ROAD_STEP = 0.21;
const ROAD_DASH = 0.12;
const RESOURCE_SPOT: [number, number] = [0.36, -0.3];

const rgb = (hex: string): Rgb => parseHexColor(hex);
const C = {
  parchment: rgb(PALETTE.parchment),
  gold: rgb(PALETTE.gold),
  hpBack: rgb('#2f2620'),
  hpGood: rgb('#7cc35a'),
  hpMid: rgb('#e8c64a'),
  hpLow: rgb('#de5a43'),
  select: rgb('#fff4d6'),
  selectUnit: rgb('#ffd86a'),
  reachable: rgb('#fff0c8'),
  attackable: rgb('#e0453a'),
  path: rgb('#fffaf0'),
  pathBack: rgb('#24180f'),
  siteGlow: rgb('#f2c14e'),
  keyline: rgb('#2d241b'),
  ownRim: rgb('#fff8ea'),
  rivalRim: rgb('#2a2522'),
  warRim: rgb('#e0453a'),
  shield: rgb('#d6dde6'),
  road: rgb('#6a4f36'),
  sea: rgb('#f3ead2'),
  white: [1, 1, 1] as Rgb,
  dust: rgb('#bfa57c'),
  sparkle: rgb('#ffd85a'),
};
const FLASH_COLORS: Record<FlashKind, Rgb> = {
  combat: rgb('#e0453a'),
  found: rgb('#f2c14e'),
  capture: rgb('#8e5bd6'),
  recruit: rgb('#ffe9a8'),
  wonder: rgb('#e9c255'),
  age: rgb('#f4e2b0'),
};
const RESOURCE_CLASSES: readonly ResourceClass[] = ['bonus', 'luxury', 'strategic'];
const RESOURCE_RGB: Record<ResourceClass, Rgb> = {
  bonus: rgb(RESOURCE_CLASS_STYLE.bonus.color),
  luxury: rgb(RESOURCE_CLASS_STYLE.luxury.color),
  strategic: rgb(RESOURCE_CLASS_STYLE.strategic.color),
};

/**
 * Render-side art table: which small prop a resource gets, and its accent color. Unknown ids
 * keep the generic class marker (ball / gem / block), so new content always shows something.
 */
const RESOURCE_ART: Record<string, { prop: ResourcePropKind; accent: string }> = {
  wheat: { prop: 'grain', accent: '#e4c25a' },
  dates: { prop: 'orchard', accent: '#8a5228' },
  olives: { prop: 'orchard', accent: '#55642e' },
  wine: { prop: 'orchard', accent: '#7a2d55' },
  tea: { prop: 'orchard', accent: '#93c45a' },
  incense: { prop: 'goods', accent: '#eadfc4' },
  silk: { prop: 'goods', accent: '#d8628f' },
  furs: { prop: 'goods', accent: '#8f6a45' },
  amber: { prop: 'ore', accent: '#e39a2c' },
  salt: { prop: 'ore', accent: '#f6f3ec' },
  stone: { prop: 'ore', accent: '#cfc8bb' },
  copper: { prop: 'ore', accent: '#cf7a3a' },
  iron: { prop: 'ore', accent: '#6f5d55' },
  gold_ore: { prop: 'ore', accent: '#efc644' },
  fish: { prop: 'sea', accent: '#9db8c8' },
  whales: { prop: 'sea', accent: '#4f6070' },
  walrus_ivory: { prop: 'sea', accent: '#efe6d2' },
  horses: { prop: 'animal', accent: '#8f5c38' },
  cattle: { prop: 'animal', accent: '#cdb79a' },
  deer: { prop: 'animal', accent: '#b58550' },
};

/** Feature glyphs on the strategic atlas (land shader). */
const GLYPH_NONE = 0;
const GLYPH_MOUNTAIN = 1;
const GLYPH_FOREST = 2;
const GLYPH_HILLS = 3;

interface UnitDraw {
  id: UnitId;
  figure: FigureKind;
  primary: Rgb;
  rim: Rgb;
  own: boolean;
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
  start: number;
  heading: number;
  hp: number;
  ring: boolean;
  fortified: boolean;
  scale: number;
  water: boolean;
  /** Packed owner skin tone (palette.ts packedSkin). */
  skin: number;
}

interface SettlementDraw {
  id: SettlementId;
  x: number;
  y: number;
  z: number;
  mem: number;
  pattern: number;
  pieces: Piece[];
  flag: number;
}

interface FlashSlot {
  mesh: Mesh;
  material: MeshBasicMaterial;
  start: number;
  active: boolean;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  start: number;
  life: number;
  size: number;
  color: Rgb;
  /** Floats up and shrinks (sparkles, confetti) instead of puffing out and settling (dust). */
  rise: boolean;
  active: boolean;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
/** Overshoot ease for pop-ins. */
const easeOutBack = (t: number): number => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export interface WorldOptions {
  reduceMotion: boolean;
  patterns: boolean;
  quality?: RenderQuality;
}


export class World {
  readonly root = new Group();
  private readonly base = new Group();
  private readonly detail = new Group();
  private readonly strategic = new Group();
  /** Shared shader uniforms (time, light rig, fog, atlas blend); the renderer drives them. */
  readonly uniforms: SceneUniforms;

  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly reduceMotion: boolean;
  private readonly patternUniforms: PatternUniforms;
  private patternsOn: boolean;
  private quality: RenderQuality;
  private band: ZoomBand = 'close';
  private ambient = false;

  // Map caches (refilled on every update; reallocated when size changes).
  private width = 0;
  private height = 0;
  private fog = new Uint8Array(0);
  private shownTop = new Float32Array(0);
  private tileX = new Float32Array(0);
  private tileZ = new Float32Array(0);
  private owners: (PlayerId | null)[] = [];
  private waterTile = new Uint8Array(0);
  private surface = new Uint8Array(0);
  private tileColor = new Float32Array(0);
  private settledTile = new Uint8Array(0);
  private dist = new Uint8Array(0);
  private fieldData = new Uint8Array(0);
  private neighbors = new Int32Array(0);
  private riverTiles: GameState['map']['tiles'] | null = null;
  private riverSegs: RiverSegment[] = [];
  private readonly edges = createEdgeList(512);
  private borderData = createBorderMeshData(2048);
  private readonly ghostMemory = new GhostMemory();
  private readonly scatter = new Float32Array(32);

  private terrainColor = new Map<string, Rgb>();
  private readonly terrainWater = new Map<string, boolean>();
  private readonly terrainMountain = new Map<string, boolean>();
  private readonly resourceAge = new Map<string, number>();
  private readonly resourceClass = new Map<string, ResourceClass>();
  private cultures: CultureIndex;

  // --- Board
  private readonly land: Instances;
  private readonly water: Instances;
  private readonly parchment: Instances;
  private readonly plinth: Mesh;
  private readonly plinthTop: Mesh;
  private readonly riverRibbons: Instances;
  private readonly riverNodes: Instances;
  private readonly territoryFill: Instances;
  private readonly borders: BorderMesh;
  private readonly staticShadows: Instances;
  private readonly resourceHalos: Instances;
  private readonly hlFill: Instances;
  private readonly hlRing: Instances;
  private readonly pathBack: Instances;
  private readonly pathDots: Instances;
  private readonly tradeDots: Instances;
  /** Living world (quality 'high' only): hearth smoke, birds, fishing boats. */
  private readonly wisps: Instances;
  private readonly birds: Instances;
  private readonly boats: Instances;
  private districtSpots: { sid: SettlementId; tile: number; kind: DistrictKind; toCity: number; size: number; key: number }[] = [];
  private knownDistricts: Set<string> | null = null;
  /** Chimney tops (x, y, z, size, mem) collected while placing settlements. */
  private smoke: number[] = [];
  private readonly siteStakes: Instances;
  // --- Relief and vegetation
  private readonly mountains: Instances[];
  private readonly hills: Instances;
  private readonly conifers: Instances;
  private readonly broadleaf: Instances;
  private readonly jungle: Instances;
  private readonly palms: Instances;
  private readonly rocks: Instances;
  private readonly tufts: Instances;
  private readonly reeds: Instances;
  private readonly drifts: Instances;
  private readonly dunes: Instances;
  private readonly flowers: Instances;
  private readonly resourceProps: Record<ResourcePropKind, Instances>;
  private readonly resourceMarkers: Record<ResourceClass, Instances>;
  // --- Settlements
  private readonly pieces: Record<PieceKind, Instances>;
  private readonly warRings: Instances;
  // --- Units
  private readonly figures: Record<FigureKind, Instances>;
  private readonly unitBases: Instances;
  private readonly unitRims: Instances;
  private readonly goldRings: Instances;
  private readonly unitGlow: Instances;
  private readonly unitShadows: Instances;
  private readonly readyMarks: Instances;
  private readonly shields: Instances;
  private readonly hpBack: Instances;
  private readonly hpFront: Instances;
  private readonly puffs: Instances;
  // --- Strategic
  private readonly cityIcons: Instances;
  private readonly csIcons: Instances;
  private readonly unitDots: Instances;

  /** Strategic icons grow with zoom so they stay readable (GDD §11 "flat icons"). */
  private iconScale = 1;
  /** Units and resource markers grow a little at regional zoom so silhouettes stay readable. */
  private propScale = 1;
  private cityIconList: { x: number; y: number; z: number; size: number; color: Rgb; capital: boolean; cs: boolean }[] = [];
  private resourceList: { x: number; y: number; z: number; cls: ResourceClass; prop: ResourcePropKind | null; spin: number; accent: Rgb; mem: number }[] = [];
  private readonly labels: LabelLayer;
  private labelsDirty = true;
  private readonly flashes: FlashSlot[] = [];
  private readonly flashGeometry: BufferGeometry;
  private readonly particles: Particle[] = [];

  private settlementDraws: SettlementDraw[] = [];
  private readonly bornAt = new Map<SettlementId, number>();
  private readonly flourishAt = new Map<SettlementId, number>();
  private knownSettlements: Set<SettlementId> | null = null;
  private unitDraws: UnitDraw[] = [];
  private readonly displayed = new Map<UnitId, { x: number; y: number; z: number; heading: number }>();
  private readonly shakeAt = new Map<UnitId, number>();
  private selection: Selection = { unit: null, tile: null, reachable: [], attackable: [], path: [], pathTurns: [] };
  private sites: SiteMark[] = [];
  private labelEntries: LabelEntry[] = [];
  /** Unit figure points (x, y, z triples) labels must not cover. */
  private obstacles = new Float32Array(3 * 64);
  private obstacleCount = 0;
  /** Tiles in front of (camera side of) a visible unit get thinned vegetation; offsets toward the unit. */
  private frontTile = new Uint8Array(0);
  private frontDx = new Float32Array(0);
  private frontDz = new Float32Array(0);
  /** Snapped yaw the vegetation thinning was computed for. */
  private vegYaw = 0;
  private selectedAt = -Infinity;
  private ready = new Set<UnitId>();
  private state: GameState | null = null;
  private viewer: PlayerId | null = null;
  private yaw = 0;
  /** Invalidate hook (labels redrawn after fonts load). */
  onInvalidate: (() => void) | null = null;

  constructor(content: ContentBundle, options: WorldOptions) {
    this.reduceMotion = options.reduceMotion;
    this.patternsOn = options.patterns;
    this.quality = options.quality ?? 'high';
    this.patternUniforms = createPatternUniforms(options.patterns);
    this.uniforms = createSceneUniforms(options.patterns);
    this.uniforms.uPatterns = this.patternUniforms.uPatterns;
    this.root.add(this.base, this.detail, this.strategic);
    this.strategic.visible = false;
    this.cultures = buildCultureIndex(content);
    this.setContent(content);

    const U = this.uniforms;
    const unlit = this.mat(new MeshBasicMaterial());
    const decal = (factor: number): MeshBasicMaterial =>
      this.mat(new MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: factor }));
    const landMat = this.mat(landMaterial(U));
    const waterMat = this.mat(waterMaterial(U));
    const parchMat = this.mat(parchmentMaterial(U));
    const propTint = this.mat(propMaterial(U, { tint: true }));
    const propFixed = this.mat(propMaterial(U));
    const flagMat = this.mat(propMaterial(U, { tint: true, sway: true, flag: true }));
    const puffMat = this.mat(propMaterial(U, { tint: true, alpha: true }));
    const soft = (offset: number): Material => this.mat(softMaterial(U, offset));
    const ribbonMat = this.mat(riverMaterial(U, false, RIVER_WIDTH / 2));
    const nodeMat = this.mat(riverMaterial(U, true, RIVER_WIDTH / 2));

    const g = <T extends BufferGeometry>(geo: T): T => {
      this.geometries.push(geo);
      return geo;
    };
    const B = this.base;
    const D = this.detail;
    const S = this.strategic;
    const cap = 2048;
    const I = (geo: BufferGeometry, m: Material, c: number, parent: Group, name: string, order = 0): Instances =>
      new Instances(g(geo), m, c, parent, name, order, 'aInst', 4);

    this.land = I(landTileGeometry(), landMat, cap, B, 'land');
    this.water = I(hexFlatGeometry(1.0), waterMat, cap, B, 'water');
    this.parchment = I(hexFlatGeometry(1.0), parchMat, cap, B, 'parchment');
    this.territoryFill = I(hexFlatGeometry(TILE_RADIUS - 0.04), soft(-2), 256, B, 'territory', 2);
    this.riverRibbons = I(ribbonGeometry(RIVER_WIDTH), ribbonMat, 256, B, 'river-ribbons', 1);
    this.riverNodes = I(riverNodeGeometry(RIVER_WIDTH / 2), nodeMat, 256, B, 'river-nodes', 1);
    this.borders = new BorderMesh(B, this.patternUniforms, 3);
    this.staticShadows = I(flatDiscGeometry(14), soft(-1), 1024, D, 'shadows', 1);
    this.resourceHalos = I(flatDiscGeometry(16), soft(-2), 128, D, 'resource-halos', 2);
    this.hlFill = I(hexFlatGeometry(0.93), soft(-5), 64, B, 'hl-fill', 5);
    this.hlRing = I(hexFlatGeometry(1.0), soft(-6), 32, B, 'hl-ring', 6);
    // Route preview: unit discs scaled per instance into dashes, waypoint dots, turn ticks and the
    // destination bullseye (ink outline under a vellum fill: readable on water and pale land).
    this.pathBack = new Instances(g(discGeometry(1, 0.03, 12)), unlit, 256, B, 'path-back', 6);
    this.pathDots = new Instances(g(discGeometry(1, 0.035, 12)), unlit, 256, B, 'path-dots', 7);
    // Roads and trade tracks: inked dashes (unit disc scaled per instance), like a drawn map.
    this.tradeDots = I(discGeometry(1, 0.02, 8), soft(-3), 256, B, 'roads', 3);
    this.wisps = I(new IcosahedronGeometry(0.5, 1), this.mat(wispMaterial(U)), 256, D, 'wisps', 8);
    this.birds = I(birdGeometry(), this.mat(propMaterial(U, { orbit: true })), 64, D, 'birds');
    this.boats = I(boatGeometry(), this.mat(propMaterial(U, { bob: true })), 64, D, 'boats');

    this.mountains = [I(mountainGeometry(0), propTint, 128, D, 'mountains-a'), I(mountainGeometry(1), propTint, 128, D, 'mountains-b')];
    this.hills = I(hillMoundGeometry(), propTint, 256, D, 'hills');
    this.conifers = I(coniferGeometry(), propTint, 1024, D, 'conifers');
    this.broadleaf = I(broadleafGeometry(), propTint, 1024, D, 'broadleaf');
    this.jungle = I(jungleGeometry(), propTint, 512, D, 'jungle');
    this.palms = I(palmGeometry(), propTint, 256, D, 'palms');
    this.rocks = I(rockGeometry(), propTint, 1024, D, 'rocks');
    this.tufts = I(tuftGeometry(), propTint, 4096, D, 'tufts');
    this.reeds = I(reedGeometry(), propTint, 1024, D, 'reeds');
    this.drifts = I(driftGeometry(), propTint, 512, D, 'drifts');
    this.dunes = I(duneGeometry(), propTint, 512, D, 'dunes');
    // Fixed vertex colors, cloth flutter (SWAY, off under reduceMotion / low via uAnim).
    this.siteStakes = I(surveyStakeGeometry(), this.mat(propMaterial(U, { sway: true, flag: true })), 8, D, 'site-stakes');
    this.flowers = I(flowerGeometry(), propTint, 1024, D, 'flowers');
    const props: Partial<Record<ResourcePropKind, Instances>> = {};
    for (const k of RESOURCE_PROPS) props[k] = I(resourcePropGeometry(k), propFixed, 64, D, `resource-${k}`);
    this.resourceProps = props as Record<ResourcePropKind, Instances>;
    const markers: Partial<Record<ResourceClass, Instances>> = {};
    for (const cls of RESOURCE_CLASSES) markers[cls] = I(resourceShapeGeometry(cls), propFixed, 64, D, `resource-marker-${cls}`);
    this.resourceMarkers = markers as Record<ResourceClass, Instances>;

    const pieces: Partial<Record<PieceKind, Instances>> = {};
    for (const k of PIECE_KINDS) pieces[k] = I(piecesGeometry(k), k === 'flag' ? flagMat : propTint, 256, D, `piece-${k}`);
    this.pieces = pieces as Record<PieceKind, Instances>;
    this.warRings = new Instances(g(hexRingGeometry(0.88, 0.97)), decal(-5), 32, D, 'war-rings', 6);

    const figs: Partial<Record<FigureKind, Instances>> = {};
    for (const k of FIGURES) figs[k] = I(figureGeometry(k), propFixed, 64, D, `figure-${k}`);
    this.figures = figs as Record<FigureKind, Instances>;
    this.unitBases = I(unitBaseGeometry(), propFixed, 128, D, 'unit-bases');
    this.unitRims = new Instances(g(baseRingGeometry(0.172, 0.02)), unlit, 128, D, 'unit-rims');
    this.goldRings = new Instances(g(baseRingGeometry(0.255, 0.022)), unlit, 32, D, 'gold-rings');
    this.unitGlow = I(flatDiscGeometry(20), soft(-6), 8, D, 'unit-glow', 6);
    this.unitShadows = I(flatDiscGeometry(14), soft(-2), 128, D, 'unit-shadows', 2);
    this.readyMarks = I(readyMarkerGeometry(), propFixed, 64, D, 'ready-marks');
    this.shields = I(shieldGeometry(), propFixed, 64, D, 'fortify-shields');
    this.hpBack = new Instances(g(boxGeometry(0.5, 0.085, 0.02)), unlit, 64, D, 'hp-back');
    this.hpFront = new Instances(g(boxGeometry(0.46, 0.055, 0.03)), unlit, 64, D, 'hp-front');
    this.puffs = I(new IcosahedronGeometry(0.5, 0), puffMat, PARTICLES, this.root, 'puffs', 60);
    // Labels live on the root: city names stay on the strategic atlas too (de-overlap keeps the
    // capitals and the viewer's own cities when the map gets crowded).
    this.labels = new LabelLayer(this.root, () => {
      // Fonts arrived: redraw every label with the real face.
      if (this.state) this.updateSettlements(this.state, this.viewer);
      this.onInvalidate?.();
    });

    this.cityIcons = new Instances(g(discGeometry(0.72, 0.08, 20)), unlit, 64, S, 'city-icons');
    this.csIcons = new Instances(g(discGeometry(0.72, 0.08, 6)), unlit, 32, S, 'cs-icons');
    this.unitDots = new Instances(g(discGeometry(0.3, 0.06, 10)), unlit, 256, S, 'unit-dots');

    // Board: the chart is a thick sheet of vellum. Its top continues the unexplored parchment
    // into the ragged hex rows at the map edge, and its sides are the paper's cut edge, so the
    // end of the world reads as the end of the map, not a brown tray.
    const plGeo = g(plinthGeometry(parseHexColor(ART.plinth0), parseHexColor(ART.plinth1)));
    this.plinth = new Mesh(plGeo, this.mat(propMaterial(U)));
    this.plinth.visible = false;
    this.plinth.frustumCulled = false;
    const topGeo = g(new PlaneGeometry(1, 1));
    topGeo.rotateX(-Math.PI / 2);
    this.plinthTop = new Mesh(topGeo, parchMat);
    this.plinthTop.visible = false;
    this.plinthTop.frustumCulled = false;
    this.base.add(this.plinth, this.plinthTop);

    // A crisp expanding hex outline (an inked shock ring), not a filled stamp.
    this.flashGeometry = g(hexRingGeometry(0.8, 0.94));
    for (let i = 0; i < FLASH_POOL; i++) {
      const material = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
      this.materials.push(material);
      const mesh = new Mesh(this.flashGeometry, material);
      mesh.visible = false;
      mesh.renderOrder = 50;
      this.root.add(mesh);
      this.flashes.push({ mesh, material, start: 0, active: false });
    }
    for (let i = 0; i < PARTICLES; i++) {
      this.particles.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, start: 0, life: 1, size: 0, color: C.dust, rise: false, active: false });
    }
    this.applyQuality();
  }

  setContent(content: ContentBundle): void {
    this.terrainWater.clear();
    this.terrainMountain.clear();
    for (const t of content.terrain) {
      this.terrainWater.set(t.id, t.water);
      // Data-driven: impassable dry land is drawn as a mountain (no hard-coded terrain id).
      this.terrainMountain.set(t.id, !t.water && t.moveCost === null);
    }
    const graded = gradeTerrainColors(content.terrain.map((t) => ({ id: t.id, color: t.color, water: t.water })));
    this.terrainColor = artDirectTerrain(graded, this.terrainWater);
    this.resourceAge.clear();
    this.resourceClass.clear();
    for (const r of content.resources ?? []) {
      this.resourceAge.set(r.id, AGES.indexOf(r.revealAge));
      this.resourceClass.set(r.id, resourceClassOf(r.class));
    }
    this.cultures = buildCultureIndex(content);
  }

  setBand(band: ZoomBand): void {
    const strategic = band === 'strategic';
    this.detail.visible = !strategic;
    this.strategic.visible = strategic;
    const changed = band !== this.band;
    this.band = band;
    if (changed && this.state) this.updateMicro();
  }

  setQuality(q: RenderQuality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.applyQuality();
    if (this.state) this.update(this.state, this.viewer, null, 0);
  }

  getQuality(): RenderQuality {
    return this.quality;
  }

  /** Ambient animation on/off (water, flags, pulses, idle bob). Driven by the renderer. */
  setAmbient(on: boolean): void {
    this.ambient = on;
  }

  /** Whether something on screen wants ambient frames (attack pulse, selected unit). */
  wantsAmbient(): boolean {
    return this.selection.attackable.length > 0 || this.selection.unit !== null;
  }

  private applyQuality(): void {
    const high = this.quality === 'high';
    this.staticShadows.mesh.visible = high && this.staticShadows.count > 0;
    this.unitShadows.mesh.visible = high && this.unitShadows.count > 0;
    // The living world is an extra: 'low' drops it entirely.
    for (const l of [this.wisps, this.birds, this.boats]) l.mesh.visible = high && l.count > 0;
  }

  setYaw(yaw: number): void {
    this.yaw = yaw;
    // Once a rotation settles on a new step, the "in front of a unit" tiles changed.
    const snapped = Math.round(yaw / (Math.PI / 3)) * (Math.PI / 3);
    if (Math.abs(yaw - snapped) < 0.003 && Math.abs(snapped - this.vegYaw) > 0.01) {
      this.vegYaw = snapped;
      this.refreshVegetation();
    }
  }

  setPatterns(on: boolean): void {
    if (on === this.patternsOn) return;
    this.patternsOn = on;
    this.patternUniforms.uPatterns.value = on ? 1 : 0;
    this.labels.clearCache();
    if (this.state) this.updateSettlements(this.state, this.viewer);
  }

  setReady(ids: readonly UnitId[], now: number): void {
    this.ready = new Set(ids);
    this.drawUnits(now);
  }

  /** Settler site markers (GDD §7): stake + pennant, gold ground ring, numbered seal. */
  setSites(sites: readonly SiteMark[]): void {
    this.sites = sites.map((s) => ({ hex: { q: s.hex.q, r: s.hex.r }, rank: s.rank }));
    this.drawSites();
    this.drawResources();
    this.rebuildLabels();
  }

  private drawSites(): void {
    this.siteStakes.begin();
    for (const site of this.sites) {
      const top = this.topAt(site.hex);
      if (top === null) continue;
      const w = hexToWorld(site.hex);
      const k = site.rank === 1 ? 1.2 : 1;
      this.siteStakes.push(w.x + SITE_SPOT[0], top - 0.005, w.z + SITE_SPOT[1], k, k, k, 0, C.white, 0, 0, site.rank * 1.9, 0);
    }
    this.siteStakes.end();
  }

  /**
   * Hex of the settlement label or site seal under screen point (x, y) (CSS px), or null. Taps
   * are resolved against labels first so a tap on a name picks the named tile, not the
   * neighbour the cartouche floats over.
   */
  labelHexAt(x: number, y: number): Hex | null {
    if (!this.detail.visible || this.width === 0) return null;
    const tag = this.labels.hitTag(x, y);
    return tag >= 0 ? hexAtIndex(tag, this.width) : null;
  }

  /** Height of the drawn top of a hex, or null when it's off the map (for picking/focus). */
  topAt(h: Hex): number | null {
    const i = tileIndex(h, this.width, this.height);
    if (i < 0) return null;
    return this.shownTop[i] ?? 0;
  }

  // -------------------------------------------------------------------------------------------
  // Snapshot update
  // -------------------------------------------------------------------------------------------

  private lastVisible: readonly number[] = [];

  update(state: GameState, viewer: PlayerId | null, visible: readonly number[] | null, now: number): void {
    this.state = state;
    this.viewer = viewer;
    if (visible) this.lastVisible = visible;
    const vis = this.lastVisible;
    const { width, height, tiles } = state.map;
    const n = width * height;
    if (width !== this.width || height !== this.height || this.fog.length !== n) this.resize(width, height);
    const viewerState = viewer !== null ? state.players[viewer] : undefined;
    classifyFog(n, viewer === null ? null : (viewerState?.explored ?? []), vis, this.fog);
    this.placeRose(state, viewer);
    const ageIdx = Math.max(0, AGES.indexOf(state.age));
    const high = this.quality === 'high';

    this.settledTile.fill(0);
    for (const s of Object.values(state.settlements)) {
      const i = tileIndex(s.at, width, height);
      if (i >= 0) this.settledTile[i] = 1;
    }
    // Units get a small clearing so trees never hide the figurine (2 = unit, 1 = settlement).
    for (const u of Object.values(state.units)) {
      const i = tileIndex(u.at, width, height);
      // Only for units the viewer can see (a clearing must not betray a hidden rival).
      if (viewer !== null && u.owner !== viewer && this.fog[i] !== FOG_VISIBLE) continue;
      if (i >= 0 && this.settledTile[i] === 0) this.settledTile[i] = 2;
    }
    this.markFrontTiles(state, viewer);

    // Pass 1: per-tile facts.
    for (let i = 0; i < n; i++) {
      const tile = tiles[i];
      if (!tile) continue;
      const w = hexToWorld(tile);
      this.tileX[i] = w.x;
      this.tileZ[i] = w.z;
      this.owners[i] = tile.owner;
      const isWater = this.terrainWater.get(tile.terrain) ?? false;
      this.waterTile[i] = isWater ? 1 : 0;
      const fog = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
      const isMountain = this.terrainMountain.get(tile.terrain) ?? false;
      const h = hashTile(tile.q, tile.r, 1);
      const v = tileVariation(h);
      let top = fog === FOG_UNEXPLORED ? FOG_TOP : tileTop(tile, { isWater, isMountain });
      if (fog !== FOG_UNEXPLORED && !isWater) top += v.dy;
      this.shownTop[i] = top;
      const base = this.terrainColor.get(tile.terrain) ?? [0.6, 0.6, 0.6];
      const c = isWater ? base : scaleRgb(base, v.tint);
      this.tileColor[i * 3] = c[0];
      this.tileColor[i * 3 + 1] = c[1];
      this.tileColor[i * 3 + 2] = c[2];
      this.surface[i] = surfaceKind(base, { mountain: isMountain, climate: tile.climate });
    }
    this.planDistricts(state, viewer);

    // Water depth field (from explored land only: no coastline leaks through the fog).
    waterDistance(
      n,
      (i) => this.waterTile[i] === 1 || this.fog[i] === FOG_UNEXPLORED,
      (i, d) => this.neighbors[i * 6 + d] ?? -1,
      this.dist,
    );
    fillMapField(n, this.dist, this.fog, this.fieldData);
    this.uniforms.uMapField.value.needsUpdate = true;

    // Pass 2: board.
    this.land.begin();
    this.water.begin();
    this.parchment.begin();
    for (let i = 0; i < n; i++) {
      const tile = tiles[i];
      if (!tile) continue;
      const fog = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
      const x = this.tileX[i] ?? 0;
      const z = this.tileZ[i] ?? 0;
      const top = this.shownTop[i] ?? 0;
      const seed = unit01(hashTile(tile.q, tile.r, 7));
      if (fog === FOG_UNEXPLORED) {
        let mask = 0;
        for (let d = 0; d < 6; d++) {
          const j = this.neighbors[i * 6 + d] ?? -1;
          if (j >= 0 && this.fog[j] !== FOG_UNEXPLORED) mask |= 1 << (DIR_BUCKET[d] ?? 0);
        }
        this.parchment.push(x, top, z, 1, 1, 1, 0, C.parchment, 0, mask, 0, seed);
        continue;
      }
      const mem = fog === FOG_EXPLORED ? 1 : 0;
      const c: Rgb = [this.tileColor[i * 3] ?? 0, this.tileColor[i * 3 + 1] ?? 0, this.tileColor[i * 3 + 2] ?? 0];
      if (this.waterTile[i]) {
        let mask = 0;
        for (let d = 0; d < 6; d++) {
          const j = this.neighbors[i * 6 + d] ?? -1;
          if (j >= 0 && !this.waterTile[j] && this.fog[j] !== FOG_UNEXPLORED) mask |= 1 << (DIR_BUCKET[d] ?? 0);
        }
        this.water.push(x, top, z, 1, 1, 1, 0, c, mem, mask, 0, 0);
        continue;
      }
      const isMountain = this.terrainMountain.get(tile.terrain) ?? false;
      const glyph = isMountain
        ? GLYPH_MOUNTAIN
        : tile.feature === 'hills'
          ? GLYPH_HILLS
          : tile.feature === 'forest' || tile.feature === 'jungle'
            ? GLYPH_FOREST
            : GLYPH_NONE;
      const kind = this.surface[i] ?? 0;
      this.land.push(x, top, z, 1, 1, 1, 0, c, mem, top - BASE_Y, kind + glyph * 8, seed);
    }
    this.land.end();
    this.water.end();
    this.parchment.end();

    this.updateProps(state, ageIdx, high);
    this.updateMicro();
    this.updateRivers(state);
    this.updateTerritory(state);
    this.updateSettlements(state, viewer, now);
    this.updateTradeRoutes(state, viewer);
    this.prepareUnits(state, viewer, now);
    this.drawUnits(now);
    this.drawSelection();
    this.drawSites();
    this.applyQuality();
  }

  /**
   * Tiles on the camera side of a visible unit (the two front neighbours for the current view
   * direction) get thinned trees, cleared toward the unit, so a forest in front never hides a
   * figurine. Recomputed per snapshot and after a view rotation settles.
   */
  private markFrontTiles(state: GameState, viewer: PlayerId | null): void {
    const { width, height } = this;
    this.frontTile.fill(0);
    // Toward the camera on the ground (camera-math cameraOffset: yaw 0 looks north from the south).
    const cx = Math.sin(this.vegYaw);
    const cz = Math.cos(this.vegYaw);
    for (const u of Object.values(state.units)) {
      const i = tileIndex(u.at, width, height);
      if (i < 0) continue;
      if (viewer !== null && u.owner !== viewer && this.fog[i] !== FOG_VISIBLE) continue;
      // (Called before this snapshot's per-tile pass, so positions come from the hexes.)
      const uw = hexToWorld(u.at);
      const ux = uw.x;
      const uz = uw.z;
      for (let d = 0; d < 6; d++) {
        const j = this.neighbors[i * 6 + d] ?? -1;
        if (j < 0 || this.frontTile[j]) continue;
        const h = hexAtIndex(j, width);
        const w = hexToWorld(h);
        const dx = w.x - ux;
        const dz = w.z - uz;
        if ((dx * cx + dz * cz) / Math.hypot(dx, dz) < 0.45) continue;
        this.frontTile[j] = 1;
        // Clear the half of the tile nearest the unit.
        this.frontDx[j] = -dx * 0.36;
        this.frontDz[j] = -dz * 0.36;
      }
    }
  }

  /** The view rotation settled on a new 60° step: re-thin vegetation in front of units. */
  private refreshVegetation(): void {
    const state = this.state;
    if (!state) return;
    this.markFrontTiles(state, this.viewer);
    this.updateProps(state, Math.max(0, AGES.indexOf(state.age)), this.quality === 'high');
  }

  private roseKey = '';
  /** True from a new rose placement until the renderer fits it into the opening view. */
  rosePending = false;

  /** Whether a compass rose centred at world (x, z) lies entirely on unexplored parchment. */
  roseClearAt(cx: number, cz: number): boolean {
    for (let k = -1; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const r = k < 0 ? 0 : 1.9;
      const i = tileIndex(worldToHex(cx + Math.cos(a) * r, cz + Math.sin(a) * r), this.width, this.height);
      if (i >= 0 && this.fog[i] !== FOG_UNEXPLORED) return false;
    }
    return true;
  }

  /** Move the main compass rose (the renderer fits it into the opening view). */
  setRose(x: number, z: number): void {
    const u = this.uniforms.uCompass.value;
    u.set(x, z, u.z, u.w);
    this.rosePending = false;
  }

  /**
   * First impression (GDD §11): the main compass rose is drawn on the unexplored parchment just
   * beyond the start, inside the default framing, so the opening screen reads as an aged chart
   * rather than empty paper. Chosen once per game/viewer so it never jumps around.
   */
  private placeRose(state: GameState, viewer: PlayerId | null): void {
    const key = `${state.seed}|${viewer ?? '*'}|${this.width}x${this.height}`;
    if (key === this.roseKey) return;
    let anchor: Hex | null = null;
    if (viewer !== null) {
      const own = Object.values(state.settlements).filter((s) => s.owner === viewer);
      anchor = (own.find((s) => s.isCapital) ?? own[0])?.at ?? Object.values(state.units).find((u) => u.owner === viewer)?.at ?? null;
    }
    if (!anchor) return;
    this.roseKey = key;
    this.rosePending = true;
    const w = hexToWorld(anchor);
    const candidates: [number, number][] = [
      [3.4, -5.6],
      [-3.4, -5.6],
      [3.6, 5.2],
      [-3.6, 5.2],
      [0, -7.5],
    ];
    // The whole rose (radius ~1.8) must sit on parchment: unexplored tiles or off the map
    // (the vellum sheet past the edge draws it too). Fallback only: the renderer then fits it
    // into the actual opening view (rosePending).
    const clear = (cx: number, cz: number): boolean => this.roseClearAt(cx, cz);
    let pick: [number, number] = candidates[0] ?? [3.4, -5.6];
    search: for (const scale of [1, 1.3, 1.6]) {
      for (const c of candidates) {
        if (clear(w.x + c[0] * scale, w.z + c[1] * scale)) {
          pick = [c[0] * scale, c[1] * scale];
          break search;
        }
      }
    }
    const u = this.uniforms.uCompass.value;
    u.set(w.x + pick[0], w.z + pick[1], u.z, u.w);
  }

  private resize(width: number, height: number): void {
    const n = width * height;
    this.width = width;
    this.height = height;
    this.fog = new Uint8Array(n);
    this.shownTop = new Float32Array(n);
    this.tileX = new Float32Array(n);
    this.tileZ = new Float32Array(n);
    this.waterTile = new Uint8Array(n);
    this.surface = new Uint8Array(n);
    this.tileColor = new Float32Array(n * 3);
    this.settledTile = new Uint8Array(n);
    this.frontTile = new Uint8Array(n);
    this.frontDx = new Float32Array(n);
    this.frontDz = new Float32Array(n);
    this.dist = new Uint8Array(n);
    this.fieldData = new Uint8Array(Math.max(1, n) * 4);
    this.owners = new Array<PlayerId | null>(n).fill(null);
    this.neighbors = new Int32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const h = hexAtIndex(i, width);
      for (let d = 0; d < 6; d++) {
        const dir = HEX_DIRECTIONS[d];
        this.neighbors[i * 6 + d] = dir ? tileIndex({ q: h.q + dir.q, r: h.r + dir.r }, width, height) : -1;
      }
    }
    // Map field texture (one texel per tile).
    const old = this.uniforms.uMapField.value;
    const tex = new DataTexture(this.fieldData, Math.max(1, width), Math.max(1, height), RGBAFormat, UnsignedByteType);
    tex.wrapS = ClampToEdgeWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.needsUpdate = true;
    this.uniforms.uMapField.value = tex;
    old.dispose();
    this.uniforms.uMapSize.value.set(Math.max(1, width), Math.max(1, height));
    const b = mapBounds(width, height);
    this.uniforms.uCompass.value.set(b.maxX * 0.22, b.maxZ * 0.3, b.maxX * 0.78, b.maxZ * 0.72);
    // Plinth: a rectangle that contains every hex, from the water line down.
    // The sheet runs well past the last hex row, so a start near the map edge still sits in the
    // middle of an old chart (rhumb lines and sea glyphs continue) instead of an empty void.
    // Art review: at strategic zoom the sheet's cut edge showed as hard bands; the vellum now
    // runs far past anything the camera can frame (the parchment shader is world-space, so the
    // chart simply continues).
    const pw = b.maxX - b.minX + 260;
    const pd = b.maxZ - b.minZ + 260;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    this.plinth.scale.set(pw, 0.22, pd);
    // Below the water line: the sheet's top shows only past the ragged edge rows.
    // A hair under the sheet: at strategic distance the two coplanar tops z-fought into a
    // warm rectangle around the map.
    this.plinth.position.set(cx, WATER_TOP - 0.09, cz);
    this.plinth.updateMatrixWorld();
    this.plinth.visible = n > 0;
    this.plinthTop.scale.set(pw, 1, pd);
    this.plinthTop.position.set(cx, WATER_TOP - 0.03, cz);
    this.plinthTop.updateMatrixWorld();
    this.plinthTop.visible = n > 0;
    this.riverTiles = null;
    this.roseKey = '';
  }

  /** Relief, vegetation, rocks and resources for explored tiles. */
  private updateProps(state: GameState, ageIdx: number, high: boolean): void {
    const tiles = state.map.tiles;
    const n = this.width * this.height;
    const L = [this.mountains[0], this.mountains[1], this.hills, this.conifers, this.broadleaf, this.jungle, this.palms, this.rocks, this.staticShadows];
    for (const l of L) l?.begin();
    this.resourceList = [];
    const pts = this.scatter;
    const shadow = (x: number, y: number, z: number, r: number, k: number, mem: number): void => {
      if (high) this.staticShadows.push(x + 0.05 * r, y + 0.004, z + 0.04 * r, r, 1, r, 0, C.white, mem, SOFT.shadow, k, 0);
    };
    for (let i = 0; i < n; i++) {
      const tile = tiles[i];
      if (!tile) continue;
      const fog = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
      if (fog === FOG_UNEXPLORED || this.waterTile[i]) {
        if (fog !== FOG_UNEXPLORED && tile.resource) this.pushResource(tile.resource, i, ageIdx, fog);
        continue;
      }
      const mem = fog === FOG_EXPLORED ? 1 : 0;
      const x = this.tileX[i] ?? 0;
      const z = this.tileZ[i] ?? 0;
      const top = this.shownTop[i] ?? 0;
      const h = hashTile(tile.q, tile.r, 3);
      const spin = unit01(h) * Math.PI * 2;
      const tc: Rgb = [this.tileColor[i * 3] ?? 0, this.tileColor[i * 3 + 1] ?? 0, this.tileColor[i * 3 + 2] ?? 0];
      // District clearings (3) thin the woods like a settlement tile does.
      const settled = this.settledTile[i] === 1 || this.settledTile[i] === 3;
      const unitHere = this.settledTile[i] === 2;
      const front = this.frontTile[i] === 1 && !settled && !unitHere;
      const isMountain = this.terrainMountain.get(tile.terrain) ?? false;
      const hasRes = !!tile.resource;
      const clear: [number, number, number] | undefined = hasRes ? [RESOURCE_SPOT[0], RESOURCE_SPOT[1], 0.24] : undefined;
      if (isMountain) {
        const layer = this.mountains[h & 1];
        const s = 0.92 + unit01(h >>> 3) * 0.2;
        const tint = mix([1, 1, 1], tc, 0.18);
        layer?.push(x, top - 0.02, z, s, s * (0.95 + unit01(h >>> 7) * 0.2), s, spin, tint, mem);
        shadow(x, top, z, 1.0, 0.45, mem);
        const k = scatterInHex(tile.q, tile.r, 11, 3, pts, { radius: 0.8, minDist: 0.25, clearCenter: 0.55 });
        for (let j = 0; j < k; j++) {
          const rs = 0.13 + unit01(hashTile(tile.q, tile.r, 40 + j)) * 0.1;
          this.rocks.push(x + (pts[j * 2] ?? 0), top - 0.01, z + (pts[j * 2 + 1] ?? 0), rs, rs, rs, spin * j, mix(tc, [0.55, 0.53, 0.5], 0.6), mem);
        }
      }
      const feature = tile.feature;
      if (feature === 'hills') {
        const tint = scaleRgb(tc, 0.98);
        this.hills.push(x, top - 0.035, z, 1.0, 1.0 + unit01(h >>> 5) * 0.35, 1.0, spin, tint, mem);
        shadow(x - 0.05, top, z, 0.8, 0.22, mem);
      } else if (feature === 'forest' || feature === 'jungle') {
        const jungle = feature === 'jungle';
        const base = jungle ? 4 : 5;
        const count = front ? Math.min(3, treeCount(base, this.quality, settled)) : treeCount(base, this.quality, settled);
        // In front of a unit: clear the half toward it (instead of the resource spot).
        const frontClear: [number, number, number] | undefined = front ? [this.frontDx[i] ?? 0, this.frontDz[i] ?? 0, 0.62] : clear;
        const k = scatterInHex(tile.q, tile.r, 5, count, pts, { radius: 0.72, minDist: jungle ? 0.34 : 0.28, clearCenter: settled ? 0.62 : unitHere ? 0.58 : 0, clear: frontClear });
        const climate = tile.climate;
        for (let j = 0; j < k; j++) {
          const hj = hashTile(tile.q, tile.r, 60 + j);
          const px = x + (pts[j * 2] ?? 0);
          const pz = z + (pts[j * 2 + 1] ?? 0);
          const s = ((jungle ? 1.05 : 0.95) + unit01(hj) * 0.35) * (front ? 0.78 : 1);
          const tint = mix([1, 1, 1], tc, 0.12);
          const v = 0.92 + unit01(hj >>> 8) * 0.16;
          const col = scaleRgb(tint, v);
          let layer: Instances;
          if (jungle) layer = unit01(hj >>> 4) < 0.2 ? this.palms : this.jungle;
          else if (climate === 'boreal' || climate === 'polar') layer = this.conifers;
          else if (climate === 'tropical' || climate === 'arid') layer = unit01(hj >>> 4) < 0.35 ? this.palms : this.broadleaf;
          else layer = unit01(hj >>> 4) < 0.55 ? this.broadleaf : this.conifers;
          const ps = layer === this.palms ? s * 0.5 : s;
          layer.push(px, top - 0.005, pz, ps, ps, ps, unit01(hj >>> 12) * 6.28, col, mem);
          shadow(px, top, pz, 0.22 * s, 0.4, mem);
        }
      } else if (feature === 'oasis') {
        const k = scatterInHex(tile.q, tile.r, 9, 3, pts, { radius: 0.66, minDist: 0.3, clearCenter: 0.32, clear });
        for (let j = 0; j < k; j++) {
          const s = 0.42 + unit01(hashTile(tile.q, tile.r, 80 + j)) * 0.14;
          this.palms.push(x + (pts[j * 2] ?? 0), top, z + (pts[j * 2 + 1] ?? 0), s, s, s, j * 2.1 + spin, C.white, mem);
          shadow(x + (pts[j * 2] ?? 0), top, z + (pts[j * 2 + 1] ?? 0), 0.2, 0.35, mem);
        }
      } else if (feature && feature !== 'marsh') {
        // Unknown feature id: a small boulder cluster so it still reads as "something here".
        for (let j = 0; j < 2; j++) this.rocks.push(x - 0.2 + j * 0.3, top, z + 0.1, 0.18, 0.18, 0.18, spin + j, mix(tc, [0.55, 0.53, 0.5], 0.5), mem);
      }
      if (feature === 'hills' && !settled) {
        const k = scatterInHex(tile.q, tile.r, 13, 2, pts, { radius: 0.7, minDist: 0.3, clearCenter: 0.35, clear });
        for (let j = 0; j < k; j++) {
          this.rocks.push(x + (pts[j * 2] ?? 0), top + 0.02, z + (pts[j * 2 + 1] ?? 0), 0.12, 0.12, 0.12, spin + j, mix(tc, [0.55, 0.53, 0.5], 0.55), mem);
        }
      }
      if (hasRes && tile.resource) this.pushResource(tile.resource, i, ageIdx, fog);
    }
    for (const l of L) l?.end();
    this.drawResources();
  }

  private pushResource(id: string, i: number, ageIdx: number, fog: FogClass): void {
    const revealAge = this.resourceAge.get(id) ?? 0;
    if (revealAge > ageIdx) return;
    const cls = this.resourceClass.get(id) ?? 'bonus';
    const art = RESOURCE_ART[id];
    const water = this.waterTile[i] === 1;
    this.resourceList.push({
      x: (this.tileX[i] ?? 0) + (water ? 0 : RESOURCE_SPOT[0]),
      y: this.shownTop[i] ?? 0,
      z: (this.tileZ[i] ?? 0) + (water ? 0 : RESOURCE_SPOT[1]),
      cls,
      prop: art?.prop ?? null,
      spin: unit01(hashTile(i, 5, 9)) * 6.28,
      accent: art ? rgb(art.accent) : RESOURCE_RGB[cls],
      mem: fog === FOG_EXPLORED ? 1 : 0,
    });
  }

  /** Micro-detail (tufts, flowers, reeds, drifts, pebbles); density follows the zoom band. */
  private updateMicro(): void {
    const state = this.state;
    const L = [this.tufts, this.reeds, this.drifts, this.dunes, this.flowers];
    for (const l of L) l.begin();
    const density = microDensity(this.band, this.quality);
    if (state && density > 0) {
      const tiles = state.map.tiles;
      const n = this.width * this.height;
      const pts = this.scatter;
      for (let i = 0; i < n; i++) {
        const tile = tiles[i];
        if (!tile || this.waterTile[i]) continue;
        const fog = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
        if (fog === FOG_UNEXPLORED) continue;
        if (this.terrainMountain.get(tile.terrain)) continue;
        const mem = fog === FOG_EXPLORED ? 1 : 0;
        const x = this.tileX[i] ?? 0;
        const z = this.tileZ[i] ?? 0;
        const top = this.shownTop[i] ?? 0;
        const kind = (this.surface[i] ?? 0) as SurfaceKind;
        const tc: Rgb = [this.tileColor[i * 3] ?? 0, this.tileColor[i * 3 + 1] ?? 0, this.tileColor[i * 3 + 2] ?? 0];
        const settled = this.settledTile[i] === 1;
        // District tiles (fields, workshops) are built over: no grass tufts poking through.
        if (this.settledTile[i] === 3) continue;
        const wooded = tile.feature === 'forest' || tile.feature === 'jungle';
        const clear: [number, number, number] | undefined = tile.resource ? [RESOURCE_SPOT[0], RESOURCE_SPOT[1], 0.22] : undefined;
        const opts = { radius: 0.78, minDist: 0.17, clearCenter: settled ? 0.72 : 0, clear };
        const wet = tile.river || tile.feature === 'marsh';
        let tufts = 0;
        let tuftCol: Rgb = tc;
        if (kind === SURFACE.grass) {
          tufts = wooded ? 2 : 5;
          tuftCol = scaleRgb(mix(tc, [0.56, 0.68, 0.33], 0.35), 1.04);
        } else if (kind === SURFACE.dry) {
          tufts = wooded ? 2 : 4;
          tuftCol = mix(tc, [0.78, 0.68, 0.42], 0.35);
        } else if (kind === SURFACE.tundra) {
          tufts = 3;
          tuftCol = mix(tc, [0.45, 0.48, 0.36], 0.4);
        }
        tufts = Math.round(tufts * density);
        const k = scatterInHex(tile.q, tile.r, 21, tufts, pts, opts);
        for (let j = 0; j < k; j++) {
          const hj = hashTile(tile.q, tile.r, 200 + j);
          const s = 1.0 + unit01(hj) * 0.6;
          this.tufts.push(x + (pts[j * 2] ?? 0), top - 0.004, z + (pts[j * 2 + 1] ?? 0), s, s * (0.8 + unit01(hj >>> 6) * 0.5), s, unit01(hj >>> 12) * 6.28, tuftCol, mem);
        }
        if (kind === SURFACE.grass && !wooded && unit01(hashTile(tile.q, tile.r, 31)) < 0.55 * density) {
          const kk = scatterInHex(tile.q, tile.r, 33, 2, pts, opts);
          for (let j = 0; j < kk; j++) this.flowers.push(x + (pts[j * 2] ?? 0), top - 0.004, z + (pts[j * 2 + 1] ?? 0), 1.4, 1.4, 1.4, j, C.white, mem);
        }
        if (wet) {
          const reeds = Math.round((tile.feature === 'marsh' ? 7 : 2) * density);
          const kr = scatterInHex(tile.q, tile.r, 41, reeds, pts, { ...opts, minDist: 0.14 });
          for (let j = 0; j < kr; j++) {
            const s = 1.3 + unit01(hashTile(tile.q, tile.r, 300 + j)) * 0.7;
            this.reeds.push(x + (pts[j * 2] ?? 0), top - 0.004, z + (pts[j * 2 + 1] ?? 0), s, s, s, j * 1.7, C.white, mem);
          }
        }
        if (kind === SURFACE.snow) {
          const kd = scatterInHex(tile.q, tile.r, 51, Math.round(2 * density), pts, { ...opts, minDist: 0.4 });
          for (let j = 0; j < kd; j++) {
            const s = 0.45 + unit01(hashTile(tile.q, tile.r, 400 + j)) * 0.3;
            this.drifts.push(x + (pts[j * 2] ?? 0), top - 0.01, z + (pts[j * 2 + 1] ?? 0), s, s, s, 0.5 + j, scaleRgb(tc, 1.02), mem);
          }
        }
        if (kind === SURFACE.sand && !wooded && !settled) {
          // Desert: a couple of crescent dunes, all lying the same way (one prevailing wind
          // across the map): lit windward slope, bright crest, shaded slip face.
          // Art review: one big centred crescent per hex stamped the desert into a tile grid.
          // Now 1–3 dunes of mixed size spread over the whole top (and across tile edges'
          // worth of radius), some tiles with only small ones, with more yaw spread.
          const hd = hashTile(tile.q, tile.r, 590);
          const want = 1 + Math.floor(unit01(hd) * 2.6);
          const kd = scatterInHex(tile.q, tile.r, 71, Math.max(1, Math.round(want * density)), pts, { ...opts, radius: 0.6, minDist: 0.42 });
          const big = unit01(hd >>> 9) < 0.6;
          for (let j = 0; j < kd; j++) {
            const hs = hashTile(tile.q, tile.r, 600 + j);
            const sz = (j === 0 && big ? 0.78 : 0.42) + unit01(hs) * 0.28;
            this.dunes.push(x + (pts[j * 2] ?? 0), top - 0.006, z + (pts[j * 2 + 1] ?? 0), sz, sz * (0.8 + unit01(hs >>> 5) * 0.5), sz * (0.85 + unit01(hs >>> 11) * 0.3), 0.15 + unit01(hs >>> 7) * 0.55, scaleRgb(tc, 0.99 + unit01(hs >>> 3) * 0.05), mem);
          }
        }
        if (kind === SURFACE.sand || kind === SURFACE.tundra) {
          // Scattered pebbles / dry scrub.
          const kp = scatterInHex(tile.q, tile.r, 61, Math.round(2 * density), pts, opts);
          for (let j = 0; j < kp; j++) {
            this.tufts.push(x + (pts[j * 2] ?? 0), top - 0.004, z + (pts[j * 2 + 1] ?? 0), 0.9, 0.6, 0.9, j, mix(tc, [0.5, 0.44, 0.32], 0.45), mem);
          }
        }
      }
    }
    for (const l of L) l.end();
  }

  private drawResources(): void {
    for (const k of RESOURCE_PROPS) this.resourceProps[k].begin();
    for (const cls of RESOURCE_CLASSES) this.resourceMarkers[cls].begin();
    this.resourceHalos.begin();
    const k = this.propScale;
    for (const r of this.resourceList) {
      // Class-colored soft halo keeps the bonus / luxury / strategic legend readable.
      this.resourceHalos.push(r.x, r.y + 0.006, r.z, 0.27 * k, 1, 0.27 * k, 0, RESOURCE_RGB[r.cls], r.mem, SOFT.glow, 0.9, 0);
      if (r.prop) this.resourceProps[r.prop].push(r.x, r.y, r.z, k * 1.5, k * 1.5, k * 1.5, r.spin, r.accent, r.mem);
      else this.resourceMarkers[r.cls].push(r.x, r.y + 0.02, r.z, k, k, k, r.cls === 'bonus' ? 0 : r.spin, r.accent, r.mem);
    }
    // Settler sites share the halo layer: a soft gold ground ring (round, not a hex: never
    // mistaken for a move or attack highlight).
    for (const site of this.sites) {
      const top = this.topAt(site.hex);
      if (top === null) continue;
      const w = hexToWorld(site.hex);
      const rr = site.rank === 1 ? 0.86 : 0.76;
      this.resourceHalos.push(w.x, top + 0.01, w.z, rr, 1, rr, 0, C.siteGlow, 0, SOFT.glow, 1, 0);
    }
    for (const kk of RESOURCE_PROPS) this.resourceProps[kk].end();
    for (const cls of RESOURCE_CLASSES) this.resourceMarkers[cls].end();
    this.resourceHalos.end();
  }

  private updateRivers(state: GameState): void {
    const { width, height } = this;
    if (this.riverTiles !== state.map.tiles) {
      // River flags are static per map; recompute only for a new map object.
      const tiles = state.map.tiles;
      this.riverSegs = computeRiverSegments(
        width,
        height,
        (i) => tiles[i]?.river ?? false,
        (i) => this.waterTile[i] === 1,
      );
      this.riverTiles = tiles;
    }
    this.riverRibbons.begin();
    this.riverNodes.begin();
    for (const seg of this.riverSegs) {
      const fa = (this.fog[seg.a] ?? FOG_UNEXPLORED) as FogClass;
      if (fa === FOG_UNEXPLORED) continue;
      const fb = (this.fog[seg.b] ?? FOG_UNEXPLORED) as FogClass;
      const ax = this.tileX[seg.a] ?? 0;
      const az = this.tileZ[seg.a] ?? 0;
      const bx = this.tileX[seg.b] ?? 0;
      const bz = this.tileZ[seg.b] ?? 0;
      const rot = -Math.atan2(bz - az, bx - ax);
      const half = Math.hypot(bx - ax, bz - az) / 2;
      const ay = (this.shownTop[seg.a] ?? 0) + 0.006;
      // Each half sits on its own tile's top (a hill's half stays on the hill); a mouth runs a
      // little past the shore so it visibly meets the water. a -> b is downstream.
      this.riverRibbons.push(ax, ay, az, half * (seg.mouth ? 1.12 : 1.01), 1, 1, rot, C.white, fa === FOG_EXPLORED ? 1 : 0, 1);
      if (!seg.mouth && fb !== FOG_UNEXPLORED) {
        const by = (this.shownTop[seg.b] ?? 0) + 0.006;
        this.riverRibbons.push(bx, by, bz, half * 1.01, 1, 1, rot + Math.PI, C.white, fb === FOG_EXPLORED ? 1 : 0, -1);
      }
    }
    const tiles = state.map.tiles;
    const n = width * height;
    for (let i = 0; i < n; i++) {
      const t = tiles[i];
      if (!t || this.waterTile[i]) continue;
      const f = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
      if (f === FOG_UNEXPLORED) continue;
      const mem = f === FOG_EXPLORED ? 1 : 0;
      const x = this.tileX[i] ?? 0;
      const z = this.tileZ[i] ?? 0;
      const y = (this.shownTop[i] ?? 0) + 0.006;
      if (t.river) this.riverNodes.push(x, y, z, 1, 1, 1, 0, C.white, mem);
      // Marsh pools and oasis springs reuse the river water.
      if (t.feature === 'oasis') this.riverNodes.push(x, y + 0.001, z, 3.2, 1, 2.6, 0.4, C.white, mem);
      if (t.feature === 'marsh') {
        for (let j = 0; j < 3; j++) {
          const hj = hashTile(t.q, t.r, 90 + j);
          const a = unit01(hj) * 6.28;
          const r = 0.2 + unit01(hj >>> 8) * 0.35;
          const s = 1.4 + unit01(hj >>> 16) * 1.4;
          this.riverNodes.push(x + Math.cos(a) * r, y + 0.001, z + Math.sin(a) * r, s, 1, s * 0.7, a, C.white, mem);
        }
      }
    }
    this.riverRibbons.end();
    this.riverNodes.end();
  }

  private updateTerritory(state: GameState): void {
    this.territoryFill.begin();
    const { width, height } = this;
    const n = width * height;
    const order = state.playerOrder;
    for (let i = 0; i < n; i++) {
      const owner = this.owners[i] ?? null;
      const fog = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
      if (owner === null || fog === FOG_UNEXPLORED) continue;
      const col = parseHexColor(ownerColors(state, owner).primary);
      this.territoryFill.push(this.tileX[i] ?? 0, (this.shownTop[i] ?? 0) + 0.008, this.tileZ[i] ?? 0, 1, 1, 1, 0, col, fog === FOG_EXPLORED ? 1 : 0, SOFT.territory, 0.2, 0);
    }
    const include = (i: number): boolean => this.fog[i] !== FOG_UNEXPLORED;
    const edges = computeBorderEdges(this.owners, width, height, include, this.edges);
    // Owner colors resolved once per owner (and per memory state), not per edge.
    const cache = new Map<string, BorderColors>();
    const colorsFor = (i: number): BorderColors => {
      const owner = this.owners[i] ?? '';
      const fog = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
      const key = `${owner}|${fog}`;
      let c = cache.get(key);
      if (!c) {
        const oc = ownerColors(state, owner);
        c = {
          primary: propColor(parseHexColor(oc.primary), fog),
          secondary: propColor(parseHexColor(oc.secondary), fog),
          ink: propColor(C.keyline, fog),
          pattern: patternFor(owner, order),
        };
        cache.set(key, c);
      }
      return c;
    };
    this.borderData = buildBorderMesh(edges, this.owners, width, height, include, { x: this.tileX, z: this.tileZ, top: this.shownTop }, colorsFor, this.borderData);
    this.borders.set(this.borderData);
    this.territoryFill.end();
  }

  private atWarWithViewer(state: GameState, owner: PlayerId): boolean {
    const v = this.viewer;
    if (v === null || owner === v) return false;
    if (owner === RAIDER_PLAYER) return true;
    return state.wars[warKey(v, owner)] !== undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Settlements
  // -------------------------------------------------------------------------------------------

  /**
   * Districts around each shown settlement (districts.ts): fields, orchards, workshops, quays and
   * plinths on the settlement's own neighbor tiles, one district per tile. Land district tiles
   * are marked built-over (settledTile = 3) so micro-detail skips them.
   */
  private planDistricts(state: GameState, viewer: PlayerId | null): void {
    this.districtSpots = [];
    const tiles = state.map.tiles;
    const claimed = new Set<number>();
    for (const id of Object.keys(state.settlements).sort()) {
      const s = state.settlements[id];
      if (!s) continue;
      const i = tileIndex(s.at, this.width, this.height);
      if (i < 0) continue;
      if (viewer !== null && s.owner !== viewer && this.fog[i] !== FOG_VISIBLE) continue;
      const neighbors: DistrictNeighbor[] = [];
      for (let d = 0; d < 6; d++) {
        const j = this.neighbors[i * 6 + d] ?? -1;
        if (j < 0 || claimed.has(j)) continue;
        const t = tiles[j];
        if (!t || this.fog[j] === FOG_UNEXPLORED) continue;
        const water = this.waterTile[j] === 1;
        if (t.owner !== s.owner && !(water && t.owner === null)) continue;
        const free = !water && !t.resource && !(this.terrainMountain.get(t.terrain) ?? false) && this.settledTile[j] !== 1;
        const wooded = free && (t.feature === 'forest' || t.feature === 'jungle');
        neighbors.push({ dir: d, water, open: free && !t.feature, wooded });
      }
      const plan = districtPlan({
        id: s.id,
        population: s.population,
        kind: s.kind,
        capital: s.isCapital,
        cityState: s.owner.startsWith(CITY_STATE_PREFIX),
        neighbors,
      });
      for (const spot of plan) {
        const j = this.neighbors[i * 6 + spot.dir] ?? -1;
        if (j < 0) continue;
        claimed.add(j);
        if (this.waterTile[j] !== 1) this.settledTile[j] = 3;
        this.districtSpots.push({
          sid: s.id,
          tile: j,
          kind: spot.kind,
          toCity: Math.atan2((this.tileZ[i] ?? 0) - (this.tileZ[j] ?? 0), (this.tileX[i] ?? 0) - (this.tileX[j] ?? 0)),
          size: clamp01((s.population - 2) / 10),
          key: hashTile(i, spot.dir, 5),
        });
      }
    }
  }

  private updateSettlements(state: GameState, viewer: PlayerId | null, now = 0): void {
    this.cityIconList = [];
    this.smoke = [];
    this.warRings.begin();
    this.labelEntries = [];
    this.settlementDraws = [];
    const ids = Object.keys(state.settlements).sort();
    const shown: { tile: number; s: (typeof state.settlements)[string] & object }[] = [];
    for (const id of ids) {
      const s = state.settlements[id];
      if (!s) continue;
      const i = tileIndex(s.at, this.width, this.height);
      if (i < 0) continue;
      shown.push({ tile: i, s });
    }
    // Founding pop-in for settlements that appeared since the last snapshot.
    if (this.knownSettlements && !this.reduceMotion) {
      for (const { s } of shown) if (!this.knownSettlements.has(s.id) && !this.bornAt.has(s.id)) this.bornAt.set(s.id, now);
    }
    this.knownSettlements = new Set(ids);
    // Wonders per settlement (landmarks).
    const wondersAt = new Map<string, string[]>();
    for (const wid of Object.keys(state.wonders ?? {}).sort()) {
      const w = state.wonders[wid];
      if (!w) continue;
      const list = wondersAt.get(w.settlement);
      if (list) list.push(wid);
      else wondersAt.set(w.settlement, [wid]);
    }
    // Fog-of-war memory: remember what we see, ghost what we saw.
    this.ghostMemory.update(`${state.seed}|${viewer ?? '*'}|${this.width}x${this.height}`, state.turn, viewer, shown, this.fog);
    const occupied = new Set<number>();
    for (const { tile: i, s } of shown) {
      const fog = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
      // Own settlements always show; others only while the tile is in sight.
      if (viewer !== null && s.owner !== viewer && fog !== FOG_VISIBLE) continue;
      occupied.add(i);
      this.placeSettlement(state, s, i, fog, false, wondersAt.get(s.id) ?? []);
    }
    for (const { tile, g } of this.ghostMemory.ghosts(this.fog)) {
      if (occupied.has(tile)) continue;
      this.placeSettlement(state, g, tile, FOG_EXPLORED, true, []);
    }
    // Districts (fields, workshops, quays…) ride the settlement pieces' layers and pop in when
    // a milestone adds one (growth made visible).
    const ageIdx = Math.max(0, AGES.indexOf(state.age));
    const keys = new Set<string>();
    for (const spot of this.districtSpots) {
      const s = state.settlements[spot.sid];
      if (!s) continue;
      const key = `${spot.sid}#${spot.tile}:${spot.kind}`;
      keys.add(key);
      if (this.knownDistricts && !this.knownDistricts.has(key) && !this.reduceMotion) this.bornAt.set(key, now);
      const player = state.players[s.owner];
      const style = kitStyle(motifWeights(s.namedFor, player?.traditions ?? [], player?.hybrids ?? [], this.cultures), ageIdx);
      const x = this.tileX[spot.tile] ?? 0;
      const y = this.shownTop[spot.tile] ?? 0;
      const z = this.tileZ[spot.tile] ?? 0;
      const mem = this.fog[spot.tile] === FOG_VISIBLE ? 0 : 1;
      this.settlementDraws.push({ id: key, x, y, z, mem, pattern: 0, pieces: districtPieces(spot.kind, spot.key, spot.toCity, spot.size, style), flag: -1 });
      const chimney = districtSmoke(spot.kind, spot.size);
      if (chimney && mem === 0) this.smoke.push(x + chimney[0], y + chimney[1], z + chimney[2], 0.1, 0);
    }
    this.knownDistricts = keys;
    this.warRings.end();
    this.rebuildLabels();
    this.drawCityIcons();
    this.drawSettlementPieces(now);
    this.drawLiving(state);
  }

  /**
   * Living world (GDD §11, art pass 3): hearth-smoke columns, birds wheeling over towns and a
   * few coasts, fishing boats off coastal settlements. All motion is in the vertex shaders
   * (uTime), so these cost one instanced draw each and no per-frame CPU. Deterministic by tile
   * hash; only on tiles in sight; 'low' quality hides them (applyQuality).
   */
  private drawLiving(state: GameState): void {
    this.wisps.begin();
    this.birds.begin();
    this.boats.begin();
    if (this.quality === 'high') {
      const sm = this.smoke;
      for (let k = 0; k + 5 <= sm.length; k += 5) {
        const x = sm[k] ?? 0;
        const y = sm[k + 1] ?? 0;
        const z = sm[k + 2] ?? 0;
        const size = sm[k + 3] ?? 0.07;
        const ph = unit01(hashTile(Math.round(x * 100), Math.round(z * 100), 23));
        // Four puffs per column, evenly phased: a continuous drifting plume.
        for (let p = 0; p < 4; p++) this.wisps.push(x, y, z, size, size, size, 0, C.white, sm[k + 4] ?? 0, (ph + p / 4) % 1, 0.75, 0);
      }
      let birds = 0;
      const flock = (cx: number, cy: number, cz: number, seed: number, count: number): void => {
        for (let b = 0; b < count && birds < 48; b++, birds++) {
          const h = hashTile(seed, b, 29);
          const r = 0.55 + unit01(h) * 0.45;
          const speed = (0.32 + unit01(h >>> 8) * 0.2) * (unit01(seed) < 0.5 ? 1 : -1);
          this.birds.push(cx, cy + unit01(h >>> 16) * 0.2, cz, 1, 1, 1, 0, C.white, 0, r, unit01(h >>> 4), speed);
        }
      };
      for (const id of Object.keys(state.settlements).sort()) {
        const s = state.settlements[id];
        if (!s || s.population < 3) continue;
        const i = tileIndex(s.at, this.width, this.height);
        if (i < 0 || this.fog[i] !== FOG_VISIBLE) continue;
        const x = this.tileX[i] ?? 0;
        const y = this.shownTop[i] ?? 0;
        const z = this.tileZ[i] ?? 0;
        flock(x, y + 1.0, z, hashTile(i, 0, 31), s.population >= 8 ? 3 : 2);
        // Fishing boats on the water next to coastal settlements.
        const boats = s.population >= 6 ? 2 : 1;
        let placed = 0;
        for (let d = 0; d < 6 && placed < boats; d++) {
          const dd = (d + (hashTile(i, 1, 37) % 6)) % 6;
          const j = this.neighbors[i * 6 + dd] ?? -1;
          if (j < 0 || this.waterTile[j] !== 1 || this.fog[j] !== FOG_VISIBLE) continue;
          const h = hashTile(j, placed, 41);
          const a = unit01(h) * Math.PI * 2;
          const r = 0.2 + unit01(h >>> 8) * 0.3;
          this.boats.push((this.tileX[j] ?? 0) + Math.cos(a) * r, this.shownTop[j] ?? 0, (this.tileZ[j] ?? 0) + Math.sin(a) * r, 1, 1, 1, unit01(h >>> 16) * 6.28, C.white, 0, 0, unit01(h >>> 4) * 6.28, 0);
          placed++;
        }
      }
      // Gulls over a few visible coasts.
      const n = this.width * this.height;
      for (let i = 0; i < n && birds < 48; i++) {
        if (this.waterTile[i] !== 1 || this.fog[i] !== FOG_VISIBLE) continue;
        let coast = false;
        for (let d = 0; d < 6 && !coast; d++) {
          const j = this.neighbors[i * 6 + d] ?? -1;
          coast = j >= 0 && this.waterTile[j] === 0 && this.fog[j] !== FOG_UNEXPLORED;
        }
        if (!coast || unit01(hashTile(i, 3, 43)) > 0.06) continue;
        flock(this.tileX[i] ?? 0, (this.shownTop[i] ?? 0) + 0.8, this.tileZ[i] ?? 0, hashTile(i, 4, 47), 2);
      }
    }
    this.wisps.end();
    this.birds.end();
    this.boats.end();
    this.applyQuality();
  }

  /**
   * Push every label: settlement cartouches (skipping settlements still popping in, so a new
   * name appears once its town has landed) and then site seals (drawn on top, fixed).
   */
  private rebuildLabels(): void {
    this.labels.begin();
    for (const e of this.labelEntries) {
      if (this.bornAt.has(e.id)) continue;
      this.labels.push(e.spec, e.x, e.y, e.z, e.priority, e.tile);
    }
    for (const site of this.sites) {
      const top = this.topAt(site.hex);
      if (top === null) continue;
      const w = hexToWorld(site.hex);
      const k = site.rank === 1 ? 1.2 : 1;
      const i = tileIndex(site.hex, this.width, this.height);
      this.labels.push(sealSpec(site.rank), w.x + SITE_SPOT[0], top + SITE_STAKE_TOP * k - 0.01, w.z + SITE_SPOT[1], 10, i);
    }
    this.labels.end();
    this.labelsDirty = true;
  }

  private placeSettlement(state: GameState, s: GhostSettlement, i: number, fog: FogClass, ghost: boolean, wonders: readonly string[]): void {
    const colors = ownerColors(state, s.owner);
    const primary = parseHexColor(colors.primary);
    const x = this.tileX[i] ?? 0;
    const z = this.tileZ[i] ?? 0;
    const y = this.shownTop[i] ?? 0;
    const cs = s.owner.startsWith(CITY_STATE_PREFIX);
    const war = !ghost && this.atWarWithViewer(state, s.owner);
    const pattern = patternFor(s.owner, state.playerOrder);
    const damage = s.maxHp > 0 ? clamp01(1 - s.hp / s.maxHp) : 0;
    const player = state.players[s.owner];
    const weights = motifWeights(s.namedFor, player?.traditions ?? [], player?.hybrids ?? [], this.cultures);
    const layout = settlementLayout({
      id: s.id,
      kind: s.kind,
      population: s.population,
      capital: s.isCapital,
      cityState: cs,
      age: Math.max(0, AGES.indexOf(state.age)),
      weights,
      damage,
      primary,
      wonders,
    });
    this.settlementDraws.push({
      id: s.id,
      x,
      y,
      z,
      mem: fog === FOG_EXPLORED || ghost ? 1 : 0,
      pattern,
      pieces: layout.pieces,
      flag: layout.flag,
    });
    if (war) this.warRings.push(x, y + 0.02, z, 1, 1, 1, 0, C.warRim);
    // Hearth smoke: more chimneys as the town grows (living world; never over ghosts).
    if (!ghost && fog === FOG_VISIBLE) {
      const big = s.kind === 'city' || cs;
      const plumes = Math.min(4, 1 + Math.floor(s.population / 4));
      for (let k = 0; k < plumes; k++) {
        const hk = hashTile(i, k, 17);
        const a = unit01(hk) * Math.PI * 2;
        const r = (big ? 0.42 : 0.2) + unit01(hk >>> 8) * 0.2;
        this.smoke.push(x + Math.cos(a) * r, y + (big ? 0.32 : 0.26), z + Math.sin(a) * r, big ? 0.11 : 0.09, 0);
      }
    }
    this.cityIconList.push({
      x,
      y,
      z,
      size: s.kind === 'city' || cs ? 1 : 0.68,
      color: propColor(primary, fog),
      capital: s.isCapital,
      cs,
    });
    const own = this.viewer !== null && s.owner === this.viewer;
    const priority = (s.isCapital ? 3 : s.kind === 'city' ? 2 : 1) + (own ? 0.5 : 0) - (ghost ? 1.5 : 0);
    const spec = labelSpec(s, colors.primary, {
      pattern: this.patternsOn ? pattern : 0,
      ghost,
      war,
      cityState: cs,
      wall: wallFraction(s.hp, s.maxHp),
    });
    this.labelEntries.push({ id: s.id, spec, x, y: y + (s.kind === 'city' || cs ? 0.9 : 0.7), z, priority, tile: i });
  }

  /** Push every settlement piece; pop-in and banner flourishes scale them. Returns true while animating. */
  drawSettlementPieces(now: number): boolean {
    for (const k of PIECE_KINDS) this.pieces[k].begin();
    let animating = false;
    let landed = false;
    for (const d of this.settlementDraws) {
      let s = 1;
      const born = this.bornAt.get(d.id);
      if (born !== undefined) {
        const t = (now - born) / POP_MS;
        if (t >= 1) {
          this.bornAt.delete(d.id);
          landed = true;
        }
        else {
          s = Math.max(0.001, easeOutBack(clamp01(t)));
          animating = true;
        }
      }
      let flourish = -1;
      const fl = this.flourishAt.get(d.id);
      if (fl !== undefined) {
        const t = (now - fl) / FLOURISH_MS;
        if (t >= 1) this.flourishAt.delete(d.id);
        else {
          flourish = t;
          animating = true;
        }
      }
      if (flourish >= 0) {
        // Captured: the town settles under its new banner with a small bounce.
        s *= 1 + 0.07 * Math.sin(flourish * Math.PI * 3) * (1 - flourish);
      }
      for (let k = 0; k < d.pieces.length; k++) {
        const p = d.pieces[k];
        if (!p) continue;
        let sx = p.sx * s;
        let sy = p.sy * s;
        let sz = p.sz * s;
        let rot = p.r;
        if (k === d.flag && flourish >= 0) {
          // Banner swap: the cloth spins in and unfurls.
          // Banner swap: the new cloth spins in, unfurls oversized, then settles.
          const e = easeOutBack(flourish);
          const swell = 1 + 0.9 * Math.sin(Math.min(1, flourish * 1.4) * Math.PI);
          sx *= e * swell;
          sy *= Math.min(1, flourish * 2) * swell;
          sz *= swell;
          rot += (1 - flourish) * Math.PI * 4;
        }
        this.pieces[p.k].push(d.x + p.x * s, d.y + p.y * s, d.z + p.z * s, sx, sy, sz, rot, p.c, d.mem, p.k === 'flag' ? d.pattern : 0, k * 0.37);
      }
    }
    for (const k of PIECE_KINDS) this.pieces[k].end();
    // A pop-in finished: its name label may show now.
    if (landed) this.rebuildLabels();
    return animating;
  }

  private drawCityIcons(): void {
    this.cityIcons.begin();
    this.csIcons.begin();
    const k = this.iconScale;
    for (const c of this.cityIconList) {
      const layer = c.cs ? this.csIcons : this.cityIcons;
      // Inked stamp: dark outline, gold for capitals, owner fill.
      if (c.capital) layer.push(c.x, c.y, c.z, c.size * k * 1.28, 1, c.size * k * 1.28, 0, C.gold);
      layer.push(c.x, c.y + 0.01, c.z, c.size * k * 1.14, 1, c.size * k * 1.14, 0, c.cs ? C.white : C.keyline);
      layer.push(c.x, c.y + 0.02, c.z, c.size * k, 1, c.size * k, 0, c.color);
    }
    this.cityIcons.end();
    this.csIcons.end();
  }

  /** Zoom-dependent sizes; redraws only when they change noticeably. */
  setZoomScales(iconScale: number, propScale: number, now: number): void {
    const iconChanged = Math.abs(iconScale - this.iconScale) >= 0.03 * this.iconScale;
    const propChanged = Math.abs(propScale - this.propScale) >= 0.03 * this.propScale;
    if (!iconChanged && !propChanged) return;
    if (iconChanged) this.iconScale = iconScale;
    if (propChanged) this.propScale = propScale;
    this.drawCityIcons();
    this.drawResources();
    this.drawUnits(now);
  }

  /**
   * Roads as inked tracks (art review: the old cream dot chain read as a debug overlay): short
   * dashes from each settlement out to its land districts, and along the viewer's trade
   * routes between settlements (a dotted sea lane where the route crosses water).
   */
  private updateTradeRoutes(state: GameState, viewer: PlayerId | null): void {
    this.tradeDots.begin();
    const track = (ax: number, az: number, bx: number, bz: number, t0: number, t1: number, bold: number): void => {
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) return;
      const rot = -Math.atan2(dz, dx);
      const steps = Math.max(1, Math.floor((len * (t1 - t0)) / ROAD_STEP));
      for (let k = 0; k <= steps; k++) {
        const t = t0 + ((t1 - t0) * k) / steps;
        const x = ax + dx * t;
        const z = az + dz * t;
        const h = worldToHex(x, z);
        const i = tileIndex(h, this.width, this.height);
        if (i < 0 || this.fog[i] === FOG_UNEXPLORED) continue;
        const top = this.shownTop[i] ?? 0;
        const mem = this.fog[i] === FOG_VISIBLE ? 0 : 1;
        if (this.waterTile[i] === 1) {
          // Sea lane: small vellum dots.
          if (k % 2 === 0) this.tradeDots.push(x, top + 0.012, z, 0.035, 1, 0.035, 0, C.sea, mem, SOFT.ink, 0.8, 0);
          continue;
        }
        const wob = (unit01(hashTile(i, k, 53)) - 0.5) * 0.02;
        this.tradeDots.push(x, top + 0.014, z + wob, ROAD_DASH / 2, 1, 0.024 * bold, rot, C.road, mem, SOFT.ink, 0.85, 0);
      }
    };
    for (const spot of this.districtSpots) {
      if (this.waterTile[spot.tile] === 1) continue;
      const s = state.settlements[spot.sid];
      if (!s) continue;
      const c = hexToWorld(s.at);
      track(c.x, c.z, this.tileX[spot.tile] ?? 0, this.tileZ[spot.tile] ?? 0, 0.32, 0.72, 1);
    }
    for (const route of state.tradeRoutes) {
      if (viewer !== null && route.owner !== viewer) continue;
      const a = state.settlements[route.from];
      const b = state.settlements[route.to];
      if (!a || !b) continue;
      const wa = hexToWorld(a.at);
      const wb = hexToWorld(b.at);
      track(wa.x, wa.z, wb.x, wb.z, 0.08, 0.92, 1.25);
    }
    this.tradeDots.end();
  }

  // -------------------------------------------------------------------------------------------
  // Units
  // -------------------------------------------------------------------------------------------

  private prepareUnits(state: GameState, viewer: PlayerId | null, now: number): void {
    const byTile = new Map<number, UnitId[]>();
    const ids = Object.keys(state.units).sort();
    for (const id of ids) {
      const u = state.units[id];
      if (!u) continue;
      const i = tileIndex(u.at, this.width, this.height);
      if (i < 0) continue;
      if (viewer !== null && u.owner !== viewer && this.fog[i] !== FOG_VISIBLE) continue;
      const list = byTile.get(i);
      if (list) list.push(id);
      else byTile.set(i, [id]);
    }
    const draws: UnitDraw[] = [];
    const seen = new Set<UnitId>();
    for (const [i, list] of byTile) {
      const settled = this.settledTile[i] === 1;
      // In a settlement, units stand at the front edge rather than inside the buildings.
      const x0 = (this.tileX[i] ?? 0) + (settled ? -0.06 : 0);
      const z0 = (this.tileZ[i] ?? 0) + (settled ? 0.4 : 0);
      const y = this.shownTop[i] ?? 0;
      // Military first (front, full size), civilians behind and a bit smaller: both readable.
      list.sort((a, b) => {
        const ca = state.units[a]?.unitClass === 'civilian' ? 1 : 0;
        const cb = state.units[b]?.unitClass === 'civilian' ? 1 : 0;
        return ca - cb || (a < b ? -1 : a > b ? 1 : 0);
      });
      list.forEach((id, k) => {
        const u = state.units[id];
        if (!u) return;
        let x = x0;
        let z = z0;
        let scale = 1;
        if (list.length === 2 && settled) {
          x += k === 0 ? -0.18 : 0.2;
          scale = k === 0 ? 1 : 0.82;
        } else if (list.length === 2) {
          x += k === 0 ? -0.16 : 0.24;
          z += k === 0 ? 0.12 : -0.2;
          scale = k === 0 ? 1 : 0.82;
        } else if (list.length > 2) {
          const a = (k / list.length) * Math.PI * 2 + Math.PI / 6;
          x += Math.cos(a) * 0.3;
          z += Math.sin(a) * 0.3;
          scale = 0.82;
        }
        const colors = ownerColors(state, u.owner);
        const prev = this.displayed.get(id);
        const moved = prev !== undefined && (Math.abs(prev.x - x) > 1e-4 || Math.abs(prev.z - z) > 1e-4);
        const heading = moved && prev ? Math.atan2(-(x - prev.x), -(z - prev.z)) : (prev?.heading ?? 0.4);
        const animate = moved && !this.reduceMotion;
        const own = viewer === null || u.owner === viewer;
        const rim = own ? C.ownRim : this.atWarWithViewer(state, u.owner) ? C.warRim : C.rivalRim;
        draws.push({
          id,
          figure: figureFor(u.unitClass, u.type),
          primary: parseHexColor(colors.primary),
          rim,
          own: viewer !== null && u.owner === viewer,
          fx: animate && prev ? prev.x : x,
          fy: animate && prev ? prev.y : y,
          fz: animate && prev ? prev.z : z,
          tx: x,
          ty: y,
          tz: z,
          start: animate ? now : -Infinity,
          heading,
          hp: u.hp,
          ring: u.figure !== null || u.unitClass === 'commander',
          fortified: u.fortified,
          scale,
          water: this.waterTile[i] === 1,
          skin: packedSkin(state.players[u.owner]?.skinTone ?? hashString(u.owner) % SKIN_TONES.length),
        });
        seen.add(id);
      });
    }
    for (const id of [...this.displayed.keys()]) if (!seen.has(id)) this.displayed.delete(id);
    this.unitDraws = draws;
    // Unit figure points labels must not cover (re-checked on the next label layout).
    if (this.obstacles.length < draws.length * 6) this.obstacles = new Float32Array(draws.length * 12);
    let k = 0;
    for (const d of draws) {
      const S = UNIT_SCALE * d.scale;
      const h = FIGURE_TOP[d.figure] * S;
      for (const f of [0.45, 0.9]) {
        this.obstacles[k * 3] = d.tx;
        this.obstacles[k * 3 + 1] = d.ty + 0.04 + h * f;
        this.obstacles[k * 3 + 2] = d.tz;
        k++;
      }
    }
    this.obstacleCount = k;
    this.labelsDirty = true;
  }

  /** Per-frame unit pass. Returns true while anything (moves, pulse, shake) is animating. */
  drawUnits(now: number): boolean {
    for (const k of FIGURES) this.figures[k].begin();
    this.unitBases.begin();
    this.unitRims.begin();
    this.goldRings.begin();
    this.unitGlow.begin();
    this.unitShadows.begin();
    this.readyMarks.begin();
    this.shields.begin();
    this.hpBack.begin();
    this.hpFront.begin();
    this.unitDots.begin();
    let moving = false;
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const pulseT = now - this.selectedAt;
    const pulsing = !this.reduceMotion && pulseT >= 0 && pulseT < PULSE_MS;
    const pulse = pulsing ? 1 + 0.12 * Math.sin((pulseT / 1000) * Math.PI * 2 * 1.6) * (1 - pulseT / PULSE_MS) : 1;
    const amb = this.ambient && !this.reduceMotion;
    for (const d of this.unitDraws) {
      const t = clamp01((now - d.start) / MOVE_MS);
      if (t < 1) moving = true;
      const e = easeOut(t);
      let x = d.fx + (d.tx - d.fx) * e;
      let z = d.fz + (d.tz - d.fz) * e;
      // Hop: a little arc every move, higher when crossing heights.
      let y = d.fy + (d.ty - d.fy) * e + Math.sin(Math.PI * t) * (0.1 + Math.abs(d.ty - d.fy) * 0.5) * (t < 1 ? 1 : 0);
      const prev = this.displayed.get(d.id);
      if (prev) {
        prev.x = x;
        prev.y = y;
        prev.z = z;
        prev.heading = d.heading;
      } else {
        this.displayed.set(d.id, { x, y, z, heading: d.heading });
      }
      const sh = this.shakeAt.get(d.id);
      if (sh !== undefined) {
        const k = (now - sh) / SHAKE_MS;
        if (k >= 1) this.shakeAt.delete(d.id);
        else {
          const a = Math.sin(k * Math.PI * 9) * 0.05 * (1 - k);
          x += a * rx;
          z += a * rz;
          moving = true;
        }
      }
      const selected = d.id === this.selection.unit;
      let lift = 0;
      if (selected && amb) lift = 0.025 + Math.sin(now * 0.005) * 0.02;
      const S = UNIT_SCALE * this.propScale * d.scale;
      const top = FIGURE_TOP[d.figure] * S;
      if (!d.water) this.unitBases.push(x, y, z, S, 1, S, 0, d.primary, 0);
      this.unitRims.push(x, y + (d.water ? 0 : 0.012), z, S, 1, S, 0, d.rim);
      this.unitShadows.push(x + 0.03, y + 0.004, z + 0.02, 0.3 * S, 1, 0.3 * S, 0, C.white, 0, SOFT.shadow, 0.55, 0);
      this.figures[d.figure].push(x, y + (d.water ? 0.01 : 0.04) + lift, z, S, S, S, d.heading, d.primary, 0, 0, 0, d.skin);
      if (d.ring) this.goldRings.push(x, y + 0.012, z, S, 1, S, 0, C.gold);
      if (selected) this.unitGlow.push(x, y + 0.02, z, 0.42 * S * pulse, 1, 0.42 * S * pulse, 0, C.selectUnit, 0, SOFT.glow, 0.9, amb ? 1 : 0);
      let topY = y + 0.042 + top + lift + 0.03 * S;
      if (d.hp < UNIT_MAX_HP) {
        const f = clamp01(d.hp / UNIT_MAX_HP);
        const by = topY + 0.04;
        const k = Math.max(1, this.propScale);
        this.hpBack.push(x, by, z, k, k, k, this.yaw, C.hpBack);
        const shift = -(1 - f) * 0.23 * k;
        const col = f > 0.6 ? C.hpGood : f > 0.3 ? C.hpMid : C.hpLow;
        this.hpFront.push(x + rx * shift, by + 0.014 * k, z + rz * shift, Math.max(0.02, f) * k, k, k, this.yaw, col);
        topY = by + 0.09 * k;
      }
      if (d.own && this.ready.has(d.id)) this.readyMarks.push(x, topY + 0.03, z, S * 0.9, S * 0.9, S * 0.9, 0.3, C.white, 0);
      if (d.fortified) {
        // Shield on the unit's camera-facing side so it reads from the default view.
        this.shields.push(x + 0.17 * S * rx, y + 0.03, z + 0.17 * S * rz + 0.12 * S, S, S, S, this.yaw, C.shield, 0);
      }
      const ds = this.iconScale;
      this.unitDots.push(x, y + 0.1, z, ds * 1.3, 1, ds * 1.3, 0, d.own ? C.ownRim : d.rim);
      this.unitDots.push(x, y + 0.12, z, ds, 1, ds, 0, d.primary);
    }
    for (const k of FIGURES) this.figures[k].end();
    this.unitBases.end();
    this.unitRims.end();
    this.goldRings.end();
    this.unitGlow.end();
    this.unitShadows.end();
    this.readyMarks.end();
    this.shields.end();
    this.hpBack.end();
    this.hpFront.end();
    this.unitDots.end();
    this.unitShadows.mesh.visible = this.quality === 'high' && this.unitShadows.count > 0;
    return moving || (pulsing && this.selection.unit !== null);
  }

  // -------------------------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------------------------

  /** Re-run label de-overlap when the camera or the labels changed. */
  layoutLabels(
    camera: PerspectiveCamera | Camera,
    viewW: number,
    viewH: number,
    cameraChanged: boolean,
    hud: { top: number; bottom: number; left?: number; right?: number } = { top: 0, bottom: 0 },
  ): void {
    if (!cameraChanged && !this.labelsDirty) return;
    this.labelsDirty = false;
    // Labels stay out of the HUD bars (a little slack: the bars' lower edge is translucent).
    this.labels.layout(camera as PerspectiveCamera, viewW, viewH, hud.top * 0.85, viewH - hud.bottom * 0.5, this.obstacles, this.obstacleCount, (hud.left ?? 0) + 6, viewW - (hud.right ?? 0) - 6);
  }

  // -------------------------------------------------------------------------------------------
  // Selection and flashes
  // -------------------------------------------------------------------------------------------

  /** Returns true when a selection pulse animation started. */
  setSelection(sel: Selection, now: number): boolean {
    const changedUnit = sel.unit !== this.selection.unit;
    this.selection = sel;
    if (changedUnit && sel.unit !== null) this.selectedAt = now;
    this.drawSelection();
    this.drawUnits(now);
    return changedUnit && sel.unit !== null && !this.reduceMotion;
  }

  private drawSelection(): void {
    this.hlFill.begin();
    this.hlRing.begin();
    this.pathBack.begin();
    this.pathDots.begin();
    const sel = this.selection;
    const pulse = this.reduceMotion ? 0 : 1;
    for (const h of sel.reachable) {
      const top = this.topAt(h);
      if (top === null) continue;
      const w = hexToWorld(h);
      this.hlFill.push(w.x, top + 0.014, w.z, 1, 1, 1, 0, C.reachable, 0, SOFT.reach, 0.5, 0);
    }
    for (const h of sel.attackable) {
      const top = this.topAt(h);
      if (top === null) continue;
      const w = hexToWorld(h);
      this.hlFill.push(w.x, top + 0.016, w.z, 1, 1, 1, 0, C.attackable, 0, SOFT.attack, 0.62, pulse);
      this.hlRing.push(w.x, top + 0.02, w.z, 1, 1, 1, 0, C.attackable, 0, SOFT.ring, 1, pulse);
    }
    this.drawPath(sel);
    if (sel.tile) {
      const top = this.topAt(sel.tile);
      if (top !== null) {
        const w = hexToWorld(sel.tile);
        this.hlRing.push(w.x, top + 0.022, w.z, 1, 1, 1, 0, C.select, 0, SOFT.ring, 1, 0);
      }
    }
    this.hlFill.end();
    this.hlRing.end();
    this.pathBack.end();
    this.pathDots.end();
  }

  /**
   * Route preview as a dashed ribbon over the tiles: three dashes per step (each half on its own
   * tile's height), a waypoint dot on every tile, a tick across the edge where a new turn starts
   * (pathTurns), and a bullseye on the destination. Starts at the selected unit when the path
   * begins next to it.
   */
  private drawPath(sel: Selection): void {
    const path = sel.path;
    if (path.length === 0) return;
    const B = this.pathBack;
    const F = this.pathDots;
    const u = sel.unit !== null ? this.state?.units[sel.unit] : undefined;
    const first = path[0];
    const fromUnit = !!u && !!first && hexDistance(u.at, first) === 1;
    const turns = sel.pathTurns;
    const n = path.length;
    for (let s = fromUnit ? -1 : 0; s < n - 1; s++) {
      const a = s < 0 ? u?.at : path[s];
      const b = path[s + 1];
      if (!a || !b) continue;
      const ta = this.topAt(a);
      const tb = this.topAt(b);
      if (ta === null || tb === null) continue;
      const wa = hexToWorld(a);
      const wb = hexToWorld(b);
      const dx = wb.x - wa.x;
      const dz = wb.z - wa.z;
      const rot = -Math.atan2(dz, dx);
      for (const t of [0.25, 0.5, 0.75]) {
        // The first dash next to the unit would sit on its base ring.
        if (s < 0 && t < 0.3) continue;
        const x = wa.x + dx * t;
        const z = wa.z + dz * t;
        // Each half rides its own tile; the middle dash (on the edge) the higher of the two.
        const y = (t < 0.5 ? ta : t > 0.5 ? tb : Math.max(ta, tb)) + 0.02;
        // Playtest: the old 0.1-wide ink keyline vanished on grass and parchment. A heavier ink
        // body (≈0.04 each side) with a narrower vellum core reads everywhere; dashes (not a
        // continuous band) keep it from looking like a border.
        B.push(x, y - 0.002, z, 0.235, 1, 0.15, rot, C.pathBack);
        F.push(x, y, z, 0.17, 1, 0.068, rot, C.path);
      }
      // Turn boundary: path index s + 1 starts a new turn.
      if (turns.includes(s + 1)) {
        const x = wa.x + dx * 0.5;
        const z = wa.z + dz * 0.5;
        const y = Math.max(ta, tb) + 0.03;
        B.push(x, y - 0.002, z, 0.1, 1, 0.38, rot, C.pathBack);
        F.push(x, y, z, 0.04, 1, 0.31, rot, C.path);
      }
    }
    for (let k = 0; k < n; k++) {
      const h = path[k];
      if (!h) continue;
      const top = this.topAt(h);
      if (top === null) continue;
      const w = hexToWorld(h);
      if (k === n - 1) {
        // Destination bullseye: ink ring, vellum ring, ink core.
        B.push(w.x, top + 0.018, w.z, 0.33, 1, 0.33, 0, C.pathBack);
        F.push(w.x, top + 0.02, w.z, 0.25, 1, 0.25, 0, C.path);
        B.push(w.x, top + 0.03, w.z, 0.13, 1, 0.13, 0, C.pathBack);
      } else {
        B.push(w.x, top + 0.018, w.z, 0.11, 1, 0.11, 0, C.pathBack);
        F.push(w.x, top + 0.02, w.z, 0.06, 1, 0.06, 0, C.path);
      }
    }
  }

  flash(hex: Hex, kind: FlashKind, now: number): void {
    const top = this.topAt(hex);
    if (top === null) return;
    let slot = this.flashes.find((f) => !f.active);
    if (!slot) {
      slot = this.flashes.reduce((a, b) => (a.start <= b.start ? a : b));
    }
    const w = hexToWorld(hex);
    const c = FLASH_COLORS[kind];
    slot.material.color.setRGB(c[0], c[1], c[2], SRGBColorSpace);
    slot.mesh.position.set(w.x, top + 0.05, w.z);
    slot.start = now;
    slot.active = true;
    slot.mesh.visible = true;
    // Juice (all skipped under reduceMotion; the ring alone still marks the event).
    if (!this.reduceMotion && this.state) {
      const i = tileIndex(hex, this.width, this.height);
      const settlement = this.state.map.tiles[i]?.settlement ?? null;
      if (kind === 'combat') {
        for (const d of this.unitDraws) if (Math.abs(d.tx - w.x) < 0.6 && Math.abs(d.tz - w.z) < 0.6) this.shakeAt.set(d.id, now);
        this.emit(w.x, top, w.z, 12, C.dust, now, 0.8, 0.24);
      } else if (kind === 'found') {
        if (settlement) {
          const b = this.bornAt.get(settlement);
          if (b === undefined || now - b > POP_MS) this.bornAt.set(settlement, now);
          // Hide the new name until the pop-in lands (drawSettlementPieces brings it back).
          this.rebuildLabels();
        }
        this.emit(w.x, top, w.z, 16, C.dust, now, 0.9, 0.26);
      } else if (kind === 'capture') {
        if (settlement) this.flourishAt.set(settlement, now);
        // Confetti in the NEW owner's colors bursts from the banner.
        const owner = settlement ? this.state.settlements[settlement]?.owner : undefined;
        const oc = owner ? ownerColors(this.state, owner) : null;
        const c1 = oc ? parseHexColor(oc.primary) : FLASH_COLORS.capture;
        const c2 = oc ? parseHexColor(oc.secondary) : C.gold;
        this.emit(w.x, top + 0.5, w.z, 10, c1, now, 0.7, 0.11, true);
        this.emit(w.x, top + 0.5, w.z, 7, c2, now + 60, 0.6, 0.09, true);
      } else if (kind === 'recruit') {
        // A famous person joins: golden sparkle and the town's standard unfurls with a flourish.
        if (settlement) this.flourishAt.set(settlement, now);
        this.emit(w.x, top + 0.1, w.z, 18, C.sparkle, now, 0.5, 0.1, true);
      } else if (kind === 'wonder') {
        // Wonder completed: a gold-leaf shimmer of motes rising over the landmark, in waves.
        if (settlement) this.flourishAt.set(settlement, now);
        this.emit(w.x - 0.3, top + 0.2, w.z + 0.2, 14, C.gold, now, 0.45, 0.12, true);
        this.emit(w.x - 0.3, top + 0.35, w.z + 0.2, 12, C.sparkle, now + 220, 0.35, 0.1, true);
        this.emit(w.x - 0.3, top + 0.5, w.z + 0.2, 10, C.gold, now + 480, 0.3, 0.085, true);
      } else if (kind === 'age') {
        this.emit(w.x, top + 0.3, w.z, 16, C.sparkle, now, 0.8, 0.07, true);
      }
    }
    this.animateFlashes(now);
  }

  private emit(x: number, y: number, z: number, count: number, color: Rgb, now: number, spread: number, size: number, rise = false): void {
    let made = 0;
    for (const p of this.particles) {
      if (made >= count) break;
      if (p.active) continue;
      const h = hashTile(Math.round(now), made, count);
      const a = unit01(h) * Math.PI * 2;
      const sp = (0.4 + unit01(h >>> 8) * 0.6) * spread;
      // Dust kicks up around the base ring (not hidden under the figure); sparkles start closer.
      const r0 = rise ? 0.12 : 0.26;
      p.x = x + Math.cos(a) * r0;
      p.y = y + 0.05;
      p.z = z + Math.sin(a) * r0;
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = rise ? 0.6 + unit01(h >>> 16) * 0.6 : 0.25 + unit01(h >>> 16) * 0.3;
      p.start = now + made * (rise ? 30 : 0);
      p.life = rise ? 1100 : 650;
      p.size = size * (0.7 + unit01(h >>> 4) * 0.6);
      p.color = color;
      p.rise = rise;
      p.active = true;
      made++;
    }
  }

  /** Returns true while a flash, particle, pop-in or flourish is still running. */
  animateFlashes(now: number): boolean {
    let any = false;
    for (const f of this.flashes) {
      if (!f.active) continue;
      const t = (now - f.start) / FLASH_MS;
      if (t >= 1) {
        f.active = false;
        f.mesh.visible = false;
        continue;
      }
      any = true;
      const s = this.reduceMotion ? 1 : 0.62 + 0.55 * easeOut(t);
      f.mesh.scale.set(s, 1, s);
      f.material.opacity = this.reduceMotion ? (t < 0.6 ? 0.85 : 0) : 0.95 * (1 - t) * (1 - t);
    }
    // Particles.
    this.puffs.begin();
    for (const p of this.particles) {
      if (!p.active) continue;
      const t = (now - p.start) / p.life;
      if (t >= 1) {
        p.active = false;
        continue;
      }
      any = true;
      if (t < 0) continue;
      const sec = (t * p.life) / 1000;
      const x = p.x + p.vx * sec;
      const z = p.z + p.vz * sec;
      const y = p.y + p.vy * sec - (p.rise ? 0 : sec * sec * 0.6);
      const s = p.size * (p.rise ? 1 - t * 0.6 : 1 + t * 1.6);
      this.puffs.push(x, y, z, s, s, s, t * 3, p.color, 0, (1 - t) * (p.rise ? 1 : 0.7));
    }
    this.puffs.end();
    if (this.bornAt.size > 0 || this.flourishAt.size > 0) {
      if (this.drawSettlementPieces(now)) any = true;
    }
    if (this.shakeAt.size > 0) {
      if (this.drawUnits(now)) any = true;
    }
    return any;
  }

  // -------------------------------------------------------------------------------------------

  /** Re-upload every buffer after a WebGL context restore. */
  touchAll(): void {
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        for (const a of Object.values(m.geometry.attributes)) a.needsUpdate = true;
        if (m.geometry.index) m.geometry.index.needsUpdate = true;
      }
    });
    for (const l of this.allInstances()) l.touch();
    this.borders.touch();
    this.uniforms.uDetail.value.needsUpdate = true;
    this.uniforms.uMapField.value.needsUpdate = true;
    this.labels.clearCache();
    this.labels.touch();
    this.labelsDirty = true;
  }

  /** Re-apply the last snapshot (used after context restore). */
  get lastState(): GameState | null {
    return this.state;
  }

  /** Forget fog-of-war memory (new game). */
  resetMemory(): void {
    this.ghostMemory.clear();
    this.knownSettlements = null;
    this.bornAt.clear();
  }

  dispose(): void {
    for (const l of this.allInstances()) l.dispose();
    this.borders.dispose();
    this.labels.dispose();
    for (const f of this.flashes) this.root.remove(f.mesh);
    this.base.remove(this.plinth, this.plinthTop);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.uniforms.uDetail.value.dispose();
    this.uniforms.uMapField.value.dispose();
    this.ghostMemory.clear();
  }

  private allInstances(): Instances[] {
    return [
      this.land,
      this.water,
      this.parchment,
      this.riverRibbons,
      this.riverNodes,
      this.territoryFill,
      this.staticShadows,
      this.resourceHalos,
      this.hlFill,
      this.hlRing,
      this.pathBack,
      this.pathDots,
      this.tradeDots,
      this.wisps,
      this.birds,
      this.boats,
      ...this.mountains,
      this.hills,
      this.conifers,
      this.broadleaf,
      this.jungle,
      this.palms,
      this.rocks,
      this.tufts,
      this.reeds,
      this.drifts,
      this.dunes,
      this.siteStakes,
      this.flowers,
      ...RESOURCE_PROPS.map((k) => this.resourceProps[k]),
      ...RESOURCE_CLASSES.map((c) => this.resourceMarkers[c]),
      ...PIECE_KINDS.map((k) => this.pieces[k]),
      this.warRings,
      ...FIGURES.map((k) => this.figures[k]),
      this.unitBases,
      this.unitRims,
      this.goldRings,
      this.unitGlow,
      this.unitShadows,
      this.readyMarks,
      this.shields,
      this.hpBack,
      this.hpFront,
      this.puffs,
      this.cityIcons,
      this.csIcons,
      this.unitDots,
    ];
  }

  private mat<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }
}

/** Debug: the background/clear color the board sits on (renderer uses it). */
export const BOARD_CLEAR = new Color(PALETTE.background);
