import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { parseHexColor, type Rgb } from '../src/render/colors';
import { OVERLAY_COLORS, REACH_STYLE, reachContrast } from '../src/render/highlight-style';
import { ART, artDirectTerrain, scaleRgb } from '../src/render/palette';
import { deltaE, gradeTerrainColors, rgbToLab } from '../src/render/terrain-style';

const content = loadContent();
const water = new Map(content.terrain.map((t) => [t.id, t.water]));
const terrain = artDirectTerrain(gradeTerrainColors(content.terrain.map((t) => ({ id: t.id, color: t.color, water: t.water }))), water);

/** Every ground the highlight can sit on: graded terrain (lit a bit darker/brighter), parchment. */
const grounds = (): [string, Rgb][] => {
  const out: [string, Rgb][] = [];
  for (const [id, c] of terrain) {
    out.push([id, c], [`${id} shade`, scaleRgb(c, 0.85)], [`${id} lit`, scaleRgb(c, 1.12)]);
  }
  out.push(['parchment', parseHexColor(ART.paper)], ['plinth', parseHexColor(ART.plinth0)]);
  return out;
};

describe('reachable-tile highlight (playtest 3: barely visible)', () => {
  it('its outline stands out on every terrain, lit or shaded, and on the parchment', () => {
    for (const [id, c] of grounds()) {
      const k = reachContrast(c);
      expect(k.outline, id).toBeGreaterThanOrEqual(40);
    }
  });

  it('its wash visibly shifts every ground (not a cream tint lost on desert)', () => {
    for (const [id, c] of grounds()) expect(reachContrast(c).wash, id).toBeGreaterThanOrEqual(15);
  });

  it('is distinct from the attack highlight, the route ribbon and the settle seal', () => {
    const wash = rgbToLab(parseHexColor(REACH_STYLE.wash));
    for (const [name, hex] of Object.entries(OVERLAY_COLORS)) {
      expect(deltaE(wash, rgbToLab(parseHexColor(hex))), name).toBeGreaterThanOrEqual(30);
    }
  });
});
