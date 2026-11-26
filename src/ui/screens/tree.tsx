/** Tech and civic trees (GDD §7 "Trees"): current-age nodes on a scrollable grid. */
import { useEffect, useState } from 'preact/hooks';
import { GlossText } from '../shell/GlossarySheet';
import type { Tech } from '@contracts/content-schemas';
import { closeModal, content, dispatch, game, lookup, me, myTurn, openModal, q } from '../store';
import type { ScreenProps } from './index';
import { Bar, Empty, Screen, Sheet } from './shared/components';
import { ageLabel, describeModifiers } from './shared/describe';
import { DEFAULT_TREE_METRICS, layoutTree, unlockedBy } from './shared/tree-layout';
import { num } from '../shell/format';
import { Icon } from '../art/Icon';
import { PLAN_MAX, researchPlan, togglePlan } from '../shell/research-plan';
import { nodeAction, planWaits } from '../shell/tree-actions';

/** Taller cells than the default so each node can say what it gives; scales with text size. */
const textScale = (): number => {
  if (typeof document === 'undefined') return 1;
  const v = Number(getComputedStyle(document.documentElement).getPropertyValue('--text-scale'));
  return Number.isFinite(v) && v > 0 ? v : 1;
};

type NodeState = 'done' | 'researching' | 'available' | 'locked';

const STATE_LABEL: Record<NodeState, string> = {
  done: 'Done',
  researching: 'Researching',
  available: 'Available',
  locked: 'Locked',
};

/** What a node unlocks, each with its one-line effect from content. */
const unlockDetails = (techId: string): { kind: string; name: string; text: string }[] => [
  ...content.units
    .filter((u) => u.requiresTech === techId && !u.figureKind)
    .map((u) => ({
      kind: 'Unit',
      name: u.name,
      text: [u.strength > 0 ? `strength ${u.strength}` : '', u.rangedStrength !== undefined ? `ranged ${u.rangedStrength}` : '', `${u.moves} ${u.moves === 1 ? 'move' : 'moves'}`]
        .filter(Boolean)
        .join(' · '),
    })),
  ...content.buildings.filter((b) => b.requiresTech === techId).map((b) => ({ kind: 'Building', name: b.name, text: b.description ?? '' })),
  ...content.wonders.filter((w) => w.requiresTech === techId).map((w) => ({ kind: 'Wonder', name: w.name, text: w.description ?? '' })),
];

export const TreeScreen = ({ modal }: ScreenProps<'tree'>) => {
  const [detail, setDetail] = useState<string | null>(null);
  // Switching tree starts at its top (the screen element is reused between the two trees).
  useEffect(() => {
    document.querySelector('.screen-body')?.scrollTo({ top: 0 });
  }, [modal.tree]);
  const g = game.value;
  const player = me.value;
  const p = g && player ? g.players[player] : undefined;
  if (!g || !player || !p) return <Screen title="Research" label="Research"><Empty>No game in progress.</Empty></Screen>;

  const tree = modal.tree;
  const nodes = content.techs.filter((t) => t.tree === tree && t.age === g.age);
  const earlierDone = content.techs.filter((t) => t.tree === tree && t.age !== g.age && p.techs.includes(t.id)).length;
  const k = Math.max(1, textScale());
  const layout = layoutTree(nodes, { ...DEFAULT_TREE_METRICS, cellW: Math.round(150 * k), cellH: Math.round(138 * k) });
  const glyph = <Icon name={tree === 'tech' ? 'science' : 'culture'} size="sm" />;
  const pointName = tree === 'tech' ? 'science' : 'culture';
  const options = q.researchOptions(g, player, tree, content);
  const slot = p.research[tree];
  const byId: Record<string, Tech> = {};
  for (const n of nodes) byId[n.id] = n;
  // Unfinished nodes of earlier ages stay researchable (sim/research.ts); without this list they
  // were unreachable once the age turned (playtest: a skipped Trade locked merchants out).
  const earlierOpen = content.techs.filter((t) => t.tree === tree && t.age !== g.age && options.some((o) => o.id === t.id));
  for (const n of earlierOpen) byId[n.id] = n;
  const otherTree = tree === 'tech' ? 'civic' : 'tech';
  const idle = (t: 'tech' | 'civic'): boolean => p.research[t].current === null && q.researchOptions(g, player, t, content).length > 0;

  const stateOf = (id: string): NodeState =>
    p.techs.includes(id) ? 'done' : slot.current === id ? 'researching' : options.some((o) => o.id === id) ? 'available' : 'locked';
  const turnsOf = (id: string): number | null => options.find((o) => o.id === id)?.turns ?? null;
  const doneCount = nodes.filter((n) => p.techs.includes(n.id)).length;
  const perTurn = tree === 'tech' ? p.income.science : p.income.culture;

  const planned = researchPlan.value[tree];
  const busy = slot.current !== null;
  /** One tap starts research (wave 13: picks took two taps ~30 times a game). */
  const research = (id: string): void => {
    dispatch({ type: 'setResearch', tree, id });
    setDetail(null);
    // "Pick one in each tree" (guide): go straight on to the other tree if it is idle.
    if (idle(otherTree)) openModal({ kind: 'tree', tree: otherTree });
    // Nothing else to pick: back to the map, where the next decision waits
    // (playtest 4: "Back to the map" after every pick, about 20 extra taps a game).
    else closeModal();
  };
  const verb = tree === 'tech' ? 'Research' : 'Study';
  /** The Research / Plan strip at the foot of a node card. */
  const actions = (n: Tech, st: NodeState) => {
    const a = nodeAction(st, busy, planned.indexOf(n.id), planned.length, PLAN_MAX);
    if (a.kind === 'none') return null;
    return (
      <span class="scr-node-acts">
        {a.kind === 'research' && (
          <button class="btn btn-primary scr-node-go" disabled={!myTurn.value} onClick={() => research(n.id)} aria-label={`${verb} ${n.name} now`}>
            <Icon name={tree === 'tech' ? 'science' : 'culture'} size="sm" /> {verb}
          </button>
        )}
        {a.plan !== 'hidden' && (
          <button
            class={`btn scr-node-plan${a.plan === 'planned' ? ' is-planned' : ''}`}
            disabled={a.plan === 'full'}
            aria-pressed={a.plan === 'planned'}
            onClick={() => togglePlan(tree, n.id)}
            aria-label={a.plan === 'planned' ? `Planned ${a.order} of ${planned.length}: ${n.name}. Tap to unplan.` : a.plan === 'full' ? `The plan holds ${PLAN_MAX}` : `Plan ${n.name} next`}
          >
            {a.plan === 'planned' ? (
              <>
                <span class="scr-plan-n tnum">{a.order}</span> Planned
              </>
            ) : (
              <>
                <Icon name="plus" size="sm" /> Plan
              </>
            )}
          </button>
        )}
      </span>
    );
  };

  const node = detail ? byId[detail] : undefined;
  const nodeState = node ? stateOf(node.id) : 'locked';
  const unlocks = node ? unlockedBy(node.id, content) : null;

  return (
    <Screen
      title={tree === 'tech' ? 'Technology' : 'Civics'}
      label={tree === 'tech' ? 'Technology tree' : 'Civic tree'}
      footer={<button class="btn" onClick={closeModal} aria-label="Back to the map">Back to the map</button>}
    >
      <div class="scr-tabs" role="tablist">
        {(['tech', 'civic'] as const).map((t) => (
          <button
            role="tab"
            aria-selected={t === tree ? 'true' : 'false'}
            class={`btn ${t === tree ? 'scr-tab-on' : ''}`}
            onClick={() => t !== tree && openModal({ kind: 'tree', tree: t })}
          >
            {t === 'tech' ? 'Technology' : 'Civics'}
            {idle(t) && (
              <span class="scr-tab-dot" role="img" aria-label="nothing being studied">
                !
              </span>
            )}
          </button>
        ))}
      </div>
      <p class="small muted">
        {ageLabel(g.age)} age · {doneCount} of {nodes.length} done · {glyph} +{num(perTurn)} {pointName} per turn
        {earlierDone > 0 && ` · ${earlierDone} earlier-age nodes completed`}
      </p>
      <div class="scr-legend-row small">
        <span class="chip scr-key scr-key-done"><Icon name="done" size="sm" /> Done</span>
        <span class="chip scr-key scr-key-researching"><Icon name={tree === 'tech' ? 'science' : 'culture'} size="sm" /> Researching</span>
        <span class="chip scr-key scr-key-available"><Icon name="star" size="sm" /> Available</span>
        <span class="chip scr-key scr-key-locked"><Icon name="locked" size="sm" /> Locked</span>
      </div>
      <p class="small muted scr-plan-note">
        {planned.length > 0
          ? `Planned next: ${planned.map((id) => byId[id]?.name ?? lookup.techs[id]?.name ?? id).join(', then ')}. Each starts by itself when ${tree === 'tech' ? 'research' : 'study'} is free.${planWaits(planned, options.map((o) => o.id), p.techs, slot.current, content.techs)}`
          : `Tap Plan on up to ${PLAN_MAX} nodes and they start by themselves, in order, when ${tree === 'tech' ? 'research' : 'study'} is free.`}
      </p>
      {nodes.length === 0 ? (
        <Empty>No {tree === 'tech' ? 'technologies' : 'civics'} in this age.</Empty>
      ) : (
        <div class="scr-tree-scroll">
          <div class="scr-tree" style={{ width: `${layout.width}px`, height: `${layout.height}px` }}>
            <svg width={layout.width} height={layout.height} aria-hidden="true">
              {layout.edges.map((e) => {
                const mid = (e.x1 + e.x2) / 2;
                const lit = p.techs.includes(e.from);
                return (
                  <path
                    d={`M${e.x1},${e.y1} C${mid},${e.y1} ${mid},${e.y2} ${e.x2},${e.y2}`}
                    fill="none"
                    stroke={lit ? '#2b2118' : '#a8916a'}
                    stroke-width={lit ? 2 : 1.4}
                    stroke-dasharray={lit ? undefined : '4 3'}
                  />
                );
              })}
            </svg>
            {layout.cells.map((c) => {
              const n = byId[c.id];
              if (!n) return null;
              const st = stateOf(n.id);
              const turns = turnsOf(n.id);
              return (
                <div
                  class={`scr-node scr-node-${st}${planned.includes(n.id) ? ' is-planned' : ''}`}
                  style={{ left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` }}
                >
                  <button class="scr-node-open" onClick={() => setDetail(n.id)} aria-label={`${n.name}, ${STATE_LABEL[st]}. ${n.description} Details.`}>
                    <span class="scr-node-name">{n.name}</span>
                    <span class="scr-node-desc">{n.description}</span>
                    {st === 'researching' && <Bar value={slot.progress} max={n.cost} label={`${n.name} progress`} />}
                    <span class="scr-node-meta">
                      {st === 'done'
                        ? <><Icon name="done" size="sm" /> Done</>
                        : <>{st === 'locked' ? <Icon name="locked" size="sm" /> : glyph} {n.cost}{st !== 'locked' && turns !== null ? ` · ${turns} ${turns === 1 ? 'turn' : 'turns'}` : ''}</>}
                    </span>
                  </button>
                  {actions(n, st)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {earlierOpen.length > 0 && (
        <div class="scr-earlier">
          <p class="scr-tag">Still open from earlier ages</p>
          <div class="scr-earlier-list">
            {earlierOpen.map((n) => {
              const st = stateOf(n.id);
              const turns = turnsOf(n.id);
              return (
                <div class={`scr-node scr-node-${st} scr-node-flow${planned.includes(n.id) ? ' is-planned' : ''}`}>
                  <button class="scr-node-open" onClick={() => setDetail(n.id)} aria-label={`${n.name}, ${ageLabel(n.age)} age, ${STATE_LABEL[st]}. ${n.description} Details.`}>
                    <span class="scr-node-name">{n.name}</span>
                    <span class="scr-node-desc">{n.description}</span>
                    {st === 'researching' && <Bar value={slot.progress} max={n.cost} label={`${n.name} progress`} />}
                    <span class="scr-node-meta">
                      {glyph} {n.cost}
                      {turns !== null ? ` · ${turns} ${turns === 1 ? 'turn' : 'turns'}` : ''} · {ageLabel(n.age)}
                    </span>
                  </button>
                  {actions(n, st)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {node && unlocks && (
        <Sheet
          title={node.name}
          onCancel={() => setDetail(null)}
          footer={
            nodeState === 'available' || nodeState === 'locked' ? (
              <>
                {(nodeState === 'locked' || busy) && (
                  <button
                    class="btn"
                    disabled={!planned.includes(node.id) && planned.length >= PLAN_MAX}
                    aria-pressed={planned.includes(node.id)}
                    onClick={() => togglePlan(tree, node.id)}
                  >
                    {planned.includes(node.id) ? 'Unplan' : planned.length >= PLAN_MAX ? `Plan is full (${PLAN_MAX})` : 'Plan next'}
                  </button>
                )}
                {nodeState === 'available' && (
                  <button class="btn btn-primary" disabled={!myTurn.value} onClick={() => research(node.id)} aria-label={`${busy ? 'Switch to' : verb} ${node.name}`}>
                    {busy ? 'Switch to it' : `${verb} ${node.name}`}
                  </button>
                )}
              </>
            ) : undefined
          }
        >
          <p class="scr-tag">{STATE_LABEL[nodeState]}</p>
          <p>
            <GlossText text={node.description} />
          </p>
          <p class="small">
            Cost {glyph} {node.cost} {pointName}
            {turnsOf(node.id) !== null && ` · about ${turnsOf(node.id)} ${turnsOf(node.id) === 1 ? 'turn' : 'turns'}`}
            {nodeState === 'researching' && ` · ${Math.floor(slot.progress)} so far`}
          </p>
          {node.requires.length > 0 && (
            <p class="small muted">Needs {node.requires.map((r) => lookup.techs[r]?.name ?? r).join(' and ')}</p>
          )}
          {describeModifiers(node.modifiers, lookup).length > 0 && (
            <ul class="scr-mods small">
              {describeModifiers(node.modifiers, lookup).map((t) => (
                <li>{t}</li>
              ))}
            </ul>
          )}
          {unlocks.units.length + unlocks.buildings.length + unlocks.wonders.length > 0 && (
            <ul class="scr-mods small" aria-label="Unlocks">
              {unlockDetails(node.id).map((u) => (
                <li>
                  <b>{u.kind}: {u.name}</b>
                  {u.text && <span class="muted"> · {u.text}</span>}
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
    </Screen>
  );
};
