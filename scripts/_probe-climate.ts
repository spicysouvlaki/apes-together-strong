import { sim } from '../src/sim';
import { runAiTurn } from '../src/ai';
import { loadContent } from '../src/content';
import { playGame, type Options } from './lib/autoplay';
import { tileAt } from '../src/sim/lookup';
const content = loadContent();
const o: Options = { games: 1, seed: 1, turns: 260, size: 'small', speed: 'standard', players: 3, maxSeconds: 600, json: null, verify: false, humanSeat: true };
const rows: string[] = [];
for (let seed = 1; seed <= 10; seed++) {
  const g = playGame(seed, o, sim, runAiTurn, content, true);
  const st = JSON.parse(g.finalJson!);
  for (const [id, p] of Object.entries(g.players)) {
    const cap = Object.values(st.settlements as Record<string, any>).find((s: any) => s.originalOwner === id && s.isCapital) as any;
    const clim = cap ? tileAt(st.map, cap.at)?.climate : '?';
    const nf = Object.values(p.figuresByCulture).reduce((a, b) => a + b, 0);
    const pl = st.players[id];
    rows.push(`${seed} ${id} ${clim} score ${p.score} figs ${nf} trad ${p.traditions.length} hyb ${p.hybrids.length} sett ${p.settlements} legacy ${pl.legacyPoints} ms ${pl.milestones.length} top ${p.topCulture} land ${p.homeTerrain}`);
  }
}
console.log(rows.join('\n'));
