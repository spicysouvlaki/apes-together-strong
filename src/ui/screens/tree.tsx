/** Tech and civic trees (GDD §7 "Trees"): current-age nodes on a scrollable grid. */
import { useState } from 'preact/hooks';
import type { Tech } from '@contracts/content-schemas';
import { closeModal, content, dispatch, game, lookup, me, myTurn, openModal, q } from '../store';
import type { ScreenProps } from './index';
import { Bar, Empty, Screen, Sheet } from './shared/components';
import { ageLabel, describeModifiers } from './shared/describe';
import { layoutTree, unlockedBy } from './shared/tree-layout';

type NodeState = 'done' | 'researching' | 'available' | 'locked';

const STATE_LABEL: Record<NodeState, string> = {
  done: 'Done',
  researching: 'Researching',
  available: 'Available',
  locked: 'Locked',
};

export const TreeScreen = ({ modal }: ScreenProps<'tree'>) => {
  const [detail, setDetail] = useState<string | null>(null);
  const g = game.value;
  const player = me.value;
  const p = g && player ? g.players[player] : undefined;
  if (!g || !player || !p) return <Screen title="Research" label="Research"><Empty>No game in progress.</Empty></Screen>;

  const tree = modal.tree;
  const nodes = content.techs.filter((t) => t.tree === tree && t.age === g.age);
  const earlierDone = content.techs.filter((t) => t.tree === tree && t.age !== g.age && p.techs.includes(t.id)).length;
  const layout = layoutTree(nodes);
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
        {ageLabel(g.age)} age · {doneCount} of {nodes.length} done · +{perTurn} {tree === 'tech' ? 'science' : 'culture'} per turn
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
                  aria-label={`${n.name}, ${STATE_LABEL[st]}`}
                >
                  <span class="scr-node-name">{n.name}</span>
                  {st === 'researching' && <Bar value={slot.progress} max={n.cost} label={`${n.name} progress`} />}
                  <span class="scr-node-meta">
                    {st === 'done' ? '✓ Done' : st === 'locked' ? `${n.cost}` : turns !== null ? `${n.cost} · ${turns} ${turns === 1 ? 'turn' : 'turns'}` : `${n.cost}`}
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
                aria-label={`Research ${node.name}`}
              >
                Research {node.name}
              </button>
            ) : undefined
          }
        >
          <p class="scr-tag">{STATE_LABEL[nodeState]}</p>
          <p>{node.description}</p>
          <p class="small">
            Cost {node.cost} {tree === 'tech' ? 'science' : 'culture'}
            {turnsOf(node.id) !== null && ` · ${turnsOf(node.id)} turns`}
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
            <div class="scr-chips">
              {unlocks.units.map((n) => (
                <span class="chip">Unit: {n}</span>
              ))}
              {unlocks.buildings.map((n) => (
                <span class="chip">Building: {n}</span>
              ))}
              {unlocks.wonders.map((n) => (
                <span class="chip">Wonder: {n}</span>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </Screen>
  );
};
