/** Government choice (GDD §7 "Governments"): seats + modifiers; mid-age change costs anarchy. */
import { useState } from 'preact/hooks';
import { Term } from '../shell/GlossarySheet';
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

  // Governments of this age not yet open, with the civic that opens each (an empty-looking
  // screen with one card read as "that's all there is"; playtest).
  const age = inTransition ? (g.transition?.toAge ?? g.age) : g.age;
  const later = content.governments
    .filter((x) => x.age === age && !options.includes(x.id))
    .map((x) => ({
      gov: x,
      by: content.techs.filter((t) => t.modifiers.some((m) => m.effect.kind === 'unlock' && m.effect.what === 'government' && m.effect.id === x.id)).map((t) => t.name),
    }));
  if (options.length === 0) return <Empty>No government is available yet.</Empty>;
  return (
    <>
      <p class="small muted scr-note">
        A government gives standing bonuses and opens cabinet seats. Each seat holds one figure of a matching kind, whose bonus then applies
        every turn.
      </p>
      {!free && (
        <p class="scr-banner scr-banner-info small">
          Changing government mid-age brings {ANARCHY_TURNS} turns of <Term id="anarchy" />: no cabinet bonuses meanwhile.
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
                {/* policySlots is not a mechanic yet (no policies in the sim), so it is not shown. */}
                <div class="scr-chips" aria-label="Cabinet seats">
                  <span class="small muted">Seats:</span>
                  {gov.cabinetSlots.map((s) => (
                    <span class="chip">{lookup.cabinetSlots[s]?.name ?? s}</span>
                  ))}
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
      {later.length > 0 && (
        <div class="scr-later">
          <p class="scr-tag">Opened later by civics</p>
          <ul class="scr-later-list small">
            {later.map(({ gov, by }) => (
              <li>
                <b>{gov.name}</b>
                <span class="muted">
                  {' '}
                  · seats {gov.cabinetSlots.map((s) => lookup.cabinetSlots[s]?.name ?? s).join(', ')}
                  {by.length > 0 && ` · from ${by.join(' or ')}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
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

export const GovernmentScreen = (_: ScreenProps<'government'>) => {
  const g = game.value;
  const player = me.value;
  // The first government is a turn-one step (Next: Government): back to the map once chosen.
  const first = !!g && !!player && g.players[player]?.government === null;
  return (
    <Screen title="Government" label="Government" footer={<button class="btn" onClick={closeModal} aria-label="Done">Done</button>}>
      <GovernmentList onChosen={first ? closeModal : undefined} />
    </Screen>
  );
};
