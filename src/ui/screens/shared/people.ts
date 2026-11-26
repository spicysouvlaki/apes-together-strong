/**
 * "Your people" (GDD §6 "Culture weight", §8 naming): who the player is becoming, at a glance.
 * Banner and name, the cultures that shape them (public culture weight, drawn as bars, never
 * numbers), the latest whisper, the figures grouped by culture and the traditions adopted, so the
 * hybrid can be seen forming. Pure: built from the snapshot, `cultureWeights` and content.
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { FigureState, GameState, PlayerId } from '@contracts/sim-api';

export interface PeopleCulture {
  culture: string;
  name: string;
  adjective: string;
  /** Share of the total weight, 0..1 (bars only). */
  share: number;
}

export interface PeopleFigure {
  id: string;
  name: string;
  state: FigureState['location']['state'];
}

export interface PeopleView {
  /** "the Hellenic Kléos", or null for a people yet unnamed. */
  name: string | null;
  leader: string;
  dream: { native: string; romanized: string; meaning: string } | null;
  /** Heaviest first, at most `TOP_CULTURES`. */
  cultures: PeopleCulture[];
  /** "Mostly Greek, with an Egyptian strand." */
  becoming: string;
  figureGroups: { culture: string; name: string; figures: PeopleFigure[] }[];
  traditions: { id: string; name: string; culture: string; tier: string }[];
  hybrids: { id: string; name: string; cultures: string[] }[];
  /** Count of figures in the Hall of Ancestors (retired). */
  ancestors: number;
}

export const TOP_CULTURES = 4;

/** One sentence for the shape of the culture mix. */
export const becomingLine = (cultures: readonly Pick<PeopleCulture, 'adjective' | 'share'>[]): string => {
  const [a, b] = cultures;
  if (!a) return 'Your people are still finding who they are.';
  if (!b || a.share >= 0.7) return `Deeply ${a.adjective}, and growing more so.`;
  const c = cultures[2];
  // No one leads: several cultures of nearly the same weight.
  if (c && a.share < 0.36 && c.share >= a.share * 0.7) return `A blend of ${a.adjective}, ${b.adjective} and ${c.adjective} ways.`;
  if (b.share >= 0.3) return `${a.adjective} and ${b.adjective}, woven together.`;
  return `Mostly ${a.adjective}, with ${/^[aeiou]/i.test(b.adjective) ? 'an' : 'a'} ${b.adjective} strand.`;
};

const ORDER: Record<string, number> = { seated: 0, unit: 1, based: 2, retired: 3, consumed: 4 };

export const buildPeople = (state: GameState, player: PlayerId, weights: Readonly<Record<string, number>>, content: ContentBundle): PeopleView | null => {
  const p = state.players[player];
  if (!p) return null;
  const byId = <T extends { id: string }>(xs: readonly T[]) => new Map(xs.map((x) => [x.id, x]));
  const cultures = byId(content.cultures);
  const figures = byId(content.figures);
  const traditions = byId(content.traditions);
  const hybrids = byId(content.hybrids);
  const total = Object.values(weights).reduce((s, w) => s + Math.max(0, w), 0);
  const rows = content.cultures
    .map((c, i) => ({ c, w: Math.max(0, weights[c.id] ?? 0), i }))
    .filter((x) => x.w > 0)
    .sort((x, y) => y.w - x.w || x.i - y.i);
  const top = rows.slice(0, TOP_CULTURES).map(({ c, w }) => ({ culture: c.id, name: c.name, adjective: c.adjective, share: total > 0 ? w / total : 0 }));
  const rank = new Map(rows.map((r, k) => [r.c.id, k]));

  const mine = Object.values(state.figures).filter((f) => f.owner === player && f.location.state !== 'consumed');
  const groups = new Map<string, PeopleFigure[]>();
  for (const f of mine) {
    const def = figures.get(f.id);
    if (!def) continue;
    const list = groups.get(def.culture) ?? [];
    list.push({ id: f.id, name: def.name, state: f.location.state });
    groups.set(def.culture, list);
  }
  const figureGroups = [...groups.entries()]
    .map(([culture, list]) => ({
      culture,
      name: cultures.get(culture)?.name ?? culture,
      figures: list.sort((x, y) => (ORDER[x.state] ?? 9) - (ORDER[y.state] ?? 9) || x.name.localeCompare(y.name)),
    }))
    .sort((x, y) => (rank.get(x.culture) ?? 99) - (rank.get(y.culture) ?? 99) || y.figures.length - x.figures.length || x.name.localeCompare(y.name));

  const dream = content.dreams.find((d) => d.id === p.dream);
  return {
    name: p.civName,
    leader: content.leaders.find((l) => l.id === p.leader)?.name ?? 'Your leader',
    dream: dream ? { native: dream.native, romanized: dream.romanized, meaning: dream.meaning } : null,
    cultures: top,
    becoming: becomingLine(top),
    figureGroups,
    traditions: p.traditions.flatMap((id) => {
      const t = traditions.get(id);
      return t ? [{ id, name: t.name, culture: t.culture, tier: t.tier }] : [];
    }),
    hybrids: p.hybrids.flatMap((id) => {
      const h = hybrids.get(id);
      return h ? [{ id, name: h.name, cultures: [...h.cultures] }] : [];
    }),
    ancestors: mine.filter((f) => f.location.state === 'retired').length,
  };
};
