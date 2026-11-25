/** Cabinet (GDD §3 "Seat", §7 governments): seats of the current government and who sits in them. */
import { useState } from 'preact/hooks';
import { content, dispatch, game, lookup, me, myTurn, openModal, q } from '../store';
import type { ScreenProps } from './index';
import { Empty, Portrait, Screen, Section, Sheet } from './shared/components';
import { describeModifiers, KIND_LABEL } from './shared/describe';
import { slotIdOfKey } from './shared/figures';
import { seatLabel } from './figure';

export const CabinetScreen = (_: ScreenProps<'cabinet'>) => {
  const [picking, setPicking] = useState<string | null>(null);
  const g = game.value;
  const player = me.value;
  const p = player && g ? g.players[player] : undefined;
  if (!g || !player || !p) return <Screen title="Cabinet" label="Cabinet"><Empty>No game in progress.</Empty></Screen>;

  const gov = p.government ? lookup.governments[p.government] : undefined;
  const seats = q.cabinetSeats(g, player, content);
  const turn = myTurn.value;

  // Based figures the sim would let sit in the seat being picked.
  const eligible = picking
    ? Object.values(g.figures).filter((fs) => fs.owner === player && fs.location.state === 'based' && q.figureActions(g, fs.id, content).seat.includes(picking))
    : [];

  return (
    <Screen
      title="Cabinet"
      label="Cabinet"
      footer={
        <button class="btn" onClick={() => openModal({ kind: 'government' })} aria-label="Change government">
          {gov ? 'Change government' : 'Choose a government'}
        </button>
      }
    >
      {p.anarchyTurns > 0 && (
        <div class="scr-banner scr-banner-bad" role="status">
          Anarchy: no cabinet bonuses for {p.anarchyTurns} more {p.anarchyTurns === 1 ? 'turn' : 'turns'}.
        </div>
      )}
      <Section title="Government">
        {gov ? (
          <div class="card">
            <div class="scr-fig-name">{gov.name}</div>
            {gov.modifiers.length > 0 ? (
              <ul class="scr-mods small">
                {describeModifiers(gov.modifiers, lookup).map((t) => (
                  <li>{t}</li>
                ))}
              </ul>
            ) : (
              <p class="small muted">No standing bonuses.</p>
            )}
          </div>
        ) : (
          <Empty>You have no government yet.</Empty>
        )}
      </Section>
      <Section title="Seats" note="Seated figures give their bonus every turn and count double toward culture weight. A vacated seat takes two turns to fill again.">
        {seats.length === 0 && <Empty>Choose a government to open cabinet seats.</Empty>}
        <ul class="scr-list">
          {seats.map((s) => {
            const slot = lookup.cabinetSlots[s.slot] ?? lookup.cabinetSlots[slotIdOfKey(s.key)];
            const fig = s.figure ? lookup.figures[s.figure] : undefined;
            const wait = s.availableTurn - g.turn;
            const accepts = slot ? slot.accepts.map((k) => KIND_LABEL[k]).join(', ') : '';
            if (fig) {
              return (
                <li>
                  <button class="card scr-tap" onClick={() => openModal({ kind: 'figure', figure: fig.id })} aria-label={`${seatLabel(s.key)}: ${fig.name}`}>
                    <div class="scr-tag">{seatLabel(s.key)}</div>
                    <div class="scr-seat">
                      <Portrait name={fig.name} culture={fig.culture} size="sm" legend={fig.kind === 'legend'} />
                      <div class="grow">
                        <div class="scr-fig-name">{fig.name}</div>
                        <div class="small">{describeModifiers(fig.cabinetModifiers, lookup).join('; ') || 'Counts double for culture weight'}</div>
                      </div>
                      <span class="scr-chev">›</span>
                    </div>
                  </button>
                </li>
              );
            }
            return (
              <li>
                <button
                  class="card scr-tap"
                  disabled={!turn || wait > 0 || p.anarchyTurns > 0}
                  onClick={() => setPicking(s.key)}
                  aria-label={`${seatLabel(s.key)}: empty. Choose someone to seat`}
                >
                  <div class="scr-tag">{seatLabel(s.key)}</div>
                  <div class="scr-seat">
                    <div class="scr-seat-empty">+</div>
                    <div class="grow">
                      <div>{wait > 0 ? `Free in ${wait} ${wait === 1 ? 'turn' : 'turns'}` : 'Empty seat'}</div>
                      <div class="small muted">Accepts: {accepts}</div>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      {picking && (
        <Sheet title={`Who should be ${seatLabel(picking)}?`} onCancel={() => setPicking(null)}>
          {eligible.length === 0 && <Empty>No one at home suits this seat. Figures in the field must come home first.</Empty>}
          {eligible.map((fs) => {
            const def = lookup.figures[fs.id];
            if (!def) return null;
            return (
              <button
                class="btn scr-option"
                onClick={() => {
                  dispatch({ type: 'seatFigure', figure: fs.id, slot: picking });
                  setPicking(null);
                }}
                aria-label={`Seat ${def.name}`}
              >
                <Portrait name={def.name} culture={def.culture} size="sm" />
                <span class="grow">
                  <b>{def.name}</b>
                  <br />
                  <span class="small">{describeModifiers(def.cabinetModifiers, lookup).join('; ') || 'Counts double for culture weight'}</span>
                </span>
              </button>
            );
          })}
        </Sheet>
      )}
    </Screen>
  );
};
