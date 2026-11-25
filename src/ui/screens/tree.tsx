/** Tech and civic trees (GDD §7 "Trees"): current-age nodes on a scrollable grid. */
import { useState } from 'preact/hooks';
import type { Tech } from '@contracts/content-schemas';
import { closeModal, content, dispatch, game, lookup, me, myTurn, openModal, q } from '../store';
import type { ScreenProps } from './index';
import { Bar, Empty, Screen, Sheet } from './shared/components';
import { ageLabel, describeModifiers } from './shared/describe';
import { DEFAULT_TREE_METRICS, layoutTree, unlockedBy } from './shared/tree-layout';
import { num } from '../shell/format';

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
      text: [u.strength > 0 ? `⚔ ${u.strength}` : '', u.rangedStrength !== undefined ? `🏹 ${u.rangedStrength}` : '', `➜ ${u.moves}`]
        .filter(Boolean)
        .join(' · '),
    })),
  ...content.buildings.filter((b) => b.requiresTech === techId).map((b) => ({ kind: 'Building', name: b.name, text: b.description ?? '' })),
  ...content.wonders.filter((w) => w.requiresTech === techId).map((w) => ({ kind: 'Wonder', name: w.name, text: w.description ?? '' })),
];

export const TreeScreen = ({ modal }: ScreenProps<'tree'>) => {
  const [detail, setDetail] = useState<string | null>(null);
  const g = game.value;
  const player = me.value;
  const p = g && player ? g.players[player] : undefined;
  if (!g || !player || !p) return <Screen title="Research" label="Research"><Empty>No game in progress.</Empty></Screen>;

  const tree = modal.tree;
  const nodes = content.techs.filter((t) => t.tree === tree && t.age === g.age);
  const earlierDone = content.techs.filter((t) => t.tree === tree && t.age !== g.age && p.techs.includes(t.id)).length;
  const k = Math.max(1, textScale());
  const layout = layoutTree(nodes, { ...DEFAULT_TREE_METRICS, cellW: Math.round(150 * k), cellH: Math.round(112 * k) });
  const glyph = tree === 'tech' ? '⚗' : '✿';
  const pointName = tree === 'tech' ? 'science' : 'culture';
  const options = q.researchOptions(g, player, tree, content);
  const slot = p.research[tree];
  const byId: Record<string, Tech> = {};
  for (const n of nodes) byId[n.id] = n;

  const stateOf = (id: string): NodeState =>
    p.techs.includes(id) ? 'done' : slot.current === id ? 'researching' : options.some((o) => o.id === id) ? 'available' : 'locked';
  const turnsOf = (id: string): number | null => options.find((o) => o.id === id)?.turns ?? null;
  const doneCount = nodes.filter((n) => p.techs.includes(n.id)).length;
  const perTurn = tree === 'tech' ? p.income.science : p.income.culture;

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
          </button>
        ))}
      </div>
      <p class="small muted">
        {ageLabel(g.age)} age · {doneCount} of {nodes.length} done · {glyph} +{num(perTurn)} {pointName} per turn
        {earlierDone > 0 && ` · ${earlierDone} earlier-age nodes completed`}
      </p>
      <div class="scr-legend-row small">
        <span class="chip">Done</span>
        <span class="chip" style={{ outline: '2px solid var(--accent)' }}>Researching</span>
        <span class="chip" style={{ outline: '1px solid var(--gold)' }}>Available</span>
        <span class="chip" style={{ opacity: 0.6 }}>Locked</span>
      </div>
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
                    stroke={lit ? '#7a9a6a' : '#cdbf9f'}
                    stroke-width={lit ? 2.5 : 2}
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
                <button
                  class={`scr-node scr-node-${st}`}
                  style={{ left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` }}
                  onClick={() => setDetail(n.id)}
                  aria-label={`${n.name}, ${STATE_LABEL[st]}. ${n.description}`}
                >
                  <span class="scr-node-name">{n.name}</span>
                  <span class="scr-node-desc">{n.description}</span>
                  {st === 'researching' && <Bar value={slot.progress} max={n.cost} label={`${n.name} progress`} />}
                  <span class="scr-node-meta">
                    {st === 'done'
                      ? '✓ Done'
                      : `${glyph} ${n.cost}${st !== 'locked' && turns !== null ? ` · ${turns} ${turns === 1 ? 'turn' : 'turns'}` : ''}`}
                  </span>
                </button>
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
            nodeState === 'available' ? (
              <button
                class="btn btn-primary"
                disabled={!myTurn.value}
                onClick={() => {
                  dispatch({ type: 'setResearch', tree, id: node.id });
                  setDetail(null);
                }}
                aria-label={`${tree === 'tech' ? 'Research' : 'Adopt'} ${node.name}`}
              >
                {tree === 'tech' ? 'Research' : 'Adopt'} {node.name}
              </button>
            ) : undefined
          }
        >
          <p class="scr-tag">{STATE_LABEL[nodeState]}</p>
          <p>{node.description}</p>
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
