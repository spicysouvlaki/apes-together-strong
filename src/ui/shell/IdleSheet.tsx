/**
 * Shown once per turn when End Turn is tapped while units or cities still wait for orders:
 * one tap jumps to each, or end the turn anyway (playtest: "what is still idle?").
 */
import { signal } from '@preact/signals';
import { content, game, lookup, me, q } from '../store';
import { idleUnits } from './hexutil';
import { foundReady, resting } from './standing-orders';
import { skipUnit } from './shell-state';
import { selectUnit } from './MapView';
import type { Prompt } from './decisions';
import { Icon } from '../art/Icon';
import type { IconName } from '../art/icons-data';

export const idleSheetOpen = signal(false);

export function IdleSheet({ onEndTurn, openDecision }: { onEndTurn: () => void; openDecision: (p: Prompt) => void }) {
  const g = game.value;
  const my = me.value;
  if (!g || !my) return null;
  const units = idleUnits(g, my, resting.value, foundReady.value);
  const cities = Object.values(g.settlements).filter((s) => s.owner === my && s.kind === 'city' && !s.production.item);
  // Idle trees too (playtest: after the age turned, both trees sat idle and the sheet said nothing).
  const trees = q.pendingDecisions(g, my, content).flatMap((d) => (d.type === 'research' ? [d.tree] : []));
  const close = (): void => {
    idleSheetOpen.value = false;
  };
  if (units.length === 0 && cities.length === 0) return null;
  return (
    <div class="confirm-backdrop" onClick={close}>
      <section class="confirm card idle-sheet" role="alertdialog" aria-modal="true" aria-label="Still waiting for orders" onClick={(e) => e.stopPropagation()}>
        <h2 class="sheet-title">Still waiting for orders</h2>
        <p class="small muted">Tap one to go to it, or end the turn anyway.</p>
        <div class="idle-list">
          {cities.map((s) => (
            <button
              key={s.id}
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
          ))}
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
