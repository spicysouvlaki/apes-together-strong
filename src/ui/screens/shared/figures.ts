/** Roster grouping and public figure counts (GDD §3 figure states, §6 culture weight). Pure. */
import type { ContentBundle, Figure } from '@contracts/content-schemas';
import type { CultureId, FigureState, GameState, PlayerId } from '@contracts/sim-api';

export type RosterGroupId = 'seated' | 'field' | 'home' | 'hall' | 'consumed';

export interface RosterEntry {
  fs: FigureState;
  def: Figure;
  /** "Warleader", "In Memphis", "Commander near Thebes"... */
  where: string;
}

export interface RosterGroup {
  id: RosterGroupId;
  title: string;
  entries: RosterEntry[];
}

export const GROUP_TITLES: Record<RosterGroupId, string> = {
  seated: 'Seated',
  field: 'In the field',
  home: 'At home',
  hall: 'Hall of Ancestors',
  consumed: 'Consumed',
};

const GROUP_ORDER: RosterGroupId[] = ['seated', 'field', 'home', 'hall', 'consumed'];

/** Slot id of a cabinet slot key ("warleader#1" -> "warleader"). */
export const slotIdOfKey = (key: string): string => {
  const i = key.indexOf('#');
  return i < 0 ? key : key.slice(0, i);
};

export const groupOf = (fs: FigureState): RosterGroupId => {
  switch (fs.location.state) {
    case 'seated':
      return 'seated';
    case 'unit':
      return 'field';
    case 'based':
      return 'home';
    case 'retired':
      return 'hall';
    case 'consumed':
      return 'consumed';
  }
};

export const whereText = (state: GameState, fs: FigureState, content: ContentBundle): string => {
  const loc = fs.location;
  switch (loc.state) {
    case 'seated':
      return content.cabinetSlots.find((s) => s.id === slotIdOfKey(loc.slot))?.name ?? 'Cabinet';
    case 'unit': {
      const u = state.units[loc.unit];
      const near = u
        ? Object.values(state.settlements).find((s) => s.at.q === u.at.q && s.at.r === u.at.r)?.name
        : undefined;
      return near ? `In the field at ${near}` : 'On campaign';
    }
    case 'based':
      return `In ${state.settlements[loc.settlement]?.name ?? 'a lost city'}`;
    case 'retired':
      return fs.activated ? 'Retired after a great deed' : 'Retired';
    case 'consumed':
      return 'Left play';
  }
};

/** The player's figures in the GDD §3 states, recruit order within each group; empty groups dropped. */
export const groupRoster = (state: GameState, player: PlayerId, content: ContentBundle): RosterGroup[] => {
  const defs: Record<string, Figure> = {};
  for (const f of content.figures) defs[f.id] = f;
  const buckets: Record<RosterGroupId, RosterEntry[]> = { seated: [], field: [], home: [], hall: [], consumed: [] };
  const mine = Object.values(state.figures)
    .filter((fs) => fs.owner === player)
    .sort((a, b) => a.recruitedTurn - b.recruitedTurn || (a.id < b.id ? -1 : 1));
  for (const fs of mine) {
    const def = defs[fs.id];
    if (!def) continue;
    buckets[groupOf(fs)].push({ fs, def, where: whereText(state, fs, content) });
  }
  return GROUP_ORDER.filter((id) => buckets[id].length > 0).map((id) => ({ id, title: GROUP_TITLES[id], entries: buckets[id] }));
};

/** Figures a player holds per culture (public: anyone can count a court). Heaviest first, zeros dropped. */
export const figureCountsByCulture = (
  state: GameState,
  player: PlayerId,
  content: ContentBundle,
): { culture: CultureId; count: number }[] => {
  const counts: Record<string, number> = {};
  for (const fs of Object.values(state.figures)) {
    if (fs.owner !== player) continue;
    const c = content.figures.find((f) => f.id === fs.id)?.culture;
    if (c) counts[c] = (counts[c] ?? 0) + 1;
  }
  return content.cultures
    .map((c, i) => ({ culture: c.id, count: counts[c.id] ?? 0, i }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || a.i - b.i)
    .map(({ culture, count }) => ({ culture, count }));
};

/** Culture weights (from q.cultureWeights) as sorted rows, zeros dropped. */
export const weightRows = (
  weights: Record<CultureId, number>,
  content: ContentBundle,
): { culture: CultureId; weight: number }[] =>
  content.cultures
    .map((c, i) => ({ culture: c.id, weight: weights[c.id] ?? 0, i }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.i - b.i)
    .map(({ culture, weight }) => ({ culture, weight }));
