/**
 * Age transition (GDD §5 "Transition", §6): recap → refinement → name → government → begin.
 * Cannot be dismissed until the player sends `finishTransition`.
 */
import { useEffect, useState } from 'preact/hooks';
import { Term } from '../shell/GlossarySheet';
import type { RefinementOption } from '@contracts/sim-api';
import { closeModal, content, dispatch, game, lookup, me, ownerName, q } from '../store';
import type { ScreenProps } from './index';
import { ConfirmSheet, CultureChip, Empty, Portrait, Screen, Section, WeightBars, cultureName } from './shared/components';
import { ageLabel, ancestorYield, describeModifiers } from './shared/describe';
import { weightRows } from './shared/figures';
import { groupRefinement, TIER_LABEL, type HybridItem, type TraditionItem } from './shared/refinement';
import { GovernmentList } from './government';
import { HEAVIEST_CULTURE_DISCOUNT_PERCENT, REFINEMENT_ESCALATION } from '../../sim/ages/constants';
import { Icon } from '../art/Icon';
import { CultureCrest, PlayerBanner } from '../art/game-art';

const CHAPTER = ['I', 'II', 'III', 'IV', 'V'];

/** Adoptions already made in this transition (display only: the sim prices them; GDD §6). */
const adoptedThisTransition = (p: { chronicle: readonly { turn: number; kind: string }[] }, turn: number): number =>
  p.chronicle.filter((e) => e.turn === turn && (e.kind === 'tradition' || e.kind === 'hybrid')).length;

const STEPS = ['recap', 'refine', 'name', 'government', 'begin'] as const;
type Step = (typeof STEPS)[number];
const STEP_TITLE: Record<Step, string> = {
  recap: 'The age ends',
  refine: 'Refine your culture',
  name: 'Name your people',
  government: 'Choose a government',
  begin: 'A new age',
};

interface Adopting {
  kind: 'tradition' | 'hybrid';
  id: string;
  name: string;
  cost: number;
}

export const TransitionScreen = (_: ScreenProps<'transition'>) => {
  const g = game.value;
  const player = me.value;
  const t = g?.transition ?? null;
  const recap = t && player ? t.recap[player] : undefined;
  const p = g && player ? g.players[player] : undefined;
  const [step, setStep] = useState<Step>('recap');
  const [adopting, setAdopting] = useState<Adopting | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Preselect the current name, else the first proposal (finishTransition would pick it anyway).
  const [name, setName] = useState<string>(() => p?.civName ?? recap?.nameOptions[0] ?? '');

  // The new age started (everyone finished): nothing left to do here.
  useEffect(() => {
    if (g && g.phase !== 'transition') {
      const id = setTimeout(closeModal, 1200);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [g?.phase]);

  if (!g || !player || !p) return <Screen title="Transition" label="Age transition"><Empty>No game in progress.</Empty></Screen>;
  if (!t || !recap) {
    return (
      <Screen title={`The ${ageLabel(g.age)} age`} label="Age transition" footer={<button class="btn btn-primary" onClick={closeModal}>Continue</button>}>
        <p class="scr-big">The {ageLabel(g.age)} age begins.</p>
      </Screen>
    );
  }

  if (recap.done) {
    const waiting = g.playerOrder.filter((id) => g.players[id]?.alive && !(t.recap[id]?.done ?? true));
    return (
      <Screen title={`Toward the ${ageLabel(t.toAge)} age`} label="Age transition" closable={false}>
        <p class="scr-big">Your people are ready.</p>
        <p class="muted" style={{ textAlign: 'center' }}>
          Waiting for {waiting.length ? waiting.map(ownerName).join(', ') : 'the world'} to finish refining…
        </p>
      </Screen>
    );
  }

  const i = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, i + 1)] ?? 'begin');
  const back = i > 0 ? () => setStep(STEPS[i - 1] ?? 'recap') : undefined;
  const weights = q.cultureWeights(g, player, content);
  const affordable = step === 'begin' ? q.refinementOptions(g, player, content).filter((o) => o.available).length : 0;
  const gov = p.government ? lookup.governments[p.government] : undefined;
  const govForNewAge = gov && gov.age === t.toAge;

  const footer =
    step === 'begin' ? (
      <button class="btn btn-primary btn-wide" onClick={() => dispatch({ type: 'finishTransition' })} aria-label={`Begin the ${ageLabel(t.toAge)} age`}>
        Begin the {ageLabel(t.toAge)} age
      </button>
    ) : step === 'name' ? (
      <button
        class="btn btn-primary btn-wide"
        disabled={name.trim().length === 0}
        onClick={() => {
          const chosen = name.trim();
          if (chosen && chosen !== p.civName) dispatch({ type: 'nameCiv', name: chosen });
          next();
        }}
      >
        {name.trim() && name.trim() !== p.civName ? `We are ${name.trim()}` : 'Continue'}
      </button>
    ) : (
      <button class="btn btn-primary btn-wide" onClick={next}>
        Continue
      </button>
    );

  return (
    <Screen title={STEP_TITLE[step]} label="Age transition" closable={false} onBack={back} footer={footer} className="scr-transition">
      <div class="scr-steps" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
        {STEPS.map((s, k) => (
          <i class={k < i ? 'on' : k === i ? 'on now' : ''} data-step={s} />
        ))}
      </div>
      <div class="scr-page" key={step}>
      <div class="scr-chapter" aria-hidden="true">
        Chapter {CHAPTER[i] ?? i + 1}
      </div>

      {step === 'recap' && (
        <>
          <p class="scr-big">The {ageLabel(t.fromAge)} age ends</p>
          <div class="scr-stats">
            <div class="card scr-stat">
              <Icon name="legacy" size="lg" />
              <b>{recap.legacyPointsEarned}</b>
              <span class="small muted">legacy points</span>
            </div>
            <div class="card scr-stat">
              <Icon name="culture" size="lg" />
              <b>{recap.rpEarned}</b>
              <span class="small muted">
                <Term id="refinement_points" /> earned
              </span>
            </div>
          </div>
          <Section title={`Milestones reached (${recap.milestones.length})`}>
            {recap.milestones.length === 0 ? (
              <Empty>No milestones this age.</Empty>
            ) : (
              <ul class="scr-mods">
                {recap.milestones.map((m) => {
                  const [id, tier] = m.split(':');
                  const def = content.legacy.find((l) => l.id === id);
                  const n = def?.thresholds[Number(tier) - 1];
                  return <li>{def ? def.description.replace('{n}', String(n ?? '')) : m}</li>;
                })}
              </ul>
            )}
          </Section>
          <Section title="To the Hall of Ancestors" note="Every figure retires as the age turns. Each keeps giving a little every turn, forever.">
            {recap.retiredFigures.length === 0 && <Empty>No figures served you this age.</Empty>}
            <ul class="scr-list">
              {recap.retiredFigures.map((id) => {
                const def = lookup.figures[id];
                if (!def) return null;
                return (
                  <li class="row">
                    <Portrait figure={def.id} size="sm" />
                    <div class="grow">
                      <div class="scr-fig-name">{def.name}</div>
                      <div class="small muted">{ancestorYield(def.kind)}</div>
                    </div>
                    <CultureChip culture={def.culture} />
                  </li>
                );
              })}
            </ul>
          </Section>
        </>
      )}

      {step === 'refine' && (
        <RefineStep
          weights={weights}
          showAll={showAll}
          onShowAll={() => setShowAll(true)}
          onAdopt={setAdopting}
        />
      )}

      {step === 'name' && (
        <>
          <div class="scr-name-banner" aria-hidden="true">
            <PlayerBanner player={p} width={84} wave />
            <div class="scr-name-preview">{name.trim() || p.civName || '…'}</div>
          </div>
          <p>Your people need a name for the {ageLabel(t.toAge)} age. It is drawn from the cultures you have gathered and your founding dream.</p>
          {p.civName && <p class="small muted">Now known as {p.civName}.</p>}
          <div role="radiogroup" aria-label="Proposed names">
            {recap.nameOptions.map((n) => (
              <button
                role="radio"
                aria-checked={name === n ? 'true' : 'false'}
                class={`btn scr-option ${name === n ? 'scr-selected' : ''}`}
                onClick={() => setName(n)}
              >
                <span class="grow scr-name-option">{n}</span>
              </button>
            ))}
          </div>
          <Section title="Or your own">
            <input
              class="scr-name-input"
              type="text"
              maxLength={40}
              value={recap.nameOptions.includes(name) ? '' : name}
              placeholder="Type a name"
              aria-label="Your own civilization name"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </Section>
        </>
      )}

      {step === 'government' && (
        <>
          <p>
            {govForNewAge ? `You will enter the age as a ${gov.name}.` : `Your old government belongs to the past. Choose one for the ${ageLabel(t.toAge)} age (free now).`}
          </p>
          <GovernmentList />
        </>
      )}

      {step === 'begin' && (
        <>
          <div class="scr-name-banner" aria-hidden="true">
            <PlayerBanner player={p} width={64} wave />
          </div>
          <p class="scr-big">{p.civName ?? (name.trim() || recap.nameOptions[0] || 'Your people')}</p>
          <ul class="scr-mods">
            <li>Government: {govForNewAge ? gov.name : `${lookup.governments[content.governments.find((x) => x.age === t.toAge)?.id ?? '']?.name ?? 'the first available'} (default)`}</li>
            <li>
              Traditions: {p.traditions.length} · Hybrids: {p.hybrids.length}
            </li>
            <li>{Math.floor(p.refinementPoints)} refinement points unspent; half carry over to the next transition.</li>
          </ul>
          {affordable > 0 && (
            <p class="scr-banner scr-banner-info small">
              {affordable === 1 ? 'One tradition is' : `${affordable} traditions and hybrids are`} still within your points.{' '}
              <button class="btn btn-ghost" onClick={() => setStep('refine')}>
                Back to refining
              </button>
            </p>
          )}
          <p class="small muted">Units start weaker until upgraded, old buildings give half yields, the cabinet empties and the trees turn to a new age.</p>
        </>
      )}
      </div>

      {adopting && (
        <ConfirmSheet
          title={`Adopt ${adopting.name}?`}
          confirmLabel={`Adopt for ${adopting.cost} points`}
          onConfirm={() => {
            dispatch(adopting.kind === 'tradition' ? { type: 'adoptTradition', tradition: adopting.id } : { type: 'adoptHybrid', hybrid: adopting.id });
            setAdopting(null);
          }}
          onCancel={() => setAdopting(null)}
        >
          <p>Traditions and hybrids are permanent. This spends {adopting.cost} of your {Math.floor(p.refinementPoints)} refinement points.</p>
          <p class="small muted">
            Afterwards every other tradition and hybrid costs {REFINEMENT_ESCALATION} more this transition (each adoption raises the next).
          </p>
        </ConfirmSheet>
      )}
    </Screen>
  );
};

const RefineStep = (props: {
  weights: Record<string, number>;
  showAll: boolean;
  onShowAll: () => void;
  onAdopt: (a: Adopting) => void;
}) => {
  const g = game.value;
  const player = me.value;
  const p = g && player ? g.players[player] : undefined;
  if (!g || !player || !p) return null;
  const options = q.refinementOptions(g, player, content);
  const bought = adoptedThisTransition(p, g.turn);
  const groups = groupRefinement(p, options, props.weights, content);
  const rows = weightRows(props.weights, content);
  const shown = groups.cultures.filter((c) => props.showAll || c.weight > 0 || c.tiers.some((t) => t.items.some((x) => x.owned)));
  const hybrids = groups.hybrids.filter((h) => props.showAll || h.owned || h.def.cultures.some((c) => (props.weights[c] ?? 0) > 0));
  const hidden = groups.cultures.length - shown.length + groups.hybrids.length - hybrids.length;

  return (
    <>
      <div class="scr-rp">
        <div class="row">
          <span class="grow">
            <b>{Math.floor(p.refinementPoints)}</b> refinement points to spend
          </span>
          {bought > 0 && <span class="chip">{bought} adopted</span>}
        </div>
      </div>
      <p class="small muted scr-rp-help">
          Spend points on traditions (and one hybrid) that last the rest of the game. Your heaviest culture is {Math.abs(HEAVIEST_CULTURE_DISCOUNT_PERCENT)}% cheaper.
          Each adoption raises the cost of the next by {REFINEMENT_ESCALATION}
          {bought > 0 ? `; prices below already include +${bought * REFINEMENT_ESCALATION}` : ''}. Unspent points: half carry over.
      </p>
      <Section title="Your culture">
        {rows.length ? <WeightBars rows={rows} /> : <Empty>No culture weight yet.</Empty>}
      </Section>
      {shown.map((c) => (
        <Section
          title={
            <>
              <CultureCrest culture={c.culture} size={20} /> {cultureName(c.culture)} · weight {c.weight}
            </>
          }
        >
          {c.tiers.map((tier) => (
            <>
              <div class="scr-tag" style={{ margin: '8px 0 4px' }}>{TIER_LABEL[tier.tier]}</div>
              <ul class="scr-list">
                {tier.items.map((item) => (
                  <li>
                    <RefineCard item={item} onAdopt={props.onAdopt} />
                  </li>
                ))}
              </ul>
            </>
          ))}
        </Section>
      ))}
      <Section title="Hybrids" note="Where two of your cultures really met in history. One new hybrid per transition.">
        {hybrids.length === 0 && <Empty>No hybrids in reach yet.</Empty>}
        <ul class="scr-list">
          {hybrids.map((h) => (
            <li>
              <RefineCard item={h} onAdopt={props.onAdopt} />
            </li>
          ))}
        </ul>
      </Section>
      {hidden > 0 && (
        <button class="btn" style={{ width: '100%' }} onClick={props.onShowAll} aria-label="Show traditions and hybrids of cultures you have no weight in">
          Show {hidden} more from cultures you have not met
        </button>
      )}
    </>
  );
};

const isHybrid = (x: TraditionItem | HybridItem): x is HybridItem => 'cultures' in x.def;

const RefineCard = (props: { item: TraditionItem | HybridItem; onAdopt: (a: Adopting) => void }) => {
  const { item } = props;
  const opt: RefinementOption | null = item.option;
  const hybrid = isHybrid(item);
  const cls = item.owned ? 'scr-trad-owned' : opt?.available ? '' : 'scr-trad-blocked';
  return (
    <div class={`card scr-trad ${cls}`}>
      <div class="scr-kv">
        <span class="scr-fig-name">{item.def.name}</span>
        {item.owned ? (
          <span class="chip scr-good">
            <Icon name="done" size="sm" /> Adopted
          </span>
        ) : opt ? (
          <span class="chip scr-cost">{opt.cost} pts</span>
        ) : null}
      </div>
      {hybrid && (
        <div class="scr-chips">
          {item.def.cultures.map((c) => (
            <CultureChip culture={c} />
          ))}
        </div>
      )}
      <ul class="scr-mods small">
        {describeModifiers(item.def.modifiers, lookup).map((t) => (
          <li>{t}</li>
        ))}
      </ul>
      <p class="scr-history">{item.def.history.note}</p>
      {!item.owned && opt && (
        <div class="scr-actions">
          {opt.available ? (
            <button
              class="btn btn-primary"
              onClick={() => props.onAdopt({ kind: hybrid ? 'hybrid' : 'tradition', id: item.def.id, name: item.def.name, cost: opt.cost })}
              aria-label={`Adopt ${item.def.name} for ${opt.cost} points`}
            >
              <Icon name="plus" /> Adopt ({opt.cost})
            </button>
          ) : (
            <span class="small muted">{opt.blocked}</span>
          )}
        </div>
      )}
    </div>
  );
};
