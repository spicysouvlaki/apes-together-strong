/**
 * War and peace (GDD §9; kept simple on purpose). Warmongers and opportunists pick on a
 * clearly weaker neighbour on the same landmass after turn ~25, one war at a time. Everyone
 * sues for peace when losing or after a long stalemate.
 */
import { hexDistance } from '@contracts/hex';
import { warKey } from '@contracts/sim-api';
import { MIN_WAR_TURNS, PEACE_INFLUENCE_COST } from '../sim/constants';
import { tileAt } from '../sim/lookup';
import { exec, me, type AiCtx } from './ctx';
import { hashStr } from './util';
import { enemiesAtWar, militaryPower, ownSettlements } from './world';

/** No AI starts a war before this turn. */
export const EARLIEST_WAR_TURN = 25;
/** Max distance between nearest settlements for a war to make sense. */
const MAX_WAR_DISTANCE = 12;
/** After this many turns of war without a capture, a stalemate ends in peace. */
const STALEMATE_TURNS = 25;

export const considerWar = (ai: AiCtx, military: number): void => {
  const { state, player, content } = ai;
  const pe = ai.persona;
  const aggression = pe.w.warmonger + 0.6 * pe.w.opportunist;
  if (aggression <= 0 || state.turn < EARLIEST_WAR_TURN) return;
  if (enemiesAtWar(state, player).length > 0 || military < 4) return;
  // Consider it now and then, not every turn.
  if (hashStr(`${state.seed}|${player}|war|${Math.floor(state.turn / 4)}`) % 4 !== 0) return;
  const own = ownSettlements(state, player);
  if (own.length === 0) return;
  const myPower = militaryPower(state, player, content);
  const continent = (h: { q: number; r: number }): number => tileAt(state.map, h)?.continent ?? -1;
  const myContinents = own.map((s) => continent(s.at));
  let best: string | null = null;
  let bestScore = 0;
  for (const rival of state.playerOrder) {
    if (rival === player || !state.players[rival]?.alive) continue;
    const theirs = ownSettlements(state, rival);
    let dist = Infinity;
    for (const a of own) for (const b of theirs) if (myContinents.includes(continent(b.at))) dist = Math.min(dist, hexDistance(a.at, b.at));
    if (dist > MAX_WAR_DISTANCE) continue;
    const theirPower = Math.max(1, militaryPower(state, rival, content));
    const ratio = myPower / theirPower;
    const needed = pe.w.warmonger > 0 ? 1.4 : 1.8;
    if (ratio < needed) continue;
    const score = ratio - dist * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = rival;
    }
  }
  if (best && me(ai).stock.influence >= 0) exec(ai, { type: 'declareWar', target: best });
};

export const considerPeace = (ai: AiCtx): void => {
  const { state, player, content } = ai;
  for (const enemy of enemiesAtWar(state, player)) {
    const began = state.wars[warKey(player, enemy)];
    if (began === undefined || state.turn - began < MIN_WAR_TURNS) continue;
    if (me(ai).stock.influence < PEACE_INFLUENCE_COST) continue;
    const mine = militaryPower(state, player, content);
    const theirs = militaryPower(state, enemy, content);
    const aggressive = ai.persona.w.warmonger > 0;
    const losing = mine < theirs * (aggressive ? 0.8 : 1.1);
    const stalemate = state.turn - began >= STALEMATE_TURNS + (aggressive ? 10 : 0);
    if (losing || stalemate) exec(ai, { type: 'makePeace', target: enemy });
  }
};
