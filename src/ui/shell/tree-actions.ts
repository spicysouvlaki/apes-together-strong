/**
 * What a tree node card offers at its foot (wave 13: a pick took two taps, node then confirm).
 * An available node in an idle tree gets a one-tap Research; while the tree is busy, available and
 * locked nodes get Plan instead (switching mid-way stays in the details sheet, on purpose). Pure.
 */
export type NodeState = 'done' | 'researching' | 'available' | 'locked';

export type NodeAction =
  | { kind: 'none' }
  | {
      kind: 'research' | 'plan';
      /** 'planned' shows its place in the plan; 'full' is a disabled Plan; 'hidden' shows none. */
      plan: 'open' | 'planned' | 'full' | 'hidden';
      /** 1-based place in the plan when planned. */
      order: number;
    };

export const nodeAction = (st: NodeState, treeBusy: boolean, planIndex: number, planLength: number, planMax: number): NodeAction => {
  if (st === 'done' || st === 'researching') return { kind: 'none' };
  const plan = planIndex >= 0 ? 'planned' : planLength >= planMax ? 'full' : 'open';
  if (st === 'available' && !treeBusy) return { kind: 'research', plan: 'hidden', order: 0 };
  return { kind: 'plan', plan, order: planIndex + 1 };
};

/**
 * When the first planned node cannot start yet, say what it waits for (wave 13 playtest: a
 * planned civic sat locked behind an unplanned one and the tree went idle without a reason).
 * Returns "" when the plan can start, else " Military Tradition still needs Craftsmanship."
 */
export const planWaits = (
  planned: readonly string[],
  offered: readonly string[],
  done: readonly string[],
  current: string | null,
  techs: readonly { id: string; name: string; requires: readonly string[] }[],
): string => {
  const first = planned[0];
  if (!first || offered.includes(first)) return '';
  const def = techs.find((t) => t.id === first);
  if (!def) return '';
  const missing = def.requires.filter((r) => !done.includes(r) && r !== current && !planned.includes(r));
  if (missing.length === 0) return '';
  const names = missing.map((r) => techs.find((t) => t.id === r)?.name ?? r);
  return ` ${def.name} still needs ${names.join(' and ')}: plan or study ${missing.length === 1 ? 'it' : 'them'} first.`;
};
