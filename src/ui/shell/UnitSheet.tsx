/**
 * Bottom sheet for the selected unit (GDD §11 "bottom sheet for selection"). Every action shown
 * is gated by a SimQuery; the sim still validates the command.
 */
import { useState } from 'preact/hooks';
import { askConfirm, content, dispatch, game, lookup, me, myTurn, openModal, q, selection } from '../store';
import { capitalize, num } from './format';
import { selectUnit } from './MapView';
import { nextIdleUnit } from './hexutil';
import { highlights, skipUnit, skipped } from './shell-state';
import { unitHint } from './unit-hints';
import { Icon } from '../art/Icon';
import { FigurePortrait } from '../art/game-art';
import type { IconName } from '../art/icons-data';

export function UnitSheet() {
  const g = game.value;
  const my = me.value;
  const id = selection.value.unit;
  const [routePick, setRoutePick] = useState(false);
  const u = g && id ? g.units[id] : undefined;
  if (!g || !my || !u || u.owner !== my) return null;
  const def = lookup.units[u.type];
  const fig = u.figure ? lookup.figures[u.figure] : undefined;
  const name = fig?.name ?? def?.name ?? u.type;
  const canAct = myTurn.value;
  const canFound = !!def?.canFound && q.canFound(g, u.id, content);
  const reach = highlights.value;
  const canAttack = reach.attackable.length > 0;
  const tradeTargets = def?.canTrade ? q.tradeTargets(g, u.id, content) : [];
  const actions = u.figure ? q.figureActions(g, u.figure, content) : null;
  const military = u.unitClass !== 'civilian';

  const advance = (): void => {
    const next = nextIdleUnit(g, my, skipped.value, u.id);
    selectUnit(next && next.id !== u.id ? next.id : null, { focus: true });
  };

  return (
    <section class="sheet unit-sheet" aria-label={`Selected unit: ${name}`}>
      <div class="row">
        <div class="grow">
          <div class="unit-name">
            {fig && u.figure ? <FigurePortrait figure={u.figure} size="xs" /> : <span class="unit-class-badge" aria-hidden="true"><Icon name={u.unitClass as IconName} /></span>}
            <span>{name}</span>
          </div>
          <div class="small muted">
            {fig ? `${def?.name ?? capitalize(u.unitClass)} · ` : ''}
            {capitalize(u.unitClass)}
            {u.fortified ? ' · Fortified' : ''}
          </div>
        </div>
        <button class="btn btn-ghost btn-icon" aria-label="Close unit panel" onClick={() => selectUnit(null)}>
          <Icon name="close" />
        </button>
      </div>
      <div class="row unit-stats">
        <span class="chip" aria-label={`Health ${u.hp} of 100`}>
          <Icon name="health" size="sm" /> {u.hp}
        </span>
        <span class="chip" aria-label={`Moves left ${num(u.movesLeft)} of ${def?.moves ?? '?'}`}>
          <Icon name="moves" size="sm" /> {num(u.movesLeft)}/{def?.moves ?? '?'}
        </span>
        {def && def.strength > 0 && (
          <span class="chip" aria-label={`Strength ${def.strength}`}>
            <Icon name="strength" size="sm" /> {def.strength}
          </span>
        )}
        {def?.rangedStrength !== undefined && (
          <span class="chip" aria-label={`Ranged strength ${def.rangedStrength}, range ${def.range ?? 1}`}>
            <Icon name="ranged" size="sm" /> {def.rangedStrength} r{def.range ?? 1}
          </span>
        )}
      </div>

      <p class="small muted unit-hint" role="status">
        {unitHint({
          isFounder: !!def?.canFound,
          canFound,
          isTrader: !!def?.canTrade,
          tradeTargets: tradeTargets.length,
          movesLeft: u.movesLeft,
          canMove: reach.reachable.length > 0,
          canAttack,
          hasAttacked: u.hasAttacked,
          military,
          canDeclare: reach.warTargets.length > 0,
        })}
      </p>
      {routePick ? (
        <div class="unit-actions">
          <div class="small muted">Open a trade route to:</div>
          {tradeTargets.map((sid) => {
            const s = g.settlements[sid];
            return (
              <button
                key={sid}
                class="btn"
                disabled={!canAct}
                onClick={() => {
                  setRoutePick(false);
                  dispatch({ type: 'openTradeRoute', unit: u.id, to: sid });
                  selectUnit(null);
                }}
              >
                {s?.name ?? sid}
              </button>
            );
          })}
          <button class="btn btn-ghost" onClick={() => setRoutePick(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div class="unit-actions">
          {def?.canFound && (
            <button
              class="btn btn-primary"
              disabled={!canAct || !canFound}
              onClick={() => {
                dispatch({ type: 'foundSettlement', unit: u.id });
                selectUnit(null);
              }}
            >
              <Icon name="found" /> Found settlement
            </button>
          )}
          {tradeTargets.length > 0 && (
            <button class="btn btn-primary" disabled={!canAct} onClick={() => setRoutePick(true)}>
              <Icon name="trade" /> Trade route…
            </button>
          )}
          {military && !u.fortified && (
            <button
              class="btn"
              disabled={!canAct}
              onClick={() => {
                dispatch({ type: 'fortify', unit: u.id });
                advance();
              }}
            >
              <Icon name="fortify" /> Fortify
            </button>
          )}
          <button
            class="btn"
            disabled={!canAct}
            onClick={() => {
              skipUnit(u.id);
              advance();
            }}
          >
            <Icon name="skip" /> Skip
          </button>
          {fig && u.figure && (
            <button class="btn" onClick={() => openModal({ kind: 'figure', figure: u.figure as string })}>
              <Icon name="figures" /> Figure
            </button>
          )}
          {actions?.canRecall && u.figure && (
            <button
              class="btn"
              disabled={!canAct}
              onClick={() => {
                dispatch({ type: 'recallFigure', figure: u.figure as string });
                selectUnit(null);
              }}
            >
              <Icon name="recall" /> Recall
            </button>
          )}
          {!u.figure && (
            <button
              class="btn btn-ghost danger-text"
              disabled={!canAct}
              onClick={() =>
                askConfirm({
                  title: `Disband ${name}?`,
                  body: 'The unit is gone for good.',
                  confirmLabel: 'Disband',
                  danger: true,
                  onConfirm: () => {
                    dispatch({ type: 'disbandUnit', unit: u.id });
                    selectUnit(null);
                  },
                })
              }
            >
              <Icon name="disband" /> Disband
            </button>
          )}
        </div>
      )}
    </section>
  );
}
