/**
 * UI art (src/ui/art): icon registry, procedural portraits, culture crests and banners are
 * deterministic and cover all content; no emoji or pictograph glyphs remain in the UI.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '../src/content';
import { ICON_NAMES, hasIcon, iconMarkup } from '../src/ui/art/icons-data';
import { GARMENTS, HAIR, HEADWEAR, KIND_ICON, portraitSpec } from '../src/ui/art/portrait-spec';
import { MOTIFS, bannerSpec, crestSpec, leaderEmblem } from '../src/ui/art/heraldry-spec';
import { ART_STYLES, artStyleOf, cultureTones, luminance, mix, textOn, toRgb } from '../src/ui/art/palette';
import { YIELD_ICON, happinessIcon } from '../src/ui/shell/format';

const content = loadContent();
const styleOf = (culture: string) => artStyleOf(content.cultures.find((c) => c.id === culture)?.architecture);

const uiFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? uiFiles(p) : /\.(tsx?|css)$/.test(f) ? [p] : [];
  });
const UI = uiFiles(join(__dirname, '../src/ui'));

describe('icon set', () => {
  it('has a drawing for every name, each a non-empty SVG fragment', () => {
    for (const n of ICON_NAMES) {
      const m = iconMarkup(n);
      expect(m.length, n).toBeGreaterThan(10);
      expect(m.startsWith('<'), n).toBe(true);
      // Balanced tags: every element is self-closing or closed.
      expect((m.match(/<(?!\/)[a-z]+/g) ?? []).length, n).toBe((m.match(/\/>|<\/[a-z]+>/g) ?? []).length);
    }
  });

  it('covers yields, moods, figure kinds and unit classes', () => {
    for (const icon of Object.values(YIELD_ICON)) expect(hasIcon(icon)).toBe(true);
    for (const h of [20, 5, -5, -20]) expect(hasIcon(happinessIcon(h))).toBe(true);
    for (const icon of Object.values(KIND_ICON)) expect(hasIcon(icon)).toBe(true);
    for (const u of content.units) expect(hasIcon(u.unitClass), u.unitClass).toBe(true);
    for (const l of content.leaders) expect(hasIcon(leaderEmblem(l.id))).toBe(true);
  });

  it('every literal <Icon name="…"> in src/ui exists', () => {
    const used = new Set<string>();
    for (const f of UI) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<Icon[^>]*?\bname=(?:"([a-zA-Z]+)"|\{'([a-zA-Z]+)'\})/g)) used.add(m[1] ?? m[2] ?? '');
      for (const m of src.matchAll(/\bicon: '([a-zA-Z]+)'/g)) used.add(m[1] ?? '');
      for (const m of src.matchAll(/<Icon name=\{[^}]*?\? '([a-zA-Z]+)' : '([a-zA-Z]+)'/g)) {
        used.add(m[1] ?? '');
        used.add(m[2] ?? '');
      }
    }
    expect(used.size).toBeGreaterThan(30);
    for (const n of used) expect(hasIcon(n), n).toBe(true);
  });

  it('no emoji or pictograph glyphs are left in the UI', () => {
    // Emoji, dingbats, misc symbols and arrows used as icons before the icon set.
    const pictograph = /[\u{1F300}-\u{1FAFF}☀-➿⬀-⯿←-⇿⌀-⏿■-◿]/u;
    for (const f of UI) {
      if (f.includes('/art/') && f.endsWith('icons-data.ts')) continue;
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$|\/\*.*?\*\/|^\s*\*.*$/g, '');
        expect(pictograph.test(code), `${f}:${i + 1}: ${line.trim()}`).toBe(false);
      });
    }
  });
});

describe('portraits', () => {
  it('every figure in content gets a valid, deterministic spec', () => {
    for (const f of content.figures) {
      const input = { id: f.id, kind: f.kind, archetype: f.archetype, style: styleOf(f.culture), culture: f.culture };
      const a = portraitSpec(input);
      const b = portraitSpec(input);
      expect(a).toEqual(b);
      expect(HEADWEAR).toContain(a.headwear);
      expect(GARMENTS).toContain(a.garment);
      expect(HAIR).toContain(a.hair);
      expect(hasIcon(a.kindIcon)).toBe(true);
      expect(a.tilt).toBeGreaterThanOrEqual(-3);
      expect(a.tilt).toBeLessThanOrEqual(3);
      expect(a.mode).toBe(f.archetype ? 'emblem' : 'bust');
      expect(a.frame).toBe(f.kind === 'legend' ? 'legend' : 'medallion');
    }
  });

  it('archetypes never get a face; every launch culture has a known art style', () => {
    expect(content.figures.some((f) => f.archetype)).toBe(true);
    for (const c of content.cultures) expect(ART_STYLES).toContain(artStyleOf(c.architecture));
    expect(artStyleOf('unknown_style')).toBe('generic');
  });

  it('figures of one culture vary', () => {
    const greek = content.figures.filter((f) => f.culture === 'greek' && !f.archetype);
    const looks = new Set(greek.map((f) => JSON.stringify(portraitSpec({ id: f.id, kind: f.kind, archetype: false, style: 'aegean', culture: f.culture }))));
    expect(looks.size).toBe(greek.length);
  });
});

describe('crests and banners', () => {
  it('every culture has a crest with a motif and a legible charge', () => {
    const motifs = new Set<string>();
    for (const c of content.cultures) {
      const s = crestSpec(styleOf(c.id), c.id);
      expect(MOTIFS).toContain(s.motif);
      motifs.add(s.motif);
      expect(s.charge).toBe(textOn(s.tones.base));
    }
    // Launch cultures are told apart by motif, not just color.
    expect(motifs.size).toBe(content.cultures.length);
  });

  it('culture pigments are distinct and dark enough for paper text', () => {
    const bases = content.cultures.map((c) => cultureTones(styleOf(c.id), c.id).base);
    expect(new Set(bases).size).toBe(bases.length);
    for (const b of bases) expect(luminance(b)).toBeLessThan(0.33);
  });

  it('banner motifs come from signature cultures, deduplicated, at most three', () => {
    const s = bannerSpec({ primary: '#0072b2', secondary: '#ffffff', leader: 'sage', signatureStyles: ['aegean', 'aegean', 'sinic', 'nile', 'arctic'], seed: 'p1' });
    expect(s.motifs).toEqual(['amphora', 'ding', 'lotus']);
    expect(s.emblem).toBe('thinker');
    expect(bannerSpec({ primary: '#000000', secondary: '#000000', leader: 'x', signatureStyles: [], seed: 'p1' }).secondary).not.toBe('#000000');
  });

  it('color helpers parse and mix', () => {
    expect(toRgb('#ff0000')).toEqual([255, 0, 0]);
    expect(toRgb('hsl(0 100% 50%)')).toEqual([255, 0, 0]);
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
