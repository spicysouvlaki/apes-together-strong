/** Diplomacy (GDD §7 "Diplomacy", "City-states"): rivals, war and peace, envoys. */
import { useState } from 'preact/hooks';
import { GlossText } from '../shell/GlossarySheet';
import { warKey, type PlayerId } from '@contracts/sim-api';
import { MIN_WAR_TURNS, PEACE_INFLUENCE_COST, SUZERAIN_MIN_ENVOYS } from '../../sim/constants';
import { signed } from '../shell/format';
import { Icon } from '../art/Icon';
import { PlayerBanner } from '../art/game-art';

const INF = <Icon name="influence" size="sm" />;

/** A price on a button: one tight pill, so the label never reads "Send envoy ( 20)". */
const Cost = ({ n }: { n: number }) => (
  <span class="cost-tag" aria-hidden="true">
    {INF}
    {n}
  </span>
);

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
import { envoyNeedsConfirm, INFLUENCE_WARNING } from './shared/envoy';

export const DiplomacyScreen = (_: ScreenProps<'diplomacy'>) => {
  const [confirmWar, setConfirmWar] = useState<PlayerId | null>(null);
  // Envoys and peace spend influence, which is slow to earn: one look at the price first
  // (playtest 3: both acted on a single tap).
  const [confirmPeace, setConfirmPeace] = useState<PlayerId | null>(null);
  const [confirmEnvoy, setConfirmEnvoy] = useState<string | null>(null);
  const [acted, setActed] = useState<string | null>(null);
  const g = game.value;
  const player = me.value;
  const p = g && player ? g.players[player] : undefined;
  if (!g || !player || !p) return <Screen title="Diplomacy" label="Diplomacy"><Empty>No game in progress.</Empty></Screen>;
  const turn = myTurn.value;
  const influence = Math.floor(p.stock.influence);
  const rivals = g.playerOrder.filter((id) => id !== player).map((id) => g.players[id]).filter((x) => !!x);
  const err = acted ? lastError.value : null;
  const atWarAny = rivals.some((r) => r.alive && g.wars[warKey(player, r.id)] !== undefined);

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
                    <div class="scr-banner-swatch" aria-hidden="true">
                      <PlayerBanner player={r} width={30} />
                    </div>
                    <div class="grow">
                      <div class="scr-fig-name">{ownerName(r.id).charAt(0).toUpperCase() + ownerName(r.id).slice(1)}</div>
                      <div class="small muted">
                        {leader} · Legacy score {r.score}
                      </div>
                    </div>
                  </div>
                  {!r.alive ? (
                    <p class="small muted">This people is no more.</p>
                  ) : (
                    <>
                      <p class={`small scr-status ${atWar ? 'scr-bad' : 'scr-good'}`}>
                        <Icon name={atWar ? 'war' : 'peace'} size="sm" /> {atWar ? `At war since turn ${since}` : 'At peace'}
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
                            onClick={() => setConfirmPeace(r.id)}
                            aria-label={`Make peace with ${ownerName(r.id)} for ${PEACE_INFLUENCE_COST} influence`}
                          >
                            <Icon name="peace" /> Make peace <Cost n={PEACE_INFLUENCE_COST} />
                          </button>
                        ) : (
                          <button class="btn" disabled={!turn} onClick={() => setConfirmWar(r.id)} aria-label={`Declare war on ${ownerName(r.id)}`}>
                            <Icon name="war" /> Declare war
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
        note={<GlossText text={`Envoys win a city-state's favor, and famous people of its culture are drawn to your court. Whoever has the most envoys (at least ${SUZERAIN_MIN_ENVOYS}) is its suzerain, its protector, and gets the bonus shown. Each envoy to the same city-state costs more than the last.`} />}
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
                          class="btn btn-primary"
                          disabled={!turn || influence < cost}
                          onClick={() =>
                            // One tap spends it (the price is on the button); ask only when it would
                            // leave too little influence to buy peace in a war (wave 11).
                            envoyNeedsConfirm(influence, cost, atWarAny) ? setConfirmEnvoy(cs.id) : act(`envoy:${cs.id}`, { type: 'sendEnvoy', cityState: cs.id })
                          }
                          aria-label={`Send an envoy to ${def.name} now for ${cost} influence`}
                        >
                          <Icon name="envoy" /> Send envoy <Cost n={cost} />
                        </button>
                      </div>
                      {acted === `envoy:${cs.id}` && !err && (
                        <p class="small scr-good" role="status">
                          Envoy sent. You have {mine} {mine === 1 ? 'envoy' : 'envoys'} in {def.name}.
                        </p>
                      )}
                      {influence < cost && turn && (
                        <p class="small muted">
                          Needs {cost} influence; you have {influence}
                          {p.income.influence > 0
                            ? `, enough in about ${Math.ceil((cost - influence) / p.income.influence)} ${Math.ceil((cost - influence) / p.income.influence) === 1 ? 'turn' : 'turns'} (${signed(p.income.influence)} per turn).`
                            : ', and no influence income yet.'}
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

      {confirmPeace && (
        <ConfirmSheet
          title={`Make peace with ${ownerName(confirmPeace)}?`}
          confirmLabel="Make peace"
          onConfirm={() => {
            act(`peace:${confirmPeace}`, { type: 'makePeace', target: confirmPeace });
            setConfirmPeace(null);
          }}
          onCancel={() => setConfirmPeace(null)}
        >
          <p>
            Costs {INF} {PEACE_INFLUENCE_COST} of your {influence} influence. They accept, and the fighting stops at once.
          </p>
        </ConfirmSheet>
      )}

      {confirmEnvoy &&
        (() => {
          const cs = g.cityStates[confirmEnvoy];
          const def = lookup.cityStates[confirmEnvoy];
          if (!cs || !def) return null;
          const mine = cs.envoys[player] ?? 0;
          const top = Object.entries(cs.envoys).reduce<{ id: string | null; n: number }>((best, [id, n]) => (n > best.n ? { id, n } : best), { id: null, n: 0 });
          const cost = q.envoyCost(g, player, cs.id, content);
          const left = envoysToLead(mine + 1, top, player);
          return (
            <ConfirmSheet
              title={`Send an envoy to ${def.name}?`}
              confirmLabel="Send envoy"
              onConfirm={() => {
                act(`envoy:${cs.id}`, { type: 'sendEnvoy', cityState: cs.id });
                setConfirmEnvoy(null);
              }}
              onCancel={() => setConfirmEnvoy(null)}
            >
              <p>
                Costs {INF} {cost} of your {influence} influence. You will have {mine + 1} {mine + 1 === 1 ? 'envoy' : 'envoys'} there
                {cs.suzerain === player
                  ? ', keeping your lead.'
                  : left <= 0
                    ? ` and become its suzerain: ${describeModifiers(def.suzerainModifiers, lookup).join('; ')}.`
                    : `; ${left} more to become suzerain.`}
              </p>
              <p class="small scr-bad">
                You are at war: this leaves {Math.max(0, influence - cost)} influence, under the {INFLUENCE_WARNING} that peace costs.
              </p>
              <p class="small muted">Each envoy to the same city-state costs more than the last.</p>
            </ConfirmSheet>
          );
        })()}

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
