/**
 * City panel (modal 'city', GDD §7 "Settlements"). Shows what the sim reports through
 * SimQueries: yields, growth, production options with cost/turns/gold cost. Picks send
 * `setProduction` / `buyItem` / `upgradeSettlement`; the sim validates them.
 */
import { useState } from 'preact/hooks';
import type { ProductionOption } from '@contracts/sim-api';
import type { YieldType } from '@contracts/content-schemas';
import { closeModal, content, dispatch, game, lookup, me, myTurn, openModal, q } from '../store';
import { YIELD_ICON, YIELD_NAME, capitalize, num, signed, turnsText } from './format';
import { Icon } from '../art/Icon';
import { FigurePortrait } from '../art/game-art';

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
  const [picking, setPicking] = useState(false);
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
  const options = mine && s.kind === 'city' ? q.productionOptions(g, s.id, content) : [];
  const current = s.production.item;
  const currentOpt = current ? options.find((o) => o.item === current) : undefined;
  const upgradeCost = mine && s.kind === 'town' ? q.upgradeCost(g, s.id, content) : 0;
  const figures = Object.values(g.figures).filter(
    (f) => f.owner === my && f.location.state === 'based' && f.location.settlement === s.id,
  );

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
        </div>
        <button class="btn btn-ghost btn-icon" aria-label="Close city panel" onClick={closeModal}>
          <Icon name="close" />
        </button>
      </div>

      <div class="progress-line" aria-label={`Food ${num(s.foodStored)} of ${num(growth)} to grow`}>
        <span class="small">
          <Icon name="food" size="sm" /> Growth <span class="tnum">{num(s.foodStored)}/{num(growth)}</span>
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
            onClick={() => dispatch({ type: 'upgradeSettlement', settlement: s.id })}
          >
            <Icon name="upgrade" /> Upgrade to city · <Icon name="gold" size="sm" /> {upgradeCost}
          </button>
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
              <button class="btn" disabled={!canAct} onClick={() => setPicking(!picking)} aria-expanded={picking}>
                {picking ? 'Done' : 'Change'}
              </button>
            ) : (
              <span class="small muted">Pick one below</span>
            )}
          </div>

          {(picking || !current) &&
            GROUPS.map((grp) => {
              const list = options.filter((o) => o.kind === grp.kind);
              if (list.length === 0) return null;
              return (
                <div key={grp.kind}>
                  <div class="section-title">{grp.title}</div>
                  {list.map((o) => {
                    const active = o.item === current;
                    return (
                      <div class={`card prod-option${active ? ' active' : ''}`} key={o.item}>
                        <button
                          class="prod-main"
                          disabled={!canAct}
                          aria-pressed={active}
                          onClick={() => {
                            dispatch({ type: 'setProduction', settlement: s.id, item: o.item });
                            setPicking(false);
                          }}
                        >
                          <span class="row">
                            <strong class="grow">{itemName(o.item)}</strong>
                            <span class="small">
                              <Icon name="production" size="sm" /> {o.cost} · {turnsText(o.turns)}
                            </span>
                          </span>
                          <span class="small muted prod-desc">{itemDescription(o)}</span>
                        </button>
                        {o.goldCost > 0 && (
                          <button
                            class="btn buy"
                            disabled={!canAct || gold < o.goldCost}
                            aria-label={`Buy ${itemName(o.item)} for ${o.goldCost} gold`}
                            onClick={() => dispatch({ type: 'buyItem', settlement: s.id, item: o.item })}
                          >
                            Buy <Icon name="gold" size="sm" /> {o.goldCost}
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
