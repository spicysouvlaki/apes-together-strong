/** Figure roster (GDD §3 states, §6 culture weight): who you have and how your culture is forming. */
import { content, game, me, openModal, q } from '../store';
import type { ScreenProps } from './index';
import { Empty, Portrait, Screen, Section, WeightBars, CultureChip } from './shared/components';
import { ancestorYield, KIND_LABEL } from './shared/describe';
import { groupRoster, weightRows } from './shared/figures';

export const RosterScreen = (_: ScreenProps<'roster'>) => {
  const g = game.value;
  const player = me.value;
  if (!g || !player) return <Screen title="Your people" label="Figure roster"><Empty>No game in progress.</Empty></Screen>;
  const groups = groupRoster(g, player, content);
  const weights = weightRows(q.cultureWeights(g, player, content), content);

  return (
    <Screen
      title="Your people"
      label="Figure roster"
      footer={
        <>
          <button class="btn" onClick={() => openModal({ kind: 'cabinet' })} aria-label="Open cabinet">
            Cabinet
          </button>
          <button class="btn" onClick={() => openModal({ kind: 'chronicle' })} aria-label="Open chronicle">
            Chronicle
          </button>
        </>
      }
    >
      <Section title="Your culture" note="Weight grows with each figure you hold and their time in the cabinet. It decides what you can refine at the next age.">
        {weights.length ? <WeightBars rows={weights} /> : <Empty>No one has joined you yet. Famous people arrive as your people earn renown.</Empty>}
      </Section>
      {groups.map((grp) => (
        <Section
          title={`${grp.title} (${grp.entries.length})`}
          note={grp.id === 'hall' ? 'Retired figures keep giving a little each turn, forever.' : grp.id === 'consumed' ? 'They left play and add nothing to your Legacy score.' : undefined}
        >
          <ul class="scr-list">
            {grp.entries.map((e) => (
              <li>
                <button
                  class="card scr-tap scr-fig-row"
                  onClick={() => openModal({ kind: 'figure', figure: e.fs.id })}
                  aria-label={`${e.def.name}, ${e.where}`}
                >
                  <Portrait figure={e.def.id} size="sm" />
                  <div class="grow">
                    <div class="scr-fig-name">{e.def.name}</div>
                    <div class="small muted">
                      {KIND_LABEL[e.def.kind]} · {grp.id === 'hall' ? ancestorYield(e.def.kind) : e.where}
                    </div>
                  </div>
                  <CultureChip culture={e.def.culture} />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </Screen>
  );
};
