/** Legacy tracks (GDD §8) and the age meter (GDD §5). */
import { GlossText } from '../shell/GlossarySheet';
import {
  CRISIS_START,
  SCORE_PER_FIGURE,
  SCORE_PER_HYBRID,
  SCORE_PER_SEATED_FIGURE,
  SCORE_PER_SIGNATURE_EXTRA,
  SCORE_PER_TRADITION,
} from '../../sim/ages/constants';
import { content, game, me, ownerName, q } from '../store';
import type { ScreenProps } from './index';
import { Bar, Empty, Screen, Section } from './shared/components';
import { ageLabel, capitalize } from './shared/describe';
import { Icon } from '../art/Icon';
import { biggestEdge, nearestGains, rivalName, scoreBreakdown, standingLine, standingOf } from '../shell/standing';
import { hasMet } from './shared/envoy';

/** Stage thresholds of this age's crisis, from content. */
const lookupCrisisStages = (age: string): number[] | null => content.crises.find((c) => c.age === age)?.stages.map((s) => s.at) ?? null;

const TRACK_COLOR: Record<string, string> = {
  science: '#2e5a7e',
  military: '#9b3426',
  culture: '#7a3f6f',
  legacy: '#9a6d16',
};

export const LegacyScreen = (_: ScreenProps<'legacy'>) => {
  const g = game.value;
  const player = me.value;
  if (!g || !player) return <Screen title="Legacy" label="Legacy"><Empty>No game in progress.</Empty></Screen>;
  const rows = q.milestones(g, player, content);
  const met = (id: string): boolean => id === player || hasMet(g, player, id);
  const ranking = g.playerOrder
    .map((id) => ({ id, score: q.score(g, id, content), alive: g.players[id]?.alive ?? false }))
    .sort((a, b) => b.score - a.score);
  const top = ranking[0]?.score ?? 0;
  const meter = Math.round(g.ageProgress);
  // Where you stand and why (wave 13): the leader's points by source, and your nearest gains.
  const standing = standingOf(g, player, (id) => q.score(g, id, content), (id) => hasMet(g, player, id));
  const mine = scoreBreakdown(g, player, content);
  const leaderId = standing?.leader?.id ?? null;
  // Leading: compare with the runner-up instead, so the lead has a shape too.
  const rivalRow = standing ? (standing.leader ?? standing.rows.find((r) => !r.me) ?? null) : null;
  const rivalId = rivalRow?.id ?? null;
  const theirs = rivalId ? scoreBreakdown(g, rivalId, content) : [];
  const edge = leaderId ? biggestEdge(mine, theirs) : null;
  const leaderName = leaderId ? rivalName(met(leaderId), ownerName(leaderId)) : '';
  const seatable = Object.values(g.figures).filter((f) => f.owner === player && f.location.state === 'based' && q.figureActions(g, f.id, content).seat.length > 0).length;
  const gains = nearestGains(rows, seatable, 3);
  const keys = [...new Set([...mine, ...theirs].map((x) => x.key))];
  const pts = (list: typeof mine, key: string): number => list.find((x) => x.key === key)?.points ?? 0;

  return (
    <Screen title="Legacy" label="Legacy">
      {standing && (
        <Section title="Where you stand" note={standingLine(standing, ownerName)}>
          {rivalId && (
            <table class="lg-compare">
              <caption class="small muted">Compared with {rivalName(met(rivalId), ownerName(rivalId))}</caption>
              <thead>
                <tr>
                  <th scope="col">Points from</th>
                  <th scope="col">You</th>
                  <th scope="col">{leaderId ? (standing.behind === 0 ? 'Level' : 'Leader') : 'Next best'}</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const label = [...mine, ...theirs].find((x) => x.key === k)?.label ?? k;
                  const a = pts(mine, k);
                  const b = pts(theirs, k);
                  return (
                    <tr class={b > a ? 'is-behind' : a > b ? 'is-ahead' : ''}>
                      <th scope="row">{label}</th>
                      <td class="tnum">{a}</td>
                      <td class="tnum">{b}</td>
                    </tr>
                  );
                })}
                <tr class="lg-total">
                  <th scope="row">Score</th>
                  <td class="tnum">{standing.score}</td>
                  <td class="tnum">{rivalRow?.score ?? 0}</td>
                </tr>
              </tbody>
            </table>
          )}
          {edge && (
            <p class="small">
              Most of {leaderName}’s lead is <b>{edge.label.toLowerCase()}</b> (+{edge.diff}).
            </p>
          )}
          {gains.length > 0 && (
            <>
              <p class="scr-tag lg-gains-head">Your nearest gains</p>
              <ul class="scr-mods lg-gains">
                {gains.map((x) => (
                  <li>
                    {x.text} <span class="muted">· +{x.points}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}
      <Section title={`${ageLabel(g.age)} age milestones`} note="Each track has three milestones. Every one reached earns legacy points and refinement points at the age's end.">
        {rows.length === 0 && <Empty>No milestones this age.</Empty>}
        <ul class="scr-list">
          {rows.map((m) => (
            <li class="card">
              <div class="scr-kv">
                <span class="scr-tag" style={{ color: TRACK_COLOR[m.track] }}>
                  {capitalize(m.track)}
                </span>
                <span class="scr-stars" role="img" aria-label={`${m.achieved} of 3 milestones`}>
                  {[0, 1, 2].map((k) => (
                    <Icon name={k < m.achieved ? 'star' : 'starEmpty'} size="sm" />
                  ))}
                </span>
              </div>
              <div>{m.achieved >= 3 ? 'All three milestones reached' : m.description}</div>
              <div class="row">
                <div class="grow">
                  <Bar value={m.value} max={m.thresholds[2]} ticks={m.thresholds.slice(0, 2)} label={`${m.track} progress`} color={TRACK_COLOR[m.track]} />
                </div>
                <span class="small" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {m.value} / {m.thresholds[Math.min(m.achieved, 2)]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Legacy score" note={<GlossText text={`Your legacy score is legacy points, plus ${SCORE_PER_FIGURE} per figure kept, ${SCORE_PER_TRADITION} per tradition (${SCORE_PER_TRADITION + SCORE_PER_SIGNATURE_EXTRA} for a signature), ${SCORE_PER_HYBRID} per hybrid and ${SCORE_PER_SEATED_FIGURE} more per seated figure. Highest score when the final age ends wins.`} />}>
        <ul class="scr-list">
          {ranking.map((r) => (
            <li class="row">
              <span class="grow" style={{ fontWeight: r.id === player ? 700 : 400 }}>
                {r.id === player ? `${ownerName(r.id)} (you)` : met(r.id) ? ownerName(r.id) : 'A people you have not met'}
                {!r.alive && ' · fallen'}
              </span>
              <div style={{ width: '40%' }}>
                <Bar value={r.score} max={Math.max(top, 1)} label={`${met(r.id) ? ownerName(r.id) : 'Unmet people'} score`} color={r.id === player ? 'var(--woad)' : '#9b8767'} />
              </div>
              <b style={{ width: '40px', textAlign: 'right' }}>{r.score}</b>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Age meter" note={`The world shares one meter. It rises every turn, and faster as anyone completes trees, reaches milestones, builds wonders or recruits famous people. A crisis begins at ${CRISIS_START}; the age ends for everyone at 100.`}>
        <Bar value={meter} max={100} ticks={(lookupCrisisStages(g.age) ?? [CRISIS_START])} label="Age meter" color="var(--gold)" />
        <p class="small">
          {meter} / 100 · {g.age === g.finalAge ? 'The final age: the game ends at 100.' : 'A new age begins at 100.'}
        </p>
      </Section>
    </Screen>
  );
};
