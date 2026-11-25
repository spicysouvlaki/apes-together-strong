/** Government choice (GDD §7 "Governments"): seats + modifiers; mid-age change costs anarchy. */
import { useState } from 'preact/hooks';
import { ANARCHY_TURNS } from '../../sim/constants';
import { closeModal, content, dispatch, game, lookup, me, myTurn, q } from '../store';
import type { ScreenProps } from './index';
import { ConfirmSheet, Empty, Screen } from './shared/components';
import { describeModifiers } from './shared/describe';

/** Government cards; used by this screen and by the transition's government step. */
export const GovernmentList = (props: { onChosen?: () => void }) => {
  const [confirm, setConfirm] = useState<string | null>(null);
  const g = game.value;
  const player = me.value;
  const p = g && player ? g.players[player] : undefined;
  if (!g || !player || !p) return null;
  const options = q.governmentOptions(g, player, content);
  const inTransition = g.phase === 'transition';
  const free = p.government === null || inTransition;
  const canAct = inTransition ? !(g.transition?.recap[player]?.done ?? true) : myTurn.value;

  const choose = (id: string) => {
    dispatch({ type: 'setGovernment', government: id });
    setConfirm(null);
    props.onChosen?.();
  };

  if (options.length === 0) return <Empty>No government is available yet.</Empty>;
  return (
    <>
      {!free && (
        <p class="scr-banner scr-banner-info small">
          Changing government mid-age brings {ANARCHY_TURNS} turns of anarchy: no cabinet bonuses meanwhile.
        </p>
      )}
      <ul class="scr-list">
        {options.map((id) => {
          const gov = lookup.governments[id];
          if (!gov) return null;
          const current = p.government === id;
          return (
            <li>
              <div class={`card ${current ? 'scr-selected' : ''}`}>
                <div class="scr-fig-name">{gov.name}</div>
                <div class="scr-chips">
                  {gov.cabinetSlots.map((s) => (
                    <span class="chip">{lookup.cabinetSlots[s]?.name ?? s}</span>
                  ))}
                  <span class="chip">{gov.policySlots} policy slots</span>
                </div>
                {gov.modifiers.length > 0 && (
                  <ul class="scr-mods small">
                    {describeModifiers(gov.modifiers, lookup).map((t) => (
                      <li>{t}</li>
                    ))}
                  </ul>
                )}
                <div class="scr-actions">
                  <button
                    class={`btn ${current ? '' : 'btn-primary'}`}
                    disabled={current || !canAct}
                    onClick={() => (free ? choose(id) : setConfirm(id))}
                    aria-label={current ? `${gov.name} is your government` : `Adopt ${gov.name}`}
                  >
                    {current ? 'Current' : `Adopt ${gov.name}`}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {confirm && (
        <ConfirmSheet
          title={`Adopt ${lookup.governments[confirm]?.name ?? confirm}?`}
          confirmLabel="Change government"
          danger
          onConfirm={() => choose(confirm)}
          onCancel={() => setConfirm(null)}
        >
          <p>
            Your realm falls into {ANARCHY_TURNS} turns of anarchy: no cabinet bonuses until it ends. Figures in seats the new government
            lacks return home.
          </p>
        </ConfirmSheet>
      )}
    </>
  );
};

export const GovernmentScreen = (_: ScreenProps<'government'>) => (
  <Screen title="Government" label="Government" footer={<button class="btn" onClick={closeModal} aria-label="Done">Done</button>}>
    <GovernmentList />
  </Screen>
);
