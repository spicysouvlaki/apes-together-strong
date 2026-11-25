/** Tech/civic tree layout (GDD §7 "Trees"): content `col`/`row` -> pixel cells and edges. Pure. */
import type { Tech } from '@contracts/content-schemas';

export interface TreeCell {
  id: string;
  col: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreeEdge {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TreeLayout {
  cells: TreeCell[];
  edges: TreeEdge[];
  width: number;
  height: number;
}

export interface TreeMetrics {
  cellW: number;
  cellH: number;
  gapX: number;
  gapY: number;
  pad: number;
}

export const DEFAULT_TREE_METRICS: TreeMetrics = { cellW: 136, cellH: 84, gapX: 36, gapY: 14, pad: 12 };

/**
 * One cell per node at its (col, row). Content may (by mistake) put two nodes in one cell;
 * the later one moves down to the next free row in that column so cells never overlap.
 * Edges only connect nodes in `nodes` (earlier-age prerequisites are not drawn).
 */
export const layoutTree = (nodes: readonly Tech[], m: TreeMetrics = DEFAULT_TREE_METRICS): TreeLayout => {
  const taken = new Set<string>();
  const cells: TreeCell[] = [];
  const sorted = [...nodes].sort((a, b) => a.col - b.col || a.row - b.row);
  for (const n of sorted) {
    let row = n.row;
    while (taken.has(`${n.col}:${row}`)) row++;
    taken.add(`${n.col}:${row}`);
    cells.push({
      id: n.id,
      col: n.col,
      row,
      x: m.pad + n.col * (m.cellW + m.gapX),
      y: m.pad + row * (m.cellH + m.gapY),
      w: m.cellW,
      h: m.cellH,
    });
  }
  const at: Record<string, TreeCell> = {};
  for (const c of cells) at[c.id] = c;
  const edges: TreeEdge[] = [];
  for (const n of sorted) {
    const to = at[n.id];
    if (!to) continue;
    for (const r of n.requires) {
      const from = at[r];
      if (!from) continue;
      edges.push({ from: r, to: n.id, x1: from.x + from.w, y1: from.y + from.h / 2, x2: to.x, y2: to.y + to.h / 2 });
    }
  }
  const width = cells.reduce((w, c) => Math.max(w, c.x + c.w), 0) + m.pad;
  const height = cells.reduce((h, c) => Math.max(h, c.y + c.h), 0) + m.pad;
  return { cells, edges, width, height };
};

/** Things whose `requiresTech` is this node (unit/building/wonder names). */
export const unlockedBy = (
  techId: string,
  lists: { units: readonly { name: string; requiresTech?: string | undefined; figureKind?: string | undefined }[]; buildings: readonly { name: string; requiresTech?: string | undefined }[]; wonders: readonly { name: string; requiresTech?: string | undefined }[] },
): { units: string[]; buildings: string[]; wonders: string[] } => ({
  units: lists.units.filter((u) => u.requiresTech === techId && !u.figureKind).map((u) => u.name),
  buildings: lists.buildings.filter((b) => b.requiresTech === techId).map((b) => b.name),
  wonders: lists.wonders.filter((w) => w.requiresTech === techId).map((w) => w.name),
});
