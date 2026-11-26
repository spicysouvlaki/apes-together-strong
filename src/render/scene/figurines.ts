/**
 * Painted-figurine units (GDD §11 "units are small painted figurines"). Each silhouette is one
 * merged, faceted geometry with fixed paint (skin, wood, metal) and team-colored cloth
 * (instanceColor = owner primary). Figures stand at y = 0 facing −z; the round base is a
 * separate shared layer (unitBaseGeometry).
 */
import { BoxGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, SphereGeometry, TorusGeometry, type BufferGeometry } from 'three';
import { assemble, lin, paint, team } from './geometry';

const SKIN = lin('#d6a479');
const WOOD = lin('#6f4c30');
const METAL = lin('#b8bcc2');
const LEATHER = lin('#7d5434');
const DARK = lin('#3a2f29');
const GOLD = lin('#e0b23e');
const HORSE = lin('#8a5a38');
const DONKEY = lin('#8c8478');
const CLOTH = lin('#efe4cc');

/** Figure kinds: unit classes plus civilian variants keyed by unit type (see figureFor). */
export const FIGURES = ['infantry', 'ranged', 'cavalry', 'siege', 'naval', 'settler', 'scout', 'merchant', 'commander'] as const;
export type FigureKind = (typeof FIGURES)[number];

/** Height of the figure's top (for hp bars and markers), at scale 1. */
export const FIGURE_TOP: Record<FigureKind, number> = {
  infantry: 0.36,
  ranged: 0.34,
  cavalry: 0.38,
  siege: 0.3,
  naval: 0.46,
  settler: 0.32,
  scout: 0.34,
  merchant: 0.32,
  commander: 0.5,
};

/**
 * Render-side art table: civilian unit types get their own silhouette; everything else is drawn
 * by class. Unknown civilian types fall back to the settler.
 */
const CIVILIAN_FIGURES: Record<string, FigureKind> = {
  settler: 'settler',
  scout: 'scout',
  figure_explorer: 'scout',
  merchant: 'merchant',
};

export const figureFor = (unitClass: string, unitType: string): FigureKind => {
  if (unitClass === 'civilian') return CIVILIAN_FIGURES[unitType] ?? 'settler';
  return (FIGURES as readonly string[]).includes(unitClass) ? (unitClass as FigureKind) : 'infantry';
};

const box = (w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry => {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
};
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 6): BufferGeometry => {
  const g = new CylinderGeometry(r0, r1, h, seg);
  g.translate(x, y + h / 2, z);
  return g;
};
const ball = (r: number, x: number, y: number, z: number): BufferGeometry => {
  const g = new IcosahedronGeometry(r, 1);
  g.translate(x, y, z);
  return g;
};

/** A standing person: legs, tunic (team), belt, head. Returns parts; `y0` lifts it (riders). */
const person = (y0 = 0, tunicShade = 1, legs = true): BufferGeometry[] => {
  const parts: BufferGeometry[] = [];
  if (legs) {
    parts.push(paint(box(0.03, 0.1, 0.035, -0.022, y0, 0), DARK));
    parts.push(paint(box(0.03, 0.1, 0.035, 0.022, y0, 0), DARK));
  }
  const ly = legs ? 0.1 : 0;
  parts.push(paint(cyl(0.045, 0.06, 0.13, 0, y0 + ly, 0), team(tunicShade)));
  parts.push(paint(cyl(0.062, 0.062, 0.018, 0, y0 + ly + 0.02, 0), LEATHER));
  parts.push(paint(ball(0.042, 0, y0 + ly + 0.17, 0), SKIN));
  return parts;
};

const quadruped = (color: [number, number, number], scale: number, x: number, z: number): BufferGeometry[] => {
  const p: BufferGeometry[] = [];
  const s = scale;
  p.push(paint(box(0.085 * s, 0.085 * s, 0.22 * s, x, 0.085 * s, z), color));
  const neck = box(0.05 * s, 0.1 * s, 0.06 * s, 0, 0, 0);
  neck.rotateX(0.55);
  neck.translate(x, 0.15 * s, z - 0.1 * s);
  p.push(paint(neck, color));
  p.push(paint(box(0.045 * s, 0.045 * s, 0.09 * s, x, 0.21 * s, z - 0.15 * s), color));
  for (const [lx, lz] of [
    [-0.03, -0.08],
    [0.03, -0.08],
    [-0.03, 0.08],
    [0.03, 0.08],
  ] as const) {
    p.push(paint(box(0.022 * s, 0.09 * s, 0.022 * s, x + lx * s, 0, z + lz * s), DARK));
  }
  const tail = box(0.02 * s, 0.08 * s, 0.02 * s, 0, 0, 0);
  tail.rotateX(-0.4);
  tail.translate(x, 0.1 * s, z + 0.12 * s);
  p.push(paint(tail, DARK));
  return p;
};

export const figureGeometry = (kind: FigureKind): BufferGeometry => {
  switch (kind) {
    case 'infantry': {
      const p = person();
      const helm = new ConeGeometry(0.048, 0.06, 6);
      helm.translate(0, 0.31, 0);
      p.push(paint(helm, METAL));
      p.push(paint(cyl(0.008, 0.008, 0.42, 0.075, 0.02, -0.02, 4), WOOD));
      const tip = new ConeGeometry(0.016, 0.05, 4);
      tip.translate(0.075, 0.46, -0.02);
      p.push(paint(tip, METAL));
      const shield = new CylinderGeometry(0.075, 0.075, 0.015, 10);
      shield.rotateZ(Math.PI / 2);
      shield.translate(-0.07, 0.17, -0.01);
      p.push(paint(shield, team(0.78)));
      const boss = new SphereGeometry(0.02, 6, 4);
      boss.translate(-0.08, 0.17, -0.01);
      p.push(paint(boss, GOLD));
      return assemble(p);
    }
    case 'ranged': {
      const p = person(0, 0.9);
      const hood = new ConeGeometry(0.05, 0.08, 6);
      hood.translate(0, 0.32, 0.005);
      p.push(paint(hood, team(0.7)));
      const bow = new TorusGeometry(0.12, 0.008, 3, 10, Math.PI * 0.9);
      bow.rotateZ(-Math.PI * 0.45);
      bow.rotateY(Math.PI / 2);
      bow.translate(0.07, 0.19, -0.02);
      p.push(paint(bow, WOOD));
      p.push(paint(box(0.035, 0.12, 0.03, -0.03, 0.14, 0.05), LEATHER));
      return assemble(p);
    }
    case 'cavalry': {
      const p = quadruped(HORSE, 1, 0, 0);
      p.push(paint(box(0.09, 0.018, 0.08, 0, 0.17, 0.01), team(0.75))); // saddle cloth
      const rider = person(0.13, 1, false);
      p.push(...rider);
      p.push(paint(box(0.02, 0.07, 0.03, -0.05, 0.13, 0.0), DARK));
      p.push(paint(box(0.02, 0.07, 0.03, 0.05, 0.13, 0.0), DARK));
      const lance = cyl(0.007, 0.007, 0.44, 0, 0, 0, 4);
      lance.rotateX(-0.5);
      lance.translate(0.07, 0.12, 0.05);
      p.push(paint(lance, WOOD));
      return assemble(p);
    }
    case 'siege': {
      const p: BufferGeometry[] = [];
      p.push(paint(box(0.2, 0.04, 0.26, 0, 0.05, 0), WOOD));
      for (const [x, z] of [
        [-0.11, -0.09],
        [0.11, -0.09],
        [-0.11, 0.09],
        [0.11, 0.09],
      ] as const) {
        const w = new CylinderGeometry(0.05, 0.05, 0.025, 8);
        w.rotateZ(Math.PI / 2);
        w.translate(x, 0.05, z);
        p.push(paint(w, DARK));
      }
      const arm = box(0.03, 0.03, 0.3, 0, 0, 0);
      arm.rotateX(0.7);
      arm.translate(0, 0.17, 0.02);
      p.push(paint(arm, WOOD));
      p.push(paint(box(0.12, 0.1, 0.03, 0, 0.09, 0.08), WOOD));
      p.push(paint(box(0.13, 0.04, 0.12, 0, 0.19, -0.06), team(0.9))); // hide canopy
      p.push(paint(ball(0.03, 0, 0.29, -0.08), lin('#8a857c')));
      return assemble(p);
    }
    case 'naval': {
      const p: BufferGeometry[] = [];
      const hull = new CylinderGeometry(0.09, 0.05, 0.07, 6);
      hull.scale(1, 1, 2.6);
      hull.translate(0, 0.035, 0);
      p.push(paint(hull, WOOD));
      p.push(paint(box(0.13, 0.012, 0.34, 0, 0.07, 0), lin('#8b6a48')));
      p.push(paint(cyl(0.009, 0.009, 0.4, 0, 0.07, 0, 4), WOOD));
      const sail = new BoxGeometry(0.22, 0.2, 0.012);
      // Belly the sail a little.
      const sp = sail.getAttribute('position');
      for (let i = 0; i < sp.count; i++) sp.setZ(i, sp.getZ(i) - (1 - (sp.getX(i) / 0.11) ** 2) * 0.03);
      sail.translate(0, 0.27, 0.0);
      p.push(paint(sail, team(1.05)));
      p.push(paint(box(0.24, 0.014, 0.014, 0, 0.37, 0), WOOD));
      const prow = new ConeGeometry(0.03, 0.08, 4);
      prow.rotateX(-Math.PI / 2 - 0.5);
      prow.translate(0, 0.08, -0.22);
      p.push(paint(prow, team(0.7)));
      return assemble(p);
    }
    case 'settler': {
      const p = person(0, 0.95);
      p.push(paint(ball(0.06, 0, 0.2, 0.06), CLOTH)); // bundle
      p.push(paint(box(0.11, 0.015, 0.015, 0, 0.23, 0.03), LEATHER));
      const staff = cyl(0.007, 0.007, 0.36, 0.07, 0, -0.03, 4);
      staff.rotateX(0.08);
      p.push(paint(staff, WOOD));
      return assemble(p);
    }
    case 'scout': {
      const p = person(0, 0.85);
      p.push(paint(cyl(0.085, 0.085, 0.012, 0, 0.29, 0, 10), LEATHER)); // wide brim
      p.push(paint(cyl(0.04, 0.045, 0.04, 0, 0.3, 0, 8), LEATHER));
      p.push(paint(box(0.1, 0.13, 0.02, 0, 0.1, 0.045), team(0.65))); // cape
      p.push(paint(cyl(0.007, 0.007, 0.38, -0.075, 0, -0.02, 4), WOOD));
      return assemble(p);
    }
    case 'merchant': {
      const p = person(0, 0.9).map((g) => g.translate(-0.08, 0, 0.02));
      p.push(...quadruped(DONKEY, 0.8, 0.07, 0));
      p.push(paint(box(0.05, 0.06, 0.09, 0.02, 0.1, 0), team(1)));
      p.push(paint(box(0.05, 0.06, 0.09, 0.12, 0.1, 0), team(0.8)));
      p.push(paint(box(0.12, 0.03, 0.05, 0.07, 0.16, 0), CLOTH));
      return assemble(p);
    }
    case 'commander': {
      const p = person(0, 1);
      p.push(paint(box(0.1, 0.17, 0.02, 0, 0.08, 0.05), team(0.62))); // cape
      const helm = new SphereGeometry(0.046, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      helm.translate(0, 0.28, 0);
      p.push(paint(helm, GOLD));
      p.push(paint(box(0.012, 0.06, 0.05, 0, 0.32, 0), team(0.8))); // plume
      p.push(paint(cyl(0.008, 0.008, 0.52, 0.08, 0, 0.01, 4), WOOD));
      p.push(paint(box(0.11, 0.08, 0.006, 0.135, 0.4, 0.01), team(1))); // standard
      p.push(paint(ball(0.016, 0.08, 0.53, 0.01), GOLD));
      return assemble(p);
    }
  }
};

/** Round figurine base: dark wooden plinth with a team-painted top. */
export const unitBaseGeometry = (): BufferGeometry =>
  assemble([
    paint(cyl(0.165, 0.175, 0.016, 0, 0, 0, 18), lin('#3d3026')),
    paint(cyl(0.16, 0.165, 0.02, 0, 0.016, 0, 18), team(0.9)),
    paint(cyl(0.125, 0.135, 0.006, 0, 0.036, 0, 18), lin('#c9bb98')),
  ]);
