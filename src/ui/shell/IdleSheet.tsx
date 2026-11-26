/**
 * Shown once per turn when End Turn is tapped while units or cities still wait for orders:
 * one tap jumps to each, or end the turn anyway (playtest: "what is still idle?").
 */
import { signal } from '@preact/signals';
import { content, dispatch, game, lookup, me, q } from '../store';
import { suggestContext, suggestionLabel, suggestNext } from './build-queue';
import { idleUnits } from './hexutil';
import { foundReady, resting } from './standing-orders';
import { skipUnit } from './shell-state';
import { selectUnit } from './MapView';
import type { Prompt } from './decisions';
import { promptKey } from './nags';
import type { GameState, PlayerId } from '@contracts/sim-api';
import { Icon } from '../art/Icon';
import type { IconName } from '../art/icons-data';

export const idleSheetOpen = signal(false);

/**
 * Cities and trees the sheet lists: idle ones the player has not waved off this turn with
 * "Not now" (wave 11 playtest: the sheet kept listing a city just dismissed, three times). Pure.
 */
export const idleLists = (
  state: GameState,
  me: PlayerId,
  research: readonly ('tech' | 'civic')[],
  atRest: ReadonlySet<string>,
): { cities: string[]; trees: ('tech' | 'civic')[] } => ({
  cities: Object.values(state.settlements)
    .filter((s) => s.owner === me && s.kind === 'city' && !s.production.item && !atRest.has(promptKey({ type: 'production', settlement: s.id })))
    .map((s) => s.id),
  trees: research.filter((tree) => !atRest.has(promptKey({ type: 'research', tree }))),
});

export function IdleSheet({
  onEndTurn,
  openDecision,
  atRest,
}: {
  onEndTurn: () => void;
  openDecision: (p: Prompt) => void;
  /** Prompts waved off this turn ("Not now"): not listed again. */
  atRest: ReadonlySet<string>;
}) {
  const g = game.value;
  const my = me.value;
  if (!g || !my) return null;
  const units = idleUnits(g, my, resting.value, foundReady.value);
  // Idle trees too (playtest: after the age turned, both trees sat idle and the sheet said nothing).
  const research = q.pendingDecisions(g, my, content).flatMap((d) => (d.type === 'research' ? [d.tree] : []));
  const lists = idleLists(g, my, research, atRest);
  const cities = lists.cities.flatMap((id) => (g.settlements[id] ? [g.settlements[id]] : []));
  const trees = lists.trees;
  const close = (): void => {
    idleSheetOpen.value = false;
  };
  const cap = q.settlementCap(g, my, content);
  if (units.length === 0 && cities.length === 0 && trees.length === 0) {
    // Nothing left to list (all answered or waved off): the sheet must not linger and pop up later.
    queueMicrotask(close);
    return null;
  }
  return (
    <div class="confirm-backdrop" onClick={close}>
      <section class="confirm card idle-sheet" role="alertdialog" aria-modal="true" aria-label="Still waiting for orders" onClick={(e) => e.stopPropagation()}>
        <h2 class="sheet-title">Still waiting for orders</h2>
        <p class="small muted">Tap one to go to it, or end the turn anyway.</p>
        <div class="idle-list">
          {cities.map((s) => {
            const ctx = suggestContext(g, s.id, content, (a, b) => q.atWar(g, a, b), cap);
            const pick = ctx ? suggestNext(q.productionOptions(g, s.id, content), ctx) : null;
            const pickName = pick ? (lookup.units[pick.item]?.name ?? lookup.buildings[pick.item]?.name ?? lookup.wonders[pick.item]?.name ?? pick.item) : '';
            return (
              <div class="idle-item" key={s.id}>
                <button
                  class="btn idle-row"
                  onClick={() => {
                    close();
                    openDecision({ type: 'production', settlement: s.id });
                  }}
                >
                  <Icon name="production" />
                  <span class="grow">{s.name}: nothing to build</span>
                  <Icon name="chevron" size="sm" />
                </button>
                {pick && (
                  <button
                    class="btn idle-suggest"
                    aria-label={suggestionLabel(pickName, pick.why, s.name)}
                    onClick={() => dispatch({ type: 'setProduction', settlement: s.id, item: pick.item })}
                  >
                    <span class="suggest-kicker" aria-hidden="true">Suggested</span>
                    <span class="grow suggest-text" aria-hidden="true">
                      <strong>{pickName}</strong>
                      <span class="small muted"> · {pick.why}</span>
                    </span>
                    <Icon name="production" size="sm" />
                  </button>
                )}
              </div>
            );
          })}
          {trees.map((tree) => (
            <button
              key={tree}
              class="btn idle-row"
              onClick={() => {
                close();
                openDecision({ type: 'research', tree });
              }}
            >
              <Icon name={tree === 'tech' ? 'science' : 'culture'} />
              <span class="grow">{tree === 'tech' ? 'Technology' : 'Civics'}: nothing being studied</span>
              <Icon name="chevron" size="sm" />
            </button>
          ))}
          {units.map((u) => {
            const name = (u.figure ? lookup.figures[u.figure]?.name : undefined) ?? lookup.units[u.type]?.name ?? u.type;
            return (
              <button
                key={u.id}
                class="btn idle-row"
                onClick={() => {
                  close();
                  selectUnit(u.id, { focus: true });
                }}
              >
                <Icon name={u.unitClass as IconName} />
                <span class="grow">{name}</span>
                <Icon name="chevron" size="sm" />
              </button>
            );
          })}
        </div>
        <div class="row confirm-buttons">
          <button class="btn grow" onClick={close}>
            Keep playing
          </button>
          <button
            class="btn btn-primary grow"
            onClick={() => {
              for (const u of units) skipUnit(u.id);
              close();
              onEndTurn();
            }}
          >
            End turn
          </button>
        </div>
      </section>
    </div>
  );
}
