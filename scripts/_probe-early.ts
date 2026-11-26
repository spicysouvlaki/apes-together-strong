import { sim } from '../src/sim';
import { runAiTurn } from '../src/ai';
import { queries } from '../src/sim/queries';
import { loadContent } from '../src/content';
import { setupFor } from './lib/autoplay';
const content = loadContent();
for (let seed = 1; seed <= 6; seed++) {
  let state = sim.createGame(setupFor(seed, { games: 1, seed, turns: 30, size: 'small', speed: 'standard', players: 3, maxSeconds: 60, json: null, verify: false, humanSeat: true }, content), content).state;
  const log: string[] = [];
  while (state.turn <= 14) {
    const pl = state.currentPlayer;
    if (pl === 'p1') {
      const p = state.players.p1!;
      const cap = Object.values(state.settlements).find((s) => s.owner === 'p1');
      const y = cap ? queries.settlementYields(state, cap.id, content) : null;
      log.push(`t${state.turn} prod=${y?.production} food=${y?.food} sci=${p.income.science} cul=${p.income.culture} item=${cap?.production.item}:${cap?.production.progress} res=${p.research.tech.current}:${p.research.tech.progress} civ=${p.research.civic.current}:${p.research.civic.progress} pop=${cap?.population}`);
    }
    const r = runAiTurn(state, pl, content, sim);
    state = r.state;
    if (state.currentPlayer === pl && state.phase === 'playing') { const f = sim.applyCommand(state, pl, { type: 'endTurn' }, content); if (f.ok) state = f.state; }
  }
  console.log(`seed ${seed}\n  ` + log.filter((_, i) => i % 3 === 0 || i < 3).join('\n  '));
}
