/**
 * Bottom sheet for the selected unit (GDD §11 "bottom sheet for selection"). Every action shown
 * is gated by a SimQuery; the sim still validates the command.
 */
import { useState } from 'preact/hooks';
import { askConfirm, content, dispatch, game, lookup, me, myTurn, openModal, q, selection } from '../store';
import { capitalize, num, turnsText } from './format';
import { cancelRoute, confirmRoute, previewRoute, refreshOverlay, selectUnit } from './MapView';
import { idleUnits, nextIdleUnit } from './hexutil';
import { highlights, siteHints, skipUnit } from './shell-state';
import { unitHint } from './unit-hints';
import { exploreNow, foundReady, orders, planRoute, plannedRoute, resting, setOrder } from './standing-orders';
import { canExplore } from './orders';
import { shortWhere, siteFacts, siteSummary, whereWord } from './site-hints';
import { guideClass } from './guide-state';
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
    const next = nextIdleUnit(g, my, resting.value, u.id, foundReady.value);
    selectUnit(next && next.id !== u.id ? next.id : null, { focus: true });
  };
  const order = orders.value[u.id] ?? null;
  const plan = plannedRoute.value?.unit === u.id ? plannedRoute.value : null;
  const explorer = canExplore(def);
  const sites = siteHints.value?.unit === u.id ? siteHints.value.sites : [];
  const idleCount = idleUnits(g, my, resting.value, foundReady.value).length;
  // Remaining route of a standing march, for "about N turns left".
  const marchTurns = order?.kind === 'goto' ? (planRoute(u.id, order.to)?.turns ?? null) : null;
  const here = def?.canFound ? siteFacts(g, u.at, content) : null;
  const hereSummary = here ? siteSummary(here) : '';
  const hereRank = sites.findIndex((x) => x.hex.q === u.at.q && x.hex.r === u.at.r);

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

      {!def?.canFound && <p class="small muted unit-hint" role="status">
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
      </p>}
      {def?.canFound && !plan && (
        <div class="site-note small" role="note">
          {canFound ? (
            <>
              <strong>{hereRank === 0 ? 'Best site nearby: ' : hereRank > 0 ? 'A good site: ' : 'You can settle here: '}</strong>
              {hereSummary ? `${here?.terrain.toLowerCase() ?? 'land'} with ${hereSummary}.` : `plain ${here?.terrain.toLowerCase() ?? 'land'}, no river, coast or resources close by.`}
            </>
          ) : (
            <>
              <strong>Not here.</strong> Settle on open land outside other borders, four or more tiles from any settlement.
            </>
          )}
          {sites.length > 0 && hereRank !== 0 && (
            <>
              <div class="site-row" aria-label="Best sites nearby, numbered on the map">
                <span class="muted site-label">Sites:</span>
                {sites.map((site, i) => {
                  const f = siteFacts(g, site.hex, content);
                  const why = f ? siteSummary(f, 2) : '';
                  if (site.hex.q === u.at.q && site.hex.r === u.at.r) return null;
                  return (
                    <button
                      key={`${site.hex.q},${site.hex.r}`}
                      class="btn site-btn"
                      disabled={!canAct}
                      aria-label={`Site ${i + 1}: ${whereWord(u.at, site.hex)}${why ? `, ${why}` : ''}. Plan a route there.`}
                      onClick={() => previewRoute(u.id, site.hex)}
                    >
                      <span class="site-n" aria-hidden="true">{i + 1}</span>
                      <span aria-hidden="true">{shortWhere(u.at, site.hex)}</span>
                      {f?.river && <Icon name="river" size="sm" />}
                    </button>
                  );
                })}
              </div>
              {(() => {
                const best = sites[0];
                const f = best ? siteFacts(g, best.hex, content) : null;
                const why = f ? siteSummary(f, 3) : '';
                return best && why ? (
                  <div class="muted site-best">
                    Site 1: {why}.
                  </div>
                ) : null;
              })()}
            </>
          )}
        </div>
      )}
      {plan && (
        <div class="route-card card row" role="status">
          <div class="grow small">
            <strong>Route: about {turnsText(plan.turns)}</strong>
            <div class="muted">
              {plan.blockedBy ? `Ends when your ${plan.blockedBy} moves off the tile.` : 'Go, or tap the tile again.'}
            </div>
          </div>
          <button class="btn btn-ghost" onClick={cancelRoute}>
            Cancel
          </button>
          <button class="btn btn-primary" disabled={!canAct} onClick={confirmRoute}>
            <Icon name="move" /> Go
          </button>
        </div>
      )}
      {!plan && order && (
        <div class="route-card card row" role="status">
          <div class="grow small">
            {order.kind === 'explore' ? (
              <>
                <strong>Exploring</strong> · moves on its own each turn until nothing is left or an enemy comes near.
              </>
            ) : (
              <>
                <strong>Marching</strong> · {whereWord(u.at, order.to)}
                {marchTurns ? `, about ${turnsText(marchTurns)} left` : ''}. Moves on at the start of each turn.
              </>
            )}
          </div>
          <button
            class="btn"
            disabled={!canAct}
            onClick={() => {
              setOrder(u.id, null);
              refreshOverlay();
            }}
          >
            {order.kind === 'explore' ? 'Stop' : 'Cancel order'}
          </button>
        </div>
      )}
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
              class={`btn btn-primary${guideClass('found')}`}
              disabled={!canAct || !canFound}
              onClick={() => {
                setOrder(u.id, null);
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
                setOrder(u.id, null);
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
          {explorer && order?.kind !== 'explore' && (
            <button
              class={`btn${guideClass('explore')}`}
              disabled={!canAct}
              aria-label="Explore automatically every turn"
              onClick={() => {
                setOrder(u.id, { kind: 'explore' });
                plannedRoute.value = null;
                // Take this turn's step right away through the same runner as later turns.
                exploreNow(u.id);
                advance();
              }}
            >
              <Icon name="moves" /> Explore
            </button>
          )}
          {idleCount > 1 && (
            <button
              class="btn"
              disabled={!canAct}
              aria-label={`Skip all ${idleCount} units waiting for orders this turn`}
              onClick={() => {
                for (const x of idleUnits(g, my, resting.value, foundReady.value)) skipUnit(x.id);
                selectUnit(null);
              }}
            >
              <Icon name="skip" /> Skip all
            </button>
          )}
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
                    setOrder(u.id, null);
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
