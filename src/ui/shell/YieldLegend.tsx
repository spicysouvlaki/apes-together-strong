/**
 * What the stand-in yield glyphs mean (GDD §11: every icon needs a name somewhere). Opened by
 * tapping the top-bar stockpiles; also reachable from the menu. Display only.
 */
import type { PlayerState } from '@contracts/sim-api';
import { HUD_YIELDS, LEGEND_YIELDS, YIELD_GLYPH, YIELD_HELP, YIELD_NAME, happinessWord, num, signed } from './format';

export function YieldLegend({ player, onClose }: { player: PlayerState | null; onClose: () => void }) {
  return (
    <div class="legend card" role="dialog" aria-label="Symbols">
      <div class="row">
        <strong class="grow">Symbols</strong>
        <button class="btn btn-ghost" aria-label="Close symbols" onClick={onClose}>
          ✕
        </button>
      </div>
      <ul class="legend-list">
        {LEGEND_YIELDS.map((y) => (
          <li key={y} class="legend-row">
            <span class="legend-glyph" aria-hidden="true">
              {YIELD_GLYPH[y]}
            </span>
            <span class="grow">
              <strong>{YIELD_NAME[y]}</strong>
              <span class="small muted"> · {YIELD_HELP[y]}</span>
            </span>
            {player && HUD_YIELDS.includes(y) && (
              <span class="small legend-num">
                {Math.floor(player.stock[y])} ({signed(player.income[y])})
              </span>
            )}
            {player && y === 'happiness' && (
              <span class="small legend-num">
                {num(player.happiness)} {happinessWord(player.happiness)}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p class="small muted legend-foot">Top bar: what you have, and below it the change per turn.</p>
    </div>
  );
}
