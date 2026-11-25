/**
 * npx tsx scripts/make-icons.ts — rasterizes the stand-in app icon (public/icon.svg) into the
 * PNGs iOS and the web manifest need. iOS ignores SVG apple-touch-icons, hence PNG.
 * No dependencies: shapes are drawn with point-in-polygon + 4x4 supersampling, PNG via zlib.
 * Re-run only if the icon design changes; outputs are committed in public/.
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

type Rgb = [number, number, number];
type Pt = [number, number];
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// Same geometry as public/icon.svg (64-unit viewBox).
const BG = hex('#5b7f5a');
const HEX_FILL = hex('#e9dcb8');
const HEX_STROKE = hex('#3d5a3c');
const HOUSE = hex('#c0704a');
const HEXAGON: Pt[] = [[32, 10], [51, 21], [51, 43], [32, 54], [13, 43], [13, 21]];
const HOUSE_POLY: Pt[] = [[24, 40], [24, 30], [32, 24], [40, 30], [40, 40]];

const inside = (x: number, y: number, poly: Pt[]): boolean => {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as Pt;
    const [xj, yj] = poly[j] as Pt;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
};
const distToSegment = (x: number, y: number, [ax, ay]: Pt, [bx, by]: Pt): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
};
const nearEdge = (x: number, y: number, poly: Pt[], half: number): boolean =>
  poly.some((p, i) => distToSegment(x, y, p, poly[(i + 1) % poly.length] as Pt) <= half);

/** Color at a point of the 64-unit design, or null for transparent. */
const sample = (x: number, y: number, rounded: boolean): Rgb | null => {
  if (rounded) {
    const r = 14;
    const cx = Math.min(Math.max(x, r), 64 - r);
    const cy = Math.min(Math.max(y, r), 64 - r);
    if (Math.hypot(x - cx, y - cy) > r) return null;
  }
  if (inside(x, y, HOUSE_POLY)) return HOUSE;
  if (nearEdge(x, y, HEXAGON, 1.5)) return HEX_STROKE;
  if (inside(x, y, HEXAGON)) return HEX_FILL;
  return BG;
};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const b of buf) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** `scale` < 1 shrinks the design inside a full-bleed background (maskable safe zone). */
const render = (size: number, opts: { rounded: boolean; scale: number }): Buffer => {
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((px + (sx + 0.5) / SS) / size) * 64;
          const v = ((py + (sy + 0.5) / SS) / size) * 64;
          const x = 32 + (u - 32) / opts.scale;
          const y = 32 + (v - 32) / opts.scale;
          const c = sample(x, y, opts.rounded);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 1;
          }
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const n = SS * SS;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / n) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
};

const out = (name: string): string => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
// iOS masks the icon itself and shows black behind transparency: full-bleed, no rounding.
writeFileSync(out('apple-touch-icon.png'), render(180, { rounded: false, scale: 1 }));
writeFileSync(out('icon-192.png'), render(192, { rounded: true, scale: 1 }));
writeFileSync(out('icon-512.png'), render(512, { rounded: true, scale: 1 }));
writeFileSync(out('icon-maskable-512.png'), render(512, { rounded: false, scale: 0.8 }));
console.log('wrote public/apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png');
