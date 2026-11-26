/**
 * npm run fun-audit -- [--games 12] [--seed 1] [--speed standard] [--size small] [--players 3]
 *                      [--difficulty normal] [--turns 260] [--json out.json]
 *
 * The gameplay "fun audit": plays seeded games with p1 as the human seat (still driven by the
 * AI) and measures what a player would feel, per the design checklist:
 *  A decisions per turn (gaps between real decisions, idle-build city-turns),
 *  B early-game pacing (capital, first build, first tech, second settlement, first offer),
 *  C the twist at the first transition (figures, top/second culture, hybrid purchasable),
 *  D offer quality (same-culture offers, repeated kinds, unusable seats, distinct reasons),
 *  E rivals (distinct top cultures by turn 30, diplomatic notices),
 *  F/H score spread at the end and lead changes, G turns per age,
 *  plus deeds timing, polar starts, navies, crossings and captures.
 * Tooling only: Node timing never reaches the sim.
 */
import { writeFileSync } from 'node:fs';
import type { ContentBundle } from '../src/contracts/content-schemas';
import type { Sim } from '../src/contracts/sim-api';
import { setupFor, type Options, type RunAiTurn } from './lib/autoplay';
import { auditGame, summarize, type AuditReport } from './lib/fun-audit';

const parseArgs = (argv: string[]): Options => {
  const o: Options = { games: 12, seed: 1, turns: 260, size: 'small', speed: 'standard', players: 3, maxSeconds: 600, json: null, verify: false, humanSeat: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '--games': o.games = Number(next()); break;
      case '--seed': o.seed = Number(next()); break;
      case '--turns': o.turns = Number(next()); break;
      case '--players': o.players = Number(next()); break;
      case '--size': o.size = next() as Options['size']; break;
      case '--speed': o.speed = next() as Options['speed']; break;
      case '--difficulty': o.difficulty = next() as NonNullable<Options['difficulty']>; break;
      case '--json': o.json = next(); break;
      default: throw new Error(`Unknown flag ${a}`);
    }
  }
  return o;
};

const main = async (): Promise<void> => {
  const o = parseArgs(process.argv.slice(2));
  const { sim } = (await import('../src/sim')) as { sim: Sim };
  const { runAiTurn } = (await import('../src/ai')) as { runAiTurn: RunAiTurn };
  const { queries } = await import('../src/sim/queries');
  const content: ContentBundle = (await import('../src/content')).loadContent();
  const reports: AuditReport[] = [];
  for (let g = 0; g < o.games; g++) {
    const seed = o.seed + g;
    const r = auditGame(seed, setupFor(seed, o, content), o.turns, sim, runAiTurn, queries, content);
    reports.push(r);
    console.log(`seed ${seed}: ${r.status}, ${r.turns} turns (${Object.entries(r.turnsPerAge).map(([a, n]) => `${a} ${n}`).join(', ')}), winner ${r.winner}`);
  }
  console.log(summarize(reports, content));
  if (o.json) writeFileSync(o.json, JSON.stringify(reports, null, 2));
};

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
