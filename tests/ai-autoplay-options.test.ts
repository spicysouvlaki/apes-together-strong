/** Autoplay's difficulty measurement options (scripts/lib/autoplay.ts): --difficulty and --human-seat. */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content';
import { humanScoreRatio, setupFor, type GameReport, type Options } from '../scripts/lib/autoplay';

const content = loadContent();
const base: Options = { games: 1, seed: 1, turns: 10, size: 'small', speed: 'quick', players: 3, maxSeconds: 10, json: null, verify: false };

describe('autoplay difficulty options', () => {
  it('passes the difficulty through and marks only p1 human with --human-seat', () => {
    expect(setupFor(1, base, content).difficulty).toBe('normal');
    const s = setupFor(1, { ...base, difficulty: 'hard', humanSeat: true }, content);
    expect(s.difficulty).toBe('hard');
    expect(s.players.map((p) => p.isHuman)).toEqual([true, false, false]);
    expect(setupFor(1, base, content).players.some((p) => p.isHuman)).toBe(false);
  });

  it("reports p1's score over the rivals' mean", () => {
    const player = (score: number) => ({ leader: '', dream: '', civName: null, alive: true, settlements: 1, score, figuresByCulture: {}, traditions: [], hybrids: [] });
    const report = { players: { p1: player(30), p2: player(10), p3: player(30) } } as unknown as GameReport;
    expect(humanScoreRatio(report)).toBe(1.5);
    expect(humanScoreRatio({ players: { p1: player(5) } } as unknown as GameReport)).toBeNull();
  });
});
