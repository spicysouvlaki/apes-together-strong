/**
 * Figure commands (GDD §3 "Figure states and actions"): choose offers, seat/unseat,
 * deploy/recall, activate, consume. Each action has a pure `…Error` validator, shared with
 * the `figureActions` query so the UI and the rules can never disagree.
 */
import {
  ACTIVATE_EFFECTS,
  type ActivateEffect,
  type ContentBundle,
  type Figure,
  type UnitDef,
} from '@contracts/content-schemas';
import { hexesInRange } from '@contracts/hex';
import type { Command, FigureId, FigureState, GameState, PlayerId, Settlement, SettlementId } from '@contracts/sim-api';
import type { SimCtx } from '../sim/ctx';
import { addAgeProgress } from '../sim/ages';
import { costPercent, applyCostPercent, playerModifiers } from '../sim/modifiers';
import { removeUnit, spawnUnit } from '../sim/units';
import { baseAtHome, slotAccepts, slotIdOfKey, vacateSeat } from './cabinet';
import * as K from './constants';
import { dropOffer } from './offers';
import { figureDef, getPlayer, homeSettlement, ownSettlementAt, ownSettlements, tileIndex } from './util';

type FigureCommand = Extract<
  Command,
  {
    type:
      | 'chooseOffer'
      | 'seatFigure'
      | 'unseatFigure'
      | 'deployFigure'
      | 'recallFigure'
      | 'activateFigure'
      | 'consumeFigure';
  }
>;

// ---------------------------------------------------------------------------
// Lookups and validators (pure)
// ---------------------------------------------------------------------------

interface Owned {
  fs: FigureState;
  def: Figure;
}

const ownedFigure = (state: GameState, player: PlayerId, id: FigureId, content: ContentBundle): Owned | string => {
  const fs = state.figures[id];
  const def = figureDef(content, id);
  if (!fs || !def || fs.owner !== player) return 'That figure is not in your court.';
  return { fs, def };
};

const isActive = (fs: FigureState): boolean =>
  fs.location.state === 'based' || fs.location.state === 'seated' || fs.location.state === 'unit';

/** Second-person offer reason -> third person for the Chronicle ("drawn by your harbors" -> "drawn by its harbors"). */
export const annalVoice = (text: string): string =>
  text.replace(/\byour people\b/g, 'this people').replace(/\bYour\b/g, 'Its').replace(/\byour\b/g, 'its').replace(/\byou\b/g, 'it');

/** A cabinet seat's display name ("Warleader"), from content/cabinet_slots.json. */
export const seatName = (content: ContentBundle, key: string): string =>
  content.cabinetSlots.find((x) => x.id === slotIdOfKey(key))?.name ?? 'That seat';

const turnsWord = (n: number): string => (n === 1 ? '1 more turn' : `${n} more turns`);

export const seatError = (state: GameState, player: PlayerId, id: FigureId, key: string, content: ContentBundle): string | null => {
  const o = ownedFigure(state, player, id, content);
  if (typeof o === 'string') return o;
  const p = getPlayer(state, player);
  if (!o.def.uses.includes('cabinet')) return `${o.def.name} does not serve in a cabinet.`;
  if (p.anarchyTurns > 0) return `There is no cabinet during anarchy (${turnsWord(p.anarchyTurns)}).`;
  if (o.fs.location.state === 'seated') return `${o.def.name} already holds a seat; unseat them first.`;
  if (o.fs.location.state === 'unit') return `${o.def.name} is in the field; recall them to a city first.`;
  if (o.fs.location.state !== 'based') return `${o.def.name} is no longer active.`;
  if (!(key in p.cabinet)) return 'Your government has no such seat.';
  const occupant = p.cabinet[key];
  if (occupant) return `The ${seatName(content, key)} seat is taken by ${figureDef(content, occupant)?.name ?? 'someone else'}.`;
  const free = p.cabinetCooldown[key] ?? 0;
  if (free > state.turn) return `The ${seatName(content, key)} seat was just vacated; it is free on turn ${free}.`;
  if (!slotAccepts(content, key, o.def)) return `The ${seatName(content, key)} seat does not suit ${o.def.name}.`;
  return null;
};

export const unseatError = (state: GameState, player: PlayerId, id: FigureId, content: ContentBundle): string | null => {
  const o = ownedFigure(state, player, id, content);
  if (typeof o === 'string') return o;
  const p = getPlayer(state, player);
  if (p.anarchyTurns > 0) return `The cabinet cannot change during anarchy (${turnsWord(p.anarchyTurns)}).`;
  if (o.fs.location.state !== 'seated') return `${o.def.name} does not hold a seat.`;
  if (!homeSettlement(state, player)) return 'You have no city to receive them.';
  return null;
};

export const figureUnitDef = (content: ContentBundle, def: Figure): UnitDef | undefined =>
  content.units.find((u) => u.figureKind === def.kind);

export const deployError = (
  state: GameState,
  player: PlayerId,
  id: FigureId,
  settlement: SettlementId,
  content: ContentBundle,
): string | null => {
  const o = ownedFigure(state, player, id, content);
  if (typeof o === 'string') return o;
  if (!o.def.uses.includes('unit') || !figureUnitDef(content, o.def)) return `${o.def.name} cannot take the field.`;
  if (o.fs.location.state === 'seated') return `${o.def.name} holds a cabinet seat; unseat them first.`;
  if (o.fs.location.state === 'unit') return `${o.def.name} is already in the field.`;
  if (o.fs.location.state !== 'based') return `${o.def.name} is no longer active.`;
  const s = state.settlements[settlement];
  if (!s || s.owner !== player || s.kind !== 'city') {
    return ownSettlements(state, player).some((x) => x.kind === 'city')
      ? 'Figures can only be deployed from one of your cities.'
      : 'You need a city (not a town) to deploy figures from.';
  }
  return null;
};

const recallTarget = (state: GameState, player: PlayerId, fs: FigureState): Settlement | null => {
  if (fs.location.state !== 'unit') return null;
  const u = state.units[fs.location.unit];
  return u ? ownSettlementAt(state, player, u.at) : null;
};

export const recallError = (state: GameState, player: PlayerId, id: FigureId, content: ContentBundle): string | null => {
  const o = ownedFigure(state, player, id, content);
  if (typeof o === 'string') return o;
  if (o.fs.location.state !== 'unit') return `${o.def.name} is not in the field.`;
  if (!recallTarget(state, player, o.fs)) return `Move ${o.def.name} into one of your settlements first.`;
  return null;
};

const amountOf = (def: Figure, effect: ActivateEffect): number => def.activate?.amount ?? K.ACTIVATE_DEFAULT_AMOUNT[effect];

const isActivateEffect = (e: string): e is ActivateEffect => (ACTIVATE_EFFECTS as readonly string[]).includes(e);

/** Settlement a settlement-targeted effect lands in: the figure's own city if it qualifies, else the capital. */
const effectSettlement = (
  state: GameState,
  fs: FigureState,
  ok: (s: Settlement) => boolean,
): Settlement | null => {
  if (fs.location.state === 'based') {
    const s = state.settlements[fs.location.settlement];
    if (s && s.owner === fs.owner && ok(s)) return s;
  }
  const home = homeSettlement(state, fs.owner);
  return home && ok(home) ? home : null;
};

const buildsWonder = (content: ContentBundle) => (s: Settlement): boolean =>
  s.production.item !== null && content.wonders.some((w) => w.id === s.production.item);
const buildsSomething = (s: Settlement): boolean => s.production.item !== null;

/** Best available military unit (GDD: free_unit): highest strength the player can field. */
export const bestMilitaryUnit = (state: GameState, player: PlayerId, content: ContentBundle): UnitDef | null => {
  const p = getPlayer(state, player);
  const ageIdx = (a: string): number => ['ancient', 'classical', 'exploration', 'modern'].indexOf(a);
  const ownedRes: Record<string, true> = {};
  for (const t of state.map.tiles) if (t.owner === player && t.resource) ownedRes[t.resource] = true;
  let best: UnitDef | null = null;
  let bestStr = -1;
  for (const u of content.units) {
    if (u.unitClass === 'civilian' || u.unitClass === 'commander' || u.unitClass === 'naval' || u.figureKind) continue;
    if (ageIdx(u.age) > ageIdx(state.age)) continue;
    if (u.requiresTech && !p.techs.includes(u.requiresTech)) continue;
    if (u.requiresResource && !ownedRes[u.requiresResource]) continue;
    const str = Math.max(u.strength, u.rangedStrength ?? 0);
    if (str > bestStr) {
      best = u;
      bestStr = str;
    }
  }
  return best;
};

export const activateError = (state: GameState, player: PlayerId, id: FigureId, content: ContentBundle): string | null => {
  const o = ownedFigure(state, player, id, content);
  if (typeof o === 'string') return o;
  const act = o.def.activate;
  if (!act || !o.def.uses.includes('activate')) return `${o.def.name} has no great deed to perform.`;
  if (!isActivateEffect(act.effect)) return `${o.def.name}'s deed cannot be performed.`;
  if (!isActive(o.fs)) return `${o.def.name} is no longer active.`;
  switch (act.effect) {
    case 'rush_wonder':
      return effectSettlement(state, o.fs, buildsWonder(content)) ? null : 'No wonder is being built; start one first.';
    case 'production_burst':
      return effectSettlement(state, o.fs, buildsSomething) ? null : 'Nothing is being built; choose something to build first.';
    case 'grow_city':
    case 'explore_reveal':
      return homeSettlement(state, player) ? null : 'You need a settlement first.';
    case 'free_unit':
      if (!homeSettlement(state, player)) return 'You need a settlement first.';
      return bestMilitaryUnit(state, player, content) ? null : 'You have no military unit to raise yet.';
    default:
      return null;
  }
};

export const consumeError = (state: GameState, player: PlayerId, id: FigureId, content: ContentBundle): string | null => {
  const o = ownedFigure(state, player, id, content);
  if (typeof o === 'string') return o;
  return isActive(o.fs) ? null : `${o.def.name} is no longer active.`;
};

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Take a figure off the map and out of the cabinet, ready for a terminal state. */
const leaveActiveDuty = (ctx: SimCtx, fs: FigureState): void => {
  if (fs.location.state === 'unit') {
    if (ctx.state.units[fs.location.unit]) removeUnit(ctx, fs.location.unit);
  }
  vacateSeat(ctx.state, fs);
};

const chooseOffer = (ctx: SimCtx, player: PlayerId, offerId: string, figureId: FigureId | null): string | null => {
  const { state, content } = ctx;
  const offer = state.offers.find((o) => o.id === offerId);
  if (!offer || offer.player !== player) return 'That offer is no longer open.';
  const p = getPlayer(state, player);

  if (figureId === null) {
    // Skip (GDD §4 step 4): points toward the next offer. A declined deed figure is lost.
    if (offer.source !== 'deed' && offer.source !== 'legend') {
      p.gp[offer.source] += K.SKIP_REFUND_SHARE * p.gpThreshold[offer.source];
    }
    dropOffer(state, offer.id, false);
    return null;
  }

  if (!offer.candidates.includes(figureId)) return 'That figure is not part of this offer.';
  const def = figureDef(content, figureId);
  if (!def) return 'That figure is not part of this offer.';
  const taken = state.figures[figureId];
  if (taken) {
    // Normally unreachable (recruiting clears rivals' offers), but stay safe.
    offer.candidates = offer.candidates.filter((c) => c !== figureId);
    delete offer.reasons[figureId];
    if (offer.candidates.length > 0) return `${def.name} has joined a rival.`;
    ctx.events.push({ type: 'figureJoinedRival', figure: figureId, player, rival: taken.owner });
    dropOffer(state, offer.id, true);
    return null;
  }

  const home = homeSettlement(state, player);
  if (!home) return 'You have no city to host them.';
  const reason = offer.reasons[figureId] ?? '';
  state.figures[figureId] = {
    id: figureId,
    owner: player,
    recruitedTurn: state.turn,
    recruitedAge: state.age,
    reason,
    activated: false,
    location: { state: 'based', settlement: home.id },
  };
  p.stats.figuresRecruited++;
  p.chronicle.push({
    turn: state.turn,
    age: state.age,
    kind: 'figure',
    ref: figureId,
    // Deed offers carry the deed's full story beat as their reason; name the deed instead.
    // Annal voice: the Chronicle is read on any civ's tab, so no "you"/"us" (offer reasons
    // and deed descriptions are second person by design and are rephrased, not copied).
    text: offer.deed
      ? `${def.name} joined the court after a deed: ${content.deeds.find((d) => d.id === offer.deed)?.name ?? 'a great deed'}.`
      : reason
        ? `${def.name} joined the court, ${annalVoice(reason)}.`
        : `${def.name} joined the court.`,
  });
  dropOffer(state, offer.id, false);
  ctx.events.push({ type: 'figureRecruited', figure: figureId, player });
  addAgeProgress(ctx, K.RECRUIT_AGE_PROGRESS);

  // Unique worldwide (GDD §3): pull the figure from every rival's open offer.
  for (const other of state.offers.slice()) {
    if (other.player === player || !other.candidates.includes(figureId)) continue;
    other.candidates = other.candidates.filter((c) => c !== figureId);
    delete other.reasons[figureId];
    ctx.events.push({ type: 'figureJoinedRival', figure: figureId, player: other.player, rival: player });
    if (other.candidates.length === 0) dropOffer(state, other.id, true);
  }
  return null;
};

const seat = (ctx: SimCtx, player: PlayerId, id: FigureId, key: string): string | null => {
  const err = seatError(ctx.state, player, id, key, ctx.content);
  if (err) return err;
  const p = getPlayer(ctx.state, player);
  const fs = ctx.state.figures[id] as FigureState;
  p.cabinet[key] = id;
  fs.location = { state: 'seated', slot: key };
  return null;
};

const unseat = (ctx: SimCtx, player: PlayerId, id: FigureId): string | null => {
  const err = unseatError(ctx.state, player, id, ctx.content);
  if (err) return err;
  const p = getPlayer(ctx.state, player);
  const fs = ctx.state.figures[id] as FigureState;
  if (fs.location.state === 'seated') p.cabinetCooldown[fs.location.slot] = ctx.state.turn + K.CABINET_COOLDOWN_TURNS;
  vacateSeat(ctx.state, fs);
  baseAtHome(ctx.state, fs);
  return null;
};

const deploy = (ctx: SimCtx, player: PlayerId, id: FigureId, settlement: SettlementId): string | null => {
  const err = deployError(ctx.state, player, id, settlement, ctx.content);
  if (err) return err;
  const fs = ctx.state.figures[id] as FigureState;
  const unitDef = figureUnitDef(ctx.content, figureDef(ctx.content, id) as Figure) as UnitDef;
  const s = ctx.state.settlements[settlement] as Settlement;
  const unit = spawnUnit(ctx, player, unitDef.id, s.at, id);
  if (!unit) return 'There is no free tile around that city to muster them.';
  fs.location = { state: 'unit', unit };
  return null;
};

const recall = (ctx: SimCtx, player: PlayerId, id: FigureId): string | null => {
  const err = recallError(ctx.state, player, id, ctx.content);
  if (err) return err;
  const fs = ctx.state.figures[id] as FigureState;
  const target = recallTarget(ctx.state, player, fs) as Settlement;
  if (fs.location.state === 'unit') removeUnit(ctx, fs.location.unit);
  fs.location = { state: 'based', settlement: target.id };
  return null;
};

const applyActivateEffect = (ctx: SimCtx, player: PlayerId, fs: FigureState, def: Figure, effect: ActivateEffect): void => {
  const { state, content } = ctx;
  const p = getPlayer(state, player);
  const amount = amountOf(def, effect);
  switch (effect) {
    case 'rush_wonder': {
      const s = effectSettlement(state, fs, buildsWonder(content)) as Settlement;
      const w = content.wonders.find((x) => x.id === s.production.item);
      if (w) {
        const cost = applyCostPercent(w.cost, costPercent(playerModifiers(state, player, content), 'wonder'));
        s.production.progress += Math.round((cost * amount) / 100);
      }
      return;
    }
    case 'production_burst': {
      const s = effectSettlement(state, fs, buildsSomething) as Settlement;
      s.production.progress += amount;
      return;
    }
    case 'culture_burst':
      p.stock.culture += amount;
      return;
    case 'science_burst':
      p.stock.science += amount;
      return;
    case 'gold_burst':
      p.stock.gold += amount;
      return;
    case 'faith_burst':
      p.stock.faith += amount;
      return;
    case 'influence_burst':
      p.stock.influence += amount;
      return;
    case 'explore_reveal': {
      const centers = [
        ...Object.values(state.settlements).filter((s) => s.owner === player).map((s) => s.at),
        ...Object.values(state.units).filter((u) => u.owner === player).map((u) => u.at),
      ];
      for (const c of centers) {
        for (const h of hexesInRange(c, amount)) {
          const i = tileIndex(state, h);
          if (i >= 0 && i < p.explored.length) p.explored[i] = 1;
        }
      }
      return;
    }
    case 'free_unit': {
      const home = homeSettlement(state, player) as Settlement;
      const u = bestMilitaryUnit(state, player, content) as UnitDef;
      for (let i = 0; i < amount; i++) spawnUnit(ctx, player, u.id, home.at, null);
      return;
    }
    case 'heal_units':
      for (const id of Object.keys(state.units)) {
        const u = state.units[id];
        if (u && u.owner === player) u.hp = Math.min(K.MAX_UNIT_HP, u.hp + amount);
      }
      return;
    case 'grow_city': {
      const s = effectSettlement(state, fs, () => true) as Settlement;
      s.population += amount;
      return;
    }
  }
};

const activate = (ctx: SimCtx, player: PlayerId, id: FigureId): string | null => {
  const err = activateError(ctx.state, player, id, ctx.content);
  if (err) return err;
  const { state } = ctx;
  const fs = state.figures[id] as FigureState;
  const def = figureDef(ctx.content, id) as Figure;
  const effect = def.activate?.effect as ActivateEffect;
  // Apply while the figure still stands where it is (its city is the effect's target).
  applyActivateEffect(ctx, player, fs, def, effect);
  leaveActiveDuty(ctx, fs);
  fs.location = { state: 'retired' };
  fs.activated = true;
  const p = getPlayer(state, player);
  p.stats.figuresActivated++;
  ctx.events.push({ type: 'figureRetired', figure: id, player });
  p.chronicle.push({ turn: state.turn, age: state.age, kind: 'figure', ref: id, text: `${def.name} performed a great deed and retired to the Hall of Ancestors.` });
  return null;
};

const consume = (ctx: SimCtx, player: PlayerId, id: FigureId, as: 'refinement' | 'yields'): string | null => {
  const err = consumeError(ctx.state, player, id, ctx.content);
  if (err) return err;
  const { state } = ctx;
  const fs = state.figures[id] as FigureState;
  const def = figureDef(ctx.content, id) as Figure;
  const p = getPlayer(state, player);
  leaveActiveDuty(ctx, fs);
  fs.location = { state: 'consumed' };
  if (as === 'refinement') {
    p.refinementPoints += def.consumeValue;
  } else {
    p.effects.push({
      source: `consume:${id}`,
      untilTurn: state.turn + K.CONSUME_BURST_TURNS - 1,
      modifiers: [
        {
          scope: 'empire',
          effect: { kind: 'yield', yield: K.MAIN_YIELD[def.kind], add: def.consumeValue * K.CONSUME_BURST_PER_VALUE },
        },
      ],
    });
  }
  return null;
};

export const handleFigureCommand = (ctx: SimCtx, player: PlayerId, command: Command): string | null => {
  const c = command as FigureCommand;
  switch (c.type) {
    case 'chooseOffer':
      return chooseOffer(ctx, player, c.offer, c.figure);
    case 'seatFigure':
      return seat(ctx, player, c.figure, c.slot);
    case 'unseatFigure':
      return unseat(ctx, player, c.figure);
    case 'deployFigure':
      return deploy(ctx, player, c.figure, c.settlement);
    case 'recallFigure':
      return recall(ctx, player, c.figure);
    case 'activateFigure':
      return activate(ctx, player, c.figure);
    case 'consumeFigure':
      return consume(ctx, player, c.figure, c.as);
    default:
      return 'That action is not recognized.';
  }
};
