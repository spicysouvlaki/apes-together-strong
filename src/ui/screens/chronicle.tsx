/** The Chronicle (GDD §8): the story of a nation that never existed, age by age. */
import { useState } from 'preact/hooks';
import { closeModal, content, game, me, modal, ownerName, route } from '../store';
import type { ScreenProps } from './index';
import { CultureChip, Empty, Portrait, Screen } from './shared/components';
import { ageLabel, KIND_LABEL } from './shared/describe';
import { buildChronicle, type ChronicleAge } from './shared/chronicle';
import type { FigureKind } from '@contracts/content-schemas';

export const ChronicleScreen = (_: ScreenProps<'chronicle'>) => {
  const g = game.value;
  const player = me.value;
  const [who, setWho] = useState<string | null>(null);
  if (!g || !player) return <Screen title="Chronicle" label="Chronicle"><Empty>No game in progress.</Empty></Screen>;
  const shown = who ?? player;
  const view = buildChronicle(g, shown, content);
  const ended = g.phase === 'ended';
  const winner = g.result ? ownerName(g.result.winner) : null;

  const newGame = () => {
    modal.value = null;
    route.value = 'title';
  };

  return (
    <Screen
      title="Chronicle"
      label="Chronicle"
      closable={!ended}
      footer={
        ended ? (
          <button class="btn btn-primary" onClick={newGame} aria-label="Start a new game">
            New game
          </button>
        ) : (
          <button class="btn" onClick={closeModal} aria-label="Close the chronicle">
            Close
          </button>
        )
      }
    >
      {g.playerOrder.length > 1 && (
        <div class="scr-tabs" role="tablist" aria-label="Whose chronicle">
          {g.playerOrder.map((id) => (
            <button role="tab" aria-selected={id === shown ? 'true' : 'false'} class={`btn ${id === shown ? 'scr-tab-on' : ''}`} onClick={() => setWho(id)}>
              {id === player ? 'Yours' : ownerName(id)}
            </button>
          ))}
        </div>
      )}
      {!view ? (
        <Empty>No chronicle.</Empty>
      ) : (
        <>
          <div
            class="scr-chron-head"
            style={{ background: `linear-gradient(160deg, ${view.colors.primary}, ${view.colors.secondary})` }}
          >
            {view.dream && (
              <div class="scr-chron-motto" lang="und" aria-label={`Motto: ${view.dream.romanized}, ${view.dream.meaning}`}>
                {view.dream.native}
              </div>
            )}
            <h2>{view.civName}</h2>
            <div class="small">
              Led by {view.leader}
              {view.dream && ` · ${view.dream.romanized}: “${view.dream.meaning}” (${view.dream.language})`}
            </div>
          </div>

          {view.ages.length === 0 && <Empty>The story has not begun.</Empty>}
          {view.ages.map((a) => (
            <AgeSection age={a} />
          ))}

          {g.result && (
            <section class="card scr-result" style={{ marginTop: '16px' }}>
              <div class="scr-tag">The end of the chronicle</div>
              <b>{winner} prevailed</b>
              <p class="small muted">{g.result.reason}</p>
              <ul class="scr-list">
                {Object.entries(g.result.scores)
                  .sort((x, y) => y[1] - x[1])
                  .map(([id, score]) => (
                    <li class="scr-kv">
                      <span>{id === player ? `${ownerName(id)} (you)` : ownerName(id)}</span>
                      <b>{score}</b>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </>
      )}
    </Screen>
  );
};

const AgeSection = ({ age: a }: { age: ChronicleAge }) => (
  <section class="scr-chron-age">
    <h3>The {ageLabel(a.age)} age</h3>
    {a.events.map((e) => (
      <p class="scr-chron-line small muted">{e.text}</p>
    ))}
    {a.figures.length > 0 && (
      <>
        <div class="section-title">People</div>
        <ul class="scr-list">
          {a.figures.map((f) => (
            <li class="card">
              <div class="row">
                <Portrait name={f.name} culture={f.culture} size="sm" legend={f.kind === 'legend'} />
                <div class="grow">
                  <div class="scr-fig-name">{f.name}</div>
                  <div class="scr-chips">
                    <CultureChip culture={f.culture} />
                    <span class="chip">{KIND_LABEL[f.kind as FigureKind] ?? f.kind}</span>
                  </div>
                </div>
              </div>
              <p class="scr-chron-line small">{f.bio}</p>
              <p class="scr-history">{f.text}</p>
            </li>
          ))}
        </ul>
      </>
    )}
    {a.traditions.length + a.hybrids.length > 0 && (
      <>
        <div class="section-title">Traditions</div>
        <ul class="scr-list">
          {[...a.hybrids, ...a.traditions].map((t) => (
            <li class="card">
              <div class="scr-kv">
                <span class="scr-fig-name">{t.name}</span>
                <span class="chip">{t.tier ? t.tier : 'hybrid'}</span>
              </div>
              <div class="scr-chips">
                {t.cultures.map((c) => (
                  <CultureChip culture={c} />
                ))}
              </div>
              <p class="scr-history">{t.note}</p>
            </li>
          ))}
        </ul>
      </>
    )}
    {a.wonders.length > 0 && (
      <>
        <div class="section-title">Wonders</div>
        {a.wonders.map((w) => (
          <p class="scr-chron-line">
            <b>{w.name}.</b> {w.note}
          </p>
        ))}
      </>
    )}
    {a.wars.length > 0 && (
      <>
        <div class="section-title">Wars</div>
        {a.wars.map((w) => (
          <p class="scr-chron-line">
            Turn {w.turn}: {w.text}
            {w.against && <span class="muted"> ({ownerName(w.against)})</span>}
          </p>
        ))}
      </>
    )}
    {a.crises.length > 0 && (
      <>
        <div class="section-title">Hard times</div>
        {a.crises.map((c) => (
          <p class="scr-chron-line">{c.text}</p>
        ))}
      </>
    )}
  </section>
);
