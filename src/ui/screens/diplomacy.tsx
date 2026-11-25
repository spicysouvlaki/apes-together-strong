/** Diplomacy (GDD §7 "Diplomacy", "City-states"): rivals, war and peace, envoys. */
import { useState } from 'preact/hooks';
import { warKey, type PlayerId } from '@contracts/sim-api';
import { MIN_WAR_TURNS, PEACE_INFLUENCE_COST, SUZERAIN_MIN_ENVOYS } from '../../sim/constants';
import { YIELD_GLYPH, signed } from '../shell/format';

const INF = YIELD_GLYPH.influence;

/**
 * Envoys still needed to lead: at least the minimum, and one more than whoever leads now (a tie
 * keeps the incumbent; sim/diplomacy.ts). Display arithmetic only, the sim decides.
 */
const envoysToLead = (mine: number, top: { id: string | null; n: number }, me: string): number =>
  Math.max(SUZERAIN_MIN_ENVOYS, top.id && top.id !== me ? top.n + 1 : 0) - mine;
import { content, dispatch, game, lastError, lookup, me, myTurn, ownerName, q } from '../store';
import type { ScreenProps } from './index';
import { ConfirmSheet, CultureChip, Empty, Screen, Section } from './shared/components';
import { capitalize, describeModifiers } from './shared/describe';
import { figureCountsByCulture } from './shared/figures';

export const DiplomacyScreen = (_: ScreenProps<'diplomacy'>) => {
  const [confirmWar, setConfirmWar] = useState<PlayerId | null>(null);
  const [acted, setActed] = useState<string | null>(null);
  const g = game.value;
  const player = me.value;
  const p = g && player ? g.players[player] : undefined;
  if (!g || !player || !p) return <Screen title="Diplomacy" label="Diplomacy"><Empty>No game in progress.</Empty></Screen>;
  const turn = myTurn.value;
  const influence = Math.floor(p.stock.influence);
  const rivals = g.playerOrder.filter((id) => id !== player).map((id) => g.players[id]).filter((x) => !!x);
  const err = acted ? lastError.value : null;

  const act = (key: string, cmd: Parameters<typeof dispatch>[0]) => {
    setActed(key);
    dispatch(cmd);
  };

  return (
    <Screen title="Diplomacy" label="Diplomacy" headerExtra={<span class="chip" aria-label={`${influence} influence`}>{INF} {influence} influence</span>}>
      <Section title="Rivals">
        {rivals.length === 0 && <Empty>You have met no rivals.</Empty>}
        <ul class="scr-list">
          {rivals.map((r) => {
            const since = g.wars[warKey(player, r.id)];
            const atWar = since !== undefined;
            const mix = figureCountsByCulture(g, r.id, content).slice(0, 3);
            const leader = lookup.leaders[r.leader]?.name ?? 'A leader';
            return (
              <li>
                <div class="card">
                  <div class="row">
                    <div class="scr-banner-swatch" style={{ background: r.colors.primary }} aria-hidden="true">
                      <i style={{ background: r.colors.secondary }} />
                    </div>
                    <div class="grow">
                      <div class="scr-fig-name">{ownerName(r.id)}</div>
                      <div class="small muted">
                        {leader} · Legacy score {r.score}
                      </div>
                    </div>
                  </div>
                  {!r.alive ? (
                    <p class="small muted">This people is no more.</p>
                  ) : (
                    <>
                      <p class={`small ${atWar ? 'scr-bad' : 'scr-good'}`}>
                        {atWar ? `At war since turn ${since}` : 'At peace'}
                        {atWar && g.turn - since < MIN_WAR_TURNS && (
                          <span class="muted"> · peace possible from turn {since + MIN_WAR_TURNS}</span>
                        )}
                      </p>
                      <div class="scr-chips" aria-label="Famous people they hold, by culture">
                        <span class="small muted">Famous people:</span>
                        {mix.length === 0 ? (
                          <span class="small muted">none yet</span>
                        ) : (
                          mix.map((m) => <CultureChip culture={m.culture} suffix={<b> {m.count}</b>} />)
                        )}
                      </div>
                      <div class="scr-actions">
                        {atWar ? (
                          <button
                            class="btn btn-primary"
                            disabled={!turn || influence < PEACE_INFLUENCE_COST || g.turn - since < MIN_WAR_TURNS}
                            onClick={() => act(`peace:${r.id}`, { type: 'makePeace', target: r.id })}
                            aria-label={`Make peace with ${ownerName(r.id)} for ${PEACE_INFLUENCE_COST} influence`}
                          >
                            Make peace ({INF} {PEACE_INFLUENCE_COST})
                          </button>
                        ) : (
                          <button class="btn" disabled={!turn} onClick={() => setConfirmWar(r.id)} aria-label={`Declare war on ${ownerName(r.id)}`}>
                            Declare war
                          </button>
                        )}
                      </div>
                      {err && acted === `peace:${r.id}` && <p class="scr-error" role="alert">{err}</p>}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        title="City-states"
        note={`Envoys win a city-state's favor, and famous people of its culture are drawn to your court. Whoever has the most envoys (at least ${SUZERAIN_MIN_ENVOYS}) is its suzerain, its protector, and gets the bonus shown.`}
      >
        {Object.keys(g.cityStates).length === 0 && <Empty>No city-states known.</Empty>}
        <ul class="scr-list">
          {Object.values(g.cityStates).map((cs) => {
            const def = lookup.cityStates[cs.id];
            if (!def) return null;
            const mine = cs.envoys[player] ?? 0;
            const top = Object.entries(cs.envoys).reduce<{ id: string | null; n: number }>(
              (best, [id, n]) => (n > best.n ? { id, n } : best),
              { id: null, n: 0 },
            );
            const cost = q.envoyCost(g, player, cs.id, content);
            const suz = cs.suzerain;
            return (
              <li>
                <div class="card">
                  <div class="row">
                    <div class="grow">
                      <div class="scr-fig-name">{def.name}</div>
                      <div class="scr-chips">
                        <CultureChip culture={def.culture} />
                        <span class="chip">{capitalize(def.type)}</span>
                      </div>
                    </div>
                  </div>
                  {!cs.alive ? (
                    <p class="small muted">Absorbed or destroyed.</p>
                  ) : (
                    <>
                      <p class="small">
                        Your envoys: <b>{mine}</b>
                        {top.id && top.id !== player ? ` · Most: ${ownerName(top.id)} (${top.n})` : ''}
                        <br />
                        Suzerain: <b>{suz ? (suz === player ? 'You' : ownerName(suz)) : 'None'}</b>
                        {suz !== player && (
                          <span class="muted"> · {envoysToLead(mine, top, player)} more to become suzerain</span>
                        )}
                      </p>
                      <p class="small muted">
                        Suzerain gets: {describeModifiers(def.suzerainModifiers, lookup).join('; ')}
                      </p>
                      <div class="scr-actions">
                        <button
                          class="btn"
                          disabled={!turn || influence < cost}
                          onClick={() => act(`envoy:${cs.id}`, { type: 'sendEnvoy', cityState: cs.id })}
                          aria-label={`Send an envoy to ${def.name} for ${cost} influence`}
                        >
                          Send envoy ({INF} {cost})
                        </button>
                      </div>
                      {influence < cost && turn && (
                        <p class="small muted">
                          Needs {cost} influence; you have {influence} ({signed(p.income.influence)} per turn).
                        </p>
                      )}
                      {err && acted === `envoy:${cs.id}` && <p class="scr-error" role="alert">{err}</p>}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      {confirmWar && (
        <ConfirmSheet
          title={`Declare war on ${ownerName(confirmWar)}?`}
          confirmLabel="Declare war"
          danger
          onConfirm={() => {
            act(`war:${confirmWar}`, { type: 'declareWar', target: confirmWar });
            setConfirmWar(null);
          }}
          onCancel={() => setConfirmWar(null)}
        >
          <p>
            Peace costs {INF} {PEACE_INFLUENCE_COST} influence and is only possible after {MIN_WAR_TURNS} turns of war. Trade routes between
            you stop.
          </p>
        </ConfirmSheet>
      )}
    </Screen>
  );
};
