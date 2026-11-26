/**
 * "Your people" (from the HUD banner): who you are becoming. Banner and name, the cultures that
 * shape you as a woven ribbon, the latest whisper, your court by culture and the traditions you
 * keep, so the hybrid can be seen forming (GDD §1 "Emergent identity", §6).
 */
import { closeModal, content, game, me, openModal, q } from '../store';
import type { ScreenProps } from './index';
import { Empty, Screen } from './shared/components';
import { cultureColor } from './shared/components';
import { buildPeople } from './shared/people';
import { shortName } from './shared/describe';
import { CultureCrest, FigurePortrait, PlayerBanner } from '../art/game-art';
import { Icon } from '../art/Icon';
import type { AnyIconName } from '../art/icons-data';
import { turnLog } from '../shell/shell-state';

const STATE_ICON: Partial<Record<string, AnyIconName>> = { seated: 'seat', unit: 'deploy', retired: 'legacy' };
const STATE_WORD: Record<string, string> = { seated: 'in the cabinet', unit: 'in the field', based: 'at home', retired: 'among the ancestors' };

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const PeopleScreen = (_: ScreenProps<'people'>) => {
  const g = game.value;
  const player = me.value;
  const p = g && player ? g.players[player] : undefined;
  if (!g || !player || !p) return <Screen title="Your people" label="Your people"><Empty icon="people">No game in progress.</Empty></Screen>;
  const v = buildPeople(g, player, q.cultureWeights(g, player, content), content);
  if (!v) return null;
  // Only true whispers ("Hellenic peoples speak of…"): offers share the culture tone but are not
  // voices (playtest 4 showed "Someone famous wants to join you." as the Spanish whisper).
  const whispers = [...turnLog.value].reverse().filter((e) => e.whisper).slice(0, 3);

  return (
    <Screen
      title="Your people"
      label="Your people"
      className="scr-people"
      footer={
        <>
          <button class="btn" onClick={closeModal}>
            Close
          </button>
          <button class="btn btn-primary" onClick={() => openModal({ kind: 'chronicle' })}>
            <Icon name="chronicle" /> Chronicle
          </button>
        </>
      }
    >
      <section class="ppl-hero">
        <div class="ppl-banner">
          <PlayerBanner player={p} width={92} wave />
        </div>
        {v.name ? <h2 class="ppl-name">{cap(v.name)}</h2> : <h2 class="ppl-name unnamed">a people yet unnamed</h2>}
        <div class="ppl-led">
          Led by {v.leader}
          {v.dream && (
            <>
              {' · '}
              <span lang="und">{v.dream.native}</span> <i>“{v.dream.meaning}”</i>
            </>
          )}
        </div>
        {!v.name && <div class="ppl-hint small muted">You choose a name when this age ends, from the cultures you have gathered.</div>}
      </section>

      <section class="ppl-section">
        <h3 class="section-title">Who you are becoming</h3>
        {v.cultures.length === 0 ? (
          <Empty icon="culture">No culture has settled among you yet. Play draws them: rivers, wonders, wars and faith each call different peoples.</Empty>
        ) : (
          <>
            <div class="ppl-weave" role="img" aria-label={v.becoming}>
              {v.cultures.map((c) => (
                <span class="ppl-weave-band" style={{ flexGrow: Math.max(0.04, c.share), background: cultureColor(c.culture) }}>
                  <span class="ppl-weave-crest">
                    <CultureCrest culture={c.culture} size={22} />
                  </span>
                </span>
              ))}
            </div>
            <p class="ppl-becoming">{v.becoming}</p>
            <ul class="ppl-cultures">
              {v.cultures.map((c) => (
                <li>
                  <CultureCrest culture={c.culture} size={22} />
                  <span class="ppl-culture-name">{c.name}</span>
                  <span class="ppl-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(6, Math.round((c.share / (v.cultures[0]?.share || 1)) * 100))}%`, background: cultureColor(c.culture) }} />
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {whispers.length > 0 && (
          <div class="ppl-voices" aria-label="Voices that reached you">
            <div class="ppl-voices-head">Voices that reached you</div>
            {whispers.map((w, i) => (
              <blockquote class={`ppl-whisper${i > 0 ? ' older' : ''}`} key={`${w.turn}:${w.text}`}>
                <span class="scr-reason-mark" aria-hidden="true">“</span>
                {w.text}
                <span class="ppl-whisper-turn">turn {w.turn}</span>
              </blockquote>
            ))}
          </div>
        )}
      </section>

      <section class="ppl-section">
        <h3 class="section-title">Your court</h3>
        {v.figureGroups.length === 0 ? (
          <Empty icon="figures">No one has joined you yet. The way you play is what calls them.</Empty>
        ) : (
          v.figureGroups.map((grp) => (
            <div class="ppl-court-row">
              <div class="ppl-court-head">
                <CultureCrest culture={grp.culture} size={18} /> {grp.name}
              </div>
              {grp.why.map((w) => (
                <p class="ppl-why" key={w.figure}>
                  <i>{w.text}</i> <span class="ppl-why-who">· {shortName(w.figure)}</span>
                </p>
              ))}
              <div class="ppl-medals">
                {grp.figures.map((f) => (
                  <button
                    class={`ppl-medal${f.state === 'retired' ? ' retired' : ''}`}
                    onClick={() => openModal({ kind: 'figure', figure: f.id })}
                    aria-label={`${f.name}, ${STATE_WORD[f.state] ?? ''}`}
                  >
                    <span class="ppl-medal-face">
                      <FigurePortrait figure={f.id} size="sm" />
                      {STATE_ICON[f.state] && (
                        <span class="ppl-medal-state" aria-hidden="true">
                          <Icon name={STATE_ICON[f.state] as AnyIconName} size="sm" />
                        </span>
                      )}
                    </span>
                    <span class="ppl-medal-name">{shortName(f.name)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <section class="ppl-section">
        <h3 class="section-title">Traditions you keep</h3>
        {v.traditions.length + v.hybrids.length === 0 ? (
          <Empty icon="culture">Traditions are chosen when an age ends, from the cultures you have gathered.</Empty>
        ) : (
          <ul class="ppl-trads">
            {v.hybrids.map((h) => (
              <li class="ppl-trad hybrid">
                <span class="ppl-trad-crests">
                  {h.cultures.map((c) => (
                    <CultureCrest culture={c} size={20} />
                  ))}
                </span>
                <span class="grow">
                  <b>{h.name}</b>
                  <span class="small muted"> · hybrid</span>
                </span>
              </li>
            ))}
            {v.traditions.map((t) => (
              <li class="ppl-trad">
                <span class="ppl-trad-crests">
                  <CultureCrest culture={t.culture} size={20} />
                </span>
                <span class="grow">
                  <b>{t.name}</b>
                  <span class="small muted"> · {t.tier}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
};
