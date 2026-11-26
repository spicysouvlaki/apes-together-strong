/**
 * Long-press tile info (GDD §11 "long-press tile info"). Unexplored tiles show nothing;
 * explored-but-not-visible tiles show terrain only (units and settlements there are hidden).
 */
import type { Hex } from '@contracts/hex';
import type { Yields } from '@contracts/content-schemas';
import { closeModal, content, game, lookup, me, openModal, ownerName, q } from '../store';
import { YIELD_ICON, YIELD_NAME, capitalize } from './format';
import { Icon } from '../art/Icon';
import { settlementAt, tileIndexOf, unitsAt } from './hexutil';

const yieldChips = (y: Yields) =>
  (Object.keys(y) as (keyof Yields)[])
    .filter((k) => (y[k] ?? 0) !== 0)
    .map((k) => (
      <span class="chip" key={k} aria-label={`${YIELD_NAME[k]} ${y[k]}`}>
        <Icon name={YIELD_ICON[k]} /> {y[k]}
      </span>
    ));

export function TileInfo({ hex }: { hex: Hex }) {
  const g = game.value;
  const my = me.value;
  if (!g || !my) return null;
  const idx = tileIndexOf(g.map, hex);
  const t = idx === null ? undefined : g.map.tiles[idx];
  const explored = idx !== null && g.players[my]?.explored[idx] === 1;
  const visible = idx !== null && q.visibleTiles(g, my, content).includes(idx);

  const close = (
    <button class="btn btn-ghost btn-icon" aria-label="Close tile info" onClick={closeModal}>
      <Icon name="close" />
    </button>
  );
  if (!t || !explored) {
    return (
      <section class="sheet" aria-label="Tile info">
        <div class="row">
          <h2 class="sheet-title grow">Unexplored</h2>
          {close}
        </div>
        <p class="small muted">Send a scout to see what lies here.</p>
      </section>
    );
  }
  const terrain = lookup.terrain[t.terrain];
  const resource = t.resource ? lookup.resources[t.resource] : undefined;
  const settlement = visible ? settlementAt(g, hex) : null;
  const units = visible ? unitsAt(g, hex) : [];

  return (
    <section class="sheet" aria-label="Tile info">
      <div class="row">
        <h2 class="sheet-title grow">
          {terrain?.name ?? t.terrain}
          {t.feature ? ` · ${capitalize(t.feature)}` : ''}
        </h2>
        {close}
      </div>
      <div class="chips">
        {terrain && yieldChips(terrain.yields)}
        {t.river && (
          <span class="chip">
            <Icon name="river" size="sm" /> River
          </span>
        )}
        {terrain?.moveCost === null ? <span class="chip">Impassable</span> : <span class="chip">Move {terrain?.moveCost ?? 1}</span>}
        {(terrain?.defense ?? 0) !== 0 && <span class="chip">Defense {terrain?.defense}</span>}
      </div>
      {resource && (
        <div class="card mt8">
          <strong>{resource.name}</strong> <span class="small muted">({resource.class})</span>
          <div class="chips mt4">{yieldChips(resource.yields)}</div>
        </div>
      )}
      <div class="small muted mt8">{t.owner ? `Territory of ${ownerName(t.owner)}` : 'Unclaimed'}</div>
      {!visible && <div class="small muted">Not in sight right now.</div>}
      {settlement &&
        (settlement.owner === my ? (
          // Our own town opens its sheet (playtest 4: the row looked tappable and was not).
          <button
            class="card mt8 tile-city-link"
            onClick={() => openModal({ kind: 'city', settlement: settlement.id })}
            aria-label={`Open ${settlement.name}`}
          >
            <span class="grow">
              <strong>{settlement.name}</strong>{' '}
              <span class="small muted">
                {capitalize(settlement.kind)} of {ownerName(settlement.owner)} · pop {settlement.population}
              </span>
            </span>
            <Icon name="chevron" size="sm" />
          </button>
        ) : (
          <div class="card mt8">
            <strong>{settlement.name}</strong>{' '}
            <span class="small muted">
              {capitalize(settlement.kind)} of {ownerName(settlement.owner)} · pop {settlement.population}
            </span>
          </div>
        ))}
      {units.map((u) => (
        <div class="card mt8" key={u.id}>
          {u.figure ? (lookup.figures[u.figure]?.name ?? 'Figure') : (lookup.units[u.type]?.name ?? u.type)}{' '}
          <span class="small muted">
            {ownerName(u.owner)} · <Icon name="health" size="sm" /> {u.hp}
          </span>
        </div>
      ))}
    </section>
  );
}
