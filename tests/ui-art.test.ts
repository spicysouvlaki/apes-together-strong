/**
 * UI art (src/ui/art): icon registry, procedural portraits, culture crests and banners are
 * deterministic and cover all content; no emoji or pictograph glyphs remain in the UI.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '../src/content';
import { ICON_NAMES, hasIcon, iconMarkup } from '../src/ui/art/icons-data';
import { AGES, BEARDS, EMBLEMS, FACES, GARMENTS, HAIR, HAIR_TONES, HEADWEAR, KIND_ICON, PROPS, VIEWS, portraitSignature, portraitSilhouette, portraitSpec } from '../src/ui/art/portrait-spec';
import { FIGURE_PRESENTATION, presentationOf } from '../src/ui/art/portrait-presentation';
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
  const specOf = (f: (typeof content.figures)[number]) => portraitSpec({ id: f.id, kind: f.kind, archetype: f.archetype, style: styleOf(f.culture), culture: f.culture });

  it('every figure in content gets a valid, deterministic spec', () => {
    for (const f of content.figures) {
      const a = specOf(f);
      expect(a).toEqual(specOf(f));
      expect(HEADWEAR).toContain(a.headwear);
      expect(GARMENTS).toContain(a.garment);
      expect(HAIR).toContain(a.hair);
      expect(BEARDS).toContain(a.beard);
      expect(HAIR_TONES).toContain(a.hairTone);
      expect(AGES).toContain(a.age);
      expect(FACES).toContain(a.face);
      expect(VIEWS).toContain(a.view);
      expect(PROPS).toContain(a.prop);
      expect(EMBLEMS).toContain(a.emblem);
      expect(hasIcon(a.kindIcon)).toBe(true);
      expect(a.tilt).toBeGreaterThanOrEqual(-3);
      expect(a.tilt).toBeLessThanOrEqual(3);
      expect(a.frame).toBe(f.kind === 'legend' ? 'legend' : 'medallion');
      if (f.archetype) expect(a.mode).toBe('emblem');
    }
  });

  it('archetypes never get a face; every launch culture has a known art style', () => {
    expect(content.figures.some((f) => f.archetype)).toBe(true);
    for (const c of content.cultures) expect(ART_STYLES).toContain(artStyleOf(c.architecture));
    expect(artStyleOf('unknown_style')).toBe('generic');
  });

  it('archetype emblems follow the role in the id', () => {
    const emblem = (id: string, kind: 'explorer' | 'builder' | 'spiritual') => portraitSpec({ id, kind, archetype: true, style: 'arctic', culture: 'inuit' }).emblem;
    expect(emblem('x_umiak_captain', 'explorer')).toBe('boat');
    expect(emblem('x_iglu_builder', 'builder')).toBe('iglu');
    expect(emblem('x_angakkuq', 'spiritual')).toBe('drum');
  });

  it('women in the presentation table are never bearded; unknown ids get a neutral bust', () => {
    for (const [id, h] of Object.entries(FIGURE_PRESENTATION)) {
      const f = content.figures.find((x) => x.id === id);
      if (!f || h.p !== 'f') continue;
      const s = specOf(f);
      expect(s.beard, id).toBe('none');
      expect(s.presentation).toBe('f');
    }
    expect(presentationOf('a_figure_added_later').p).toBe('n');
    for (let i = 0; i < 40; i++) {
      const s = portraitSpec({ id: `new_figure_${i}`, kind: 'thinker', archetype: false, style: 'aegean', culture: 'greek' });
      expect(s.beard).toBe('none');
      expect(['veil', 'wimple', 'diadem', 'hairpins', 'boqta', 'vultureCrown']).not.toContain(s.headwear);
    }
  });

  it('every presentation entry names a figure in content (catches renamed ids)', () => {
    const ids = new Set(content.figures.map((f) => f.id));
    for (const id of Object.keys(FIGURE_PRESENTATION)) expect(ids.has(id), id).toBe(true);
  });

  it('named figures of a culture vary in silhouette, face, hair and beard', () => {
    for (const c of content.cultures) {
      const named = content.figures.filter((f) => f.culture === c.id && !f.archetype);
      const silhouettes = new Set(named.map((f) => portraitSilhouette(specOf(f))));
      expect(silhouettes.size, c.id).toBeGreaterThanOrEqual(Math.min(named.length, Math.max(3, Math.ceil(named.length * 0.6))));
      // Several head views and facial structures within every culture with enough figures.
      if (named.length >= 4) {
        expect(new Set(named.map((f) => specOf(f).face)).size, c.id).toBeGreaterThanOrEqual(3);
        expect(new Set(named.map((f) => specOf(f).age)).size, c.id).toBeGreaterThanOrEqual(2);
      }
    }
    const all = content.figures.filter((f) => !f.archetype).map(specOf);
    expect(new Set(all.map((s) => s.view))).toEqual(new Set(VIEWS));
    expect(new Set(all.map((s) => s.hair)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(all.map((s) => s.beard)).size).toBe(BEARDS.length);
    expect(new Set(all.map((s) => s.prop)).size).toBeGreaterThanOrEqual(15);
  });

  it('no two figures in one offer pool (same culture and age) look identical', () => {
    const pools = new Map<string, string[]>();
    for (const f of content.figures) {
      const key = `${f.culture}:${f.age}`;
      pools.set(key, [...(pools.get(key) ?? []), f.id]);
    }
    for (const [key, ids] of pools) {
      const seen = new Map<string, string>();
      for (const id of ids) {
        const f = content.figures.find((x) => x.id === id);
        if (!f) continue;
        const sig = portraitSignature(specOf(f));
        expect(seen.get(sig), `${key}: ${id} looks like ${seen.get(sig)}`).toBeUndefined();
        seen.set(sig, id);
      }
    }
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
