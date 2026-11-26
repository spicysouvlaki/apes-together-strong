/**
 * Painted toy-soldier figurines (GDD §11 "units are small painted figurines"; art pass 4). One
 * merged, faceted geometry per look (unit-look.ts LOOKS) with fixed paint (skin, wood, bronze,
 * hide) and two team colors: owner primary (vertex r < 0, instanceColor) and owner secondary
 * (vertex b < 0, packed in aInst.y; materials.ts SECOND). Cloth that flutters (standards,
 * pennons, sails) carries a flutter weight in −g. Figures stand at y = 0 facing −z, chunky toy
 * proportions (big heads, thick limbs) so they read at phone zoom from a 48° camera; every look
 * has one silhouette feature visible from far away (spear, bow, sling loop, wheel, sail, arm,
 * standard). The round base, rim, shadow and markers are separate shared layers.
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { Rgb } from '../colors';
import { LOOKS, type Look } from '../unit-look';
import { assemble, lin, paint, team } from './geometry';

export { LOOKS, type Look } from '../unit-look';

/** Skin marker (materials.ts propMaterial): g < −0.5 = owner's skin tone × r (aInst.w). */
const SKIN: Rgb = [1, -1, 0];
const SKIN_SHADE: Rgb = [0.82, -1, 0];
/** Secondary team color marker: aInst.y-packed secondary × r. */
const second = (shade = 1): Rgb => [shade, 0, -1];
const WOOD = lin('#7a5234');
const WOOD_D = lin('#553a26');
const BRONZE = lin('#c9973f');
const METAL = lin('#b9bec4');
const LEATHER = lin('#80583a');
const HIDE = lin('#a8865c');
const DARK = lin('#3a2f29');
const HAIR = lin('#2e241f');
const GOLD = lin('#e6b844');
const HORSE = lin('#8a5634');
const HORSE_D = lin('#4a2f22');
const OX = lin('#c9b89a');
const CAMEL = lin('#c7a26b');
const CLOTH = lin('#efe4cc');
const STONE = lin('#9a958c');
const ROPE = lin('#b79a6a');

/** Height of the figure's top (for hp pips and the ready gem), at scale 1. */
export const LOOK_TOP: Record<Look, number> = {
  warband: 0.46,
  spearman: 0.5,
  slinger: 0.44,
  archer: 0.4,
  chariot: 0.42,
  horseArcher: 0.46,
  ram: 0.3,
  catapult: 0.42,
  canoe: 0.22,
  galley: 0.56,
  settler: 0.34,
  scout: 0.44,
  merchant: 0.36,
  general: 0.78,
  explorer: 0.72,
};

// --- primitives (bottom at y unless noted) ------------------------------------------------------

const box = (w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry => {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
};
const cyl = (rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 7): BufferGeometry => {
  const g = new CylinderGeometry(rTop, rBot, h, seg);
  g.translate(x, y + h / 2, z);
  return g;
};
/** Horizontal cylinder along x, centered at (x, y, z) (bedrolls, rope bundles, charts). */
const hcyl = (r: number, len: number, x: number, y: number, z: number): BufferGeometry => {
  const g = new CylinderGeometry(r, r, len, 7);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
};
/** Centered ball. */
const ball = (r: number, x: number, y: number, z: number, detail = 1): BufferGeometry => {
  const g = new IcosahedronGeometry(r, detail);
  g.translate(x, y, z);
  return g;
};
/** A round rod from a to b (spears, oars, poles, legs of a frame). */
const rod = (a: [number, number, number], b: [number, number, number], r: number, seg = 5): BufferGeometry => {
  const va = new Vector3(...a);
  const vb = new Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const g = new CylinderGeometry(r, r, len, seg);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()));
  const m = va.add(vb).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
};
/** Spoked wheel in the y-z plane (axle along x). */
const wheel = (r: number, x: number, y: number, z: number, rim: Rgb = WOOD_D): BufferGeometry[] => {
  const t = new TorusGeometry(r, r * 0.16, 4, 12);
  t.rotateY(Math.PI / 2);
  t.translate(x, y, z);
  const parts = [paint(t, rim)];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    parts.push(paint(rod([x, y - Math.sin(a) * r, z - Math.cos(a) * r], [x, y + Math.sin(a) * r, z + Math.cos(a) * r], r * 0.08, 3), WOOD));
  }
  parts.push(paint(ball(r * 0.22, x, y, z, 0), DARK));
  return parts;
};
/** Round shield facing −z (toward the figure's front), primary field, secondary rim, bronze boss. */
const roundShield = (r: number, x: number, y: number, z: number, tiltY = 0): BufferGeometry[] => {
  const field = new CylinderGeometry(r, r, 0.016, 12);
  field.rotateX(Math.PI / 2);
  const rim = new TorusGeometry(r, 0.011, 3, 14);
  const boss = new SphereGeometry(r * 0.28, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  boss.rotateX(-Math.PI / 2);
  boss.translate(0, 0, -0.008);
  for (const g of [field, rim, boss]) {
    g.rotateY(tiltY);
    g.translate(x, y, z);
  }
  return [paint(field, team(1)), paint(rim, second(1)), paint(boss, BRONZE)];
};

/**
 * Per-vertex flutter weight for cloth: 0 at the pole (x = poleX), 1 at `reach` away. Stored in
 * −g of the team/secondary markers (materials.ts IDLE flutter), so only the free end moves.
 */
const flutter = (g: BufferGeometry, base: Rgb | ((y: number) => Rgb), poleX: number, reach: number): BufferGeometry => {
  const p = g.getAttribute('position');
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const w = Math.min(1, Math.abs(p.getX(i) - poleX) / reach);
    const c = typeof base === 'function' ? base(p.getY(i)) : base;
    a[i * 3] = c[0];
    a[i * 3 + 2] = c[2];
    a[i * 3 + 1] = -(0.06 + 0.4 * w);
  }
  g.setAttribute('color', new Float32BufferAttribute(a, 3));
  return g;
};

const place = (parts: BufferGeometry[], x: number, y: number, z: number, s = 1, rotY = 0): BufferGeometry[] => {
  for (const g of parts) {
    if (s !== 1) g.scale(s, s, s);
    if (rotY !== 0) g.rotateY(rotY);
    g.translate(x, y, z);
  }
  return parts;
};

// --- people and animals -------------------------------------------------------------------------

interface PersonOpts {
  tunic?: Rgb;
  /** Belt / sash color (default secondary). */
  belt?: Rgb;
  legs?: Rgb | null;
  /** Arm poses: angle forward from hanging (rad); left/right in figure space (+x = right). */
  armL?: number;
  armR?: number;
  /** Raise the arm sideways (rad) e.g. a sling over the head. */
  armRUp?: number;
  hair?: boolean;
  /** Eyes and brow on the front of the head (default on). */
  face?: boolean;
}

/** Toy person (top of head ≈ 0.33): stubby legs, tunic, sash, arms, a big round head. */
const person = (o: PersonOpts = {}): BufferGeometry[] => {
  const parts: BufferGeometry[] = [];
  if (o.legs !== null) {
    const lc = o.legs ?? DARK;
    parts.push(paint(box(0.036, 0.09, 0.04, -0.026, 0, 0), lc));
    parts.push(paint(box(0.036, 0.09, 0.04, 0.026, 0, 0), lc));
  }
  const y0 = o.legs === null ? 0 : 0.085;
  parts.push(paint(cyl(0.05, 0.068, 0.125, 0, y0, 0, 8), o.tunic ?? team(1)));
  parts.push(paint(cyl(0.07, 0.07, 0.02, 0, y0 + 0.03, 0, 8), o.belt ?? second(0.95)));
  const sh = y0 + 0.115;
  const arm = (side: number, fwd: number, up: number): void => {
    const len = 0.1;
    const ax = side * 0.07;
    const dx = Math.sin(up) * side * len;
    const dy = -Math.cos(up) * Math.cos(fwd) * len;
    const dz = -Math.sin(fwd) * Math.cos(up) * len;
    parts.push(paint(rod([ax, sh, 0], [ax + dx, sh + dy, dz], 0.019, 5), o.tunic ?? team(0.88)));
    parts.push(paint(ball(0.022, ax + dx * 1.08, sh + dy * 1.08, dz * 1.08, 0), SKIN_SHADE));
  };
  arm(-1, o.armL ?? 0.25, 0);
  arm(1, o.armR ?? 0.25, o.armRUp ?? 0);
  parts.push(paint(cyl(0.026, 0.03, 0.025, 0, sh, 0, 6), SKIN_SHADE));
  const hy = sh + 0.075;
  parts.push(paint(ball(0.058, 0, hy, 0), SKIN));
  if (o.face !== false) {
    // Minimal face (playtest 3: faceless heads read as helmets): two small ink eyes on the
    // front (−z) of the head, well apart (a brow line merged with them into a mask at phone
    // zoom); figures turn their face to the viewer at rest.
    for (const ex of [-0.024, 0.024]) parts.push(paint(box(0.011, 0.015, 0.012, ex, hy - 0.002, -0.05), DARK));
  }
  if (o.hair !== false) {
    // Hair swept back from a high hairline: crown, back and sides, never the brow, so it reads
    // as hair over a face (the old cap sat level across the forehead and read as a hat).
    const hair = new SphereGeometry(0.063, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
    hair.rotateX(0.78);
    hair.translate(0, hy + 0.004, 0.006);
    parts.push(paint(hair, HAIR));
  }
  return parts;
};
/** Head-top y of `person()`. */
const HEAD_Y = 0.085 + 0.115 + 0.075;

/** Horse/ox/camel/donkey facing −z; `s` scales it; returns its back height via the caller. */
const beast = (color: Rgb, s: number, kind: 'horse' | 'ox' | 'camel' | 'donkey' = 'horse'): BufferGeometry[] => {
  const p: BufferGeometry[] = [];
  const legH = kind === 'camel' ? 0.13 : kind === 'ox' ? 0.08 : 0.1;
  const bodyH = kind === 'ox' ? 0.1 : 0.085;
  const bodyW = kind === 'ox' ? 0.1 : 0.08;
  p.push(paint(box(bodyW, bodyH, 0.22, 0, legH, 0), color));
  for (const [lx, lz] of [
    [-0.028, -0.075],
    [0.028, -0.075],
    [-0.028, 0.075],
    [0.028, 0.075],
  ] as const) {
    p.push(paint(box(0.026, legH + 0.01, 0.028, lx, 0, lz), kind === 'horse' ? HORSE_D : DARK));
  }
  if (kind === 'ox') {
    p.push(paint(box(0.07, 0.07, 0.07, 0, legH + 0.03, -0.14), color));
    p.push(paint(rod([-0.065, legH + 0.09, -0.15], [0.065, legH + 0.09, -0.15], 0.009, 4), CLOTH));
  } else if (kind === 'camel') {
    p.push(paint(ball(0.05, 0, legH + bodyH + 0.01, 0.01), color));
    p.push(paint(rod([0, legH + 0.06, -0.1], [0, legH + 0.16, -0.16], 0.022, 5), color));
    p.push(paint(box(0.04, 0.04, 0.08, 0, legH + 0.14, -0.19), color));
  } else {
    const neckTop = legH + bodyH + 0.07;
    p.push(paint(rod([0, legH + bodyH * 0.6, -0.08], [0, neckTop, -0.13], 0.03, 5), color));
    p.push(paint(box(0.044, 0.045, 0.1, 0, neckTop - 0.03, -0.16), color));
    // Mane / ears.
    p.push(paint(box(0.014, 0.05, 0.07, 0, neckTop - 0.035, -0.1), kind === 'horse' ? HORSE_D : DARK));
    p.push(paint(box(0.04, 0.03, 0.012, 0, neckTop + 0.01, -0.13), kind === 'horse' ? HORSE_D : color));
  }
  const tail = rod([0, legH + bodyH * 0.8, 0.11], [0, legH * 0.5, 0.15], 0.012, 4);
  p.push(paint(tail, DARK));
  return place(p, 0, 0, 0, s);
};

// --- looks ----------------------------------------------------------------------------------------

const warrior = (s: number, x: number, z: number): BufferGeometry[] => {
  const p = person({ tunic: team(1), legs: HIDE, armR: 1.2, armL: 0.9 });
  // Hide band around the hair (not a cap: the face and hair stay readable).
  p.push(paint(cyl(0.056, 0.058, 0.015, 0, HEAD_Y + 0.024, 0.004, 9), HIDE));
  // A big club raised over the right shoulder.
  p.push(paint(rod([0.075, 0.2, -0.06], [0.095, 0.44, 0.02], 0.014, 5), WOOD));
  p.push(paint(ball(0.04, 0.095, 0.44, 0.02, 0), WOOD_D));
  // Hide-and-wicker shield on the left arm.
  p.push(...roundShield(0.078, -0.09, 0.17, -0.05, 0.35));
  return place(p, x, 0, z, s);
};

/**
 * The warband's second member as a plain dark silhouette a step behind (a spear, no shield, no
 * paint detail): the leader carries the read, the shadow says "a band", not two busy figures.
 */
const companion = (s: number, x: number, z: number): BufferGeometry[] => {
  const shade = team(0.5);
  const p = person({ tunic: shade, belt: shade, legs: DARK, armR: 0.2, armL: 0.3, face: false });
  p.push(paint(rod([0.08, 0.02, -0.02], [0.08, 0.5, -0.02], 0.01, 4), WOOD_D));
  const tip = new ConeGeometry(0.018, 0.05, 4);
  tip.translate(0.08, 0.52, -0.02);
  p.push(paint(tip, DARK));
  return place(p, x, 0, z, s);
};

const lookGeometry = (look: Look): BufferGeometry[] => {
  switch (look) {
    case 'warband': {
      // Playtest 3: two fully painted warriors read busy beside a civilian. One bold warrior in
      // front, a dark companion silhouette behind his shoulder.
      return [...companion(0.86, 0.1, 0.11), ...warrior(1.14, -0.03, -0.03)];
    }
    case 'spearman': {
      const p = person({ tunic: team(1), legs: DARK, armR: 0.2, armL: 1.1 });
      // Bronze crested helmet with a tall secondary-colored crest (classical hoplite).
      // Brim above the eyes so the face shows under the helmet.
      const helm = new SphereGeometry(0.064, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
      helm.translate(0, HEAD_Y + 0.012, 0);
      p.push(paint(helm, BRONZE));
      p.push(paint(box(0.018, 0.07, 0.13, 0, HEAD_Y + 0.045, 0.01), second(1)));
      // Long spear upright in the right hand.
      p.push(paint(rod([0.09, 0.02, -0.04], [0.09, 0.58, -0.04], 0.011), WOOD));
      const tip = new ConeGeometry(0.022, 0.07, 4);
      tip.translate(0.09, 0.6, -0.04);
      p.push(paint(tip, METAL));
      // Big round aspis on the left arm, facing front.
      p.push(...roundShield(0.105, -0.07, 0.17, -0.08, 0.2));
      return p;
    }
    case 'slinger': {
      const p = person({ tunic: team(1), legs: HIDE, armRUp: 2.5, armL: 0.5 });
      // Headband, pouch, and a sling loop whirling over the head.
      p.push(paint(cyl(0.055, 0.057, 0.016, 0, HEAD_Y + 0.024, 0.004, 8), second(1)));
      p.push(paint(box(0.05, 0.05, 0.035, -0.06, 0.1, 0.03), LEATHER));
      // The raised hand is at about (0.16, 0.29); the cord whirls in a flat loop just above it.
      const loop = new TorusGeometry(0.06, 0.006, 3, 14);
      loop.rotateX(Math.PI / 2);
      loop.translate(0.14, 0.37, 0);
      p.push(paint(loop, ROPE));
      p.push(paint(rod([0.135, 0.285, 0], [0.14, 0.37, -0.06], 0.005, 3), ROPE));
      p.push(paint(ball(0.024, 0.14, 0.37, 0.06, 0), STONE));
      return p;
    }
    case 'archer': {
      const p = person({ tunic: team(1), legs: DARK, armL: 1.4, armR: 1.2 });
      // Pointed cap, quiver with fletching on the back, a tall recurve bow held out front.
      const cap = new ConeGeometry(0.06, 0.08, 7);
      cap.translate(0, HEAD_Y + 0.05, 0.005);
      p.push(paint(cap, team(0.72)));
      p.push(paint(cyl(0.022, 0.022, 0.18, 0.04, 0.12, 0.07), LEATHER));
      p.push(paint(box(0.04, 0.03, 0.03, 0.04, 0.3, 0.07), second(1)));
      // A tall bow held out to the left side (reads as a bow from any angle), string taut.
      const bow = new TorusGeometry(0.19, 0.015, 4, 12, Math.PI * 0.8);
      bow.rotateZ(Math.PI * 0.6);
      bow.rotateY(Math.PI / 2 - 0.5);
      bow.translate(-0.06, 0.22, -0.17);
      p.push(paint(bow, lin('#a5713d')));
      p.push(paint(rod([-0.115, 0.05, -0.075], [-0.115, 0.4, -0.075], 0.004, 3), CLOTH));
      return p;
    }
    case 'chariot': {
      // Horse in front, a two-wheeled car with a team-painted side and a standing driver.
      const p = beast(HORSE, 1, 'horse');
      for (const g of p) g.translate(0, 0, -0.13);
      p.push(paint(rod([0, 0.13, -0.08], [0, 0.1, 0.06], 0.01, 4), WOOD_D));
      p.push(paint(box(0.15, 0.08, 0.1, 0, 0.07, 0.1), team(0.95)));
      p.push(paint(box(0.155, 0.018, 0.105, 0, 0.15, 0.1), second(1)));
      p.push(...wheel(0.075, -0.09, 0.075, 0.12), ...wheel(0.075, 0.09, 0.075, 0.12));
      const d = place(person({ tunic: team(1), legs: null, armL: 1.0, armR: 1.0 }), 0, 0.1, 0.11, 0.9);
      p.push(...d);
      const helm = new ConeGeometry(0.058, 0.06, 7);
      helm.translate(0, 0.1 + HEAD_Y * 0.9 + 0.015, 0.11);
      p.push(paint(helm, BRONZE));
      p.push(paint(rod([0.06, 0.2, 0.06], [0.08, 0.5, 0.18], 0.008, 4), WOOD));
      return p;
    }
    case 'horseArcher': {
      const p = beast(HORSE, 1.05, 'horse');
      p.push(paint(box(0.095, 0.02, 0.1, 0, 0.19, 0.01), team(0.8)));
      p.push(paint(box(0.1, 0.012, 0.11, 0, 0.183, 0.01), second(1)));
      const rider = place(person({ tunic: team(1), legs: null, armL: 1.45, armR: 1.1 }), 0, 0.19, 0.01, 0.92);
      p.push(...rider);
      p.push(paint(box(0.022, 0.08, 0.032, -0.055, 0.14, 0.01), DARK), paint(box(0.022, 0.08, 0.032, 0.055, 0.14, 0.01), DARK));
      const cap = new ConeGeometry(0.058, 0.09, 7);
      cap.translate(0, 0.19 + HEAD_Y * 0.92 + 0.05, 0.01);
      p.push(paint(cap, second(0.95)));
      const bow = new TorusGeometry(0.14, 0.009, 3, 10, Math.PI * 0.8);
      bow.rotateZ(Math.PI * 0.6);
      bow.rotateY(Math.PI / 2);
      bow.translate(-0.07, 0.36, -0.17);
      p.push(paint(bow, WOOD_D));
      return p;
    }
    case 'ram': {
      // A wheeled shed with a hide roof in team colors and a bronze-headed log poking out front.
      const p: BufferGeometry[] = [];
      p.push(paint(box(0.2, 0.03, 0.3, 0, 0.05, 0), WOOD));
      p.push(...wheel(0.055, -0.11, 0.055, -0.09), ...wheel(0.055, 0.11, 0.055, -0.09), ...wheel(0.055, -0.11, 0.055, 0.1), ...wheel(0.055, 0.11, 0.055, 0.1));
      for (const sx of [-1, 1]) {
        const roof = new BoxGeometry(0.15, 0.012, 0.32);
        roof.rotateZ(sx * 0.75);
        roof.translate(sx * 0.052, 0.17, 0);
        p.push(paint(roof, team(sx > 0 ? 0.85 : 1)));
      }
      p.push(paint(box(0.012, 0.012, 0.33, 0, 0.225, 0), second(1)));
      p.push(paint(rod([0, 0.12, 0.12], [0, 0.12, -0.25], 0.03, 6), WOOD_D));
      const head = new ConeGeometry(0.04, 0.07, 6);
      head.rotateX(-Math.PI / 2);
      head.translate(0, 0.12, -0.28);
      p.push(paint(head, BRONZE));
      return p;
    }
    case 'catapult': {
      // Frame on wheels, a torsion bundle, and the throwing arm cocked back with a stone in the cup.
      const p: BufferGeometry[] = [];
      p.push(paint(box(0.18, 0.03, 0.3, 0, 0.05, 0), WOOD));
      p.push(...wheel(0.05, -0.1, 0.05, -0.1), ...wheel(0.05, 0.1, 0.05, -0.1), ...wheel(0.05, -0.1, 0.05, 0.1), ...wheel(0.05, 0.1, 0.05, 0.1));
      for (const sx of [-1, 1]) p.push(paint(rod([sx * 0.07, 0.08, 0.02], [sx * 0.05, 0.25, -0.05], 0.014, 4), WOOD_D));
      p.push(paint(rod([-0.075, 0.2, -0.04], [0.075, 0.2, -0.04], 0.012, 4), WOOD_D));
      p.push(paint(hcyl(0.04, 0.12, 0, 0.1, 0.02), ROPE));
      p.push(paint(rod([0, 0.1, 0.03], [0, 0.4, 0.16], 0.016, 5), WOOD));
      p.push(paint(cyl(0.045, 0.03, 0.03, 0, 0.395, 0.16, 7), LEATHER));
      p.push(paint(ball(0.035, 0, 0.44, 0.16, 0), STONE));
      p.push(paint(box(0.12, 0.05, 0.05, 0, 0.08, 0.12), team(1)));
      p.push(paint(box(0.124, 0.014, 0.054, 0, 0.12, 0.12), second(1)));
      return p;
    }
    case 'canoe': {
      // Long dugout with a carved, upturned prow and three paddlers in team tunics.
      const p: BufferGeometry[] = [];
      const hull = new CylinderGeometry(0.06, 0.04, 0.5, 8, 1);
      hull.rotateX(Math.PI / 2);
      hull.scale(1, 0.6, 1);
      hull.translate(0, 0.03, 0);
      p.push(paint(hull, WOOD));
      p.push(paint(box(0.1, 0.012, 0.44, 0, 0.055, 0), WOOD_D));
      p.push(paint(rod([0, 0.04, -0.24], [0, 0.17, -0.31], 0.02, 5), second(1)));
      p.push(paint(ball(0.026, 0, 0.18, -0.31, 0), team(1)));
      p.push(paint(rod([0, 0.04, 0.24], [0, 0.11, 0.29], 0.016, 5), second(0.9)));
      for (const [k, z] of [
        [0, -0.13],
        [1, 0.0],
        [2, 0.13],
      ] as const) {
        const side = k % 2 === 0 ? 1 : -1;
        p.push(...place(person({ tunic: team(1), legs: null, armL: 0.8, armR: 0.8 }), 0, 0.04, z, 0.62));
        p.push(paint(rod([side * 0.04, 0.17, z - 0.02], [side * 0.14, -0.02, z + 0.05], 0.007, 4), WOOD_D));
        p.push(paint(box(0.012, 0.05, 0.025, side * 0.14, -0.04, z + 0.05), WOOD_D));
      }
      return p;
    }
    case 'galley': {
      // Hull with a bronze ram, a curled stern, oar banks each side, and a big square sail in team
      // colors with a secondary stripe: the silhouette that reads from far away.
      const p: BufferGeometry[] = [];
      const hull = new CylinderGeometry(0.1, 0.06, 0.52, 8, 1);
      hull.rotateX(Math.PI / 2);
      hull.scale(1, 0.75, 1);
      hull.translate(0, 0.05, 0);
      p.push(paint(hull, WOOD));
      p.push(paint(box(0.17, 0.02, 0.46, 0, 0.085, 0), WOOD_D));
      p.push(paint(box(0.175, 0.025, 0.42, 0, 0.06, 0), team(0.8)));
      const ram = new ConeGeometry(0.03, 0.09, 5);
      ram.rotateX(-Math.PI / 2);
      ram.translate(0, 0.03, -0.3);
      p.push(paint(ram, BRONZE));
      p.push(paint(rod([0, 0.08, 0.25], [0, 0.2, 0.3], 0.02, 5), WOOD_D));
      p.push(paint(ball(0.028, 0, 0.21, 0.28, 0), second(1)));
      for (let k = 0; k < 5; k++) {
        const z = -0.16 + k * 0.08;
        for (const sx of [-1, 1]) p.push(paint(rod([sx * 0.08, 0.08, z], [sx * 0.24, -0.02, z + 0.03], 0.006, 3), WOOD_D));
      }
      p.push(paint(rod([0, 0.08, -0.01], [0, 0.58, -0.01], 0.012), WOOD_D));
      p.push(paint(rod([-0.17, 0.5, -0.01], [0.17, 0.5, -0.01], 0.008, 4), WOOD_D));
      // Sail in three bands (team / secondary stripe / team), bellied and fluttering together.
      // Playtest 3: ships rest broadside-on, so a sail square to the keel showed its edge to the
      // camera. The sail is bigger and leans back ~40° about the yard (its face tilts up toward
      // the elevated camera from either side), with the yard braced a little.
      const SAIL_TILT = 0.7;
      const SAIL_BRACE = 0.3;
      for (const [y0, h, c] of [
        [0.4, 0.1, team(1)],
        [0.34, 0.06, second(1)],
        [0.2, 0.14, team(0.92)],
      ] as const) {
        const band = new BoxGeometry(0.38, h, 0.012, 6, 1, 1);
        band.translate(0, y0 + h / 2 - 0.5, 0);
        const bp = band.getAttribute('position');
        for (let i = 0; i < bp.count; i++) bp.setZ(i, bp.getZ(i) - (1 - (bp.getX(i) / 0.19) ** 2) * 0.04);
        band.rotateX(SAIL_TILT);
        band.rotateY(SAIL_BRACE);
        band.translate(0, 0.5, -0.01);
        p.push(flutter(band, c, 0, 0.5));
      }
      return p;
    }
    case 'settler': {
      // A family on the road: a pale ox pulling a two-wheeled cart piled with bundles under a
      // team-colored cloth, the parent walking beside with a staff and a child at their side.
      const p = beast(OX, 0.85, 'ox');
      for (const g of p) g.translate(0.04, 0, -0.16);
      p.push(paint(rod([0.04, 0.1, -0.05], [0.04, 0.09, 0.05], 0.009, 4), WOOD_D));
      p.push(paint(box(0.15, 0.05, 0.16, 0.04, 0.07, 0.12), WOOD));
      p.push(...wheel(0.06, -0.04, 0.06, 0.12), ...wheel(0.06, 0.12, 0.06, 0.12));
      p.push(paint(ball(0.07, 0.04, 0.16, 0.12), team(1)));
      p.push(paint(ball(0.045, 0.0, 0.2, 0.1, 0), CLOTH));
      p.push(paint(ball(0.04, 0.09, 0.19, 0.16, 0), second(1)));
      p.push(...place(person({ tunic: team(0.95), armR: 0.5 }), -0.13, 0, 0.0, 0.92));
      p.push(paint(rod([-0.065, 0.0, -0.05], [-0.065, 0.36, -0.04], 0.008, 4), WOOD));
      p.push(...place(person({ tunic: second(0.95), belt: team(1) }), -0.15, 0, 0.13, 0.62));
      return p;
    }
    case 'scout': {
      // A lone walker: hooded travelling cloak in team colors, a tall staff, a bedroll.
      const p = person({ tunic: team(0.9), armR: 0.6, armL: 0.3 });
      const cloak = new ConeGeometry(0.1, 0.27, 8, 1, true);
      cloak.translate(0, 0.135 + 0.04, 0.012);
      p.push(paint(cloak, team(0.78)));
      const hood = new SphereGeometry(0.066, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.6);
      hood.rotateX(1.0);
      hood.translate(0, HEAD_Y - 0.005, 0.012);
      p.push(paint(hood, team(0.7)));
      p.push(paint(hcyl(0.03, 0.11, 0, 0.24, 0.07), second(1)));
      p.push(paint(rod([0.09, 0.0, -0.06], [0.095, 0.46, -0.06], 0.009, 4), WOOD));
      p.push(paint(ball(0.016, 0.095, 0.465, -0.06, 0), second(1)));
      return p;
    }
    case 'merchant': {
      // A camel loaded with striped bales, the trader leading it by a rope.
      const p = beast(CAMEL, 0.82, 'camel');
      for (const g of p) g.translate(0.07, 0, 0.04);
      for (const sx of [-1, 1]) {
        p.push(paint(box(0.06, 0.08, 0.1, 0.07 + sx * 0.075, 0.12, 0.04), sx < 0 ? team(1) : second(1)));
        p.push(paint(box(0.062, 0.016, 0.102, 0.07 + sx * 0.075, 0.15, 0.04), sx < 0 ? second(1) : team(1)));
      }
      p.push(paint(ball(0.04, 0.07, 0.25, 0.04, 0), CLOTH));
      p.push(...place(person({ tunic: team(1), armR: 1.0 }), -0.1, 0, -0.08, 0.9));
      const hat = new CylinderGeometry(0.04, 0.085, 0.03, 9);
      hat.translate(-0.1, HEAD_Y * 0.9 + 0.03, -0.08);
      p.push(paint(hat, CLOTH));
      p.push(paint(rod([-0.04, 0.16, -0.13], [0.07, 0.17, -0.11], 0.004, 3), ROPE));
      return p;
    }
    case 'general': {
      // A commander a head taller than the troops: gilded plumed helm, cape, and a big square
      // standard on a crossbar (primary field, secondary band, gold finial) that reads from afar.
      const p = place(person({ tunic: team(1), legs: DARK, armR: 0.9, armL: 0.4 }), 0, 0, 0, 1.15);
      const cape = new BoxGeometry(0.14, 0.22, 0.02);
      cape.rotateX(-0.12);
      cape.translate(0, 0.16, 0.06);
      p.push(paint(cape, second(0.9)));
      const helm = new SphereGeometry(0.072, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
      helm.translate(0, HEAD_Y * 1.15 + 0.014, 0);
      p.push(paint(helm, GOLD));
      p.push(paint(box(0.02, 0.09, 0.12, 0, HEAD_Y * 1.15 + 0.05, 0.01), team(0.75)));
      const px = 0.11;
      p.push(paint(rod([px, 0.0, -0.03], [px, 0.76, -0.03], 0.011), WOOD_D));
      p.push(paint(rod([px - 0.005, 0.7, -0.03], [px + 0.22, 0.7, -0.03], 0.008, 4), WOOD_D));
      const flag = new BoxGeometry(0.2, 0.2, 0.01, 4, 3, 1);
      flag.translate(px + 0.105, 0.595, -0.03);
      p.push(flutter(flag, team(1), px, 0.2));
      const band = new BoxGeometry(0.2, 0.045, 0.012, 4, 1, 1);
      band.translate(px + 0.105, 0.6, -0.031);
      p.push(flutter(band, second(1), px, 0.2));
      const fin = new ConeGeometry(0.03, 0.06, 5);
      fin.translate(px, 0.79, -0.03);
      p.push(paint(fin, GOLD), paint(ball(0.022, px, 0.76, -0.03, 0), GOLD));
      return p;
    }
    case 'explorer': {
      // A famous traveller: wide-brimmed hat, pack and rolled chart, and a long swallowtail
      // pennant streaming from a tall staff (distinct from the general's square standard).
      const p = place(person({ tunic: team(0.95), armR: 0.8, armL: 0.6 }), 0, 0, 0, 1.1);
      p.push(paint(cyl(0.11, 0.11, 0.012, 0, HEAD_Y * 1.1 + 0.03, 0, 12), LEATHER));
      p.push(paint(cyl(0.05, 0.058, 0.05, 0, HEAD_Y * 1.1 + 0.035, 0, 8), LEATHER));
      p.push(paint(box(0.1, 0.12, 0.06, 0, 0.17, 0.07), LEATHER));
      p.push(paint(hcyl(0.022, 0.14, -0.03, 0.15, -0.065), CLOTH));
      const px = -0.1;
      p.push(paint(rod([px, 0.0, -0.04], [px, 0.72, -0.04], 0.01), WOOD));
      p.push(paint(ball(0.02, px, 0.73, -0.04, 0), GOLD));
      // Swallowtail: two tapering tails from the staff top.
      for (const [dy, c] of [
        [0, team(1)],
        [-0.055, second(1)],
      ] as const) {
        const tail = new ConeGeometry(0.03, 0.3, 4, 3);
        tail.rotateZ(Math.PI / 2);
        tail.scale(1, 1, 0.25);
        tail.translate(px - 0.155, 0.66 + dy, -0.04);
        p.push(flutter(tail, c, px, 0.3));
      }
      return p;
    }
  }
};

export const figureGeometry = (look: Look): BufferGeometry => assemble(lookGeometry(look));

/** Every look's geometry (built once per renderer). */
export const allFigureGeometries = (): Record<Look, BufferGeometry> => {
  const out: Partial<Record<Look, BufferGeometry>> = {};
  for (const k of LOOKS) out[k] = figureGeometry(k);
  return out as Record<Look, BufferGeometry>;
};

/**
 * Round toy base: dark wooden plinth, a band in the owner's primary, a thin secondary rule
 * and a parchment top. The rim (relation color) is its own unlit layer.
 */
export const unitBaseGeometry = (): BufferGeometry =>
  assemble([
    paint(cyl(0.168, 0.178, 0.014, 0, 0, 0, 20), lin('#3d3026')),
    paint(cyl(0.163, 0.168, 0.026, 0, 0.014, 0, 20), team(0.95)),
    paint(new TorusGeometry(0.128, 0.007, 3, 24).rotateX(Math.PI / 2).translate(0, 0.041, 0), second(1)),
    paint(cyl(0.116, 0.12, 0.004, 0, 0.04, 0, 20), lin('#d6c9a6')),
  ]);

/**
 * Fortified marker: a ring of sharpened stakes around the base, with three small round shields
 * (owner primary) propped along the front.
 */
export const palisadeGeometry = (): BufferGeometry => {
  const p: BufferGeometry[] = [];
  const n = 14;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const r = 0.205;
    const h = 0.07 + (k % 2) * 0.018;
    p.push(paint(cyl(0.011, 0.012, h, Math.cos(a) * r, 0, Math.sin(a) * r, 5), WOOD));
    const tip = new ConeGeometry(0.012, 0.028, 5);
    tip.translate(Math.cos(a) * r, h + 0.014, Math.sin(a) * r);
    p.push(paint(tip, HIDE));
  }
  p.push(paint(new TorusGeometry(0.205, 0.006, 3, 28).rotateX(Math.PI / 2).translate(0, 0.045, 0), ROPE));
  for (const a of [Math.PI * 0.32, Math.PI * 0.5, Math.PI * 0.68]) {
    const s = roundShield(0.042, 0, 0, 0);
    for (const g of s) {
      g.rotateX(-0.25);
      g.rotateY(-a + Math.PI / 2 + Math.PI);
      g.translate(Math.cos(a) * 0.225, 0.05, Math.sin(a) * 0.225);
    }
    p.push(...s);
  }
  return assemble(p);
};

/** Embarked land unit: a log raft with a little cloth sail it stands on (bobs with the water). */
export const raftGeometry = (): BufferGeometry => {
  const p: BufferGeometry[] = [];
  for (let k = -2; k <= 2; k++) p.push(paint(rod([k * 0.06, 0.0, -0.18], [k * 0.06, 0.0, 0.18], 0.03, 6), k % 2 === 0 ? WOOD : WOOD_D));
  p.push(paint(rod([-0.16, 0.03, -0.12], [0.16, 0.03, -0.12], 0.012, 4), ROPE), paint(rod([-0.16, 0.03, 0.12], [0.16, 0.03, 0.12], 0.012, 4), ROPE));
  p.push(paint(rod([0.13, 0.02, 0.1], [0.13, 0.36, 0.1], 0.008, 4), WOOD_D));
  const sail = new BoxGeometry(0.012, 0.18, 0.15, 1, 2, 3);
  sail.translate(0.13, 0.24, 0.03);
  p.push(flutter(sail, second(1), 0.13, 0.15));
  return assemble(p);
};

/** Raiders' dark red pennon on a short pole at the back of the base (team = raider primary). */
export const pennonGeometry = (): BufferGeometry => {
  const p: BufferGeometry[] = [paint(rod([0, 0, 0], [0, 0.34, 0], 0.008, 4), WOOD_D)];
  const tail = new ConeGeometry(0.035, 0.16, 3, 2);
  tail.rotateZ(Math.PI / 2);
  tail.scale(1, 1, 0.2);
  tail.translate(0.08, 0.3, 0);
  p.push(flutter(tail, team(1), 0, 0.16));
  p.push(paint(ball(0.014, 0, 0.345, 0, 0), BRONZE));
  return assemble(p);
};

/**
 * At-war marker (playtest 3: rivals and enemies looked alike in a war): a short pole with a
 * pennant in the instance color (war red) under a pair of crossed swords, set behind the base on
 * the side away from the raiders' pennon. Faces the camera (instance yaw = view yaw).
 */
export const warMarkGeometry = (): BufferGeometry => {
  const p: BufferGeometry[] = [paint(rod([0, 0, 0], [0, 0.31, 0], 0.009, 4), WOOD_D)];
  const flag = new BoxGeometry(0.13, 0.085, 0.008, 4, 1, 1);
  flag.translate(0.067, 0.235, 0);
  p.push(flutter(flag, team(1), 0, 0.13));
  for (const sgn of [-1, 1]) {
    const parts = [paint(new BoxGeometry(0.016, 0.15, 0.008).translate(0, 0.05, 0), METAL), paint(new BoxGeometry(0.06, 0.014, 0.012).translate(0, -0.03, 0), BRONZE), paint(new BoxGeometry(0.014, 0.04, 0.012).translate(0, -0.055, 0), DARK)];
    for (const g of parts) {
      g.rotateZ(sgn * 0.62);
      g.translate(0, 0.39, -0.004);
    }
    p.push(...parts);
  }
  return assemble(p);
};

/** Paved forecourt pad that units in a settlement stand on (keeps them clear of the buildings). */
export const forecourtGeometry = (): BufferGeometry => {
  const p: BufferGeometry[] = [paint(cyl(0.2, 0.21, 0.012, 0, 0, 0, 9), lin('#8f8574')), paint(cyl(0.185, 0.19, 0.006, 0, 0.012, 0, 9), lin('#cbbf9f'))];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    p.push(paint(box(0.05, 0.006, 0.04, Math.cos(a) * 0.12, 0.014, Math.sin(a) * 0.12).rotateY(a), lin('#b7aa8a')));
  }
  return assemble(p);
};
