/**
 * Rules changed by the depth and balance pass (sim, emergence, AI), on real content:
 * past-age wonders, past-age research, government unlocks, cold, elimination and game end,
 * income refresh, chronicle voice, modifier-granted cabinet seats, and the war AI.
 */
import { describe, expect, it } from 'vitest';
import type { GameSetup, GameState, Unit } from '@contracts/sim-api';
import { warKey } from '@contracts/sim-api';
import { runAiTurn } from '../src/ai';
import { makePersona } from '../src/ai/persona';
import { pickWarTarget } from '../src/ai/war';
import { annalVoice } from '../src/emergence/figures';
import { emergenceTick } from '../src/emergence';
import { loadContent } from '../src/content';
import { queries, sim } from '../src/sim';
import { checkEliminations } from '../src/sim/combat';
import { COLD_FOOD_PENALTY } from '../src/sim/constants';
import { availableItems } from '../src/sim/settlements';
import { governmentOptionsFor, researchOptionsFor } from '../src/sim/research';
import { tileYield } from '../src/sim/yields';
import type { AiCtx } from '../src/ai/ctx';

const content = loadContent();

const setup = (players: number, humans: number[] = []): GameSetup => ({
  seed: 5,
  mapSize: 'small',
  speed: 'standard',
  players: Array.from({ length: players }, (_, i) => ({
    id: `p${i + 1}`,
    isHuman: humans.includes(i + 1),
    leader: content.leaders[i % content.leaders.length]?.id ?? '',
    dream: content.dreams[0]?.id ?? '',
    colors: { primary: '#123456', secondary: '#654321' },
    skinTone: 0,
  })),
});

const run = (state: GameState, player: string, command: Parameters<typeof sim.applyCommand>[2]): GameState => {
  const r = sim.applyCommand(state, player, command, content);
  if (!r.ok) throw new Error(`${command.type}: ${r.error}`);
  return r.state;
};

const found = (state: GameState, player: string): GameState => {
  const settler = Object.values(state.units).find((u) => u.owner === player && u.type === 'settler');
  if (!settler) throw new Error('no settler');
  return run(state, player, { type: 'foundSettlement', unit: settler.id });
};

/** Every player founds on turn 1 (p1 first, as the turn order requires). */
const foundedGame = (players = 3, humans: number[] = []): GameState => {
  let s = sim.createGame(setup(players, humans), content).state;
  for (const id of s.playerOrder) {
    s = found(s, id);
    if (id !== s.playerOrder[s.playerOrder.length - 1]) s = run(s, id, { type: 'endTurn' });
  }
  return s;
};

describe('wonders belong to their age (GDD §7)', () => {
  it('an ancient wonder is buildable in the ancient age and not after it', () => {
    const s = foundedGame();
    const cap = Object.values(s.settlements).find((x) => x.owner === 'p1')!;
    s.players.p1!.techs.push('masonry');
    expect(availableItems(s, cap, content).some((x) => x.item === 'step_pyramid')).toBe(true);
    s.age = 'classical';
    expect(availableItems(s, cap, content).some((x) => x.item === 'step_pyramid')).toBe(false);
  });
});

describe('past-age research stays open', () => {
  it('a skipped ancient node (Trade, which unlocks merchants) can be researched in the classical age', () => {
    const s = foundedGame();
    // Everything Trade needs is known, Trade itself was skipped.
    const need = (id: string): string[] => content.techs.find((t) => t.id === id)!.requires.flatMap((r) => [r, ...need(r)]);
    s.players.p1!.techs.push(...new Set(need('trade')));
    s.age = 'classical';
    const ids = researchOptionsFor(s, 'p1', 'tech', content).map((o) => o.id);
    expect(ids).toContain('trade');
    const trade = content.techs.find((t) => t.id === 'trade')!;
    expect(researchOptionsFor(s, 'p1', 'tech', content).find((o) => o.id === 'trade')?.cost).toBe(trade.cost);
    // Researching it counts nothing toward the classical milestone/meter (current-age nodes only).
    s.players.p1!.techs.push('trade');
    const ms = queries.milestones(s, 'p1', content).find((m) => m.track === 'science');
    expect(ms?.value ?? 0).toBe(0);
  });
});

describe('civics unlock governments (GDD §7)', () => {
  it('a government named by a node unlock is offered only once the node is known', () => {
    const s = foundedGame();
    const node = content.techs.find((t) => t.modifiers.some((m) => m.effect.kind === 'unlock' && m.effect.what === 'government'))!;
    const eff = node.modifiers.find((m) => m.effect.kind === 'unlock')!.effect as { id: string };
    expect(governmentOptionsFor(s, 'p1', content)).not.toContain(eff.id);
    s.players.p1!.techs.push(node.id);
    expect(governmentOptionsFor(s, 'p1', content)).toContain(eff.id);
  });
});

describe('cold (ignoreCold)', () => {
  it('polar tiles lose food unless an ignoreCold modifier applies', () => {
    const s = foundedGame();
    const tile = s.map.tiles.find((t) => t.climate === 'polar' && t.terrain === 'tundra') ?? s.map.tiles.find((t) => t.climate === 'polar')!;
    const base = { ...tile, climate: 'boreal' as const };
    const warm = tileYield(s, base, 'p1', content, []).food;
    const cold = tileYield(s, tile, 'p1', content, []).food;
    expect(cold).toBe(Math.max(0, warm - COLD_FOOD_PENALTY));
    expect(tileYield(s, tile, 'p1', content, [{ scope: 'empire', effect: { kind: 'ignoreCold' } }]).food).toBe(warm);
  });
});

describe('elimination and game end (GDD §3)', () => {
  const killAllBut = (s: GameState, player: string, keep: (u: Unit) => boolean): void => {
    for (const id of Object.keys(s.settlements)) if (s.settlements[id]!.owner === player) delete s.settlements[id];
    for (const t of s.map.tiles) if (t.owner === player) {
      t.owner = null;
      t.settlement = null;
    }
    for (const id of Object.keys(s.units)) if (s.units[id]!.owner === player && !keep(s.units[id]!)) delete s.units[id];
  };

  it('killing the last settler of a homeless player eliminates them, ends wars, and with no human left ends the game', () => {
    let s = sim.createGame(setup(3, [2]), content).state;
    s = found(s, 'p1');
    // p2 (human) never founded: only a settler left, standing next to p1's warrior.
    killAllBut(s, 'p2', (u) => u.type === 'settler');
    const warrior = Object.values(s.units).find((u) => u.owner === 'p1' && u.unitClass === 'infantry')!;
    const settler = Object.values(s.units).find((u) => u.owner === 'p2')!;
    settler.at = { q: warrior.at.q + 1, r: warrior.at.r };
    for (const t of s.map.tiles) if (t.q === settler.at.q && t.r === settler.at.r) t.terrain = 'grassland';
    s.wars[warKey('p1', 'p2')] = 1;
    s = run(s, 'p1', { type: 'attack', unit: warrior.id, target: settler.at });
    expect(s.players.p2?.alive).toBe(false);
    expect(Object.keys(s.wars).some((k) => k.includes('p2'))).toBe(false);
    expect(s.phase).toBe('ended');
    expect(s.result?.winner).not.toBe('p2');
    expect(s.players.p2?.chronicle.some((e) => e.text.includes('scattered'))).toBe(true);
    expect(s.players.p1?.chronicle.at(-1)?.text).toMatch(/legacy score/);
  });

  it('AI-only games go on while two players live, and end when one is left', () => {
    const s = foundedGame(3);
    killAllBut(s, 'p3', () => false);
    checkEliminations({ state: s, content, events: [] }, 'p1');
    expect(s.players.p3?.alive).toBe(false);
    expect(s.phase).toBe('playing');
    killAllBut(s, 'p2', () => false);
    checkEliminations({ state: s, content, events: [] }, 'p1');
    expect(s.phase).toBe('ended');
    expect(s.result?.winner).toBe('p1');
    expect(s.result?.reason).toMatch(/standing/);
  });
});

describe('income refresh', () => {
  it('founding a settlement updates income at once (no "+0 science" until next turn)', () => {
    let s = sim.createGame(setup(2), content).state;
    expect(s.players.p1?.income.science).toBe(0);
    s = found(s, 'p1');
    expect(s.players.p1?.income.science).toBeGreaterThan(0);
    expect(s.players.p1?.stock.science).toBe(0); // stockpiles untouched
  });
});

describe('chronicle voice', () => {
  it('offer reasons become third person', () => {
    expect(annalVoice('drawn by your harbors')).toBe('drawn by its harbors');
    expect(annalVoice('a wanderer who heard of your people')).toBe('a wanderer who heard of this people');
  });

  it('a played game writes no second- or first-person chronicle lines', () => {
    let s = sim.createGame(setup(3), content).state;
    for (let i = 0; i < 3 * 30 && s.phase === 'playing'; i++) s = runAiTurn(s, s.currentPlayer, content, sim).state;
    const lines = Object.values(s.players).flatMap((p) => p.chronicle.map((e) => e.text));
    expect(lines.length).toBeGreaterThan(5);
    // Tradition and hybrid history notes are content text quoted as-is; check the sim's own lines.
    const own = Object.values(s.players).flatMap((p) => p.chronicle.filter((e) => e.kind !== 'tradition' && e.kind !== 'hybrid' && e.kind !== 'crisis').map((e) => e.text));
    for (const line of own) expect(line, line).not.toMatch(/\b(you|your|us|we|our)\b/i);
  }, 60_000);
});

describe('modifier-granted cabinet seats', () => {
  it('a cabinetSlot modifier adds its seat at the next turn start, without a government change', () => {
    const s = foundedGame();
    s.players.p1!.government = content.governments.find((g) => g.age === 'ancient')!.id;
    emergenceTick({ state: s, content, events: [] }, 'p1');
    const before = queries.cabinetSeats(s, 'p1', content).length;
    s.players.p1!.effects.push({ source: 'test', untilTurn: -1, modifiers: [{ scope: 'empire', effect: { kind: 'cabinetSlot', slot: 'laureate' } }] });
    emergenceTick({ state: s, content, events: [] }, 'p1');
    expect(queries.cabinetSeats(s, 'p1', content).length).toBe(before + 1);
  });
});

describe('war AI (GDD §9)', () => {
  const aiCtx = (s: GameState, player: string): AiCtx => ({
    state: s,
    player,
    content,
    sim,
    events: [],
    persona: makePersona(s, player, content),
    commands: 0,
    rejected: 0,
    claimedSites: [],
  });

  it('targets a human neighbour exactly like an AI one, and spares a last settlement in the ancient age', () => {
    const s = foundedGame(2, [2]);
    // Put p2's capital near p1.
    const p1cap = Object.values(s.settlements).find((x) => x.owner === 'p1')!;
    const p2cap = Object.values(s.settlements).find((x) => x.owner === 'p2')!;
    p2cap.at = { q: p1cap.at.q + 5, r: p1cap.at.r };
    for (const t of s.map.tiles) t.continent = 1;
    expect(pickWarTarget(aiCtx(s, 'p1'), ['p2'])).toBeNull(); // their only settlement, ancient age
    s.age = 'classical';
    expect(pickWarTarget(aiCtx(s, 'p1'), ['p2'])?.rival).toBe('p2');
    const asAi = structuredClone(s);
    asAi.players.p2!.isHuman = false;
    expect(pickWarTarget(aiCtx(asAi, 'p1'), ['p2'])?.settlement.id).toBe(pickWarTarget(aiCtx(s, 'p1'), ['p2'])?.settlement.id);
  });
});
