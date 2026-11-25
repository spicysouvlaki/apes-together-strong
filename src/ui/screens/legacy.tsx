/** Legacy tracks (GDD §8) and the age meter (GDD §5). */
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

/** Stage thresholds of this age's crisis, from content. */
const lookupCrisisStages = (age: string): number[] | null => content.crises.find((c) => c.age === age)?.stages.map((s) => s.at) ?? null;

const TRACK_COLOR: Record<string, string> = {
  science: '#3f6f9a',
  military: '#a8483c',
  culture: '#7a5c94',
  legacy: '#b8892b',
};

export const LegacyScreen = (_: ScreenProps<'legacy'>) => {
  const g = game.value;
  const player = me.value;
  if (!g || !player) return <Screen title="Legacy" label="Legacy"><Empty>No game in progress.</Empty></Screen>;
  const rows = q.milestones(g, player, content);
  const ranking = g.playerOrder
    .map((id) => ({ id, score: q.score(g, id, content), alive: g.players[id]?.alive ?? false }))
    .sort((a, b) => b.score - a.score);
  const top = ranking[0]?.score ?? 0;
  const meter = Math.round(g.ageProgress);

  return (
    <Screen title="Legacy" label="Legacy">
      <Section title={`${ageLabel(g.age)} age milestones`} note="Each track has three milestones. Every one reached earns legacy points and refinement points at the age's end.">
        {rows.length === 0 && <Empty>No milestones this age.</Empty>}
        <ul class="scr-list">
          {rows.map((m) => (
            <li class="card">
              <div class="scr-kv">
                <span class="scr-tag" style={{ color: TRACK_COLOR[m.track] }}>
                  {capitalize(m.track)}
                </span>
                <span class="small">{'★'.repeat(m.achieved)}{'☆'.repeat(3 - m.achieved)}</span>
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
      <Section title="Legacy score" note={`Legacy points, plus ${SCORE_PER_FIGURE} per figure kept, ${SCORE_PER_TRADITION} per tradition (${SCORE_PER_TRADITION + SCORE_PER_SIGNATURE_EXTRA} for a signature), ${SCORE_PER_HYBRID} per hybrid and ${SCORE_PER_SEATED_FIGURE} more per seated figure. Highest score when the final age ends wins.`}>
        <ul class="scr-list">
          {ranking.map((r) => (
            <li class="row">
              <span class="grow" style={{ fontWeight: r.id === player ? 700 : 400 }}>
                {r.id === player ? `${ownerName(r.id)} (you)` : ownerName(r.id)}
                {!r.alive && ' · fallen'}
              </span>
              <div style={{ width: '40%' }}>
                <Bar value={r.score} max={Math.max(top, 1)} label={`${ownerName(r.id)} score`} color={r.id === player ? 'var(--accent)' : '#9b8f7d'} />
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
