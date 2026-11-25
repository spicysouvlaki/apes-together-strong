/**
 * npm run autoplay -- [--games 3] [--seed 1] [--turns 200] [--size small] [--players 4]
 *                     [--speed quick] [--max-seconds 300] [--json out.json] [--verify]
 *
 * Plays N seeded AI-only games headless through the public Sim API and `runAiTurn`, and prints
 * per game: turns and offers per age, figures per culture per player, traditions and hybrids,
 * settlements, final scores, and AI turn timings (budget: < 3 s per AI turn late game).
 * --verify plays each seed twice and compares the final states byte for byte (determinism).
 *
 * Timing uses performance.now() here only — never inside the sim.
 */
import { writeFileSync } from 'node:fs';
import type { ContentBundle } from '../src/contracts/content-schemas';
import type { Sim } from '../src/contracts/sim-api';
import { AI_TURN_BUDGET_MS, COLORS, NotImplemented, playGame, type GameReport, type Options, type RunAiTurn } from './lib/autoplay';

const parseArgs = (argv: string[]): Options => {
  const o: Options = { games: 3, seed: 1, turns: 250, size: 'small', speed: 'quick', players: 4, maxSeconds: 300, json: null, verify: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    const int = (): number => {
      const v = Number(next());
      if (!Number.isInteger(v) || v < 0) throw new Error(`${a} needs a non-negative integer`);
      return v;
    };
    switch (a) {
      case '--games': o.games = int(); break;
      case '--seed': o.seed = int(); break;
      case '--turns': o.turns = int(); break;
      case '--players': o.players = Math.max(2, Math.min(COLORS.length, int())); break;
      case '--max-seconds': o.maxSeconds = int(); break;
      case '--size': {
        const v = next();
        if (v !== 'small' && v !== 'standard' && v !== 'large') throw new Error('--size is small | standard | large');
        o.size = v;
        break;
      }
      case '--speed': {
        const v = next();
        if (v !== 'quick' && v !== 'standard' && v !== 'epic') throw new Error('--speed is quick | standard | epic');
        o.speed = v;
        break;
      }
      case '--json': o.json = next(); break;
      case '--verify': o.verify = true; break;
      case '--help':
      case '-h':
        console.log('Usage: npm run autoplay -- [--games N] [--seed S] [--turns T] [--size small|standard|large] [--speed quick|standard|epic] [--players P] [--max-seconds S] [--json out.json] [--verify]');
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown flag ${a}`);
    }
  }
  return o;
};

const fmtRecord = (r: Record<string, number | undefined>): string =>
  Object.entries(r)
    .map(([k, v]) => `${k} ${v ?? 0}`)
    .join(', ') || '-';

const printReport = (g: GameReport): void => {
  console.log(`\n=== Game seed ${g.seed}: ${g.status}${g.note ? ` (${g.note})` : ''} — turn ${g.turns}, ${g.finalAge}, ${g.wallSeconds.toFixed(1)} s`);
  console.log(`  turns per age:  ${fmtRecord(g.turnsPerAge)}`);
  console.log(`  offers per age: ${fmtRecord(g.offersPerAge)}`);
  console.log(`  AI turns: ${g.aiTurns}, avg ${g.avgAiMs.toFixed(1)} ms, worst ${g.worstAiMs.toFixed(1)} ms${g.slowTurns ? `, ${g.slowTurns} over ${AI_TURN_BUDGET_MS} ms budget` : ''}`);
  if (g.result) console.log(`  winner: ${g.result.winner} (${g.result.reason})`);
  for (const [id, p] of Object.entries(g.players)) {
    console.log(`  ${id} ${p.leader}/${p.dream}${p.civName ? ` "${p.civName}"` : ''}${p.alive ? '' : ' [eliminated]'}: score ${p.score}, settlements ${p.settlements}`);
    console.log(`     figures: ${fmtRecord(p.figuresByCulture)}`);
    console.log(`     traditions: ${p.traditions.join(', ') || '-'}; hybrids: ${p.hybrids.join(', ') || '-'}`);
  }
};

const firstDiff = (a: string, b: string): string => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `first difference at char ${i}: …${a.slice(Math.max(0, i - 60), i + 60)}… vs …${b.slice(Math.max(0, i - 60), i + 60)}…`;
};

const main = async (): Promise<number> => {
  let o: Options;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  let sim: Sim;
  let runAiTurn: RunAiTurn;
  let content: ContentBundle;
  try {
    ({ sim } = await import('../src/sim'));
    ({ runAiTurn } = await import('../src/ai'));
    content = (await import('../src/content')).loadContent();
  } catch (err) {
    console.error(`autoplay: could not load sim/AI/content: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const reports: GameReport[] = [];
  let failures = 0;
  try {
    for (let g = 0; g < o.games; g++) {
      const seed = o.seed + g;
      const report = playGame(seed, o, sim, runAiTurn, content, o.verify);
      if (o.verify) {
        const again = playGame(seed, o, sim, runAiTurn, content, true);
        if (report.finalJson === again.finalJson) {
          console.log(`seed ${seed}: deterministic (${report.finalJson?.length ?? 0} bytes of final state)`);
        } else {
          failures++;
          console.error(`seed ${seed}: NOT deterministic — ${firstDiff(report.finalJson ?? '', again.finalJson ?? '')}`);
        }
      }
      delete report.finalJson;
      if (report.status === 'error' || report.status === 'stuck') failures++;
      printReport(report);
      reports.push(report);
    }
  } catch (err) {
    if (err instanceof NotImplemented) {
      console.log(`autoplay: sim not implemented yet (${err.message}). Nothing to play.`);
      return 0;
    }
    throw err;
  }

  if (reports.length) {
    const ai = reports.filter((r) => r.aiTurns > 0);
    const avg = ai.reduce((s, r) => s + r.avgAiMs * r.aiTurns, 0) / Math.max(1, ai.reduce((s, r) => s + r.aiTurns, 0));
    console.log(`\n${reports.length} game(s): avg AI turn ${avg.toFixed(1)} ms, worst ${Math.max(...reports.map((r) => r.worstAiMs)).toFixed(1)} ms; statuses ${reports.map((r) => r.status).join(', ')}`);
  }
  if (o.json) {
    writeFileSync(o.json, JSON.stringify({ options: o, games: reports }, null, 2));
    console.log(`wrote ${o.json}`);
  }
  return failures ? 1 : 0;
};

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`autoplay failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
