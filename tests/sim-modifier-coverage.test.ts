/**
 * Dead-rule scan (CLAUDE.md rule 4: every bonus is a Modifier evaluated by one engine). Walks
 * every Modifier (scope × effect kind) and every Condition field that content actually uses
 * and asserts the sim has a code path that evaluates it: injecting the effect changes a
 * computed value in a real-content fixture, and each condition field flips
 * `conditionMatches`. A new effect or field in content that the sim ignores fails here.
 */
import { describe, expect, it } from 'vitest';
import type { Condition, ContentBundle, Modifier } from '@contracts/content-schemas';
import type { GameState, Settlement, Unit } from '@contracts/sim-api';
import { runAiTurn } from '../src/ai';
import { loadContent } from '../src/content';
import { addAffinity, cabinetSeats, emergenceTick } from '../src/emergence';
import { gpGain } from '../src/emergence/points';
import { measurePlayer } from '../src/emergence/signals';
import { sim } from '../src/sim';
import { refinementOptions } from '../src/sim/ages';
import { attackStrength } from '../src/sim/combat';
import { tradeRouteCap } from '../src/sim/diplomacy';
import { capitalOf, tileAt } from '../src/sim/lookup';
import { conditionMatches, type CondEnv } from '../src/sim/modifiers';
import { governmentOptionsFor } from '../src/sim/research';
import { itemCost, upgradeCostOf } from '../src/sim/settlements';
import { canEmbarkPlayer, maxMoves, visionRadius } from '../src/sim/units';
import { computeEmpire, computeHappiness, settlementCapFor, settlementYields, tileYield } from '../src/sim/yields';

const content = loadContent();

/** Every modifier in content, with where it came from. */
const allModifiers = (c: ContentBundle): { src: string; m: Modifier }[] => {
  const out: { src: string; m: Modifier }[] = [];
  const push = (src: string, mods: readonly Modifier[] | undefined): void => {
    for (const m of mods ?? []) out.push({ src, m });
  };
  for (const x of c.traditions) push(`tradition ${x.id}`, x.modifiers);
  for (const x of c.hybrids) push(`hybrid ${x.id}`, x.modifiers);
  for (const x of c.leaders) push(`leader ${x.id}`, x.modifiers);
  for (const x of c.dreams) push(`dream ${x.id}`, x.modifiers);
  for (const x of c.governments) push(`government ${x.id}`, x.modifiers);
  for (const x of c.buildings) push(`building ${x.id}`, x.modifiers);
  for (const x of c.wonders) push(`wonder ${x.id}`, x.modifiers);
  for (const x of c.techs) push(`tech ${x.id}`, x.modifiers);
  for (const x of c.cityStates) push(`city-state ${x.id}`, x.suzerainModifiers);
  for (const x of c.figures) {
    push(`figure ${x.id}`, x.cabinetModifiers);
    push(`figure ${x.id}`, x.unitModifiers);
  }
  for (const x of c.crises) {
    push(`crisis ${x.id}`, x.pressure);
    for (const st of x.stages) for (const o of st.options) push(`crisis option ${o.id}`, o.modifiers);
  }
  return out;
};

/** Effect signature: what kind of rule a modifier is, independent of its numbers. */
const signature = (m: Modifier): string => {
  const e = m.effect;
  switch (e.kind) {
    case 'yield':
      return `${m.scope}:yield:${e.yield}:${e.add !== undefined ? 'add' : 'percent'}`;
    case 'cost':
      return `${m.scope}:cost:${e.target}`;
    case 'unlock':
      return `${m.scope}:unlock:${e.what}`;
    default:
      return `${m.scope}:${e.kind}`;
  }
};

/** A small real game a few turns in: every player has a capital and some units. */
const fixture = (): GameState => {
  let s = sim.createGame(
    {
      seed: 11,
      mapSize: 'small',
      speed: 'standard',
      players: ['p1', 'p2', 'p3'].map((id, i) => ({
        id,
        isHuman: false,
        leader: content.leaders[i]?.id ?? '',
        dream: content.dreams[i]?.id ?? '',
        colors: { primary: '#000000', secondary: '#ffffff' },
        skinTone: 0,
      })),
    },
    content,
  ).state;
  for (let i = 0; i < 3 * 6; i++) s = runAiTurn(s, s.currentPlayer, content, sim).state;
  return s;
};

/** A copy of `state` where p1 also has `mods` (as a timed effect, which every evaluator sees). */
const withMods = (state: GameState, mods: Modifier[]): GameState => {
  const s = structuredClone(state);
  s.players.p1!.effects.push({ source: 'test', untilTurn: -1, modifiers: mods });
  return s;
};

describe('modifier coverage (dead-rule scan)', () => {
  const base = fixture();
  const cap = (s: GameState): Settlement => capitalOf(s, 'p1') as Settlement;
  const unit = (s: GameState, pred: (u: Unit) => boolean = (u) => u.unitClass !== 'civilian'): Unit =>
    Object.values(s.units).find((u) => u.owner === 'p1' && pred(u)) as Unit;
  const polar = (s: GameState) => s.map.tiles.find((t) => t.climate === 'polar' && t.terrain !== 'snow') ?? s.map.tiles[0]!;

  /** A probe returns a number that the effect must change. */
  const probe = (sig: string, m: Modifier): ((s: GameState) => number) => {
    const e = m.effect;
    const y = e.kind === 'yield' ? e.yield : 'food';
    switch (sig.split(':').slice(1, 2)[0] === 'yield' ? `yield:${m.scope}` : e.kind) {
      case 'yield:empire':
        return y === 'happiness'
          ? (s) => computeHappiness(s, 'p1', content)
          : (s) => {
              const inc = computeEmpire(s, 'p1', content).income[y];
              // Local yields (food, production) from empire percents land in settlements.
              return inc + settlementYields(s, cap(s), content)[y];
            };
      case 'yield:settlement':
        return (s) => settlementYields(s, cap(s), content)[y];
      case 'yield:tile':
        return (s) => {
          // Tile yields of every tile of the map as if p1 worked it (conditions vary by tile).
          let sum = 0;
          const mods = s.players.p1!.effects.flatMap((x) => x.modifiers);
          for (const t of s.map.tiles) sum += tileYield(s, t, 'p1', content, mods, cap(s))[y];
          return sum;
        };
      case 'combat':
        return (s) => {
          const u = unit(s);
          return attackStrength(s, u, { at: { q: u.at.q + 1, r: u.at.r }, unitClass: e.kind === 'combat' ? (e.vs ?? null) : null, settlement: false }, false, content);
        };
      case 'movement':
        return (s) => maxMoves(s, unit(s), content);
      case 'vision':
        return (s) => visionRadius(s, unit(s, () => true), content);
      case 'gpPoints':
        return (s) => (e.kind === 'gpPoints' ? gpGain(s, 'p1', content, measurePlayer(s, 'p1', content))[e.gp] : 0);
      case 'affinityGain':
        return (s) => {
          const culture = e.kind === 'affinityGain' ? (e.culture ?? 'greek') : 'greek';
          const t = structuredClone(s);
          addAffinity({ state: t, content, events: [] }, 'p1', culture, 10);
          return t.players.p1!.affinity[culture] ?? 0;
        };
      case 'cost':
        return (s) => {
          if (e.kind !== 'cost') return 0;
          const c = cap(s);
          if (e.target === 'tradition') {
            const t = structuredClone(s);
            t.phase = 'transition';
            t.transition = { fromAge: 'ancient', toAge: 'classical', recap: { p1: { legacyPointsEarned: 0, rpEarned: 0, milestones: [], retiredFigures: [], nameOptions: [], signaturesBought: 0, hybridsBought: 0, done: false } } };
            return refinementOptions(t, 'p1', content).reduce((sum, o) => sum + o.cost, 0);
          }
          if (e.target === 'upgrade') return upgradeCostOf(s, c, content);
          const item =
            e.target === 'unit' ? 'warrior_band' : e.target === 'settler' ? 'settler' : e.target === 'building' ? 'monument' : (content.wonders[0]?.id ?? '');
          return itemCost(s, c, item, content);
        };
      case 'cabinetSlot':
        return (s) => {
          // Seats granted by modifiers appear at the next turn start (emergenceTick).
          const t = structuredClone(s);
          emergenceTick({ state: t, content, events: [] }, 'p1');
          return cabinetSeats(t, 'p1', content).length;
        };
      case 'settlementCap':
        return (s) => settlementCapFor(s, 'p1', content);
      case 'tradeRoutes':
        return (s) => tradeRouteCap(s, 'p1', content);
      case 'unlock':
        return (s) => {
          if (e.kind !== 'unlock') return 0;
          if (e.what === 'embark') return canEmbarkPlayer(s, 'p1', content) ? 1 : 0;
          if (e.what === 'government') {
            // Governments are unlocked by researching the node that carries the effect.
            const t = structuredClone(s);
            const node = content.techs.find((x) => x.modifiers.includes(m));
            if (node && s.players.p1!.effects.some((x) => x.modifiers.includes(m))) t.players.p1!.techs.push(node.id);
            const gov = content.governments.find((g) => g.id === e.id);
            if (gov) t.age = gov.age;
            return governmentOptionsFor(t, 'p1', content).includes(e.id) ? 1 : 0;
          }
          return 0;
        };
      case 'ignoreCold':
        return (s) => tileYield(s, polar(s), 'p1', content, s.players.p1!.effects.flatMap((x) => x.modifiers)).food;
      default:
        return () => 0;
    }
  };

  const seen = new Map<string, { src: string; m: Modifier }>();
  for (const x of allModifiers(content)) if (!seen.has(signature(x.m))) seen.set(signature(x.m), x);

  it('content uses at least the core effect kinds', () => {
    expect(seen.size).toBeGreaterThan(20);
  });

  for (const [sig, { src, m }] of seen) {
    it(`${sig} (e.g. ${src}) changes a computed value`, () => {
      // Drop the condition so the effect applies in the fixture; conditions are checked below.
      const bare: Modifier = { scope: m.scope, effect: m.effect };
      const p = probe(sig, m);
      // The government unlock probe looks for the original modifier object on the tech.
      const injected = m.effect.kind === 'unlock' && m.effect.what === 'government' ? m : bare;
      // Percent effects need something to scale: give p1 a flat amount of that yield first.
      const e = m.effect;
      const seed = e.kind === 'yield' && e.percent !== undefined ? withMods(base, [{ scope: 'empire', effect: { kind: 'yield', yield: e.yield, add: 5 } }]) : base;
      const before = p(seed);
      const after = p(withMods(seed, [injected]));
      expect(after, `${sig} from ${src} had no effect`).not.toBe(before);
    });
  }
});

describe('condition coverage (dead-rule scan)', () => {
  const base = fixture();
  const fields = new Map<string, Condition>();
  for (const { m } of allModifiers(content)) for (const [k, v] of Object.entries(m.when ?? {})) if (!fields.has(k)) fields.set(k, { [k]: v } as Condition);
  for (const b of [...content.buildings, ...content.wonders]) for (const [k, v] of Object.entries(b.requires ?? {})) if (!fields.has(k)) fields.set(k, { [k]: v } as Condition);

  const cap = capitalOf(base, 'p1') as Settlement;
  const tile = tileAt(base.map, cap.at)!;
  const u = Object.values(base.units).find((x) => x.owner === 'p1' && x.unitClass !== 'civilian') as Unit;
  const env: CondEnv = { state: base, content, player: 'p1', tile, settlement: cap, unitClass: u.unitClass };

  /** A condition on `field` that holds in `env`, and one that does not. */
  const pair = (field: string): [Condition, Condition] => {
    switch (field) {
      case 'terrain':
        return [{ terrain: [tile.terrain] }, { terrain: ['no_such_terrain'] }];
      case 'feature':
        return tile.feature ? [{ feature: [tile.feature] }, { feature: ['no_such'] }] : [{}, { feature: ['forest'] }];
      case 'resource':
        return tile.resource ? [{ resource: [tile.resource] }, { resource: ['no_such'] }] : [{}, { resource: ['wheat'] }];
      case 'climate':
        return [{ climate: [tile.climate] }, { climate: [tile.climate === 'polar' ? 'arid' : 'polar'] }];
      case 'adjacentTerrain':
        return [{ adjacentTerrain: base.map.tiles.map((t) => t.terrain) }, { adjacentTerrain: ['no_such'] }];
      case 'coastal':
      case 'river':
      case 'capital':
        return [{ [field]: field === 'capital' ? true : (field === 'river' ? tile.river : conditionMatches({ coastal: true }, env)) } as Condition, { [field]: field === 'capital' ? false : !(field === 'river' ? tile.river : conditionMatches({ coastal: true }, env)) } as Condition];
      case 'cityMinPop':
        return [{ cityMinPop: 1 }, { cityMinPop: 99 }];
      case 'cityMaxPop':
        return [{ cityMaxPop: 99 }, { cityMaxPop: 0 }];
      case 'minTradeRoutes':
        return [{ minTradeRoutes: 0 }, { minTradeRoutes: 99 }];
      case 'unitClass':
        return [{ unitClass: [u.unitClass] }, { unitClass: ['naval'] }];
      case 'age':
        return [{ age: [base.age] }, { age: ['modern'] }];
      case 'atWar':
        return [{ atWar: false }, { atWar: true }];
      case 'settlementKind':
        return [{ settlementKind: cap.kind }, { settlementKind: cap.kind === 'city' ? 'town' : 'city' }];
      default:
        return [{}, {}];
    }
  };

  for (const field of fields.keys()) {
    it(`when.${field} is evaluated`, () => {
      const [yes, no] = pair(field);
      expect(conditionMatches(yes, env)).toBe(true);
      expect(conditionMatches(no, env), `when.${field} is ignored by conditionMatches`).toBe(false);
    });
  }
});
