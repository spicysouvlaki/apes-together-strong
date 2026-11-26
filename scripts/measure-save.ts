/**
 * npm exec tsx scripts/measure-save.ts -- [size] [turns]
 * Measures the cost of one save of a mid-game state: JSON size, structuredClone (what an
 * IndexedDB put does synchronously) and JSON.stringify. Node timings are a proxy; iPhone
 * Safari is roughly 2-4x slower.
 */
import type { GameSetup, MapSize } from '../src/contracts/sim-api';
import { runAiTurn } from '../src/ai';
import { loadContent } from '../src/content';
import { sim } from '../src/sim';

const size = (process.argv[2] ?? 'standard') as MapSize;
const turns = Number(process.argv[3] ?? 80);
const content = loadContent();
const setup: GameSetup = {
  seed: 7,
  mapSize: size,
  speed: 'standard',
  players: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, i) => ({
    id,
    isHuman: false,
    leader: content.leaders[i % content.leaders.length]?.id ?? '',
    dream: content.dreams[i % content.dreams.length]?.id ?? '',
    colors: { primary: '#888888', secondary: '#f3ede1' },
    skinTone: i % 6,
  })),
};
let { state } = sim.createGame(setup, content);
for (let i = 0; i < turns * setup.players.length && state.phase !== 'ended'; i++) {
  const p = state.currentPlayer;
  if (state.phase === 'transition') {
    for (const id of state.playerOrder) {
      if (state.phase !== 'transition') break;
      state = runAiTurn(state, id, content, sim).state;
      const r = sim.applyCommand(state, id, { type: 'finishTransition' }, content);
      if (r.ok) state = r.state;
    }
    continue;
  }
  state = runAiTurn(state, p, content, sim).state;
  if (state.currentPlayer === p && state.phase === 'playing') {
    const r = sim.applyCommand(state, p, { type: 'endTurn' }, content);
    if (r.ok) state = r.state;
  }
}
const time = (label: string, fn: () => unknown, n = 20): void => {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn();
  console.log(`${label}: ${((performance.now() - t0) / n).toFixed(2)} ms`);
};
console.log(`${size} map, turn ${state.turn}, ${Object.keys(state.units).length} units, ${Object.keys(state.settlements).length} settlements`);
console.log(`JSON size: ${(JSON.stringify(state).length / 1024).toFixed(0)} KB`);
time('structuredClone', () => structuredClone(state));
time('JSON.stringify', () => JSON.stringify(state));
const s = JSON.stringify(state);
time('JSON.parse', () => JSON.parse(s));
time('structuredClone(string)', () => structuredClone(s));
