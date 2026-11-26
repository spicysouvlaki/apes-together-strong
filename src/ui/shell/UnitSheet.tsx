/**
 * Bottom sheet for the selected unit (GDD §11 "bottom sheet for selection"). Every action shown
 * is gated by a SimQuery; the sim still validates the command.
 */
import { useState } from 'preact/hooks';
import { hexDistance } from '@contracts/hex';
import type { GameState, Unit } from '@contracts/sim-api';
import { TRADE_RANGE } from '../../sim/constants';
import { askConfirm, content, dispatch, game, lookup, me, myTurn, openModal, q, selection } from '../store';
import { capitalize, num } from './format';
import { cancelRoute, confirmRoute, previewRoute, refreshOverlay, selectUnit } from './MapView';
import { idleUnits, nextIdleUnit, tileIndexOf } from './hexutil';
import { highlights, siteHints, skipUnit } from './shell-state';
import { unitHint } from './unit-hints';
import { exploreNow, foundReady, orders, planRoute, plannedRoute, resting, setOrder, type PlannedRoute } from './standing-orders';
import { arrivalText, canExplore } from './orders';
import { pendingAttack, cancelAttack, commitAttack } from './combat-state';
import { OutlookStamp } from './CombatSheet';
import { shortWhere, siteFacts, siteSummary, whereWord } from './site-hints';
import { guideClass } from './guide-state';
import { Icon } from '../art/Icon';
import { FigurePortrait } from '../art/game-art';
import type { IconName } from '../art/icons-data';

/** Why a trader beside a foreign settlement cannot trade with it (display only; see unit-hints). */
const tradeBlockedBeside = (g: GameState, u: Unit): { name: string; why: 'far' | 'war' | 'open'; range: number } | null => {
  const near = Object.values(g.settlements).find((s) => s.owner !== u.owner && hexDistance(s.at, u.at) <= 1);
  if (!near) return null;
  const why = q.atWar(g, u.owner, near.owner)
    ? 'war'
    : g.tradeRoutes.some((r) => r.owner === u.owner && r.to === near.id)
      ? 'open'
      : 'far';
  return { name: near.name, why, range: TRADE_RANGE };
};

/**
 * Where a merchant with nobody beside it could go: known foreign settlements and city-states
 * that would take a route (display only, mirroring sim tradeTargets: not at war, no route yet,
 * a home settlement within trade range), nearest by route first. Playtest 3: a new merchant
 * said "walk next to a foreign city" with no hint where one was.
 */
const tradeDestinations = (g: GameState, u: Unit): { id: string; name: string; plan: PlannedRoute }[] => {
  const p = g.players[u.owner];
  if (!p) return [];
  const homes = Object.values(g.settlements).filter((s) => s.owner === u.owner);
  return Object.values(g.settlements)
    .filter((s) => {
      if (s.owner === u.owner || q.atWar(g, u.owner, s.owner)) return false;
      const i = tileIndexOf(g.map, s.at);
      if (i === null || !p.explored[i]) return false;
      if (g.tradeRoutes.some((r) => r.owner === u.owner && r.to === s.id)) return false;
      return homes.some((h) => hexDistance(h.at, s.at) <= TRADE_RANGE);
    })
    .map((s) => ({ id: s.id, name: s.name, plan: planRoute(u.id, s.at) }))
    .filter((x): x is { id: string; name: string; plan: PlannedRoute } => !!x.plan)
    .sort((a, b) => a.plan.path.length - b.plan.path.length)
    .slice(0, 3);
};

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
  const pa = pendingAttack.value;
  const inline = pa && pa.mode === 'inline' && pa.unit === u.id ? pa : null;
  // A figure outside its settlements cannot be recalled (sim: Recall works inside one). Offer
  // the walk back as one order that recalls on arrival (playtest 3: deployed beside the city,
  // Recall stayed grey with no way forward).
  const home =
    u.figure && actions && !actions.canRecall && !Object.values(g.settlements).some((s) => s.owner === my && s.at.q === u.at.q && s.at.r === u.at.r)
      ? Object.values(g.settlements)
          .filter((s) => s.owner === my)
          .map((s) => ({ s, plan: planRoute(u.id, s.at) }))
          .filter((x) => x.plan && x.plan.to.q === x.s.at.q && x.plan.to.r === x.s.at.r)
          .sort((a, b) => (a.plan?.path.length ?? 0) - (b.plan?.path.length ?? 0))[0] ?? null
      : null;
  const walkingHome = order?.kind === 'goto' && !!order.recall;
  const destinations = def?.canTrade && tradeTargets.length === 0 && !plan && !order && !inline ? tradeDestinations(g, u) : [];

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

      {!def?.canFound && !inline && <p class="small muted unit-hint" role="status">
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
          tradeBlocked: def?.canTrade && tradeTargets.length === 0 ? tradeBlockedBeside(g, u) : null,
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
              <strong>Not here.</strong> Settle on open land outside other borders, four or more tiles from any settlement. Tap a numbered site to march there.
            </>
          )}
          {sites.length > 0 && hereRank !== 0 && (
            <>
              <div class="site-row" aria-label="Best sites nearby, numbered on the map">
                <span class="muted site-label">Numbered sites:</span>
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
                      onClick={() => previewRoute(u.id, site.hex, { frame: true })}
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
      {destinations.length > 0 && (
        <div class="site-row small" aria-label="Places that would take a trade route">
          <span class="muted site-label">Trade with:</span>
          {destinations.map((d) => (
            <button
              key={d.id}
              class="btn site-btn"
              disabled={!canAct}
              aria-label={`Plan a route to ${d.name}, ${arrivalText(d.plan.turns).toLowerCase()}`}
              onClick={() => previewRoute(u.id, g.settlements[d.id]?.at ?? u.at, { frame: true })}
            >
              <Icon name="trade" size="sm" /> {d.name}
              <span class="muted tnum">· {d.plan.turns <= 1 ? 'this turn' : `${d.plan.turns - 1} ${d.plan.turns === 2 ? 'turn' : 'turns'}`}</span>
            </button>
          ))}
        </div>
      )}
      {inline && (
        <div class="card cbt-inline" role="status" aria-label={`Attack preview. ${inline.view.summary}`}>
          <div class="row">
            <OutlookStamp a={inline} />
            <div class="grow small cbt-inline-text">
              <b class="tnum">
                <Icon name="strength" size="sm" /> {inline.view.attacker.strength} vs {inline.view.defender.strength}
              </b>
              {inline.view.kind !== 'capture' && (
                <span class="tnum">
                  {' '}· you <Icon name="health" size="sm" /> {inline.view.attacker.hp}
                  <span class="cbt-arrow" aria-hidden="true" />
                  {inline.view.attacker.after.expected} · they {inline.view.defender.hp}
                  <span class="cbt-arrow" aria-hidden="true" />
                  {inline.view.defender.after.expected}
                </span>
              )}
              <div class="muted">Tap the target again to attack.</div>
            </div>
          </div>
          {inline.view.warLine && (
            <p class="cbt-war small">
              <Icon name="war" size="sm" /> {inline.view.warLine}
            </p>
          )}
          <div class="row cbt-buttons">
            <button class="btn grow" onClick={cancelAttack}>
              Cancel
            </button>
            <button class={`btn grow ${inline.view.warLine ? 'btn-danger' : 'btn-primary'}`} disabled={!canAct} onClick={() => commitAttack(inline)}>
              <Icon name="attack" /> {inline.view.warLine ? 'War and attack' : inline.view.confirmLabel}
            </button>
          </div>
        </div>
      )}
      {plan && (
        <div class="route-card card row" role="status">
          <div class="grow small">
            <strong>{arrivalText(plan.turns)}</strong>
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
                <strong>{order.recall ? 'Walking home' : 'Marching'}</strong> · {whereWord(u.at, order.to)}
                {marchTurns ? `, ${arrivalText(marchTurns).replace('Arrives', 'arrives')}` : ''}.{' '}
                {order.recall ? 'Recalled on arrival.' : 'Moves on at the start of each turn.'}
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
      {inline ? null : routePick ? (
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
            <button
              class="btn btn-primary"
              disabled={!canAct}
              onClick={() => {
                // One city in reach: no picker, one tap opens the route.
                const only = tradeTargets.length === 1 ? tradeTargets[0] : undefined;
                if (!only) return setRoutePick(true);
                setOrder(u.id, null);
                dispatch({ type: 'openTradeRoute', unit: u.id, to: only });
                selectUnit(null);
              }}
            >
              <Icon name="trade" />{' '}
              {tradeTargets.length === 1 ? `Trade route to ${g.settlements[tradeTargets[0] ?? '']?.name ?? 'here'}` : 'Trade route…'}
            </button>
          )}
          {/* Scouts fortify as lookouts (+2 vision) once the map is charted. */}
          {(military || explorer) && !u.fortified && (
            <button
              class="btn"
              disabled={!canAct}
              onClick={() => {
                setOrder(u.id, null);
                dispatch({ type: 'fortify', unit: u.id });
                advance();
              }}
            >
              <Icon name="fortify" /> {military ? 'Fortify' : 'Keep watch'}
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
          {home && !walkingHome && u.figure && (
            <button
              class="btn"
              disabled={!canAct}
              aria-label={`Walk home to ${home.s.name} and recall there`}
              onClick={() => {
                setOrder(u.id, { kind: 'goto', to: home.s.at, recall: true });
                plannedRoute.value = null;
                exploreNow(u.id);
                refreshOverlay();
              }}
            >
              <Icon name="recall" /> Walk home
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
                  body: 'The unit is gone for good. Inside your own borders, a quarter of its cost comes back as gold.',
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
