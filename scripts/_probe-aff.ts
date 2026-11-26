import { sim } from '../src/sim';
import { runAiTurn } from '../src/ai';
import { loadContent } from '../src/content';
import { setupFor, type Options } from './lib/autoplay';
const content = loadContent();
const o: Options = { games: 1, seed: 1, turns: 260, size: 'small', speed: 'standard', players: 3, maxSeconds: 600, json: null, verify: false, humanSeat: true };
for (let seed = 1; seed <= 8; seed++) {
  let state = sim.createGame(setupFor(seed, o, content), content).state;
  while (state.phase === 'playing') {
    const pl = state.currentPlayer;
    const r = runAiTurn(state, pl, content, sim);
    state = r.state;
    if (state.phase === 'playing' && state.currentPlayer === pl) { const f = sim.applyCommand(state, pl, { type: 'endTurn' }, content); if (f.ok) state = f.state; else break; }
  }
  for (const id of state.playerOrder) {
    const p = state.players[id]!;
    const top = Object.entries(p.affinity).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, v]) => `${c}:${v.toFixed(0)}${p.hintsShown[c] ? '*' + p.hintsShown[c] : ''}`);
    console.log(seed, id, top.join(' '));
  }
}
