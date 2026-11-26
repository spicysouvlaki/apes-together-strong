/**
 * npm run autoplay -- [--games 3] [--seed 1] [--turns 200] [--size small] [--players 4]
 *                     [--speed quick] [--max-seconds 300] [--json out.json] [--verify]
 *                     [--difficulty easy|normal|hard] [--human-seat]
 *
 * Plays N seeded AI-only games headless through the public Sim API and `runAiTurn`, and prints
 * per game: turns and offers per age, figures per culture per player, traditions and hybrids,
 * settlements, final scores, and AI turn timings (budget: < 3 s per AI turn late game).
 * --verify plays each seed twice and compares the final states byte for byte (determinism).
 * --human-seat marks p1 as human (difficulty bonuses then apply to the others) while the AI
 * still plays it, and reports p1's final score over the rivals' mean: how a competent player
 * fares against easy/normal/hard rivals.
 *
 * Timing uses performance.now() here only — never inside the sim.
 */
import { writeFileSync } from 'node:fs';
import type { ContentBundle } from '../src/contracts/content-schemas';
import type { Sim } from '../src/contracts/sim-api';
import { AI_TURN_BUDGET_MS, COLORS, NotImplemented, humanScoreRatio, playGame, type GameReport, type Options, type RunAiTurn } from './lib/autoplay';

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
      case '--human-seat': o.humanSeat = true; break;
      case '--difficulty': {
        const v = next();
        if (v !== 'easy' && v !== 'normal' && v !== 'hard') throw new Error('--difficulty is easy | normal | hard');
        o.difficulty = v;
        break;
      }
      case '--help':
      case '-h':
        console.log('Usage: npm run autoplay -- [--games N] [--seed S] [--turns T] [--size small|standard|large] [--speed quick|standard|epic] [--players P] [--max-seconds S] [--json out.json] [--verify] [--difficulty easy|normal|hard] [--human-seat]');
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
  const wars = g.wars ?? [];
  if (wars.length) console.log(`  wars: ${wars.map((w) => `${w.by}→${w.on} t${w.turn}${w.ended !== null ? `–${w.ended}` : '+'}`).join(', ')}`);
  const caps = g.captures ?? [];
  if (caps.length) console.log(`  captures: ${caps.map((c) => `${c.to}←${c.from} t${c.turn}`).join(', ')}`);
  const elim = g.eliminations ?? [];
  if (elim.length) console.log(`  eliminated: ${elim.map((e) => `${e.player} by ${e.by ?? '-'} t${e.turn} (${e.age})`).join(', ')}`);
  for (const [id, p] of Object.entries(g.players)) {
    console.log(`  ${id} ${p.leader}/${p.dream}${p.civName ? ` "${p.civName}"` : ''}${p.alive ? '' : ' [eliminated]'}: score ${p.score}, settlements ${p.settlements}`);
    console.log(`     figures: ${fmtRecord(p.figuresByCulture)}  top ${p.topCulture ?? '-'} (affinity ${p.topAffinity ?? '-'}); land: ${p.homeTerrain ?? '-'}`);
    console.log(`     traditions: ${p.traditions.join(', ') || '-'}; hybrids: ${p.hybrids.join(', ') || '-'}`);
    const research = Object.entries(p.researchByAge ?? {})
      .map(([age, r]) => `${age} ${Math.round(r.tech * 100)}%/${Math.round(r.civic * 100)}%`)
      .join(', ');
    const wonders = (p.wonders ?? []).map((w) => `${w.id}${w.wonderAge !== w.builtAge ? `(${w.wonderAge}@${w.builtAge})` : ''}`).join(', ');
    console.log(`     happiness min ${p.minHappiness ?? '-'} end ${p.finalHappiness ?? '-'}; research tech/civic: ${research || '-'}; wonders: ${wonders || '-'}`);
  }
};

const pct = (n: number, d: number): string => (d ? `${Math.round((100 * n) / d)}%` : '-');

/** Cross-game summary: war, culture variety, research pace, happiness, wonder timing. */
const printSummary = (reports: GameReport[]): void => {
  const n = reports.length;
  const withWar = reports.filter((r) => (r.wars ?? []).length > 0).length;
  const wars = reports.reduce((s, r) => s + (r.wars ?? []).length, 0);
  const pvp = reports.reduce((s, r) => s + (r.captures ?? []).filter((c) => !c.cityState).length, 0);
  const cs = reports.reduce((s, r) => s + (r.captures ?? []).filter((c) => c.cityState).length, 0);
  const elim = reports.flatMap((r) => r.eliminations ?? []);
  const battles = reports.reduce((s, r) => s + (r.battles ?? 0), 0);
  console.log(`\nwar: ${withWar}/${n} games with war, ${wars} wars, ${battles} battles, captures ${pvp} from players + ${cs} city-states, eliminations ${elim.length} (${elim.map((e) => e.age).join(', ') || '-'})`);
  const players = reports.flatMap((r) => Object.values(r.players));
  const tops: Record<string, number> = {};
  const affs: Record<string, number> = {};
  const custom: Record<string, number> = {};
  for (const p of players) {
    const t = p.topCulture ?? '-';
    tops[t] = (tops[t] ?? 0) + 1;
    const a = p.topAffinity ?? '-';
    affs[a] = (affs[a] ?? 0) + 1;
    for (const tr of p.traditions) custom[tr] = (custom[tr] ?? 0) + 1;
  }
  const sorted = (r: Record<string, number>): string =>
    Object.entries(r)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
  console.log(`top culture (figures) of ${players.length} civs: ${sorted(tops)}`);
  console.log(`top affinity: ${sorted(affs)}`);
  const ancientAff: Record<string, number> = {};
  for (const p of players) {
    const a = p.topAffinityByAge?.ancient ?? '-';
    ancientAff[a] = (ancientAff[a] ?? 0) + 1;
  }
  console.log(`top affinity when the ancient age ended: ${sorted(ancientAff)}`);
  console.log(`most adopted traditions: ${sorted(custom).split(', ').slice(0, 8).join(', ')}`);
  const ages: Record<string, { tech: number; civic: number; n: number }> = {};
  for (const p of players) {
    for (const [age, r] of Object.entries(p.researchByAge ?? {})) {
      const a = (ages[age] ??= { tech: 0, civic: 0, n: 0 });
      a.tech += r.tech;
      a.civic += r.civic;
      a.n++;
    }
  }
  console.log(
    `research at age end (avg tech/civic/both): ${Object.entries(ages)
      .map(([age, a]) => `${age} ${pct(a.tech, a.n)}/${pct(a.civic, a.n)}/${pct(a.tech + a.civic, 2 * a.n)}`)
      .join(', ') || '-'}`,
  );
  const mins = players.map((p) => p.minHappiness).filter((h): h is number => typeof h === 'number');
  if (mins.length) {
    console.log(`happiness: min avg ${(mins.reduce((a, b) => a + b, 0) / mins.length).toFixed(1)}, worst ${Math.min(...mins)}, civs below −10: ${mins.filter((h) => h < -10).length}/${mins.length}`);
  }
  const ws = players.flatMap((p) => p.wonders ?? []);
  console.log(`wonders: ${ws.length} built, ${ws.filter((w) => w.wonderAge !== w.builtAge).length} after their age; per age built: ${sorted(ws.reduce<Record<string, number>>((r, w) => ((r[`${w.wonderAge}@${w.builtAge}`] = (r[`${w.wonderAge}@${w.builtAge}`] ?? 0) + 1), r), {}))}`);
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
    printSummary(reports);
    if (o.humanSeat) {
      const ratios = reports.map(humanScoreRatio);
      const valid = ratios.filter((r): r is number => r !== null);
      const avg = valid.reduce((a, b) => a + b, 0) / Math.max(1, valid.length);
      const wins = reports.filter((r) => r.result?.winner === 'p1').length;
      console.log(
        `human seat (p1) vs ${o.difficulty ?? 'normal'} rivals: score ratio avg ${avg.toFixed(2)} (per seed ${ratios.map((r) => (r === null ? '-' : r.toFixed(2))).join(', ')}), p1 won ${wins}/${reports.length}`,
      );
    }
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
