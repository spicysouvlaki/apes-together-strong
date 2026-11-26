/**
 * City panel (modal 'city', GDD §7 "Settlements"). Shows what the sim reports through
 * SimQueries: yields, growth, production options with cost/turns/gold cost. Picks send
 * `setProduction` / `buyItem` / `upgradeSettlement`; the sim validates them.
 */
import { useEffect, useState } from 'preact/hooks';
import type { ProductionOption } from '@contracts/sim-api';
import type { YieldType } from '@contracts/content-schemas';
import { closeModal, content, dispatch, game, lastError, lookup, me, myTurn, openModal, q } from '../store';
import { YIELD_ICON, YIELD_NAME, capitalize, growthText, num, signed, turnsText } from './format';
import { FOOD_PER_POP, UNREST_THRESHOLD, UPGRADE_COST_BASE, UPGRADE_COST_PER_POP } from '../../sim/constants';
import { MAX_QUEUE, queueAdd, queueChoices, queueFullNote, queueMove, queueRemove, suggestContext, suggestionLabel, suggestNext } from './build-queue';
import { namingLine, strongestCulture, upgradeCostReason } from './city-lines';
import { Icon } from '../art/Icon';
import { FigurePortrait } from '../art/game-art';
import { GlossText } from './GlossarySheet';
import { ownSettlementRing } from './hexutil';

const CITY_YIELDS: readonly YieldType[] = ['food', 'production', 'gold', 'science', 'culture', 'faith', 'influence', 'happiness'];

const itemName = (id: string): string => lookup.units[id]?.name ?? lookup.buildings[id]?.name ?? lookup.wonders[id]?.name ?? id;

const itemDescription = (o: ProductionOption): string => {
  if (o.kind === 'unit') {
    const u = lookup.units[o.item];
    if (!u) return '';
    const parts = [capitalize(u.unitClass)];
    if (u.strength > 0) parts.push(`strength ${u.strength}`);
    if (u.rangedStrength !== undefined) parts.push(`ranged ${u.rangedStrength}`);
    parts.push(`${u.moves} ${u.moves === 1 ? 'move' : 'moves'}`);
    if (u.canFound) parts.push('Founds settlements');
    if (u.canTrade) parts.push('Opens trade routes');
    return parts.join(' · ');
  }
  if (o.kind === 'building') return lookup.buildings[o.item]?.description ?? '';
  return lookup.wonders[o.item]?.description ?? '';
};

const GROUPS: { kind: ProductionOption['kind']; title: string }[] = [
  { kind: 'unit', title: 'Units' },
  { kind: 'building', title: 'Buildings' },
  { kind: 'wonder', title: 'Wonders' },
];

export function CitySheet({ settlement }: { settlement: string }) {
  const g = game.value;
  const my = me.value;
  // 'current' changes what is being built; 'queue' adds a follow-on ("Then: …").
  const [picking, setPicking] = useState<'current' | 'queue' | null>(null);
  // Set when a queue edit was sent; an error arriving meanwhile is shown inline (the sim may
  // refuse the whole list, e.g. an item that stopped being legal).
  const [queueSent, setQueueSent] = useState(false);
  // The Buy button that was tapped once and waits for its second tap (see below).
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(null), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  const s = g?.settlements[settlement];
  if (!g || !my || !s) {
    return (
      <section class="sheet">
        <p>This settlement no longer exists.</p>
        <button class="btn" onClick={closeModal}>
          Close
        </button>
      </section>
    );
  }
  const mine = s.owner === my;
  const canAct = mine && myTurn.value;
  const gold = g.players[my]?.stock.gold ?? 0;
  const yields = q.settlementYields(g, s.id, content);
  const growth = q.growthCost(s.population);
  // Mirrors sim/settlements.ts growSettlement: citizens eat, unrest stops growth.
  const rawSurplus = yields.food - FOOD_PER_POP * s.population;
  const surplus = (g.players[s.owner]?.happiness ?? 0) < UNREST_THRESHOLD ? Math.min(0, rawSurplus) : rawSurplus;
  const options = mine && s.kind === 'city' ? q.productionOptions(g, s.id, content) : [];
  const current = s.production.item;
  const currentOpt = current ? options.find((o) => o.item === current) : undefined;
  const upgradeCost = mine && s.kind === 'town' ? q.upgradeCost(g, s.id, content) : 0;
  const queue = s.queue ?? [];
  const queueError = queueSent ? lastError.value : null;
  const sendQueue = (items: string[]): void => {
    setQueueSent(true);
    dispatch({ type: 'setProductionQueue', settlement: s.id, items: items.slice(0, MAX_QUEUE) });
  };
  const ctx = !current && options.length > 0 ? suggestContext(g, s.id, content, (a, b) => q.atWar(g, a, b), q.settlementCap(g, my, content)) : null;
  const suggestion = ctx ? suggestNext(options, ctx) : null;
  const named = mine
    ? namingLine(lookup.cultures[s.namedFor]?.adjective ?? null, s.namedFor, strongestCulture(q.cultureWeights(g, my, content), content.cultures.map((c) => c.id)))
    : null;
  const figures = Object.values(g.figures).filter(
    (f) => f.owner === my && f.location.state === 'based' && f.location.settlement === s.id,
  );
  // Step through our settlements without panning the map (playtest 4: reaching a far town meant
  // dragging across the map, and a slow drag could open tile info instead).
  const ring = mine ? ownSettlementRing(g, my) : [];
  const at = ring.indexOf(s.id);
  const step = (d: number): void => {
    const next = ring[(at + d + ring.length) % ring.length];
    if (next && next !== s.id) openModal({ kind: 'city', settlement: next });
  };

  return (
    <section class="sheet city-sheet" aria-label={`${s.name} city panel`}>
      <div class="row">
        <div class="grow">
          <h2 class="sheet-title">
            {s.isCapital && (
              <span class="capital-mark" role="img" aria-label="Capital">
                <Icon name="capital" />
              </span>
            )}
            {s.name}
          </h2>
          <div class="small muted">
            {capitalize(s.kind)} · Population {s.population} · Walls {Math.round(s.hp)}/{s.maxHp}
          </div>
          {named && <div class="small muted city-named">{named}</div>}
        </div>
        {ring.length > 1 && at >= 0 && (
          <>
            <button class="btn btn-ghost btn-icon" aria-label={`Previous settlement: ${g.settlements[ring[(at - 1 + ring.length) % ring.length] ?? '']?.name ?? ''}`} onClick={() => step(-1)}>
              <Icon name="back" />
            </button>
            <button class="btn btn-ghost btn-icon" aria-label={`Next settlement: ${g.settlements[ring[(at + 1) % ring.length] ?? '']?.name ?? ''}`} onClick={() => step(1)}>
              <Icon name="next" />
            </button>
          </>
        )}
        <button class="btn btn-ghost btn-icon" aria-label="Close city panel" onClick={closeModal}>
          <Icon name="close" />
        </button>
      </div>

      <div class="progress-line" aria-label={`Food ${num(s.foodStored)} of ${num(growth)} to grow`}>
        <span class="small">
          <Icon name="food" size="sm" /> Growth <span class="tnum">{num(s.foodStored)}/{num(growth)}</span>
          {mine && <span class={`muted growth-eta${surplus < 0 ? ' bad-text' : ''}`}> · {growthText(s.foodStored, growth, surplus)}</span>}
        </span>
        <span class="bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (s.foodStored / Math.max(1, growth)) * 100)}%` }} />
        </span>
      </div>

      <div class="yield-grid" aria-label="Yields per turn">
        {CITY_YIELDS.map((y) => (
          <span class={`chip yield-chip y-${y}`} key={y} aria-label={`${YIELD_NAME[y]} ${signed(yields[y])}`}>
            <Icon name={YIELD_ICON[y]} /> {signed(yields[y])}
          </span>
        ))}
      </div>

      {s.kind === 'town' && mine && (
        <div class="card">
          <div class="small">Towns turn their production into gold. Upgrade to build, research and host figures.</div>
          <button
            class="btn btn-primary mt8"
            disabled={!canAct || gold < upgradeCost}
            // The price is an icon and a number on screen; say "gold" to a screen reader.
            aria-label={`Upgrade ${s.name} to a city for ${upgradeCost} gold`}
            onClick={() => dispatch({ type: 'upgradeSettlement', settlement: s.id })}
          >
            <Icon name="upgrade" /> Upgrade to city · <Icon name="gold" size="sm" /> {upgradeCost}
          </button>
          <div class="small muted mt4 upgrade-why">{upgradeCostReason(upgradeCost, s.population, UPGRADE_COST_BASE, UPGRADE_COST_PER_POP)}</div>
          {gold < upgradeCost && (
            <div class="small muted mt4">
              {Math.ceil(upgradeCost - gold)} more gold needed
              {(g.players[my]?.income.gold ?? 0) > 0
                ? `, about ${turnsText(Math.ceil((upgradeCost - gold) / (g.players[my]?.income.gold ?? 1)))} at your income.`
                : '.'}
            </div>
          )}
        </div>
      )}

      {s.kind === 'city' && mine && (
        <>
          <div class="section-title">Production</div>
          <div class="card row">
            <div class="grow">
              {current ? (
                <>
                  <div>
                    <strong>{itemName(current)}</strong>
                  </div>
                  <div class="small muted">
                    {num(s.production.progress)}/{currentOpt?.cost ?? '?'} · {turnsText(currentOpt?.turns ?? null)}
                  </div>
                </>
              ) : (
                <div class="bad-text">Nothing in production</div>
              )}
            </div>
            {current ? (
              <button class="btn" disabled={!canAct} onClick={() => setPicking(picking === 'current' ? null : 'current')} aria-expanded={picking === 'current'}>
                {picking === 'current' ? 'Done' : 'Change'}
              </button>
            ) : (
              <span class="small muted">Pick one below</span>
            )}
          </div>

          {!current && suggestion && (
            <button
              class="btn suggest-chip"
              disabled={!canAct}
              aria-label={suggestionLabel(itemName(suggestion.item), suggestion.why)}
              onClick={() => {
                dispatch({ type: 'setProduction', settlement: s.id, item: suggestion.item });
                setPicking(null);
              }}
            >
              <span class="suggest-kicker" aria-hidden="true">Suggestion</span>
              <span class="grow suggest-text" aria-hidden="true">
                <strong>{itemName(suggestion.item)}</strong>
                <span class="small muted"> · {suggestion.why}</span>
              </span>
              <Icon name="production" size="sm" />
            </button>
          )}

          {current && (
            <QueueStrip
              queue={queue}
              canAct={canAct}
              adding={picking === 'queue'}
              turnsOf={(item) => options.find((o) => o.item === item)?.turns ?? null}
              onChange={sendQueue}
              onAdd={() => setPicking(picking === 'queue' ? null : 'queue')}
            />
          )}
          {queueError && (
            <p class="small bad-text" role="alert">
              The queue was not saved: {queueError}
            </p>
          )}

          {(picking !== null || !current) &&
            GROUPS.map((grp) => {
              const pool = picking === 'queue' ? queueChoices(options, current, queue) : options;
              const list = pool.filter((o) => o.kind === grp.kind);
              if (list.length === 0) return null;
              return (
                <div key={grp.kind}>
                  <div class="section-title">{picking === 'queue' ? `Then: ${grp.title.toLowerCase()}` : grp.title}</div>
                  {list.map((o) => {
                    const active = picking !== 'queue' && o.item === current;
                    return (
                      <div class={`card prod-option${active ? ' active' : ''}`} key={o.item}>
                        <button
                          class="prod-main"
                          disabled={!canAct}
                          aria-pressed={picking === 'queue' ? undefined : active}
                          aria-label={picking === 'queue' ? `Then build ${itemName(o.item)}` : undefined}
                          onClick={() => {
                            if (picking === 'queue') {
                              sendQueue(queueAdd(queue, o.item));
                              setPicking(null);
                              return;
                            }
                            dispatch({ type: 'setProduction', settlement: s.id, item: o.item });
                            setPicking(null);
                          }}
                        >
                          <span class="row">
                            <strong class="grow">{itemName(o.item)}</strong>
                            <span class="small">
                              <Icon name="production" size="sm" /> {o.cost} · {turnsText(o.turns)}
                            </span>
                          </span>
                          <span class="small muted prod-desc">
                            <GlossText text={itemDescription(o)} />
                          </span>
                        </button>
                        {o.goldCost > 0 && picking !== 'queue' && (
                          <button
                            class={`btn buy${armed === o.item ? ' is-armed' : ''}`}
                            disabled={!canAct || gold < o.goldCost}
                            aria-label={armed === o.item ? `Tap again to buy ${itemName(o.item)} for ${o.goldCost} gold` : `Buy ${itemName(o.item)} for ${o.goldCost} gold`}
                            onClick={() => {
                              // Two taps: the Buy column sits where End Turn usually is, and one
                              // stray tap spent 60-80 gold twice in playtest 4.
                              if (armed !== o.item) {
                                setArmed(o.item);
                                return;
                              }
                              setArmed(null);
                              dispatch({ type: 'buyItem', settlement: s.id, item: o.item });
                            }}
                          >
                            {armed === o.item ? (
                              <>Sure? <Icon name="gold" size="sm" /> {o.goldCost}</>
                            ) : (
                              <>Buy <Icon name="gold" size="sm" /> {o.goldCost}</>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
        </>
      )}

      <div class="section-title">Built here</div>
      {s.buildings.length === 0 ? (
        <div class="small muted">None yet.</div>
      ) : (
        <div class="chips">
          {s.buildings.map((b) => (
            <span class="chip" key={b}>
              {itemName(b)}
            </span>
          ))}
        </div>
      )}

      {figures.length > 0 && (
        <>
          <div class="section-title">Figures based here</div>
          {figures.map((f) => {
            const def = lookup.figures[f.id];
            return (
              <button key={f.id} class="btn figure-row" onClick={() => openModal({ kind: 'figure', figure: f.id })}>
                <FigurePortrait figure={f.id} size="xs" />
                <span class="grow">{def?.name ?? f.id}</span>
                <Icon name="chevron" size="sm" />
              </button>
            );
          })}
        </>
      )}
    </section>
  );
}

/**
 * "Then: …" follow-ons as one compact strip (wave 11: refilling idle cities was the biggest
 * chore). Each entry can move earlier or be removed; "Add" opens the picker in queue mode.
 */
function QueueStrip({
  queue,
  canAct,
  adding,
  turnsOf,
  onChange,
  onAdd,
}: {
  queue: readonly string[];
  canAct: boolean;
  adding: boolean;
  turnsOf: (item: string) => number | null;
  onChange: (items: string[]) => void;
  onAdd: () => void;
}) {
  return (
    <div class="queue-strip" aria-label="Build queue">
      <span class="queue-label" aria-hidden="true">
        Then
      </span>
      <ol class="queue-list">
        {queue.map((item, i) => (
          <li class="queue-item" key={`${i}:${item}`}>
            <span class="queue-n tnum" aria-hidden="true">
              {i + 1}
            </span>
            <span class="grow queue-name">
              {itemName(item)}
              {turnsOf(item) !== null && <span class="muted tnum"> · {turnsText(turnsOf(item))}</span>}
            </span>
            <button class="queue-btn queue-up" disabled={!canAct || i === 0} aria-label={`Build ${itemName(item)} earlier`} onClick={() => onChange(queueMove(queue, i, -1))}>
              <Icon name="back" size="sm" />
            </button>
            <button class="queue-btn" disabled={!canAct} aria-label={`Remove ${itemName(item)} from the queue`} onClick={() => onChange(queueRemove(queue, i))}>
              <Icon name="close" size="sm" />
            </button>
          </li>
        ))}
      </ol>
      {queue.length < MAX_QUEUE ? (
        <button class="btn btn-ghost queue-add" disabled={!canAct} aria-expanded={adding} onClick={onAdd}>
          <Icon name={adding ? 'close' : 'plus'} size="sm" /> {adding ? 'Cancel' : queue.length === 0 ? 'Then build…' : 'Add another'}
        </button>
      ) : (
        // Wave 12 playtest: with three follow-ons "Add another" just vanished, with no word why.
        <p class="small muted queue-full">{queueFullNote(MAX_QUEUE)}</p>
      )}
    </div>
  );
}
