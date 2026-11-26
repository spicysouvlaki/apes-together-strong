/**
 * The in-game guide (GDD §11 "Onboarding: in-game over the first 20 turns; first figure offer
 * scripted early (~turn 8); advisors are your own seated figures"). Pure: `nextAdvice` reads the
 * snapshot and the guide's own memory and returns at most one tip. Steps are conditions on game
 * state, not a script, so they cannot desync: a tip appears when its situation is true, and the
 * caller marks it seen once it was shown and its situation passed (or the player dismissed it).
 *
 * Voice: a chronicler addressing the player, warm and brief (Atlas Chronicle, base.css). Once a
 * figure is seated, the same tips are attributed to that advisor (see `advisorFor`).
 * Never mentions affinity numbers (GDD §4 "Hidden affinity").
 */
import type { ContentBundle } from '@contracts/content-schemas';
import { hexDistance } from '@contracts/hex';
import { RAIDER_PLAYER, isCityStateOwner, type Decision, type GameState, type PlayerId, type SimQueries } from '@contracts/sim-api';

/** A control the tip points at (the HUD pulses it). `decision:x` = whichever button opens that decision. */
export type GuideTarget =
  | 'endTurn'
  | 'found'
  | 'explore'
  | 'nextUnit'
  | 'age'
  | 'quick:roster'
  | 'quick:cabinet'
  | 'quick:tree'
  | 'quick:diplomacy'
  | `decision:${Decision['type'] | 'found'}`;

export interface Advice {
  id: string;
  text: string;
  /** One-line form for the compact slip above a unit sheet. */
  short?: string;
  target: GuideTarget | null;
}

export interface GuideMemory {
  /** Tip ids already shown and passed, or dismissed. */
  seen: readonly string[];
  /** Turn on which the last paced tip first appeared (one paced tip per turn). */
  lastTipTurn: number;
  /** The tip on screen right now, if any (it keeps its place even on a paced turn). */
  current: string | null;
}

export interface GuideView {
  /** Type id of the selected own unit, if any. */
  selectedUnitType: string | null;
  /** Units under a standing order (UI-side). */
  ordered: readonly string[];
}

interface Ctx {
  g: GameState;
  me: PlayerId;
  content: ContentBundle;
  q: SimQueries;
  view: GuideView;
  pending: Decision[];
}

interface Step {
  id: string;
  /** Paced tips wait for a turn without another new paced tip (keeps the guide light). */
  paced: boolean;
  when(c: Ctx): boolean;
  text(c: Ctx): string;
  short?: (c: Ctx) => string;
  target(c: Ctx): GuideTarget | null;
  /**
   * For tips that may step aside and come back (the settler marching to its site): the tip is
   * seen only once this holds (or it is dismissed), not when another tip takes its place.
   */
  done?: (c: Ctx) => boolean;
}

const unitDef = (c: Ctx, type: string) => c.content.units.find((u) => u.id === type);
const mySettlements = (c: Ctx) => Object.values(c.g.settlements).filter((s) => s.owner === c.me);
const myUnits = (c: Ctx) => Object.values(c.g.units).filter((u) => u.owner === c.me);
const pendingOf = (c: Ctx, type: Decision['type']) => c.pending.some((d) => d.type === type);
const figureName = (c: Ctx, id: string) => c.content.figures.find((f) => f.id === id)?.name ?? 'Your new figure';
const isExplorer = (c: Ctx, type: string | null): boolean => {
  const d = type ? unitDef(c, type) : undefined;
  return !!d && (d.id === 'scout' || (d.unitClass === 'civilian' && (d.vision ?? 0) >= 3 && !d.canFound));
};

/** Enemy units the player can see near their land: at war with them, or raiders. */
const enemiesNear = (c: Ctx): boolean => {
  const homes = mySettlements(c).map((s) => s.at);
  if (homes.length === 0) return false;
  const visible = new Set(c.q.visibleTiles(c.g, c.me, c.content));
  const w = c.g.map.width;
  return Object.values(c.g.units).some((u) => {
    if (u.owner === c.me) return false;
    if (u.owner !== RAIDER_PLAYER && !c.q.atWar(c.g, c.me, u.owner)) return false;
    const idx = u.at.r * w + (u.at.q + (u.at.r - (u.at.r & 1)) / 2);
    return visible.has(idx) && homes.some((h) => hexDistance(h, u.at) <= 5);
  });
};

const metCityState = (c: Ctx): boolean => {
  const p = c.g.players[c.me];
  if (!p) return false;
  return Object.values(c.g.settlements).some((s) => {
    if (!isCityStateOwner(s.owner)) return false;
    const idx = s.at.r * c.g.map.width + (s.at.q + (s.at.r - (s.at.r & 1)) / 2);
    return !!p.explored[idx];
  });
};

const crisisAt = (c: Ctx): number => c.content.crises.find((x) => x.age === c.g.age)?.stages[0]?.at ?? 70;

/**
 * The guide's steps in priority order. Early steps follow the first turns (found, build, study,
 * govern, explore, end turn); the rest wait for their situation and are paced one per turn.
 */
export const STEPS: readonly Step[] = [
  {
    id: 'found',
    paced: false,
    // While the settler marches to its site the tip steps aside (others may teach meanwhile)
    // and returns when it arrives; it is only done once the first city stands.
    when: (c) =>
      mySettlements(c).length === 0 &&
      myUnits(c).some((u) => !!unitDef(c, u.type)?.canFound) &&
      (!!(c.view.selectedUnitType && unitDef(c, c.view.selectedUnitType)?.canFound) ||
        !myUnits(c).some((u) => !!unitDef(c, u.type)?.canFound && c.view.ordered.includes(u.id))),
    done: (c) => mySettlements(c).length > 0,
    text: (c) => {
      if (c.view.selectedUnitType && unitDef(c, c.view.selectedUnitType)?.canFound) {
        return 'This is your settler. Rivers and coasts feed a city well; the dots mark the best sites nearby. Tap Found settlement to build your first city.';
      }
      const marching = myUnits(c).some((u) => !!unitDef(c, u.type)?.canFound && c.view.ordered.includes(u.id));
      return marching
        ? 'Your settler is on the march and moves on at the start of each turn. When it arrives, select it and tap Found settlement.'
        : 'Your people wait for a home. Tap the glowing button to pick up your settler, then found your first city.';
    },
    short: () => 'Found your first city: tap Found settlement, or a dotted site to march there.',
    target: (c) => {
      if (c.view.selectedUnitType && unitDef(c, c.view.selectedUnitType)?.canFound) return 'found';
      return myUnits(c).some((u) => !!unitDef(c, u.type)?.canFound && c.view.ordered.includes(u.id)) ? null : 'decision:found';
    },
  },
  {
    id: 'production',
    paced: false,
    when: (c) => pendingOf(c, 'production'),
    text: () => 'Your city needs work. Choose what it builds: a warrior guards, a scout explores, a settler founds a new town, a monument brings culture.',
    target: () => 'decision:production',
  },
  {
    id: 'research',
    paced: false,
    when: (c) => pendingOf(c, 'research'),
    text: () => 'Choose what your scholars study. Science feeds the technology tree; culture feeds civics, which open governments. Pick one in each tree.',
    target: () => 'decision:research',
  },
  {
    id: 'government',
    paced: false,
    when: (c) => pendingOf(c, 'government'),
    text: () => 'Choose a government. Each one opens cabinet seats, where the famous people who join you will serve and help every turn.',
    target: () => 'decision:government',
  },
  {
    id: 'offer',
    paced: false,
    when: (c) => pendingOf(c, 'offer'),
    text: () =>
      'Someone famous wants to join you! Who comes depends on where and how you play: your land, your trade, your deeds. Every one of them really lived.',
    target: () => 'decision:offer',
  },
  {
    id: 'figures',
    paced: false,
    // Done once any figure has been put to use (seated, deployed, activated or consumed).
    when: (c) =>
      Object.values(c.g.figures).some((f) => f.owner === c.me) &&
      !Object.values(c.g.figures).some((f) => f.owner === c.me && f.location.state !== 'based'),
    text: (c) => {
      const first = Object.values(c.g.figures)
        .filter((f) => f.owner === c.me)
        .sort((a, b) => a.recruitedTurn - b.recruitedTurn)[0];
      return `${first ? figureName(c, first.id) : 'Your first figure'} has joined you. A famous person can be seated in your cabinet, deployed on the map as a unit, activated once for a great deed, or consumed for points. Open Figures to choose.`;
    },
    target: () => 'quick:roster',
  },
  {
    id: 'seat',
    paced: false,
    when: (c) =>
      Object.values(c.g.figures).some((f) => f.owner === c.me && f.location.state === 'based' && c.q.figureActions(c.g, f.id, c.content).seat.length > 0),
    text: (c) => {
      const f = Object.values(c.g.figures).find(
        (x) => x.owner === c.me && x.location.state === 'based' && c.q.figureActions(c.g, x.id, c.content).seat.length > 0,
      );
      return `A cabinet seat is free for ${f ? figureName(c, f.id) : 'your figure'}. Seated figures help every turn and count double toward the culture you are becoming.`;
    },
    target: () => 'quick:roster',
  },
  {
    id: 'explore',
    paced: false,
    when: (c) =>
      mySettlements(c).length > 0 &&
      c.g.turn <= 15 &&
      myUnits(c).some((u) => isExplorer(c, u.type) && u.movesLeft > 0 && !c.view.ordered.includes(u.id)),
    text: (c) =>
      isExplorer(c, c.view.selectedUnitType)
        ? 'Tap a far tile to march there over several turns, or tap Explore and your scout will wander on its own, charting the parchment for you.'
        : 'The blank parchment is land no one has charted. Select your scout and send it out: whoever you meet out there shapes who joins you.',
    short: () => 'Tap a far tile to march there, or Explore to let your scout wander.',
    target: (c) => (isExplorer(c, c.view.selectedUnitType) ? 'explore' : 'nextUnit'),
  },
  {
    id: 'end_turn',
    paced: false,
    when: (c) => c.pending.length === 0 && c.g.turn <= 5,
    text: () => 'When your orders are given, tap End Turn. Your rivals move, the world turns, and your cities grow.',
    target: () => 'endTurn',
  },
  {
    id: 'growth',
    paced: true,
    when: (c) => mySettlements(c).some((s) => s.population >= 2),
    text: () => 'Your city has grown. Each new citizen works another tile; tap the city to see what it yields and how soon it grows again.',
    target: () => null,
  },
  {
    id: 'culture',
    paced: true,
    when: (c) => Object.values(c.g.players[c.me]?.hintsShown ?? {}).some((v) => v > 0),
    text: () =>
      'That golden whisper was a culture taking notice of you. Keep playing as you do and its famous people will begin to come. You will only ever see such signs, never a tally.',
    target: () => null,
  },
  {
    id: 'war',
    paced: false,
    when: (c) => enemiesNear(c),
    text: () =>
      'Enemies are near. Keep a soldier in every city, fortify on hills or in forest, and strike together: each friendly unit beside a target adds strength.',
    target: () => null,
  },
  {
    id: 'expand',
    paced: true,
    when: (c) => mySettlements(c).length === 1 && c.g.turn >= 10,
    text: (c) =>
      `Room to grow: build a settler and found a second settlement. New ones start as towns. This age allows ${c.q.settlementCap(c.g, c.me, c.content)} settlements; each beyond that costs happiness.`,
    target: () => null,
  },
  {
    id: 'town',
    paced: true,
    when: (c) => mySettlements(c).some((s) => s.kind === 'town'),
    text: () => 'A town cannot build: its production becomes gold. Tap the town and choose Upgrade to city once your treasury allows.',
    target: () => null,
  },
  {
    id: 'happiness',
    paced: true,
    when: (c) => (c.g.players[c.me]?.happiness ?? 10) < 2 && mySettlements(c).length > 0,
    text: () =>
      'Your people grow restless. Luxury resources inside your borders lift their mood; crowded cities and too many settlements lower it. Below zero, every yield suffers.',
    target: () => null,
  },
  {
    id: 'city_states',
    paced: true,
    when: (c) => metCityState(c) && (c.g.players[c.me]?.stats.envoysSent ?? 0) === 0,
    text: () =>
      'You have found a city-state. Send envoys from Nations with influence: whoever sends the most, three at least, becomes its suzerain and gains its gift, and its culture takes notice.',
    target: () => 'quick:diplomacy',
  },
  {
    id: 'trade',
    paced: true,
    // Once a merchant exists or one of your cities can train one.
    when: (c) =>
      myUnits(c).some((u) => !!unitDef(c, u.type)?.canTrade) ||
      mySettlements(c).some(
        (s) => s.kind === 'city' && c.q.productionOptions(c.g, s.id, c.content).some((o) => o.kind === 'unit' && !!unitDef(c, o.item)?.canTrade),
      ),
    text: (c) =>
      myUnits(c).some((u) => !!unitDef(c, u.type)?.canTrade)
        ? 'You have a unit that can trade. Walk it beside a foreign city or city-state and tap Trade route: gold every turn, and the far culture comes to know you.'
        : 'Your cities can now train merchants. A merchant opens a trade route to a foreign city or city-state: gold every turn, and the far culture comes to know you.',
    target: () => null,
  },
  {
    id: 'age',
    paced: true,
    when: (c) => c.g.ageProgress >= 30 && c.g.turn >= 12,
    text: (c) =>
      `The seal on the age track moves every turn, faster with wonders and milestones. At ${crisisAt(c)} a crisis strikes the world; at 100 this age ends for everyone.`,
    target: () => 'age',
  },
  {
    id: 'crisis',
    paced: false,
    when: (c) => c.g.crisis !== null,
    text: () => 'The crisis has come. Three times you will choose how to meet it, and each answer trades one hardship for another.',
    target: () => null,
  },
  {
    id: 'transition',
    paced: true,
    when: (c) => c.g.ageProgress >= 85,
    text: () =>
      'The age is closing. When it ends you will spend refinement points on traditions of the cultures you gathered, perhaps blend two into a hybrid, and name your people.',
    target: () => null,
  },
];

export const STEP_IDS: readonly string[] = STEPS.map((s) => s.id);

/** The one tip to show now, or null. */
export const nextAdvice = (
  g: GameState,
  me: PlayerId,
  memory: GuideMemory,
  view: GuideView,
  content: ContentBundle,
  q: SimQueries,
): Advice | null => {
  if (g.phase !== 'playing') return null;
  const p = g.players[me];
  if (!p || !p.alive) return null;
  const c: Ctx = { g, me, content, q, view, pending: q.pendingDecisions(g, me, content) };
  const seen = new Set(memory.seen);
  for (const s of STEPS) {
    if (seen.has(s.id)) continue;
    if (s.paced && memory.current !== s.id && memory.lastTipTurn >= g.turn) continue;
    if (!s.when(c)) continue;
    const out: Advice = { id: s.id, text: s.text(c), target: s.target(c) };
    if (s.short) out.short = s.short(c);
    return out;
  }
  return null;
};

export const isPaced = (id: string): boolean => STEPS.find((s) => s.id === id)?.paced ?? false;

/** Tips that end only when their goal is met (see Step.done). */
export const hasGoal = (id: string): boolean => !!STEPS.find((s) => s.id === id)?.done;

/** Ids of goal tips whose goal is met now. */
export const goalsMet = (g: GameState, me: PlayerId, view: GuideView, content: ContentBundle, q: SimQueries): string[] => {
  const c: Ctx = { g, me, content, q, view, pending: [] };
  return STEPS.filter((s) => s.done?.(c)).map((s) => s.id);
};

/**
 * Who gives the advice: the first figure seated in the player's cabinet (in seat order), with
 * the seat's name; null before anyone is seated (then the chronicler speaks).
 */
export const advisorFor = (g: GameState, me: PlayerId, content: ContentBundle): { figure: string; name: string; seat: string } | null => {
  const p = g.players[me];
  if (!p) return null;
  for (const [key, fig] of Object.entries(p.cabinet)) {
    if (!fig) continue;
    const def = content.figures.find((f) => f.id === fig);
    if (!def) continue;
    const slot = content.cabinetSlots.find((s) => s.id === key.split('#')[0]);
    return { figure: fig, name: def.name, seat: slot?.name ?? 'Advisor' };
  }
  return null;
};
