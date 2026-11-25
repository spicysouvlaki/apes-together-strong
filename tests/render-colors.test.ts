import { describe, expect, it } from 'vitest';
import { CITY_STATE_PREFIX, RAIDER_PLAYER, type GameState } from '../src/contracts/sim-api';
import {
  CITY_STATE_COLORS,
  FOG_EXPLORED,
  FOG_UNEXPLORED,
  FOG_VISIBLE,
  PALETTE,
  RAIDER_COLORS,
  UNKNOWN_COLORS,
  classifyFog,
  ownerColors,
  parseHexColor,
  propColor,
  resourceColor,
  rgbToHex,
  tileTopColor,
} from '../src/render/colors';
import { LabelSlotCache, labelKey, labelSpec, labelText } from '../src/render/labels';

describe('render colors', () => {
  it('parses and formats hex colors', () => {
    expect(parseHexColor('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(rgbToHex(parseHexColor('#9cbf7a'))).toBe('#9cbf7a');
    expect(parseHexColor('nope', [0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('resolves owner colors for players, city-states and raiders', () => {
    const state = {
      players: { p1: { colors: { primary: '#123456', secondary: '#abcdef' } } },
    } as unknown as Pick<GameState, 'players'>;
    expect(ownerColors(state, 'p1')).toEqual({ primary: '#123456', secondary: '#abcdef' });
    expect(ownerColors(state, `${CITY_STATE_PREFIX}carthage`)).toBe(CITY_STATE_COLORS);
    expect(ownerColors(state, RAIDER_PLAYER)).toBe(RAIDER_COLORS);
    expect(ownerColors(state, 'ghost')).toBe(UNKNOWN_COLORS);
    expect(ownerColors(state, null)).toBe(UNKNOWN_COLORS);
  });

  it('classifies fog: unexplored / explored / visible', () => {
    const out = new Uint8Array(5);
    classifyFog(5, [1, 1, 0, 0, 1], [0, 3, 99], out);
    expect([...out]).toEqual([FOG_VISIBLE, FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE, FOG_EXPLORED]);
    // viewer null => reveal all
    classifyFog(5, null, [], out);
    expect([...out]).toEqual([2, 2, 2, 2, 2]);
  });

  it('colors tiles by fog class', () => {
    const grass = parseHexColor('#9cbf7a');
    expect(tileTopColor(grass, false, FOG_VISIBLE)).toEqual(grass);
    expect(tileTopColor(grass, true, FOG_UNEXPLORED)).toEqual(parseHexColor(PALETTE.parchment));
    const dim = tileTopColor(grass, false, FOG_EXPLORED);
    expect(dim[0] + dim[1] + dim[2]).toBeLessThan(grass[0] + grass[1] + grass[2]);
    // explored is muted (less saturated)
    const sat = (c: number[]): number => Math.max(...c) - Math.min(...c);
    expect(sat(dim)).toBeLessThan(sat(grass));
    // rivers tint toward blue
    const river = tileTopColor(grass, true, FOG_VISIBLE);
    expect(river[2]).toBeGreaterThan(grass[2]);
    expect(propColor(grass, FOG_VISIBLE)).toEqual(grass);
  });

  it('hashes resource colors deterministically and distinctly', () => {
    expect(resourceColor('iron')).toEqual(resourceColor('iron'));
    expect(resourceColor('iron')).not.toEqual(resourceColor('wheat'));
    for (const v of resourceColor('horses')) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('render labels', () => {
  const s = { name: 'Uruk', population: 4, isCapital: true };

  it('builds label text and cache keys from what changes the pixels', () => {
    expect(labelText(s)).toBe('Uruk  4');
    const k = labelKey(labelSpec(s, '#AA0000'));
    expect(k).toBe(labelKey(labelSpec({ ...s }, '#aa0000')));
    expect(k).not.toBe(labelKey(labelSpec({ ...s, population: 5 }, '#aa0000')));
    expect(k).not.toBe(labelKey(labelSpec({ ...s, isCapital: false }, '#aa0000')));
    expect(k).not.toBe(labelKey(labelSpec(s, '#00aa00')));
  });

  it('caches slots and evicts the least recently used', () => {
    const c = new LabelSlotCache(2);
    c.beginPass();
    expect(c.acquire('a')).toEqual({ slot: 0, fresh: true });
    expect(c.acquire('b')).toEqual({ slot: 1, fresh: true });
    expect(c.acquire('a')).toEqual({ slot: 0, fresh: false });
    // Both slots are in use this pass: nothing to evict.
    expect(c.acquire('c')).toBeNull();
    c.beginPass();
    expect(c.acquire('a')).toEqual({ slot: 0, fresh: false });
    // 'b' is least recently used and not in use this pass.
    expect(c.acquire('c')).toEqual({ slot: 1, fresh: true });
    expect(c.has('b')).toBe(false);
  });
});
