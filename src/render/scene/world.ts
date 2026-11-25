/**
 * All map content as instanced layers: tiles, water, rivers, features, resources, territory,
 * settlements (incl. fog-of-war ghosts), units, labels, highlights, trade routes, strategic
 * icons and event flashes.
 *
 * Update model: `update()` refills every layer from a snapshot (O(tiles + entities), a few ms
 * at most, and only on new snapshots). GPU buffers are allocated once per map size and grow
 * only if entity counts outgrow them. `drawUnits()` is the only per-frame pass and it runs
 * only while unit moves, the selection pulse or rotation are animating.
 */
import {
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type BufferGeometry,
  type Camera,
  type Material,
  type PerspectiveCamera,
} from 'three';
import { AGES, UNIT_CLASSES, type ContentBundle, type UnitClass } from '@contracts/content-schemas';
import type { Hex } from '@contracts/hex';
import { CITY_STATE_PREFIX, RAIDER_PLAYER, warKey, type GameState, type PlayerId, type Settlement, type SettlementId, type UnitId } from '@contracts/sim-api';
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
  tileTopColor,
  type FogClass,
  type Rgb,
} from '../colors';
import { BASE_Y, FOG_TOP, MOUNTAIN_PEAK, tileTop } from '../heights';
import { hexToWorld, mapBounds, tileIndex, worldToHex } from '../layout';
import { labelSpec, wallFraction } from '../labels';
import type { ZoomBand } from '../camera-math';
import { EDGE_ROTATION, computeBorderEdges, createEdgeList } from '../borders';
import { computeRiverSegments, type RiverSegment } from '../rivers';
import { GhostMemory, type GhostSettlement } from '../ghosts';
import { patternFor } from '../patterns';
import { RESOURCE_CLASS_STYLE, gradeTerrainColors, resourceClassOf, type ResourceClass } from '../terrain-style';
import {
  TILE_RADIUS,
  UNIT_HEAD_Y,
  baseRingGeometry,
  borderBandGeometry,
  boxGeometry,
  broadleafGeometry,
  coneGeometry,
  discGeometry,
  headGeometry,
  hexFlatGeometry,
  hexRingGeometry,
  hexSideGeometry,
  hexTopGeometry,
  hillMoundGeometry,
  readyMarkerGeometry,
  resourceShapeGeometry,
  ribbonGeometry,
  roofGeometry,
  shieldGeometry,
  starGeometry,
  towerGeometry,
  unitBodyGeometry,
  wallGeometry,
} from './geometry';
import { Instances } from './instances';
import { LabelLayer } from './label-layer';
import { borderPatternMaterial, createPatternUniforms, flagPatternMaterial, type PatternUniforms } from './pattern-material';

export interface Selection {
  unit: UnitId | null;
  tile: Hex | null;
  reachable: Hex[];
  attackable: Hex[];
  path: Hex[];
}

export type FlashKind = 'combat' | 'found' | 'capture' | 'recruit';

/** GDD §7: "One military unit per tile, 100 HP." */
const UNIT_MAX_HP = 100;
const MOVE_MS = 200;
const FLASH_MS = 700;
const FLASH_POOL = 6;
const BEVEL_DROP = 0.045;
/** Figurines read better a bit larger than their geometry's nominal size. */
const UNIT_SCALE = 1.45;
/** Selected-unit ring pulses this long after a selection change, then rests (battery). */
const PULSE_MS = 1800;

// Border bands (hex radii; they stay on the flat part of the top, inside the bevel).
const BAND_OUTER = 0.9;
const KEY_INNER = 0.735;
const PRIMARY_OUTER = 0.885;
const PRIMARY_INNER = 0.75;
const SECONDARY_INNER = 0.695;
const COS30 = Math.cos(Math.PI / 6);

const RIVER_WIDTH = 0.2;
/** Distance between trade-route dots (world units). */
const TRADE_DOT_STEP = 0.42;

const rgb = (hex: string): Rgb => parseHexColor(hex);
const C = {
  parchmentSide: rgb(PALETTE.parchmentSide),
  soil: rgb(PALETTE.soil),
  waterSide: rgb(PALETTE.waterSide),
  forest: rgb(PALETTE.forest),
  jungle: rgb(PALETTE.jungle),
  marsh: rgb(PALETTE.marsh),
  oasis: rgb(PALETTE.oasis),
  hills: rgb(PALETTE.hills),
  snowCap: rgb(PALETTE.snowCap),
  houseWall: rgb(PALETTE.houseWall),
  gold: rgb(PALETTE.gold),
  hpBack: rgb(PALETTE.hpBack),
  hpGood: rgb(PALETTE.hpGood),
  hpMid: rgb(PALETTE.hpMid),
  hpLow: rgb(PALETTE.hpLow),
  select: rgb(PALETTE.select),
  selectUnit: rgb(PALETTE.selectUnit),
  reachable: rgb(PALETTE.reachable),
  reachableRing: rgb(PALETTE.reachableRing),
  attackable: rgb(PALETTE.attackable),
  path: rgb(PALETTE.path),
  pathBack: rgb(PALETTE.pathBack),
  river: rgb(PALETTE.riverRibbon),
  keyline: rgb(PALETTE.borderKeyline),
  ownRim: rgb(PALETTE.ownRim),
  rivalRim: rgb(PALETTE.rivalRim),
  warRim: rgb(PALETTE.warRim),
  ready: rgb(PALETTE.ready),
  shield: rgb(PALETTE.shield),
  wallStone: rgb(PALETTE.wallStone),
  wallDamaged: rgb(PALETTE.wallDamaged),
  badge: rgb(PALETTE.resourceBadge),
  trade: rgb(PALETTE.tradeRoute),
  white: [1, 1, 1] as Rgb,
};
const FLASH_COLORS: Record<FlashKind, Rgb> = {
  combat: rgb('#e0453a'),
  found: rgb('#f2c14e'),
  capture: rgb('#8e5bd6'),
  recruit: rgb('#ffe9a8'),
};
const RESOURCE_CLASSES: readonly ResourceClass[] = ['bonus', 'luxury', 'strategic'];
const RESOURCE_RGB: Record<ResourceClass, Rgb> = {
  bonus: rgb(RESOURCE_CLASS_STYLE.bonus.color),
  luxury: rgb(RESOURCE_CLASS_STYLE.luxury.color),
  strategic: rgb(RESOURCE_CLASS_STYLE.strategic.color),
};

/** How each map feature id is drawn. Unknown feature ids get a small neutral disc. */
type FeatureStyle =
  | { kind: 'cones'; color: Rgb; count: number }
  | { kind: 'broadleaf'; color: Rgb; count: number }
  | { kind: 'disc'; color: Rgb }
  | { kind: 'mounds' };
const FEATURE_STYLE: Record<string, FeatureStyle> = {
  forest: { kind: 'cones', color: C.forest, count: 3 },
  jungle: { kind: 'broadleaf', color: C.jungle, count: 4 },
  marsh: { kind: 'disc', color: C.marsh },
  oasis: { kind: 'disc', color: C.oasis },
  hills: { kind: 'mounds' }, // also raised (heights.ts)
};
const CONE_OFFSETS: readonly [number, number, number][] = [
  [-0.3, -0.2, 1],
  [0.28, -0.12, 0.85],
  [-0.02, 0.32, 0.95],
  [0.34, 0.3, 0.75],
];

interface UnitDraw {
  id: UnitId;
  cls: UnitClass;
  primary: Rgb;
  secondary: Rgb;
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
  /** Draw scale relative to a lone unit (a civilian sharing a tile is drawn smaller). */
  scale: number;
}

interface FlashSlot {
  mesh: Mesh;
  material: MeshBasicMaterial;
  start: number;
  active: boolean;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

export interface WorldOptions {
  reduceMotion: boolean;
  patterns: boolean;
}

export class World {
  readonly root = new Group();
  private readonly base = new Group();
  private readonly detail = new Group();
  private readonly strategic = new Group();

  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly reduceMotion: boolean;
  private readonly patternUniforms: PatternUniforms;
  private patternsOn: boolean;

  // Map caches (refilled on every update; reallocated when size changes).
  private width = 0;
  private height = 0;
  private fog = new Uint8Array(0);
  private shownTop = new Float32Array(0);
  private tileX = new Float32Array(0);
  private tileZ = new Float32Array(0);
  private owners: (PlayerId | null)[] = [];
  private waterTile = new Uint8Array(0);
  private riverTiles: GameState['map']['tiles'] | null = null;
  private riverSegs: RiverSegment[] = [];
  private readonly edges = createEdgeList(512);
  private readonly ghostMemory = new GhostMemory();

  private terrainColor = new Map<string, Rgb>();
  private readonly terrainWater = new Map<string, boolean>();
  private readonly terrainMountain = new Map<string, boolean>();
  private readonly resourceAge = new Map<string, number>();
  private readonly resourceClass = new Map<string, ResourceClass>();

  // Layers
  private readonly tops: Instances;
  private readonly waterTops: Instances;
  private readonly sides: Instances;
  private readonly riverRibbons: Instances;
  private readonly riverNodes: Instances;
  private readonly peaks: Instances;
  private readonly snow: Instances;
  private readonly mounds: Instances;
  private readonly cones: Instances;
  private readonly broadleaf: Instances;
  private readonly discs: Instances;
  private readonly resourceShapes: Record<ResourceClass, Instances>;
  private readonly resourceBadges: Instances;
  private readonly borderKey: Instances;
  private readonly borderPrimary: Instances;
  private readonly borderSecondary: Instances;
  private readonly territoryFill: Instances;
  private readonly houses: Instances;
  private readonly roofs: Instances;
  private readonly keeps: Instances;
  private readonly towers: Instances;
  private readonly walls: Instances;
  private readonly tents: Instances;
  private readonly poles: Instances;
  private readonly flags: Instances;
  private readonly stars: Instances;
  private readonly warRings: Instances;
  private readonly tradeDots: Instances;
  private readonly unitBodies: Record<UnitClass, Instances>;
  private readonly heads: Instances;
  private readonly unitBases: Instances;
  private readonly unitRims: Instances;
  private readonly goldRings: Instances;
  private readonly unitSelect: Instances;
  private readonly readyMarks: Instances;
  private readonly shields: Instances;
  private readonly hpBack: Instances;
  private readonly hpFront: Instances;
  private readonly hlFill: Instances;
  private readonly hlRing: Instances;
  private readonly hlEdge: Instances;
  private readonly pathBack: Instances;
  private readonly pathDots: Instances;
  private readonly cityIcons: Instances;
  private readonly csIcons: Instances;
  private readonly unitDots: Instances;
  /** Strategic icons grow with zoom so they stay readable (GDD §11 "flat icons"). */
  private iconScale = 1;
  /** Units and resource markers grow a little at regional zoom so silhouettes stay readable. */
  private propScale = 1;
  private cityIconList: { x: number; y: number; z: number; size: number; color: Rgb; capital: boolean; cs: boolean }[] = [];
  private resourceList: { x: number; y: number; z: number; cls: ResourceClass; spin: number; color: Rgb; badge: Rgb }[] = [];
  private readonly labels: LabelLayer;
  private labelsDirty = true;
  private readonly flashes: FlashSlot[] = [];
  private readonly flashGeometry: BufferGeometry;
  /** Dark floor under the prisms so the hairline seams between tiles never show the sky color. */
  private readonly floor: Mesh;

  private unitDraws: UnitDraw[] = [];
  private readonly displayed = new Map<UnitId, { x: number; y: number; z: number; heading: number }>();
  private selection: Selection = { unit: null, tile: null, reachable: [], attackable: [], path: [] };
  private selectedAt = -Infinity;
  private ready = new Set<UnitId>();
  private state: GameState | null = null;
  private viewer: PlayerId | null = null;
  private yaw = 0;

  constructor(content: ContentBundle, options: WorldOptions) {
    this.reduceMotion = options.reduceMotion;
    this.patternsOn = options.patterns;
    this.patternUniforms = createPatternUniforms(options.patterns);
    this.root.add(this.base, this.detail, this.strategic);
    this.strategic.visible = false;
    this.setContent(content);

    const lit = this.mat(new MeshLambertMaterial({ flatShading: true }));
    const unlit = this.mat(new MeshBasicMaterial());
    const overlay = this.mat(
      new MeshBasicMaterial({ transparent: true, opacity: 0.13, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    const highlight = this.mat(
      new MeshBasicMaterial({ transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    const decal = (factor: number): MeshBasicMaterial =>
      this.mat(new MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: factor }));
    const borderPrimaryMat = this.mat(
      borderPatternMaterial(this.patternUniforms, PRIMARY_OUTER * COS30, PRIMARY_INNER * COS30, {
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    const flagMat = this.mat(flagPatternMaterial(this.patternUniforms, 0.2, 0.12));

    const g = <T extends BufferGeometry>(geo: T): T => {
      this.geometries.push(geo);
      return geo;
    };
    const B = this.base;
    const D = this.detail;
    const S = this.strategic;
    const cap = 2048;
    this.tops = new Instances(g(hexTopGeometry()), lit, cap, B, 'tile-tops');
    // Water is one seamless flat sheet (no bevels or seams): reads as water, not as land prisms.
    this.waterTops = new Instances(g(hexFlatGeometry(1.0)), lit, cap, B, 'water-tops');
    this.sides = new Instances(g(hexSideGeometry()), lit, cap, B, 'tile-sides');
    this.territoryFill = new Instances(g(hexFlatGeometry(TILE_RADIUS - 0.02)), overlay, 256, B, 'territory-fill', 2);
    this.riverRibbons = new Instances(g(ribbonGeometry(RIVER_WIDTH)), decal(-1), 256, B, 'river-ribbons', 1);
    this.riverNodes = new Instances(g(discGeometry(RIVER_WIDTH / 2, 0.001, 10)), decal(-1), 256, B, 'river-nodes', 1);
    this.borderKey = new Instances(g(borderBandGeometry(BAND_OUTER, KEY_INNER)), decal(-3), 512, B, 'border-keyline', 3);
    this.borderPrimary = new Instances(
      g(borderBandGeometry(PRIMARY_OUTER, PRIMARY_INNER)),
      borderPrimaryMat,
      512,
      B,
      'border-primary',
      4,
      'aPattern',
    );
    this.borderSecondary = new Instances(g(borderBandGeometry(KEY_INNER, SECONDARY_INNER)), decal(-3), 512, B, 'border-secondary', 3);
    this.hlFill = new Instances(g(hexFlatGeometry(0.8)), highlight, 64, B, 'hl-fill', 5);
    this.hlEdge = new Instances(g(hexRingGeometry(0.8, 0.88)), decal(-5), 64, B, 'hl-edge', 6);
    this.hlRing = new Instances(g(hexRingGeometry(0.78, 0.95)), decal(-6), 32, B, 'hl-ring', 6);
    this.warRings = new Instances(g(hexRingGeometry(0.9, 1.0)), decal(-5), 32, B, 'war-rings', 6);
    this.pathBack = new Instances(g(discGeometry(0.13, 0.03, 12)), unlit, 32, B, 'path-back', 6);
    this.pathDots = new Instances(g(discGeometry(0.09, 0.035, 12)), unlit, 32, B, 'path-dots', 7);
    this.tradeDots = new Instances(g(discGeometry(0.06, 0.03, 8)), unlit, 128, B, 'trade-dots', 6);

    this.peaks = new Instances(g(coneGeometry(0.7, MOUNTAIN_PEAK, 6)), lit, 128, D, 'peaks');
    this.snow = new Instances(g(coneGeometry(0.7 * 0.36, MOUNTAIN_PEAK * 0.36, 6)), lit, 128, D, 'snow');
    this.mounds = new Instances(g(hillMoundGeometry()), lit, 256, D, 'hill-mounds');
    this.cones = new Instances(g(coneGeometry(0.17, 0.42, 6)), lit, 1024, D, 'tree-cones');
    this.broadleaf = new Instances(g(broadleafGeometry()), lit, 512, D, 'broadleaf');
    this.discs = new Instances(g(discGeometry(0.36, 0.03, 10)), lit, 128, D, 'feature-discs');
    const shapes: Partial<Record<ResourceClass, Instances>> = {};
    for (const cls of RESOURCE_CLASSES) {
      shapes[cls] = new Instances(g(resourceShapeGeometry(cls)), lit, 128, D, `resources-${cls}`);
    }
    this.resourceShapes = shapes as Record<ResourceClass, Instances>;
    this.resourceBadges = new Instances(g(discGeometry(0.16, 0.025, 14)), unlit, 256, D, 'resource-badges');
    this.houses = new Instances(g(boxGeometry(0.17, 0.15, 0.17)), lit, 256, D, 'houses');
    this.roofs = new Instances(g(roofGeometry()), lit, 256, D, 'roofs');
    this.keeps = new Instances(g(boxGeometry(0.26, 0.48, 0.26)), lit, 64, D, 'keeps');
    this.towers = new Instances(g(towerGeometry()), lit, 32, D, 'cs-towers');
    this.walls = new Instances(g(wallGeometry(0.66, 0.09)), lit, 64, D, 'walls');
    this.tents = new Instances(g(coneGeometry(0.16, 0.28, 6)), lit, 128, D, 'tents');
    this.poles = new Instances(g(discGeometry(0.018, 0.75, 5)), lit, 128, D, 'poles');
    this.flags = new Instances(g(boxGeometry(0.2, 0.12, 0.015)), flagMat, 128, D, 'flags', 0, 'aPattern');
    this.stars = new Instances(g(starGeometry()), lit, 32, D, 'capital-stars');
    const bodies: Partial<Record<UnitClass, Instances>> = {};
    for (const cls of UNIT_CLASSES) {
      bodies[cls] = new Instances(g(unitBodyGeometry(cls)), lit, 64, D, `units-${cls}`);
    }
    this.unitBodies = bodies as Record<UnitClass, Instances>;
    this.heads = new Instances(g(headGeometry()), lit, 128, D, 'unit-heads');
    this.unitBases = new Instances(g(discGeometry(0.2, 0.035, 14)), lit, 128, D, 'unit-bases');
    this.unitRims = new Instances(g(baseRingGeometry(0.205, 0.022)), unlit, 128, D, 'unit-rims');
    this.goldRings = new Instances(g(baseRingGeometry(0.27, 0.04)), unlit, 32, D, 'gold-rings');
    this.unitSelect = new Instances(g(baseRingGeometry(0.33, 0.035)), unlit, 4, D, 'unit-select');
    this.readyMarks = new Instances(g(readyMarkerGeometry()), unlit, 64, D, 'ready-marks');
    this.shields = new Instances(g(shieldGeometry()), lit, 64, D, 'fortify-shields');
    this.hpBack = new Instances(g(boxGeometry(0.5, 0.085, 0.02)), unlit, 64, D, 'hp-back');
    this.hpFront = new Instances(g(boxGeometry(0.46, 0.055, 0.03)), unlit, 64, D, 'hp-front');
    this.labels = new LabelLayer(D);

    this.cityIcons = new Instances(g(discGeometry(0.72, 0.08, 20)), unlit, 64, S, 'city-icons');
    this.csIcons = new Instances(g(discGeometry(0.72, 0.08, 6)), unlit, 32, S, 'cs-icons');
    this.unitDots = new Instances(g(discGeometry(0.3, 0.06, 10)), unlit, 256, S, 'unit-dots');

    const floorGeo = g(new PlaneGeometry(1, 1));
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = this.mat(new MeshBasicMaterial({ color: new Color(PALETTE.soil).multiplyScalar(0.55) }));
    this.floor = new Mesh(floorGeo, floorMat);
    this.floor.visible = false;
    this.base.add(this.floor);

    this.flashGeometry = g(hexRingGeometry(0.55, 0.95));
    for (let i = 0; i < FLASH_POOL; i++) {
      const material = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
      this.materials.push(material);
      const mesh = new Mesh(this.flashGeometry, material);
      mesh.visible = false;
      mesh.renderOrder = 50;
      this.root.add(mesh);
      this.flashes.push({ mesh, material, start: 0, active: false });
    }
  }

  setContent(content: ContentBundle): void {
    this.terrainWater.clear();
    this.terrainMountain.clear();
    for (const t of content.terrain) {
      this.terrainWater.set(t.id, t.water);
      // Data-driven: impassable dry land is drawn as a mountain (no hard-coded terrain id).
      this.terrainMountain.set(t.id, !t.water && t.moveCost === null);
    }
    this.terrainColor = gradeTerrainColors(content.terrain.map((t) => ({ id: t.id, color: t.color, water: t.water })));
    this.resourceAge.clear();
    this.resourceClass.clear();
    for (const r of content.resources) {
      this.resourceAge.set(r.id, AGES.indexOf(r.revealAge));
      this.resourceClass.set(r.id, resourceClassOf(r.class));
    }
  }

  setBand(band: ZoomBand): void {
    const strategic = band === 'strategic';
    this.detail.visible = !strategic;
    this.strategic.visible = strategic;
  }

  setYaw(yaw: number): void {
    this.yaw = yaw;
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

  /** Height of the drawn top of a hex, or null when it's off the map (for picking/focus). */
  topAt(h: Hex): number | null {
    const i = tileIndex(h, this.width, this.height);
    if (i < 0) return null;
    return this.shownTop[i] ?? 0;
  }

  // -------------------------------------------------------------------------------------------
  // Snapshot update
  // -------------------------------------------------------------------------------------------

  update(state: GameState, viewer: PlayerId | null, visible: readonly number[], now: number): void {
    this.state = state;
    this.viewer = viewer;
    const { width, height, tiles } = state.map;
    const n = width * height;
    if (width !== this.width || height !== this.height || this.fog.length !== n) {
      this.width = width;
      this.height = height;
      this.fog = new Uint8Array(n);
      this.shownTop = new Float32Array(n);
      this.tileX = new Float32Array(n);
      this.tileZ = new Float32Array(n);
      this.waterTile = new Uint8Array(n);
      this.owners = new Array<PlayerId | null>(n).fill(null);
      const b = mapBounds(width, height);
      this.floor.scale.set(b.maxX - b.minX + 1.6, 1, b.maxZ - b.minZ + 1.6);
      this.floor.position.set((b.minX + b.maxX) / 2, BASE_Y + 0.02, (b.minZ + b.maxZ) / 2);
      this.floor.visible = n > 0;
      this.riverTiles = null;
    }
    const viewerState = viewer !== null ? state.players[viewer] : undefined;
    classifyFog(n, viewer === null ? null : (viewerState?.explored ?? []), visible, this.fog);
    const ageIdx = AGES.indexOf(state.age);

    this.tops.begin();
    this.waterTops.begin();
    this.sides.begin();
    this.peaks.begin();
    this.snow.begin();
    this.mounds.begin();
    this.cones.begin();
    this.broadleaf.begin();
    this.discs.begin();
    this.resourceList = [];

    const parchSide = C.parchmentSide;
    for (let i = 0; i < n; i++) {
      const tile = tiles[i];
      if (!tile) continue;
      const w = hexToWorld(tile);
      this.tileX[i] = w.x;
      this.tileZ[i] = w.z;
      this.owners[i] = tile.owner;
      const fog = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
      const isWater = this.terrainWater.get(tile.terrain) ?? false;
      this.waterTile[i] = isWater ? 1 : 0;
      const isMountain = this.terrainMountain.get(tile.terrain) ?? false;
      const top = fog === FOG_UNEXPLORED ? FOG_TOP : tileTop(tile, { isWater, isMountain });
      this.shownTop[i] = top;
      const tColor = this.terrainColor.get(tile.terrain) ?? [0.6, 0.6, 0.6];
      const topColor = tileTopColor(tColor, tile.river, fog, isWater);
      if (isWater && fog !== FOG_UNEXPLORED) this.waterTops.push(w.x, top, w.z, 1, 1, 1, 0, topColor);
      else this.tops.push(w.x, top, w.z, 1, 1, 1, 0, topColor);
      const sideTop = isWater && fog !== FOG_UNEXPLORED ? top : top - BEVEL_DROP;
      const sideColor = fog === FOG_UNEXPLORED ? parchSide : propColor(isWater ? C.waterSide : C.soil, fog);
      this.sides.push(w.x, sideTop, w.z, 1, sideTop - BASE_Y, 1, 0, sideColor);
      if (fog === FOG_UNEXPLORED) continue;

      // Props get a deterministic per-tile jitter so forests don't look stamped.
      const jit = hashString(`${tile.q},${tile.r}`);
      const spin = ((jit % 360) * Math.PI) / 180;
      if (isMountain) {
        const peakCol = propColor(mix(tColor, [0.36, 0.34, 0.33], 0.3), fog);
        const s = 0.9 + ((jit >> 9) % 20) / 100;
        this.peaks.push(w.x, top, w.z, s, s, s, spin, peakCol);
        this.snow.push(w.x, top + MOUNTAIN_PEAK * s * 0.64, w.z, s, s, s, spin, propColor(C.snowCap, fog));
      }
      if (tile.feature) {
        const style = FEATURE_STYLE[tile.feature] ?? { kind: 'disc', color: C.hills };
        if (style.kind === 'cones' || style.kind === 'broadleaf') {
          const layer = style.kind === 'cones' ? this.cones : this.broadleaf;
          const col = propColor(style.color, fog);
          const c = Math.cos(spin);
          const s = Math.sin(spin);
          for (let k = 0; k < style.count; k++) {
            const o = CONE_OFFSETS[k % CONE_OFFSETS.length];
            if (!o) continue;
            const ox = o[0] * c - o[1] * s;
            const oz = o[0] * s + o[1] * c;
            layer.push(w.x + ox, top, w.z + oz, o[2], o[2], o[2], spin * (k + 1), col);
          }
        } else if (style.kind === 'disc') {
          this.discs.push(w.x - 0.1, top, w.z + 0.15, 1, 1, 1, spin, propColor(style.color, fog));
        } else if (style.kind === 'mounds') {
          // Mounds a shade darker than the ground so the bumps catch light against it.
          const col = propColor(mix(tColor, [0.3, 0.27, 0.2], 0.22), fog);
          this.mounds.push(w.x, top - 0.02, w.z, 1.15, 1.25, 1.15, spin, col);
        }
      }
      if (tile.resource) {
        const revealAge = this.resourceAge.get(tile.resource) ?? 0;
        if (revealAge <= ageIdx) {
          const cls = this.resourceClass.get(tile.resource) ?? 'bonus';
          this.resourceList.push({
            x: w.x + 0.4,
            y: top,
            z: w.z - 0.34,
            cls,
            spin,
            color: propColor(RESOURCE_RGB[cls], fog),
            badge: propColor(C.badge, fog),
          });
        }
      }
    }
    this.tops.end();
    this.waterTops.end();
    this.sides.end();
    this.peaks.end();
    this.snow.end();
    this.mounds.end();
    this.cones.end();
    this.broadleaf.end();
    this.discs.end();
    this.drawResources();

    this.updateRivers(state);
    this.updateTerritory(state);
    this.updateSettlements(state, viewer);
    this.updateTradeRoutes(state, viewer);
    this.prepareUnits(state, viewer, now);
    this.drawUnits(now);
    this.drawSelection();
  }

  private drawResources(): void {
    for (const cls of RESOURCE_CLASSES) this.resourceShapes[cls].begin();
    this.resourceBadges.begin();
    const k = this.propScale;
    for (const r of this.resourceList) {
      this.resourceBadges.push(r.x, r.y + 0.004, r.z, k, 1, k, 0, r.badge);
      this.resourceShapes[r.cls].push(r.x, r.y + 0.03, r.z, k, k, k, r.cls === 'bonus' ? 0 : r.spin, r.color);
    }
    for (const cls of RESOURCE_CLASSES) this.resourceShapes[cls].end();
    this.resourceBadges.end();
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
      const col = propColor(C.river, fa);
      const ay = (this.shownTop[seg.a] ?? 0) + 0.006;
      // Each half sits on its own tile's top (a hill's half stays on the hill); a mouth runs a
      // little past the shore so it visibly meets the water.
      this.riverRibbons.push(ax, ay, az, half * (seg.mouth ? 1.12 : 1.01), 1, 1, rot, col);
      if (!seg.mouth && fb !== FOG_UNEXPLORED) {
        const by = (this.shownTop[seg.b] ?? 0) + 0.006;
        this.riverRibbons.push(bx, by, bz, half * 1.01, 1, 1, rot + Math.PI, propColor(C.river, fb));
      }
    }
    const tiles = state.map.tiles;
    const n = width * height;
    for (let i = 0; i < n; i++) {
      if (!tiles[i]?.river || this.waterTile[i]) continue;
      const f = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
      if (f === FOG_UNEXPLORED) continue;
      this.riverNodes.push(this.tileX[i] ?? 0, (this.shownTop[i] ?? 0) + 0.006, this.tileZ[i] ?? 0, 1, 1, 1, 0, propColor(C.river, f));
    }
    this.riverRibbons.end();
    this.riverNodes.end();
  }

  private updateTerritory(state: GameState): void {
    this.territoryFill.begin();
    this.borderKey.begin();
    this.borderPrimary.begin();
    this.borderSecondary.begin();
    const { width, height } = this;
    const n = width * height;
    const order = state.playerOrder;
    for (let i = 0; i < n; i++) {
      const owner = this.owners[i] ?? null;
      const fog = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
      if (owner === null || fog === FOG_UNEXPLORED) continue;
      const col = propColor(parseHexColor(ownerColors(state, owner).primary), fog);
      this.territoryFill.push(this.tileX[i] ?? 0, (this.shownTop[i] ?? 0) + 0.008, this.tileZ[i] ?? 0, 1, 1, 1, 0, col);
    }
    const edges = computeBorderEdges(this.owners, width, height, (i) => this.fog[i] !== FOG_UNEXPLORED, this.edges);
    let lastOwner: string | null = null;
    let primary: Rgb = C.keyline;
    let secondary: Rgb = C.keyline;
    let pattern = 0;
    for (let k = 0; k < edges.count; k++) {
      const i = edges.tile[k] ?? 0;
      const d = edges.dir[k] ?? 0;
      const owner = this.owners[i] ?? null;
      if (owner === null) continue;
      if (owner !== lastOwner) {
        const oc = ownerColors(state, owner);
        primary = parseHexColor(oc.primary);
        secondary = parseHexColor(oc.secondary);
        pattern = patternFor(owner, order);
        lastOwner = owner;
      }
      const fog = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
      const x = this.tileX[i] ?? 0;
      const z = this.tileZ[i] ?? 0;
      const top = (this.shownTop[i] ?? 0) + 0.01;
      const rot = EDGE_ROTATION[d] ?? 0;
      this.borderKey.push(x, top, z, 1, 1, 1, rot, propColor(C.keyline, fog));
      this.borderPrimary.push(x, top + 0.002, z, 1, 1, 1, rot, propColor(primary, fog), pattern);
      this.borderSecondary.push(x, top + 0.001, z, 1, 1, 1, rot, propColor(secondary, fog));
    }
    this.territoryFill.end();
    this.borderKey.end();
    this.borderPrimary.end();
    this.borderSecondary.end();
  }

  private atWarWithViewer(state: GameState, owner: PlayerId): boolean {
    const v = this.viewer;
    if (v === null || owner === v) return false;
    if (owner === RAIDER_PLAYER) return true;
    return state.wars[warKey(v, owner)] !== undefined;
  }

  private updateSettlements(state: GameState, viewer: PlayerId | null): void {
    const L = [this.houses, this.roofs, this.keeps, this.towers, this.walls, this.tents, this.poles, this.flags, this.stars];
    this.cityIconList = [];
    for (const l of L) l.begin();
    this.warRings.begin();
    this.labels.begin();
    const ids = Object.keys(state.settlements).sort();
    const shown: { tile: number; s: Settlement }[] = [];
    for (const id of ids) {
      const s = state.settlements[id];
      if (!s) continue;
      const i = tileIndex(s.at, this.width, this.height);
      if (i < 0) continue;
      shown.push({ tile: i, s });
    }
    // Fog-of-war memory: remember what we see, ghost what we saw.
    this.ghostMemory.update(`${state.seed}|${viewer ?? '*'}|${this.width}x${this.height}`, state.turn, viewer, shown, this.fog);
    const occupied = new Set<number>();
    for (const { tile: i, s } of shown) {
      const fog = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
      // Own settlements always show; others only while the tile is in sight.
      if (viewer !== null && s.owner !== viewer && fog !== FOG_VISIBLE) continue;
      occupied.add(i);
      this.placeSettlement(state, s, i, fog, false);
    }
    for (const { tile, g } of this.ghostMemory.ghosts(this.fog)) {
      if (occupied.has(tile)) continue;
      this.placeSettlement(state, g, tile, FOG_EXPLORED, true);
    }
    for (const l of L) l.end();
    this.warRings.end();
    this.labels.end();
    this.labelsDirty = true;
    this.drawCityIcons();
  }

  private placeSettlement(state: GameState, s: GhostSettlement, i: number, fog: FogClass, ghost: boolean): void {
    const colors = ownerColors(state, s.owner);
    const primary = parseHexColor(colors.primary);
    const secondary = parseHexColor(colors.secondary);
    const x = this.tileX[i] ?? 0;
    const z = this.tileZ[i] ?? 0;
    const y = this.shownTop[i] ?? 0;
    const cs = s.owner.startsWith(CITY_STATE_PREFIX);
    const war = !ghost && this.atWarWithViewer(state, s.owner);
    const pattern = patternFor(s.owner, state.playerOrder);
    const damage = s.maxHp > 0 ? clamp01(1 - s.hp / s.maxHp) : 0;
    this.drawSettlement(s.id, s.kind, s.population, s.isCapital, cs, damage, x, y, z, primary, secondary, fog, pattern);
    if (war) this.warRings.push(x, y + 0.02, z, 1, 1, 1, 0, C.warRim);
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
    this.labels.push(spec, x, y + (s.kind === 'city' || cs ? 0.95 : 0.72), z, priority);
  }

  private drawCityIcons(): void {
    this.cityIcons.begin();
    this.csIcons.begin();
    const k = this.iconScale;
    for (const c of this.cityIconList) {
      const layer = c.cs ? this.csIcons : this.cityIcons;
      // Capitals get a gold rim, city-states a white one: a slightly larger disc underneath.
      if (c.capital) layer.push(c.x, c.y, c.z, c.size * k * 1.24, 1, c.size * k * 1.24, 0, C.gold);
      else layer.push(c.x, c.y, c.z, c.size * k * 1.14, 1, c.size * k * 1.14, 0, c.cs ? C.white : C.keyline);
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

  private drawSettlement(
    id: SettlementId,
    kind: 'town' | 'city',
    pop: number,
    capital: boolean,
    cityState: boolean,
    damage: number,
    x: number,
    y: number,
    z: number,
    primary: Rgb,
    secondary: Rgb,
    fog: FogClass,
    pattern: number,
  ): void {
    const h = hashString(id);
    const rot0 = ((h % 60) * Math.PI) / 180;
    const wall = propColor(C.houseWall, fog);
    const roof = propColor(mix(primary, [0.55, 0.3, 0.25], 0.25), fog);
    const flag = propColor(primary, fog);
    const pole = propColor(secondary, fog);
    const big = kind === 'city' || cityState;
    if (big) {
      // Walls: stone, reddening with damage (GDD §7 wall HP).
      this.walls.push(x, y, z, 1, 1, 1, 0, propColor(mix(C.wallStone, C.wallDamaged, damage > 0 ? 0.35 + damage * 0.65 : 0), fog));
    }
    if (cityState) {
      this.towers.push(x - 0.05, y, z - 0.08, 1, 1 + Math.min(pop, 12) * 0.03, 1, rot0, propColor(mix(C.houseWall, primary, 0.25), fog));
      for (let k = 0; k < 3; k++) {
        const a = rot0 + (k / 3) * Math.PI * 2 + 0.6;
        const hx = x + Math.cos(a) * 0.36;
        const hz = z + Math.sin(a) * 0.36;
        this.houses.push(hx, y, hz, 0.85, 0.85, 0.85, a, wall);
        this.roofs.push(hx, y + 0.15 * 0.85, hz, 0.85, 0.85, 0.85, a, propColor(C.wallStone, fog));
      }
    } else if (kind === 'city') {
      this.keeps.push(x - 0.05, y, z - 0.08, 1, 1 + Math.min(pop, 12) * 0.03, 1, rot0, wall);
      this.roofs.push(x - 0.05, y + 0.48 + Math.min(pop, 12) * 0.0144, z - 0.08, 1.5, 1.4, 1.5, rot0, roof);
      if (capital) this.stars.push(x - 0.05, y + 0.72 + Math.min(pop, 12) * 0.0144, z - 0.08, 1.3, 1.3, 1.3, rot0, C.gold);
      const houses = Math.max(2, Math.min(8, 2 + Math.floor(pop / 2)));
      for (let k = 0; k < houses; k++) {
        const a = rot0 + (k / houses) * Math.PI * 2 + 0.4;
        const r = k % 2 === 0 ? 0.42 : 0.34;
        const hx = x + Math.cos(a) * r;
        const hz = z + Math.sin(a) * r;
        const s = 0.85 + ((h >> (k + 3)) & 3) * 0.08;
        this.houses.push(hx, y, hz, s, s, s, a, wall);
        this.roofs.push(hx, y + 0.15 * s, hz, s, s, s, a, roof);
      }
    } else {
      // Towns: a few tents in the owner's tint, no walls, no keep.
      const tents = Math.max(1, Math.min(3, 1 + Math.floor(pop / 3)));
      const tentCol = propColor(mix(C.houseWall, primary, 0.35), fog);
      for (let k = 0; k < tents; k++) {
        const a = rot0 + (k / tents) * Math.PI * 2;
        const r = tents === 1 ? 0 : 0.26;
        this.tents.push(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 1, 1, 1, a, tentCol);
      }
      if (capital) this.stars.push(x, y + 0.34, z, 1, 1, 1, rot0, C.gold);
    }
    // Banner pole in owner colors (flag carries the colorblind pattern).
    const px = x + 0.36;
    const pz = z + 0.3;
    this.poles.push(px, y, pz, 1, 1, 1, 0, pole);
    this.flags.push(px + 0.15, y + 0.56, pz, 1.5, 1.5, 1.5, 0, flag, pattern);
  }

  private updateTradeRoutes(state: GameState, viewer: PlayerId | null): void {
    this.tradeDots.begin();
    for (const route of state.tradeRoutes) {
      if (viewer !== null && route.owner !== viewer) continue;
      const a = state.settlements[route.from];
      const b = state.settlements[route.to];
      if (!a || !b) continue;
      const wa = hexToWorld(a.at);
      const wb = hexToWorld(b.at);
      const dx = wb.x - wa.x;
      const dz = wb.z - wa.z;
      const len = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.floor(len / TRADE_DOT_STEP));
      // Skip the ends (they sit under the settlements).
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        const x = wa.x + dx * t;
        const z = wa.z + dz * t;
        const top = this.topAt(worldToHex(x, z));
        if (top === null) continue;
        this.tradeDots.push(x, top + 0.03, z, 1, 1, 1, 0, C.trade);
      }
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
      const x0 = this.tileX[i] ?? 0;
      const z0 = this.tileZ[i] ?? 0;
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
        if (list.length === 2) {
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
        const cls: UnitClass = (UNIT_CLASSES as readonly string[]).includes(u.unitClass) ? u.unitClass : 'infantry';
        const moved = prev !== undefined && (Math.abs(prev.x - x) > 1e-4 || Math.abs(prev.z - z) > 1e-4);
        const heading = moved && prev ? Math.atan2(-(x - prev.x), -(z - prev.z)) : (prev?.heading ?? 0);
        const animate = moved && !this.reduceMotion;
        const own = viewer === null || u.owner === viewer;
        const rim = own ? C.ownRim : this.atWarWithViewer(state, u.owner) ? C.warRim : C.rivalRim;
        draws.push({
          id,
          cls,
          primary: parseHexColor(colors.primary),
          secondary: parseHexColor(colors.secondary),
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
          ring: u.figure !== null || cls === 'commander',
          fortified: u.fortified,
          scale,
        });
        seen.add(id);
      });
    }
    for (const id of [...this.displayed.keys()]) if (!seen.has(id)) this.displayed.delete(id);
    this.unitDraws = draws;
  }

  /** Per-frame unit pass. Returns true while anything (moves, selection pulse) is animating. */
  drawUnits(now: number): boolean {
    for (const cls of UNIT_CLASSES) this.unitBodies[cls].begin();
    this.heads.begin();
    this.unitBases.begin();
    this.unitRims.begin();
    this.goldRings.begin();
    this.unitSelect.begin();
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
    const pulse = pulsing ? 1 + 0.16 * Math.sin((pulseT / 1000) * Math.PI * 2 * 1.6) * (1 - pulseT / PULSE_MS) : 1;
    for (const d of this.unitDraws) {
      const t = clamp01((now - d.start) / MOVE_MS);
      if (t < 1) moving = true;
      const e = easeOut(t);
      const x = d.fx + (d.tx - d.fx) * e;
      const z = d.fz + (d.tz - d.fz) * e;
      // Hop slightly when crossing tiles of different height.
      const y = d.fy + (d.ty - d.fy) * e + Math.sin(Math.PI * t) * 0.12 * (t < 1 ? 1 : 0);
      const prev = this.displayed.get(d.id);
      if (prev) {
        prev.x = x;
        prev.y = y;
        prev.z = z;
        prev.heading = d.heading;
      } else {
        this.displayed.set(d.id, { x, y, z, heading: d.heading });
      }
      const S = UNIT_SCALE * this.propScale * d.scale;
      const headY = UNIT_HEAD_Y[d.cls] * S;
      this.unitBases.push(x, y, z, S, 1, S, 0, d.primary);
      this.unitRims.push(x, y + 0.005, z, S, 1, S, 0, d.rim);
      this.unitBodies[d.cls].push(x, y + 0.035, z, S, S, S, d.heading, d.primary);
      this.heads.push(x, y + 0.035 + headY, z, S, S, S, 0, d.secondary);
      if (d.ring) this.goldRings.push(x, y + 0.01, z, S, 1, S, 0, C.gold);
      if (d.id === this.selection.unit) this.unitSelect.push(x, y + 0.012, z, S * pulse, 1, S * pulse, 0, C.selectUnit);
      let topY = y + 0.035 + headY + 0.08 * S;
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
      if (d.own && this.ready.has(d.id)) this.readyMarks.push(x, topY + 0.04, z, S, S, S, 0, C.ready);
      if (d.fortified) {
        // Shield on the unit's camera-facing side so it reads from the default view.
        this.shields.push(x + 0.17 * S * rx, y + 0.03, z + 0.17 * S * rz + 0.12 * S, S, S, S, this.yaw, C.shield);
      }
      const ds = this.iconScale;
      if (d.own) this.unitDots.push(x, y + 0.1, z, ds * 1.3, 1, ds * 1.3, 0, C.ownRim);
      else this.unitDots.push(x, y + 0.1, z, ds * 1.3, 1, ds * 1.3, 0, d.rim);
      this.unitDots.push(x, y + 0.12, z, ds, 1, ds, 0, d.primary);
    }
    for (const cls of UNIT_CLASSES) this.unitBodies[cls].end();
    this.heads.end();
    this.unitBases.end();
    this.unitRims.end();
    this.goldRings.end();
    this.unitSelect.end();
    this.readyMarks.end();
    this.shields.end();
    this.hpBack.end();
    this.hpFront.end();
    this.unitDots.end();
    return moving || (pulsing && this.selection.unit !== null);
  }

  // -------------------------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------------------------

  /** Re-run label de-overlap when the camera or the labels changed. */
  layoutLabels(camera: PerspectiveCamera | Camera, viewW: number, viewH: number, cameraChanged: boolean): void {
    if (!this.detail.visible) return;
    if (!cameraChanged && !this.labelsDirty) return;
    this.labelsDirty = false;
    this.labels.layout(camera as PerspectiveCamera, viewW, viewH);
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
    this.hlEdge.begin();
    this.hlRing.begin();
    this.pathBack.begin();
    this.pathDots.begin();
    const sel = this.selection;
    for (const h of sel.reachable) {
      const top = this.topAt(h);
      if (top === null) continue;
      const w = hexToWorld(h);
      // White wash + deep-blue edge: the wash reads on water and dark land, the edge on snow/desert.
      this.hlFill.push(w.x, top + 0.014, w.z, 1, 1, 1, 0, C.reachable);
      this.hlEdge.push(w.x, top + 0.016, w.z, 1, 1, 1, 0, C.reachableRing);
    }
    for (const h of sel.attackable) {
      const top = this.topAt(h);
      if (top === null) continue;
      const w = hexToWorld(h);
      this.hlFill.push(w.x, top + 0.016, w.z, 1, 1, 1, 0, C.attackable);
      this.hlRing.push(w.x, top + 0.02, w.z, 1, 1, 1, 0, C.attackable);
    }
    for (const h of sel.path) {
      const top = this.topAt(h);
      if (top === null) continue;
      const w = hexToWorld(h);
      this.pathBack.push(w.x, top + 0.018, w.z, 1, 1, 1, 0, C.pathBack);
      this.pathDots.push(w.x, top + 0.02, w.z, 1, 1, 1, 0, C.path);
    }
    if (sel.tile) {
      const top = this.topAt(sel.tile);
      if (top !== null) {
        const w = hexToWorld(sel.tile);
        this.hlRing.push(w.x, top + 0.022, w.z, 1, 1, 1, 0, C.select);
      }
    }
    this.hlFill.end();
    this.hlEdge.end();
    this.hlRing.end();
    this.pathBack.end();
    this.pathDots.end();
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
    this.animateFlashes(now);
  }

  /** Returns true while a flash is still running. */
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
      const s = this.reduceMotion ? 1 : 0.6 + t * 0.9;
      f.mesh.scale.set(s, 1, s);
      f.material.opacity = this.reduceMotion ? (t < 0.6 ? 0.85 : 0) : 0.9 * (1 - t);
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
  }

  dispose(): void {
    for (const l of this.allInstances()) l.dispose();
    this.labels.dispose();
    for (const f of this.flashes) this.root.remove(f.mesh);
    this.base.remove(this.floor);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.ghostMemory.clear();
  }

  private allInstances(): Instances[] {
    return [
      this.tops,
      this.waterTops,
      this.sides,
      this.riverRibbons,
      this.riverNodes,
      this.peaks,
      this.snow,
      this.mounds,
      this.cones,
      this.broadleaf,
      this.discs,
      ...RESOURCE_CLASSES.map((c) => this.resourceShapes[c]),
      this.resourceBadges,
      this.borderKey,
      this.borderPrimary,
      this.borderSecondary,
      this.territoryFill,
      this.houses,
      this.roofs,
      this.keeps,
      this.towers,
      this.walls,
      this.tents,
      this.poles,
      this.flags,
      this.stars,
      this.warRings,
      this.tradeDots,
      ...UNIT_CLASSES.map((c) => this.unitBodies[c]),
      this.heads,
      this.unitBases,
      this.unitRims,
      this.goldRings,
      this.unitSelect,
      this.readyMarks,
      this.shields,
      this.hpBack,
      this.hpFront,
      this.hlFill,
      this.hlEdge,
      this.hlRing,
      this.pathBack,
      this.pathDots,
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
