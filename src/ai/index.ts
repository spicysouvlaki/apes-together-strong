/**
 * Rival AI entry point (GDD §9). Plays one full turn for `player` through the public Sim API
 * only (same rules, same information as a human; it never reads anyone's hidden `affinity`)
 * and returns the resulting state plus every event emitted.
 *
 * Layers: strategic (decisions.focusTrack — which legacy track to lean into, re-planned every
 * 10 turns), operational (economy.makePlan — settle/build/war goals for the whole empire) and
 * tactical (units.ts — per-unit scoring). Personality (persona.ts) biases every weight.
 *
 * Guarantees: deterministic (no Math.random/Date; "randomness" is a hash of seed, turn and
 * ids), never throws (each step is wrapped; rejected commands are skipped), bounded (a hard
 * cap on commands per turn), and always terminates with the turn ended — or, during the
 * 'transition' phase, with `finishTransition` sent.
 */
import type { ContentBundle, LegacyTrack } from '@contracts/content-schemas';
import type { GameState, PlayerId, Sim, SimEvent } from '@contracts/sim-api';
import { exec, step, type AiCtx } from './ctx';
import { answerCrisis, answerOffers, chooseGovernment, chooseResearch, focusTrack } from './decisions';
import { makePlan, manageProduction, sendEnvoys, spendGold } from './economy';
import { activateFigures, consumeLeftovers, fieldExplorers, fieldGenerals, seatFigures } from './figures';
import { makePersona } from './persona';
import { runTransition } from './transition';
import { moveExpeditions, moveMerchants, moveMilitary, moveNavy, moveScouts, moveSettlers } from './units';
import { considerPeace, considerWar } from './war';
import { hostilesNear, ownSettlements } from './world';

export { aiDiagnostics, MAX_COMMANDS_PER_TURN } from './ctx';

const newCtx = (state: GameState, player: PlayerId, content: ContentBundle, sim: Sim): AiCtx => ({
  state,
  player,
  content,
  sim,
  events: [],
  persona: makePersona(state, player, content),
  commands: 0,
  rejected: 0,
  claimedSites: [],
});

const playTurn = (ai: AiCtx): void => {
  let focus: LegacyTrack = 'legacy';
  step(ai, (a) => {
    focus = focusTrack(a);
  });
  // Decisions that gate the turn come first.
  step(ai, answerOffers);
  step(ai, answerCrisis);
  step(ai, chooseGovernment);
  step(ai, (a) => chooseResearch(a, focus));

  // Settle before planning production (turn 1: the capital).
  let plan = null as ReturnType<typeof makePlan> | null;
  step(ai, (a) => {
    plan = makePlan(a, focus);
  });
  step(ai, (a) => {
    if (plan) moveSettlers(a, plan);
  });

  // Figures.
  let threatened = false;
  step(ai, (a) => {
    threatened = ownSettlements(a.state, a.player).some((s) => hostilesNear(a.state, a.player, s.at, 4).length > 0);
  });
  step(ai, seatFigures);
  step(ai, fieldGenerals);
  step(ai, fieldExplorers);
  step(ai, (a) => activateFigures(a, focus, threatened));
  step(ai, consumeLeftovers);

  // War and peace.
  step(ai, considerPeace);
  step(ai, (a) => {
    if (plan) considerWar(a, plan.military);
  });

  // Economy: re-plan after settling and diplomacy.
  step(ai, (a) => {
    plan = makePlan(a, focus);
  });
  step(ai, (a) => {
    if (plan) manageProduction(a, plan);
  });
  step(ai, (a) => {
    if (plan) spendGold(a, plan);
  });
  // Bought items and freshly upgraded towns leave cities idle: give them work.
  step(ai, (a) => {
    if (plan) manageProduction(a, plan);
  });
  step(ai, sendEnvoys);

  // Units.
  step(ai, (a) => moveMilitary(a, plan ?? undefined));
  step(ai, moveNavy);
  step(ai, moveScouts);
  step(ai, moveMerchants);
  step(ai, moveExpeditions);
  // Activations that needed this turn's production choice (rush a wonder just started).
  step(ai, (a) => activateFigures(a, focus, threatened));
  step(ai, seatFigures);
};

/** End the turn no matter what: answer anything still blocking, then endTurn. */
const finishTurn = (ai: AiCtx): void => {
  const turnKey = (): string => `${ai.state.phase}|${ai.state.turn}|${ai.state.currentPlayer}`;
  const before = turnKey();
  if (exec(ai, { type: 'endTurn' }, true)) return;
  for (let guard = 0; guard < 8 && turnKey() === before; guard++) {
    const offer = ai.state.offers.find((o) => o.player === ai.player);
    if (offer) {
      const first = offer.candidates[0] ?? null;
      if (!exec(ai, { type: 'chooseOffer', offer: offer.id, figure: first }, true)) {
        exec(ai, { type: 'chooseOffer', offer: offer.id, figure: null }, true);
      }
    }
    const crisis = ai.state.crisis;
    if (crisis?.awaiting.includes(ai.player)) {
      const def = ai.content.crises.find((c) => c.id === crisis.id);
      for (const o of def?.stages[crisis.stage - 1]?.options ?? []) {
        if (exec(ai, { type: 'chooseCrisisResponse', option: o.id }, true)) break;
      }
    }
    if (exec(ai, { type: 'endTurn' }, true)) return;
  }
};

export const runAiTurn = (
  state: GameState,
  player: PlayerId,
  content: ContentBundle,
  sim: Sim,
): { state: GameState; events: SimEvent[] } => {
  const p = state.players[player];
  if (state.phase === 'ended' || !p || !p.alive) return { state, events: [] };
  const ai = newCtx(state, player, content, sim);
  if (state.phase === 'transition') {
    step(ai, runTransition);
    if (ai.state.phase === 'transition' && !ai.state.transition?.recap[player]?.done) exec(ai, { type: 'finishTransition' }, true);
    return { state: ai.state, events: ai.events };
  }
  if (state.currentPlayer !== player) return { state, events: [] };
  step(ai, playTurn);
  finishTurn(ai);
  return { state: ai.state, events: ai.events };
};
