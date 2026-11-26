/** The Chronicle (GDD §8): the story of a nation that never existed, age by age. */
import { useState } from 'preact/hooks';
import { closeModal, content, game, lookup, me, modal, ownerName, q, route } from '../store';
import { ageSummary, storyFacts, storyParagraphs, type StoryInput } from './shared/chronicle-story';
import { weightRows } from './shared/figures';
import { ShareButtons } from './chronicle-share';
import type { ScreenProps } from './index';
import { CultureChip, Empty, Portrait, Screen } from './shared/components';
import { Icon } from '../art/Icon';
import { CultureCrest, FigurePortrait, PlayerBanner } from '../art/game-art';
import { ageLabel, bioText, KIND_LABEL } from './shared/describe';
import { buildChronicle, type ChronicleAge } from './shared/chronicle';
import type { FigureKind } from '@contracts/content-schemas';

export const ChronicleScreen = (_: ScreenProps<'chronicle'>) => {
  const g = game.value;
  const player = me.value;
  const [who, setWho] = useState<string | null>(null);
  if (!g || !player) return <Screen title="Chronicle" label="Chronicle"><Empty>No game in progress.</Empty></Screen>;
  const shown = who ?? player;
  const view = buildChronicle(g, shown, content);
  const story: StoryInput | null = view
    ? {
        view,
        cultures: weightRows(q.cultureWeights(g, shown, content), content)
          .slice(0, 3)
          .map((r) => lookup.cultures[r.culture]?.adjective ?? r.culture),
        named: !!g.players[shown]?.civName,
        facts: storyFacts(g, shown, content, ownerName),
      }
    : null;
  const ended = g.phase === 'ended';
  const winner = g.result ? ownerName(g.result.winner) : null;

  const newGame = () => {
    modal.value = null;
    route.value = 'setup';
  };

  return (
    <Screen
      title="Chronicle"
      label="Chronicle"
      closable={!ended}
      footer={
        <>
          {story && <ShareButtons story={story} ended={ended} turn={g.turn} />}
          {ended ? (
            <button class="btn btn-primary" onClick={newGame} aria-label="Start a new game">
              New game
            </button>
          ) : (
            <button class="btn" onClick={closeModal} aria-label="Close the chronicle">
              Close
            </button>
          )}
        </>
      }
    >
      {g.playerOrder.length > 1 && (
        <div class="scr-tabs" role="tablist" aria-label="Whose chronicle">
          {g.playerOrder.map((id) => (
            <button role="tab" aria-selected={id === shown ? 'true' : 'false'} class={`btn ${id === shown ? 'scr-tab-on' : ''}`} onClick={() => setWho(id)}>
              {id === player ? 'Yours' : cap(ownerName(id))}
            </button>
          ))}
        </div>
      )}
      {!view ? (
        <Empty>No chronicle.</Empty>
      ) : (
        <>
          <div class="scr-chron-head">
            {g.players[shown] && (
              <div class="scr-chron-banner">
                <PlayerBanner player={g.players[shown]!} width={70} wave />
              </div>
            )}
            <div class="scr-chron-eyebrow">The Chronicle of</div>
            <h2>{cap(view.civName)}</h2>
            {view.dream && (
              <div class="scr-chron-motto" lang="und" aria-label={`Motto: ${view.dream.romanized}, ${view.dream.meaning}`}>
                {view.dream.native}
              </div>
            )}
            <div class="scr-chron-sub">
              Led by {view.leader}
              {view.dream && (
                <>
                  <br />
                  <i>{view.dream.romanized}</i>: “{view.dream.meaning}” <span class="muted">({view.dream.language})</span>
                </>
              )}
            </div>
            <div class="fleuron" aria-hidden="true">
              <Icon name="legend" size="sm" />
            </div>
          </div>
          {/* The verdict first: at the end of a game the player opens this to learn who won. */}
          {g.result && (
            <section class={`card scr-result${view.result?.won ? ' won' : ''}`} style={{ margin: '4px 0 16px' }}>
              <div class="scr-result-seal" aria-hidden="true">
                <Icon name={view.result?.won ? 'legend' : 'legacy'} />
              </div>
              <div class="scr-tag">The end of the chronicle</div>
              <b>{winner ? cap(winner) : 'No one'} prevailed</b>
              <p class="small muted">{g.result.reason}</p>
              <ul class="scr-list">
                {Object.entries(g.result.scores)
                  .sort((x, y) => y[1] - x[1])
                  .map(([id, score]) => (
                    <li class="scr-kv">
                      <span>{id === player ? `${cap(ownerName(id))} (you)` : cap(ownerName(id))}</span>
                      <b>{score}</b>
                    </li>
                  ))}
              </ul>
            </section>
          )}
          {story?.facts && (
            <div class="scr-chron-story" aria-label="The story">
              {storyParagraphs(story, story.facts, ended, g.turn).map((para, i) => (
                <p class={i === 0 ? 'scr-chron-opening scr-dropcap' : 'scr-chron-para'} key={i}>
                  {para}
                </p>
              ))}
            </div>
          )}

          {view.ages.length > 0 && <div class="section-title">The books</div>}
          {view.ages.length === 0 && <Empty icon="chronicle">The story has not begun.</Empty>}
          {view.ages.map((a, i) => (
            <AgeSection age={a} n={i} />
          ))}

        </>
      )}
    </Screen>
  );
};

/** Civ names are stored lower-case ("the Sinic Pax"); headings and tabs start with a capital. */
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/** Figure id -> the earlier figure in this book who came for the very same reason (wave 11: one reason six times). */
const sameReason = (a: ChronicleAge): Record<string, string> => {
  const first = new Map<string, string>();
  const out: Record<string, string> = {};
  for (const f of a.figures) {
    const why = f.text.startsWith(f.name) ? f.text.slice(f.name.length) : f.text;
    const prev = first.get(why);
    if (prev) out[f.id] = prev;
    else first.set(why, f.name.replace(/\s*\([^)]*\)\s*$/, ''));
  }
  return out;
};

const AgeSection = ({ age: a, n }: { age: ChronicleAge; n: number }) => {
  const sameAs = sameReason(a);
  return (
  <section class="scr-chron-age">
    <div class="scr-chron-book">Book {ROMAN[n] ?? n + 1}</div>
    <h3>The {ageLabel(a.age)} Age</h3>
    {a.figures.length > 0 && (
      <div class="chron-medals" aria-hidden="true">
        {a.figures.map((f) => (
          <FigurePortrait figure={f.id} size="xs" />
        ))}
      </div>
    )}
    <p class="chron-summary">{ageSummary(a)}</p>
    <div class="scr-chron-events">
      {a.events.map((e, i) => (
        <p class={`scr-chron-line${i === 0 && e.text.length > 60 ? ' scr-dropcap' : ''}`}>
          {e.text} <span class="scr-chron-turn">· turn {e.turn}</span>
        </p>
      ))}
    </div>
    {a.figures.length > 0 && (
      <>
        <div class="section-title">People</div>
        <ul class="scr-list">
          {a.figures.map((f) => (
            <li class="scr-chron-person">
              <div class="row">
                <Portrait figure={f.id} size="sm" />
                <div class="grow">
                  <div class="scr-fig-name">{f.name}</div>
                  <div class="scr-chips">
                    <CultureChip culture={f.culture} />
                    <span class="chip">{KIND_LABEL[f.kind as FigureKind] ?? f.kind}</span>
                  </div>
                </div>
              </div>
              <p class="scr-chron-line small">{bioText(f.bio)}</p>
              <p class="scr-history">{sameAs[f.id] ? `Came for the same reason as ${sameAs[f.id]}.` : f.text}</p>
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
            <li class="scr-chron-trad">
              <div class="scr-kv">
                <span class="scr-fig-name">
                  {t.cultures.map((c) => (
                    <CultureCrest culture={c} size={18} />
                  ))}
                  {t.name}
                </span>
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
          <p class="scr-chron-line scr-chron-mark">
            <Icon name="builder" size="sm" />
            <span>
              <b>{w.name}.</b> {w.note}
            </span>
          </p>
        ))}
      </>
    )}
    {a.wars.length > 0 && (
      <>
        <div class="section-title">Wars</div>
        {a.wars.map((w) => (
          <p class="scr-chron-line scr-chron-mark">
            <Icon name="war" size="sm" />
            {w.text} <span class="scr-chron-turn">· turn {w.turn}</span>
            {w.against && <span class="muted"> ({ownerName(w.against)})</span>}
          </p>
        ))}
      </>
    )}
    {a.crises.length > 0 && (
      <>
        <div class="section-title">Hard times</div>
        {a.crises.map((c) => (
          <p class="scr-chron-line scr-chron-mark">
            <Icon name="crisis" size="sm" /> {c.text}
          </p>
        ))}
      </>
    )}
  </section>
  );
};
