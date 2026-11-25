/**
 * All map content as instanced layers: tiles, features, resources, territory, settlements,
 * units, labels, highlights, strategic icons and event flashes.
 *
 * Update model: `update()` refills every layer from a snapshot (O(tiles + entities), a few ms
 * at most, and only on new snapshots). GPU buffers are allocated once per map size and grow
 * only if entity counts outgrow them. `drawUnits()` is the only per-frame pass and it runs
 * only while unit moves or rotation are animating.
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
  type Material,
} from 'three';
import { AGES, UNIT_CLASSES, type ContentBundle, type UnitClass } from '@contracts/content-schemas';
import { HEX_DIRECTIONS, type Hex } from '@contracts/hex';
import type { GameState, PlayerId, SettlementId, UnitId } from '@contracts/sim-api';
import {
  FOG_UNEXPLORED,
  FOG_VISIBLE,
  PALETTE,
  classifyFog,
  hashString,
  mix,
  ownerColors,
  parseHexColor,
  propColor,
  resourceColor,
  tileTopColor,
  type FogClass,
  type Rgb,
} from '../colors';
import { BASE_Y, FOG_TOP, MOUNTAIN_PEAK, tileTop } from '../heights';
import { hexToWorld, mapBounds, tileIndex } from '../layout';
import { labelSpec } from '../labels';
import type { ZoomBand } from '../camera-math';
import {
  TILE_RADIUS,
  UNIT_HEAD_Y,
  baseRingGeometry,
  borderStripGeometry,
  boxGeometry,
  coneGeometry,
  discGeometry,
  headGeometry,
  hexFlatGeometry,
  hexRingGeometry,
  hexSideGeometry,
  hexTopGeometry,
  markerGeometry,
  roofGeometry,
  starGeometry,
  unitBodyGeometry,
} from './geometry';
import { Instances } from './instances';
import { LabelLayer } from './label-layer';

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
const UNIT_SCALE = 1.3;

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
  attackable: rgb(PALETTE.attackable),
  path: rgb(PALETTE.path),
};
const FLASH_COLORS: Record<FlashKind, Rgb> = {
  combat: rgb('#e0453a'),
  found: rgb('#f2c14e'),
  capture: rgb('#8e5bd6'),
  recruit: rgb('#ffe9a8'),
};

/** How each map feature id is drawn. Unknown feature ids get a small neutral disc. */
type FeatureStyle = { kind: 'cones'; color: Rgb; count: number } | { kind: 'disc'; color: Rgb } | { kind: 'none' };
const FEATURE_STYLE: Record<string, FeatureStyle> = {
  forest: { kind: 'cones', color: C.forest, count: 3 },
  jungle: { kind: 'cones', color: C.jungle, count: 4 },
  marsh: { kind: 'disc', color: C.marsh },
  oasis: { kind: 'disc', color: C.oasis },
  hills: { kind: 'none' }, // hills are drawn as raised tiles (heights.ts)
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
}

interface FlashSlot {
  mesh: Mesh;
  material: MeshBasicMaterial;
  start: number;
  active: boolean;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

export class World {
  readonly root = new Group();
  private readonly base = new Group();
  private readonly detail = new Group();
  private readonly strategic = new Group();

  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];

  // Map caches (refilled on every update; reallocated when size changes).
  private width = 0;
  private height = 0;
  private fog = new Uint8Array(0);
  private shownTop = new Float32Array(0);
  private tileX = new Float32Array(0);
  private tileZ = new Float32Array(0);
  private owners: (PlayerId | null)[] = [];

  private readonly terrainColor = new Map<string, Rgb>();
  private readonly terrainWater = new Map<string, boolean>();
  private readonly terrainMountain = new Map<string, boolean>();
  private readonly resourceAge = new Map<string, number>();

  // Layers
  private readonly tops: Instances;
  private readonly sides: Instances;
  private readonly peaks: Instances;
  private readonly snow: Instances;
  private readonly cones: Instances;
  private readonly discs: Instances;
  private readonly resources: Instances;
  private readonly borderStrips: Instances;
  private readonly territoryFill: Instances;
  private readonly houses: Instances;
  private readonly roofs: Instances;
  private readonly keeps: Instances;
  private readonly tents: Instances;
  private readonly poles: Instances;
  private readonly flags: Instances;
  private readonly stars: Instances;
  private readonly unitBodies: Record<UnitClass, Instances>;
  private readonly heads: Instances;
  private readonly goldRings: Instances;
  private readonly unitSelect: Instances;
  private readonly hpBack: Instances;
  private readonly hpFront: Instances;
  private readonly hlFill: Instances;
  private readonly hlRing: Instances;
  private readonly pathDots: Instances;
  private readonly cityIcons: Instances;
  private readonly unitDots: Instances;
  /** Strategic icons grow with zoom so they stay readable (GDD §11 "flat icons"). */
  private iconScale = 1;
  private cityIconList: { x: number; y: number; z: number; size: number; color: Rgb; capital: boolean }[] = [];
  private readonly labels: LabelLayer;
  private readonly flashes: FlashSlot[] = [];
  private readonly flashGeometry: BufferGeometry;
  /** Dark floor under the prisms so the hairline seams between tiles never show the sky color. */
  private readonly floor: Mesh;

  private unitDraws: UnitDraw[] = [];
  private readonly displayed = new Map<UnitId, { x: number; y: number; z: number; heading: number }>();
  private selection: Selection = { unit: null, tile: null, reachable: [], attackable: [], path: [] };
  private state: GameState | null = null;
  private yaw = 0;

  constructor(
    content: ContentBundle,
    private readonly reduceMotion: boolean,
  ) {
    this.root.add(this.base, this.detail, this.strategic);
    this.strategic.visible = false;
    this.setContent(content);

    const lit = this.mat(new MeshLambertMaterial({ flatShading: true }));
    const unlit = this.mat(new MeshBasicMaterial());
    const overlay = this.mat(
      new MeshBasicMaterial({ transparent: true, opacity: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    const highlight = this.mat(
      new MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    );

    const g = <T extends BufferGeometry>(geo: T): T => {
      this.geometries.push(geo);
      return geo;
    };
    const B = this.base;
    const D = this.detail;
    const S = this.strategic;
    const cap = 2048;
    this.tops = new Instances(g(hexTopGeometry()), lit, cap, B, 'tile-tops');
    this.sides = new Instances(g(hexSideGeometry()), lit, cap, B, 'tile-sides');
    this.territoryFill = new Instances(g(hexFlatGeometry(TILE_RADIUS - 0.02)), overlay, 256, B, 'territory-fill', 2);
    this.borderStrips = new Instances(g(borderStripGeometry()), unlit, 512, B, 'territory-borders');
    this.hlFill = new Instances(g(hexFlatGeometry(0.78)), highlight, 64, B, 'hl-fill', 3);
    this.hlRing = new Instances(g(hexRingGeometry(0.8, 0.95)), unlit, 32, B, 'hl-ring', 4);
    this.pathDots = new Instances(g(discGeometry(0.09, 0.03, 10)), unlit, 32, B, 'path-dots', 4);

    this.peaks = new Instances(g(coneGeometry(0.66, MOUNTAIN_PEAK, 6)), lit, 128, D, 'peaks');
    this.snow = new Instances(g(coneGeometry(0.66 * 0.36, MOUNTAIN_PEAK * 0.36, 6)), lit, 128, D, 'snow');
    this.cones = new Instances(g(coneGeometry(0.17, 0.42, 6)), lit, 1024, D, 'tree-cones');
    this.discs = new Instances(g(discGeometry(0.36, 0.03, 10)), lit, 128, D, 'feature-discs');
    this.resources = new Instances(g(markerGeometry()), lit, 256, D, 'resources');
    this.houses = new Instances(g(boxGeometry(0.17, 0.15, 0.17)), lit, 256, D, 'houses');
    this.roofs = new Instances(g(roofGeometry()), lit, 256, D, 'roofs');
    this.keeps = new Instances(g(boxGeometry(0.26, 0.48, 0.26)), lit, 64, D, 'keeps');
    this.tents = new Instances(g(coneGeometry(0.16, 0.28, 6)), lit, 128, D, 'tents');
    this.poles = new Instances(g(discGeometry(0.015, 0.62, 5)), lit, 128, D, 'poles');
    this.flags = new Instances(g(boxGeometry(0.2, 0.12, 0.015)), lit, 128, D, 'flags');
    this.stars = new Instances(g(starGeometry()), lit, 32, D, 'capital-stars');
    const bodies: Partial<Record<UnitClass, Instances>> = {};
    for (const cls of UNIT_CLASSES) {
      bodies[cls] = new Instances(g(unitBodyGeometry(cls)), lit, 64, D, `units-${cls}`);
    }
    this.unitBodies = bodies as Record<UnitClass, Instances>;
    this.heads = new Instances(g(headGeometry()), lit, 128, D, 'unit-heads');
    this.goldRings = new Instances(g(baseRingGeometry(0.24, 0.028)), lit, 32, D, 'gold-rings');
    this.unitSelect = new Instances(g(baseRingGeometry(0.3, 0.03)), unlit, 4, D, 'unit-select');
    this.hpBack = new Instances(g(boxGeometry(0.42, 0.06, 0.02)), unlit, 64, D, 'hp-back');
    this.hpFront = new Instances(g(boxGeometry(0.4, 0.045, 0.03)), unlit, 64, D, 'hp-front');
    this.labels = new LabelLayer(D);

    this.cityIcons = new Instances(g(discGeometry(0.72, 0.08, 20)), unlit, 64, S, 'city-icons');
    this.unitDots = new Instances(g(discGeometry(0.3, 0.06, 10)), unlit, 128, S, 'unit-dots');

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
    this.terrainColor.clear();
    this.terrainWater.clear();
    this.terrainMountain.clear();
    for (const t of content.terrain) {
      this.terrainColor.set(t.id, parseHexColor(t.color));
      this.terrainWater.set(t.id, t.water);
      // Data-driven: impassable dry land is drawn as a mountain (no hard-coded terrain id).
      this.terrainMountain.set(t.id, !t.water && t.moveCost === null);
    }
    this.resourceAge.clear();
    for (const r of content.resources) this.resourceAge.set(r.id, AGES.indexOf(r.revealAge));
  }

  setBand(band: ZoomBand): void {
    const strategic = band === 'strategic';
    this.detail.visible = !strategic;
    this.strategic.visible = strategic;
  }

  setYaw(yaw: number): void {
    this.yaw = yaw;
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
    const { width, height, tiles } = state.map;
    const n = width * height;
    if (width !== this.width || height !== this.height || this.fog.length !== n) {
      this.width = width;
      this.height = height;
      this.fog = new Uint8Array(n);
      this.shownTop = new Float32Array(n);
      this.tileX = new Float32Array(n);
      this.tileZ = new Float32Array(n);
      this.owners = new Array<PlayerId | null>(n).fill(null);
      const b = mapBounds(width, height);
      this.floor.scale.set(b.maxX - b.minX + 1.6, 1, b.maxZ - b.minZ + 1.6);
      this.floor.position.set((b.minX + b.maxX) / 2, BASE_Y + 0.02, (b.minZ + b.maxZ) / 2);
      this.floor.visible = n > 0;
    }
    const viewerState = viewer !== null ? state.players[viewer] : undefined;
    classifyFog(n, viewer === null ? null : (viewerState?.explored ?? []), visible, this.fog);
    const ageIdx = AGES.indexOf(state.age);

    this.tops.begin();
    this.sides.begin();
    this.peaks.begin();
    this.snow.begin();
    this.cones.begin();
    this.discs.begin();
    this.resources.begin();

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
      const isMountain = this.terrainMountain.get(tile.terrain) ?? false;
      const top = fog === FOG_UNEXPLORED ? FOG_TOP : tileTop(tile, { isWater, isMountain });
      this.shownTop[i] = top;
      const tColor = this.terrainColor.get(tile.terrain) ?? [0.6, 0.6, 0.6];
      this.tops.push(w.x, top, w.z, 1, 1, 1, 0, tileTopColor(tColor, tile.river, fog));
      const sideTop = top - BEVEL_DROP;
      const sideColor = fog === FOG_UNEXPLORED ? parchSide : propColor(isWater ? C.waterSide : C.soil, fog);
      this.sides.push(w.x, sideTop, w.z, 1, sideTop - BASE_Y, 1, 0, sideColor);
      if (fog === FOG_UNEXPLORED) continue;

      // Props get a deterministic per-tile jitter so forests don't look stamped.
      const jit = hashString(`${tile.q},${tile.r}`);
      const spin = ((jit % 360) * Math.PI) / 180;
      if (isMountain) {
        const peakCol = propColor(mix(tColor, [0.35, 0.33, 0.32], 0.25), fog);
        const s = 0.9 + ((jit >> 9) % 20) / 100;
        this.peaks.push(w.x, top, w.z, s, s, s, spin, peakCol);
        this.snow.push(w.x, top + MOUNTAIN_PEAK * s * 0.64, w.z, s, s, s, spin, propColor(C.snowCap, fog));
      }
      if (tile.feature) {
        const style = FEATURE_STYLE[tile.feature] ?? { kind: 'disc', color: C.hills };
        if (style.kind === 'cones') {
          const col = propColor(style.color, fog);
          const c = Math.cos(spin);
          const s = Math.sin(spin);
          for (let k = 0; k < style.count; k++) {
            const o = CONE_OFFSETS[k % CONE_OFFSETS.length];
            if (!o) continue;
            const ox = o[0] * c - o[1] * s;
            const oz = o[0] * s + o[1] * c;
            this.cones.push(w.x + ox, top, w.z + oz, o[2], o[2], o[2], 0, col);
          }
        } else if (style.kind === 'disc') {
          this.discs.push(w.x - 0.1, top, w.z + 0.15, 1, 1, 1, spin, propColor(style.color, fog));
        }
      }
      if (tile.resource) {
        const revealAge = this.resourceAge.get(tile.resource) ?? 0;
        if (revealAge <= ageIdx) {
          this.resources.push(w.x + 0.42, top + 0.04, w.z - 0.3, 1, 1, 1, spin, propColor(resourceColor(tile.resource), fog));
        }
      }
    }
    this.tops.end();
    this.sides.end();
    this.peaks.end();
    this.snow.end();
    this.cones.end();
    this.discs.end();
    this.resources.end();

    this.updateTerritory(state);
    this.updateSettlements(state, viewer);
    this.prepareUnits(state, viewer, now);
    this.drawUnits(now);
    this.drawSelection();
  }

  private updateTerritory(state: GameState): void {
    this.territoryFill.begin();
    this.borderStrips.begin();
    const { width, height } = this;
    const n = width * height;
    for (let i = 0; i < n; i++) {
      const owner = this.owners[i] ?? null;
      const fog = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
      if (owner === null || fog === FOG_UNEXPLORED) continue;
      const tile = state.map.tiles[i];
      if (!tile) continue;
      const col = propColor(parseHexColor(ownerColors(state, owner).primary), fog);
      const x = this.tileX[i] ?? 0;
      const z = this.tileZ[i] ?? 0;
      const top = this.shownTop[i] ?? 0;
      this.territoryFill.push(x, top + 0.008, z, 1, 1, 1, 0, col);
      for (let d = 0; d < 6; d++) {
        const dir = HEX_DIRECTIONS[d];
        if (!dir) continue;
        const ni = tileIndex({ q: tile.q + dir.q, r: tile.r + dir.r }, width, height);
        if (ni >= 0 && this.owners[ni] === owner) continue;
        const e = EDGES[d];
        if (!e) continue;
        this.borderStrips.push(x + e.mx, top + 0.012, z + e.mz, EDGE_LEN, 1, 1, e.rot, col);
      }
    }
    this.territoryFill.end();
    this.borderStrips.end();
  }

  private updateSettlements(state: GameState, viewer: PlayerId | null): void {
    const L = [this.houses, this.roofs, this.keeps, this.tents, this.poles, this.flags, this.stars];
    this.cityIconList = [];
    for (const l of L) l.begin();
    this.labels.begin();
    const ids = Object.keys(state.settlements).sort();
    for (const id of ids) {
      const s = state.settlements[id];
      if (!s) continue;
      const i = tileIndex(s.at, this.width, this.height);
      if (i < 0) continue;
      const fog = (this.fog[i] ?? FOG_UNEXPLORED) as FogClass;
      // Own settlements always show; others only while the tile is in sight.
      if (viewer !== null && s.owner !== viewer && fog !== FOG_VISIBLE) continue;
      const colors = ownerColors(state, s.owner);
      const primary = parseHexColor(colors.primary);
      const secondary = parseHexColor(colors.secondary);
      const x = this.tileX[i] ?? 0;
      const z = this.tileZ[i] ?? 0;
      const y = this.shownTop[i] ?? 0;
      this.drawSettlement(id, s.kind, s.population, s.isCapital, x, y, z, primary, secondary, fog);
      this.cityIconList.push({ x, y, z, size: s.kind === 'city' ? 1 : 0.7, color: primary, capital: s.isCapital });
      this.labels.push(labelSpec(s, colors.primary), x, y + (s.kind === 'city' ? 0.85 : 0.7), z);
    }
    for (const l of L) l.end();
    this.labels.end();
    this.drawCityIcons();
  }

  private drawCityIcons(): void {
    this.cityIcons.begin();
    const k = this.iconScale;
    for (const c of this.cityIconList) {
      // Capitals get a gold rim: a slightly larger gold disc underneath.
      if (c.capital) this.cityIcons.push(c.x, c.y, c.z, c.size * k * 1.22, 1, c.size * k * 1.22, 0, C.gold);
      this.cityIcons.push(c.x, c.y + 0.02, c.z, c.size * k, 1, c.size * k, 0, c.color);
    }
    this.cityIcons.end();
  }

  /** Strategic icon size multiplier; redraws icons only when it changes noticeably. */
  setIconScale(scale: number, now: number): void {
    if (Math.abs(scale - this.iconScale) < 0.03 * this.iconScale) return;
    this.iconScale = scale;
    this.drawCityIcons();
    this.drawUnits(now);
  }

  private drawSettlement(
    id: SettlementId,
    kind: 'town' | 'city',
    pop: number,
    capital: boolean,
    x: number,
    y: number,
    z: number,
    primary: Rgb,
    secondary: Rgb,
    fog: FogClass,
  ): void {
    const h = hashString(id);
    const rot0 = ((h % 60) * Math.PI) / 180;
    const wall = propColor(C.houseWall, fog);
    const roof = propColor(mix(primary, [0.55, 0.3, 0.25], 0.25), fog);
    const flag = propColor(primary, fog);
    const pole = propColor(secondary, fog);
    if (kind === 'city') {
      this.keeps.push(x - 0.05, y, z - 0.08, 1, 1 + Math.min(pop, 12) * 0.03, 1, rot0, wall);
      this.roofs.push(x - 0.05, y + 0.48 + Math.min(pop, 12) * 0.0144, z - 0.08, 1.5, 1.4, 1.5, rot0, roof);
      if (capital) this.stars.push(x - 0.05, y + 0.72 + Math.min(pop, 12) * 0.0144, z - 0.08, 1, 1, 1, rot0, C.gold);
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
      const tents = Math.max(1, Math.min(3, 1 + Math.floor(pop / 3)));
      const tentCol = propColor(mix(C.houseWall, primary, 0.35), fog);
      for (let k = 0; k < tents; k++) {
        const a = rot0 + (k / tents) * Math.PI * 2;
        const r = tents === 1 ? 0 : 0.26;
        this.tents.push(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 1, 1, 1, a, tentCol);
      }
      if (capital) this.stars.push(x, y + 0.3, z, 0.8, 0.8, 0.8, rot0, C.gold);
    }
    // Banner pole in owner colors.
    const px = x + 0.36;
    const pz = z + 0.3;
    this.poles.push(px, y, pz, 1, 1, 1, 0, pole);
    this.flags.push(px + 0.1, y + 0.48, pz, 1, 1, 1, 0, flag);
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
      list.forEach((id, k) => {
        const u = state.units[id];
        if (!u) return;
        let x = x0;
        let z = z0;
        if (list.length > 1) {
          const a = (k / list.length) * Math.PI * 2 + Math.PI / 6;
          x += Math.cos(a) * 0.3;
          z += Math.sin(a) * 0.3;
        }
        const colors = ownerColors(state, u.owner);
        const prev = this.displayed.get(id);
        const cls: UnitClass = (UNIT_CLASSES as readonly string[]).includes(u.unitClass) ? u.unitClass : 'infantry';
        const moved = prev !== undefined && (Math.abs(prev.x - x) > 1e-4 || Math.abs(prev.z - z) > 1e-4);
        const heading = moved && prev ? Math.atan2(-(x - prev.x), -(z - prev.z)) : (prev?.heading ?? 0);
        const animate = moved && !this.reduceMotion;
        draws.push({
          id,
          cls,
          primary: parseHexColor(colors.primary),
          secondary: parseHexColor(colors.secondary),
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
        });
        seen.add(id);
      });
    }
    for (const id of [...this.displayed.keys()]) if (!seen.has(id)) this.displayed.delete(id);
    this.unitDraws = draws;
  }

  /** Per-frame unit pass. Returns true while any unit is still moving. */
  drawUnits(now: number): boolean {
    for (const cls of UNIT_CLASSES) this.unitBodies[cls].begin();
    this.heads.begin();
    this.goldRings.begin();
    this.unitSelect.begin();
    this.hpBack.begin();
    this.hpFront.begin();
    this.unitDots.begin();
    let moving = false;
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
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
      const S = UNIT_SCALE;
      const headY = UNIT_HEAD_Y[d.cls] * S;
      this.unitBodies[d.cls].push(x, y + 0.01, z, S, S, S, d.heading, d.primary);
      this.heads.push(x, y + headY, z, S, S, S, 0, d.secondary);
      if (d.ring) this.goldRings.push(x, y + 0.005, z, S, 1, S, 0, C.gold);
      if (d.id === this.selection.unit) this.unitSelect.push(x, y + 0.01, z, S, 1, S, 0, C.selectUnit);
      if (d.hp < UNIT_MAX_HP) {
        const f = clamp01(d.hp / UNIT_MAX_HP);
        const by = y + headY + 0.16;
        this.hpBack.push(x, by, z, 1, 1, 1, this.yaw, C.hpBack);
        const shift = -(1 - f) * 0.2;
        const col = f > 0.6 ? C.hpGood : f > 0.3 ? C.hpMid : C.hpLow;
        this.hpFront.push(x + rx * shift, by + 0.008, z + rz * shift, Math.max(0.02, f), 1, 1, this.yaw, col);
      }
      const ds = this.iconScale;
      this.unitDots.push(x, y + 0.12, z, ds, 1, ds, 0, d.primary);
    }
    for (const cls of UNIT_CLASSES) this.unitBodies[cls].end();
    this.heads.end();
    this.goldRings.end();
    this.unitSelect.end();
    this.hpBack.end();
    this.hpFront.end();
    this.unitDots.end();
    return moving;
  }

  // -------------------------------------------------------------------------------------------
  // Selection and flashes
  // -------------------------------------------------------------------------------------------

  setSelection(sel: Selection, now: number): void {
    this.selection = sel;
    this.drawSelection();
    this.drawUnits(now);
  }

  private drawSelection(): void {
    this.hlFill.begin();
    this.hlRing.begin();
    this.pathDots.begin();
    const sel = this.selection;
    for (const h of sel.reachable) {
      const top = this.topAt(h);
      if (top === null) continue;
      const w = hexToWorld(h);
      this.hlFill.push(w.x, top + 0.014, w.z, 1, 1, 1, 0, C.reachable);
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
    this.hlRing.end();
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
    this.labels.touch();
  }

  /** Re-apply the last snapshot (used after context restore). */
  get lastState(): GameState | null {
    return this.state;
  }

  dispose(): void {
    for (const l of this.allInstances()) l.dispose();
    this.labels.dispose();
    for (const f of this.flashes) this.root.remove(f.mesh);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }

  private allInstances(): Instances[] {
    return [
      this.tops,
      this.sides,
      this.peaks,
      this.snow,
      this.cones,
      this.discs,
      this.resources,
      this.borderStrips,
      this.territoryFill,
      this.houses,
      this.roofs,
      this.keeps,
      this.tents,
      this.poles,
      this.flags,
      this.stars,
      ...UNIT_CLASSES.map((c) => this.unitBodies[c]),
      this.heads,
      this.goldRings,
      this.unitSelect,
      this.hpBack,
      this.hpFront,
      this.hlFill,
      this.hlRing,
      this.pathDots,
      this.cityIcons,
      this.unitDots,
    ];
  }

  private mat<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }
}

/** Border strip placement for each of the 6 neighbor directions (edge midpoint + rotation). */
const EDGE_INSET = 0.9;
const EDGE_LEN = 0.92 * EDGE_INSET;
const EDGES = HEX_DIRECTIONS.map((d) => {
  const w = hexToWorld(d);
  const len = Math.hypot(w.x, w.z);
  // Strip's local x axis must run along the edge, i.e. perpendicular to the neighbor vector.
  return { mx: (w.x / 2) * EDGE_INSET, mz: (w.z / 2) * EDGE_INSET, rot: Math.atan2(-w.x / len, -w.z / len) };
});
