/** One figure: full card plus the GDD §3 actions the sim says are legal (q.figureActions). */
import { useState } from 'preact/hooks';
import type { FigureState } from '@contracts/sim-api';
import { content, dispatch, game, lookup, me, myTurn, ownerName, q } from '../store';
import type { ScreenProps } from './index';
import { ConfirmSheet, Empty, FigureCard, Screen, Section, Sheet } from './shared/components';
import { ancestorYield, consumeBurstText } from './shared/describe';
import { slotIdOfKey, whereText } from './shared/figures';

type Pending = null | 'seat' | 'deploy' | 'activate' | 'consume' | 'consume-rp' | 'consume-yields';

/** "Warleader", or "Warleader (2nd)" when a government has two of the same seat. */
export const seatLabel = (key: string): string => {
  const name = lookup.cabinetSlots[slotIdOfKey(key)]?.name ?? slotIdOfKey(key);
  const n = Number(key.slice(key.indexOf('#') + 1));
  return n > 0 ? `${name} (${n + 1}${n === 1 ? 'nd' : n === 2 ? 'rd' : 'th'})` : name;
};

const statusLine = (fs: FigureState | undefined, mine: boolean): string => {
  if (!fs) return 'Not in anyone’s service.';
  if (!mine) return `Serves ${ownerName(fs.owner)}.`;
  const g = game.value;
  return g ? whereText(g, fs, content) : '';
};

export const FigureScreen = ({ modal }: ScreenProps<'figure'>) => {
  const [pending, setPending] = useState<Pending>(null);
  const g = game.value;
  const player = me.value;
  const def = lookup.figures[modal.figure];
  if (!g || !def) {
    return (
      <Screen title="Figure" label="Figure">
        <Empty>Unknown figure.</Empty>
      </Screen>
    );
  }
  const fs = g.figures[def.id];
  const mine = !!fs && fs.owner === player;
  const p = player ? g.players[player] : undefined;
  const a = mine ? q.figureActions(g, def.id, content) : null;
  const turn = myTurn.value;
  const loc = fs?.location.state;

  const run = (cmd: Parameters<typeof dispatch>[0]) => {
    dispatch(cmd);
    setPending(null);
  };

  // Disabled reasons where the rules make them knowable from public state.
  const reasons: string[] = [];
  if (mine && a) {
    if (!turn) reasons.push('You can act on your turn.');
    if (def.uses.includes('cabinet') && a.seat.length === 0 && loc === 'based') {
      reasons.push(p && p.anarchyTurns > 0 ? 'No cabinet during anarchy.' : 'No free cabinet seat suits them right now.');
    }
    if (def.uses.includes('unit') && loc === 'based' && a.deploy.length === 0) reasons.push('They can only take the field from one of your cities.');
    if (loc === 'unit' && !a.canRecall) reasons.push('Move them into one of your settlements to bring them home.');
    if (def.activate && def.uses.includes('activate') && !a.canActivate && (loc === 'based' || loc === 'seated' || loc === 'unit')) {
      reasons.push(
        def.activate.effect === 'rush_wonder'
          ? 'Their deed needs a city building a wonder.'
          : def.activate.effect === 'production_burst'
            ? 'Their deed needs a city building something.'
            : 'Their deed is not possible right now.',
      );
    }
  }

  const buttons = mine && a
    ? [
        loc === 'based' && def.uses.includes('cabinet') && (
          <button class="btn btn-primary" disabled={!turn || a.seat.length === 0} onClick={() => setPending('seat')} aria-label="Seat in the cabinet">
            Seat
          </button>
        ),
        loc === 'seated' && (
          <button class="btn" disabled={!turn || !a.canUnseat} onClick={() => run({ type: 'unseatFigure', figure: def.id })} aria-label="Unseat from the cabinet">
            Unseat
          </button>
        ),
        loc === 'based' && def.uses.includes('unit') && (
          <button class="btn" disabled={!turn || a.deploy.length === 0} onClick={() => setPending('deploy')} aria-label="Deploy as a unit">
            Deploy
          </button>
        ),
        loc === 'unit' && (
          <button class="btn" disabled={!turn || !a.canRecall} onClick={() => run({ type: 'recallFigure', figure: def.id })} aria-label="Recall home">
            Recall
          </button>
        ),
        def.uses.includes('activate') && def.activate && (loc === 'based' || loc === 'seated' || loc === 'unit') && (
          <button class="btn" disabled={!turn || !a.canActivate} onClick={() => setPending('activate')} aria-label="Activate their one-time deed">
            Activate
          </button>
        ),
        a.canConsume && (
          <button class="btn" disabled={!turn} onClick={() => setPending('consume')} aria-label="Consume this figure">
            Consume
          </button>
        ),
      ].filter(Boolean)
    : [];

  return (
    <Screen title={def.name} label={`Figure: ${def.name}`} footer={buttons.length ? <>{buttons}</> : undefined}>
      <FigureCard
        def={def}
        reason={def.deed ? null : fs?.reason}
        status={statusLine(fs, mine)}
        extra={def.deed ? <p class="scr-history">Arrives through a deed: {lookup.deeds[def.deed]?.name ?? 'a story beat'}.</p> : undefined}
      />
      {mine && loc === 'retired' && (
        <Section title="Hall of Ancestors">
          <p>Gives {ancestorYield(def.kind)} for the rest of the game.</p>
        </Section>
      )}
      {mine && loc === 'consumed' && (
        <Section title="Consumed">
          <p class="muted">They left play. They add nothing to your Legacy score.</p>
        </Section>
      )}
      {reasons.length > 0 && (
        <Section title="Why some actions are unavailable">
          <ul class="scr-mods small muted">
            {reasons.map((r) => (
              <li>{r}</li>
            ))}
          </ul>
        </Section>
      )}

      {pending === 'seat' && a && (
        <Sheet title={`Seat ${def.name}`} onCancel={() => setPending(null)}>
          {a.seat.map((key) => (
            <button class="btn scr-option" onClick={() => run({ type: 'seatFigure', figure: def.id, slot: key })} aria-label={`Seat as ${seatLabel(key)}`}>
              <span class="grow">{seatLabel(key)}</span>
              <span class="scr-chev">›</span>
            </button>
          ))}
        </Sheet>
      )}
      {pending === 'deploy' && a && (
        <Sheet title={`Where should ${def.name} muster?`} onCancel={() => setPending(null)}>
          {a.deploy.map((sid) => (
            <button class="btn scr-option" onClick={() => run({ type: 'deployFigure', figure: def.id, settlement: sid })} aria-label={`Deploy at ${g.settlements[sid]?.name ?? sid}`}>
              <span class="grow">{g.settlements[sid]?.name ?? sid}</span>
              <span class="scr-chev">›</span>
            </button>
          ))}
        </Sheet>
      )}
      {pending === 'activate' && def.activate && (
        <ConfirmSheet
          title={`Activate ${def.name}?`}
          confirmLabel="Activate"
          onConfirm={() => run({ type: 'activateFigure', figure: def.id })}
          onCancel={() => setPending(null)}
        >
          <p>This happens once. Afterwards {def.name} retires to the Hall of Ancestors ({ancestorYield(def.kind)}).</p>
        </ConfirmSheet>
      )}
      {pending === 'consume' && (
        <Sheet title={`Consume ${def.name}?`} onCancel={() => setPending(null)}>
          <p class="small muted">They leave play for good and add nothing to your Legacy score. Choose what you gain:</p>
          <button class="btn scr-option" onClick={() => setPending('consume-rp')} aria-label="Gain refinement points">
            <span class="grow">
              <b>{def.consumeValue} refinement points</b>
              <br />
              <span class="small muted">Spent on traditions at the next age</span>
            </span>
          </button>
          <button class="btn scr-option" onClick={() => setPending('consume-yields')} aria-label="Gain a yield burst">
            <span class="grow">
              <b>{consumeBurstText(def)}</b>
            </span>
          </button>
        </Sheet>
      )}
      {(pending === 'consume-rp' || pending === 'consume-yields') && (
        <ConfirmSheet
          title={`Consume ${def.name}?`}
          confirmLabel="Consume"
          danger
          onConfirm={() => run({ type: 'consumeFigure', figure: def.id, as: pending === 'consume-rp' ? 'refinement' : 'yields' })}
          onCancel={() => setPending(null)}
        >
          <p>
            You gain {pending === 'consume-rp' ? `${def.consumeValue} refinement points` : consumeBurstText(def)}. {def.name} leaves play and
            cannot come back. This cannot be undone.
          </p>
        </ConfirmSheet>
      )}
    </Screen>
  );
};
