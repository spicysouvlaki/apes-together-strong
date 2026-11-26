/**
 * Emergence fixes from the wave 11 full-game playtest: offer reasons that name the city-state
 * and read well after "joined the court,", real signals before generic lines, and full pools
 * served in the order of the player's current lean (scholar play draws thinkers).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GP_KINDS, type GpKind } from '@contracts/content-schemas';
import type { GameState } from '@contracts/sim-api';
import { loadContent } from '../src/content';
import * as K from '../src/emergence/constants';
import { annalVoice } from '../src/emergence/figures';
import { offerReason, poolOrderKey } from '../src/emergence/offers';
import { AGE_OPENING_REASON, REASON_TEMPLATES, WANDERER_REASONS } from '../src/emergence/reasons';
import { citedSignals, signalContributions } from '../src/emergence/signals';
import { addSettlement, at, makeState, resetFakes, testContent } from './helpers/emergence';

vi.mock('../src/sim/units', () => import('./helpers/emergence'));
vi.mock('../src/sim/stats', () => import('./helpers/emergence'));
vi.mock('../src/sim/ages', () => import('./helpers/emergence'));

const real = loadContent();
const content = testContent(real);

beforeEach(resetFakes);

const world = (): GameState => {
  const state = makeState(content);
  addSettlement(state, 'p1', at(3, 3), { id: 'cap1' });
  return state;
};

describe('reasons (wave 11)', () => {
  it('a suzerainty reason names the city-state', () => {
    const state = world();
    const def = content.cityStates[0];
    if (!def) throw new Error('content has no city-states');
    const sett = addSettlement(state, `cs:${def.id}`, at(12, 12), { id: 'cs_s', name: def.name, namedFor: def.culture, isCapital: false });
    state.cityStates[def.id] = { id: def.id, settlement: sett.id, envoys: { p1: 3 }, suzerain: 'p1', alive: true };
    state.players.p1!.affinity[def.culture] = 40;
    const contrib = signalContributions(state, 'p1', content);
    const cited = citedSignals(state, 'p1', contrib, def.culture, content).find((x) => x.signal.measure === 'suzerainOfCulture');
    expect(cited?.hint).toBe(`your friendship with ${def.name}`);
    expect(cited?.hint).not.toMatch(/their city/);
  });

  it('every phrasing reads after "X joined the court, " (no bare "come …")', () => {
    for (const family of Object.values(REASON_TEMPLATES)) {
      for (const t of family) expect(t).not.toMatch(/^come\b/);
    }
    expect(AGE_OPENING_REASON).not.toMatch(/^come\b/);
    expect(`Hypatia joined the court, ${annalVoice(REASON_TEMPLATES.learning[2]!.replace('{h}', 'your scholars'))}.`).toBe(
      'Hypatia joined the court, eager to learn from its scholars.',
    );
  });

  it('a real signal is cited even while the culture’s affinity is still low; generic lines are the last resort', () => {
    const state = world();
    const t = state.map.tiles.find((x) => x.settlement === 'cap1');
    if (t) t.river = true;
    state.players.p1!.affinity.egyptian = K.REASON_MIN_AFFINITY / 2; // a first offer, early on
    const contrib = signalContributions(state, 'p1', content);
    expect(citedSignals(state, 'p1', contrib, 'egyptian', content).length).toBeGreaterThan(0);
    expect(offerReason(state, 'p1', 'egyptian', contrib, content)).toMatch(/^drawn by your /);
    // A culture nothing the player does feeds, at low affinity: the wanderer line.
    const none = Object.keys(contrib).find((c) => Object.keys(contrib[c] ?? {}).length === 0 && !state.players.p1!.affinity[c]);
    if (none) expect(WANDERER_REASONS as readonly string[]).toContain(offerReason(state, 'p1', none, contrib, content));
  });
});

describe('which full pool offers next (wave 11: scholar play drew few thinkers)', () => {
  const pools = (v: number): Record<GpKind, number> => Object.fromEntries(GP_KINDS.map((k) => [k, v])) as Record<GpKind, number>;

  it('without gains it is the fill alone (unchanged)', () => {
    const gp = { ...pools(60), thought: 90 };
    const key = poolOrderKey(gp, pools(60));
    expect(key('thought')).toBe(1.5);
    expect(key('military')).toBe(1);
  });

  it('among pools banked to the cap, the one the player feeds most goes first', () => {
    const cap = pools(K.GP_BANK_MAX_THRESHOLDS * 60);
    const gains = { ...pools(1), thought: 3 };
    const key = poolOrderKey(cap, pools(60), gains);
    const order = GP_KINDS.slice().sort((a, b) => key(b) - key(a) || GP_KINDS.indexOf(a) - GP_KINDS.indexOf(b));
    expect(order[0]).toBe('thought');
    // The lean never lifts an unfilled pool over a full one by much: it is a tiebreak-sized nudge.
    expect(K.GP_LEAN_WEIGHT).toBeLessThan(1);
  });
});
