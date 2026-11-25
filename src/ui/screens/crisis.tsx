/** End-of-age crisis card (GDD §5): sober and factual; one of two responses per stage. */
import { closeModal, dispatch, game, lookup, me, myTurn } from '../store';
import type { ScreenProps } from './index';
import { Empty, Screen, Section } from './shared/components';
import { describeModifiers, YIELD_LABEL } from './shared/describe';
import type { Yields, YieldType } from '@contracts/content-schemas';

const stockText = (stock: Yields): string[] =>
  (Object.keys(stock) as YieldType[])
    .filter((k) => (stock[k] ?? 0) !== 0)
    .map((k) => `${(stock[k] ?? 0) > 0 ? '+' : ''}${stock[k]} ${YIELD_LABEL[k]} now`);

export const CrisisScreen = (_: ScreenProps<'crisis'>) => {
  const g = game.value;
  const player = me.value;
  const crisis = g?.crisis ?? null;
  const def = crisis ? lookup.crises[crisis.id] : undefined;
  if (!g || !player || !crisis || !def) {
    return (
      <Screen title="Crisis" label="Crisis" className="scr-crisis">
        <Empty>No crisis is under way.</Empty>
      </Screen>
    );
  }
  const p = g.players[player];
  const stage = crisis.stage > 0 ? def.stages[crisis.stage - 1] : undefined;
  const awaiting = crisis.awaiting.includes(player);
  const past = def.stages.flatMap((s) => s.options).filter((o) => p?.crisisChoices.includes(o.id));

  return (
    <Screen
      title="Crisis"
      label={`Crisis: ${def.name}`}
      className="scr-crisis"
      footer={
        awaiting && stage ? (
          <>
            {stage.options.map((o) => {
              const effects = [...stockText(o.stock), ...describeModifiers(o.modifiers, lookup)];
              return (
                <button
                  class="btn btn-wide scr-response"
                  disabled={!myTurn.value}
                  onClick={() => {
                    dispatch({ type: 'chooseCrisisResponse', option: o.id });
                    closeModal();
                  }}
                  aria-label={`${o.label}: ${o.description}`}
                >
                  <span class="grow">
                    <b>{o.label}</b>
                    <br />
                    <span class="small scr-response-fx">{effects.length ? effects.join('; ') : o.description}</span>
                  </span>
                </button>
              );
            })}
          </>
        ) : (
          <button class="btn" onClick={closeModal} aria-label="Close">
            Close
          </button>
        )
      }
    >
      <p class="scr-tag">
        Crisis · stage {crisis.stage} of {def.stages.length}
      </p>
      <h2 class="scr-crisis-title">{def.name}</h2>
      <p>{def.description}</p>
      {def.pressure.length > 0 && (
        <p class="small muted">While it lasts: {describeModifiers(def.pressure, lookup).join('; ')}.</p>
      )}
      {stage && (
        <div class="card">
          <p class="scr-stage">{stage.text}</p>
        </div>
      )}
      {awaiting && stage ? (
        <p class="small muted">Choose your response below. It lasts until the age ends.</p>
      ) : (
        <Section title="Status">
          <p>{crisis.awaiting.length ? 'Others are still answering this stage.' : 'Every people has answered this stage.'}</p>
          {crisis.stage < def.stages.length && <p class="small muted">The next stage comes as the age draws on.</p>}
        </Section>
      )}
      {past.length > 0 && (
        <Section title="Your choices so far">
          <ul class="scr-mods">
            {past.map((o) => (
              <li>
                <b>{o.label}.</b> {o.description}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Screen>
  );
};
