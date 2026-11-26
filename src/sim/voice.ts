/**
 * Rivals as characters (GDD §9 "Personality = leader + agendas"): each rival civilization has
 * a posture toward the human player, read from its leader archetype, and speaks in short
 * diplomatic messages (`notice` events) on a few occasions — first contact, borders touching,
 * war, peace, a figure who chose the human's court over theirs, and wonders. Messages are in
 * the rival's own voice: no ids, numbers or game jargon. The AI (src/ai) reads the same
 * posture so that what a rival says and what it does agree.
 *
 * Sparse by design: only AI → human, and only once per occasion (each occasion is a one-time
 * transition the sim can detect exactly).
 */
import type { ContentBundle } from '@contracts/content-schemas';
import { hexNeighbors } from '@contracts/hex';
import { warKey, type GameState, type PlayerId, type Settlement } from '@contracts/sim-api';
import { WAR_INTENT_SOURCE, WAR_WARNING_SOURCE, WAR_WARNING_TURNS } from './constants';
import type { SimCtx } from './ctx';
import { capitalOf, tileAt, tileIndex } from './lookup';
import { visibleTileSet } from './units';

export type Posture = 'aggressor' | 'rival' | 'trader' | 'wary';

/**
 * Posture from the leader's agenda bias (content/leaders.json `aiAgendaBias`), first match:
 * a warmonger is an aggressor; a collector-opportunist or an expansionist is a rival who
 * races you for land and city-states; a seafarer or opportunist is a friendly trader; the
 * rest (builders, scholars, zealots) are wary neighbours.
 */
export const postureOfBias = (bias: readonly string[]): Posture => {
  const has = (a: string): boolean => bias.includes(a);
  if (has('warmonger')) return 'aggressor';
  if ((has('collector') && has('opportunist')) || (has('expansionist') && !has('seafarer'))) return 'rival';
  if (has('seafarer') || has('opportunist')) return 'trader';
  return 'wary';
};

export const posture = (state: GameState, player: PlayerId, content: ContentBundle): Posture => {
  const leader = content.leaders.find((l) => l.id === state.players[player]?.leader);
  return postureOfBias(leader?.aiAgendaBias ?? []);
};

/** "The Conqueror of the Steppe Pax", or before naming "The Conqueror of Avarga". */
export const speakerName = (state: GameState, player: PlayerId, content: ContentBundle): string => {
  const p = state.players[player];
  const leader = content.leaders.find((l) => l.id === p?.leader)?.name ?? 'The ruler';
  // Civ names are proposed as "the Andalusian Pax" but may be typed without the article.
  if (p?.civName) return `${leader} of ${/^the /i.test(p.civName) ? `the ${p.civName.slice(4)}` : `the ${p.civName}`}`;
  const cap = capitalOf(state, player);
  return cap ? `${leader} of ${cap.name}` : leader;
};

export type Occasion =
  | 'contact'
  | 'borders'
  | 'warWarning'
  | 'standDown'
  | 'appeased'
  | 'warOnYou'
  | 'warByYou'
  | 'peace'
  | 'figureWanted'
  | 'wonderTheirs'
  | 'wonderYours';

/**
 * Occasions about war itself. Wave 13: the others (greetings, borders, wonders, figures) are
 * friendly or neutral small talk and are not spoken while the two are at war or the speaker
 * has threatened war ("Our borders meet. Good neighbours make good markets." came the turn
 * after that trader declared war).
 */
const WAR_OCCASIONS: ReadonlySet<Occasion> = new Set<Occasion>(['warWarning', 'standDown', 'appeased', 'warOnYou', 'warByYou', 'peace']);

/** `{f}` = a figure's name, `{w}` = a wonder's name, `{c}` = a city name. */
export const VOICE: Record<Occasion, Record<Posture, string>> = {
  contact: {
    aggressor: 'Our scouts have seen your lands. Mind your borders, and we shall mind ours, for now.',
    rival: 'So there are others under this sky. We shall see which of us the world remembers.',
    trader: 'Welcome, neighbours! Our caravans would gladly visit your markets.',
    wary: 'We have seen your people on the horizon. We wish you peace, from a distance.',
  },
  borders: {
    aggressor: 'Your borders press against ours. Land belongs to those strong enough to hold it.',
    rival: 'Our borders touch. Settle wisely; every valley you claim is one we wanted.',
    trader: 'Our borders meet. Good neighbours make good markets.',
    wary: 'Your borders now touch ours. We will build our walls a little higher.',
  },
  // Wave 13 (src/sim/war-intent.ts): a threat names the city it wants ({c}), hints at the
  // grievance, and says how to answer it — guard the city, or send gifts (tribute).
  warWarning: {
    aggressor: '{c} lies open and your soldiers are few. Guard it well, or send us gifts worthy of a king, for soon our spears come for it.',
    rival: 'You have grown too fast, and {c} stands on land that should be ours. Garrison it, or pay us to look elsewhere. We will not ask twice.',
    trader: 'Your markets grow fat while ours go hungry, and {c} is the fattest. Pay what you owe us, or we will come and collect it ourselves.',
    wary: 'Your soldiers gather too close to our walls. Give us cause to trust you, gifts or a quiet border, or we strike {c} before you strike us.',
  },
  standDown: {
    aggressor: 'Your walls at {c} have grown teeth. We will wait for a better day.',
    rival: '{c} is well guarded. Another time, then.',
    trader: 'Cooler heads have prevailed. Let the caravans run, and let {c} keep its gold.',
    wary: 'We see you mean us no harm. We stand down, for now.',
  },
  appeased: {
    aggressor: 'Your gifts are accepted. {c} may sleep easy, for now.',
    rival: 'A wise payment. {c} is yours, for now.',
    trader: 'The debt is settled. Our caravans will visit {c} as friends.',
    wary: 'Your gifts speak for you. We will keep our soldiers home.',
  },
  warOnYou: {
    aggressor: 'Words are over. Our armies march on your lands.',
    rival: 'You have grown too fast for our liking. Let the field decide between us.',
    trader: 'You leave us no choice. Our caravans will carry soldiers now.',
    wary: 'We tried to keep our distance. Now we must strike before you strike us.',
  },
  warByYou: {
    aggressor: 'At last, an honest enemy. We will meet you in the field.',
    rival: 'So it comes to war. History will remember who struck first.',
    trader: 'You would trade blows instead of goods? Then you will pay dearly for them.',
    wary: 'We feared this day. Our walls are ready.',
  },
  peace: {
    aggressor: 'We lay down our spears, for now. Do not mistake this for weakness.',
    rival: 'Let there be peace. The contest between us will go on by other means.',
    trader: 'Peace at last. Let the caravans run again.',
    wary: 'Peace, then. May our borders stay quiet.',
  },
  figureWanted: {
    aggressor: '{f} chose your court over ours. We will remember it.',
    rival: '{f} chose your court over ours. Enjoy the company while it lasts.',
    trader: '{f} chose your court over ours. A loss for us, and a fine bargain for you.',
    wary: '{f} chose your court over ours. We wish them well among you.',
  },
  wonderTheirs: {
    aggressor: '{w} now stands in {c}. Let it remind you of what we can build, and what we can tear down.',
    rival: '{w} now stands in {c}. Let the world compare it with anything you can raise.',
    trader: '{w} now stands in {c}. Come and see it; our gates are open to merchants.',
    wary: '{w} now stands in {c}. We built it to last, as we intend to.',
  },
  wonderYours: {
    aggressor: 'So you have raised {w}. Stone does not stop soldiers.',
    rival: '{w} is impressive. We will build something greater.',
    trader: '{w}! Our merchants already ask when they may visit.',
    wary: 'We hear of {w}. You are clearly here to stay.',
  },
};

export const voiceText = (
  state: GameState,
  speaker: PlayerId,
  occasion: Occasion,
  content: ContentBundle,
  vars: { f?: string; w?: string; c?: string } = {},
): string => {
  const line = VOICE[occasion][posture(state, speaker, content)]
    .replace('{f}', vars.f ?? '')
    .replace('{w}', vars.w ?? '')
    .replace('{c}', vars.c ?? 'your city');
  return `${speakerName(state, speaker, content)}: “${line}”`;
};

/** True while some human player is alive (voice work is skipped in AI-only games). */
export const hasHuman = (state: GameState): boolean => state.playerOrder.some((id) => isHuman(state, id));

const isAi = (state: GameState, id: PlayerId): boolean => state.players[id]?.alive === true && state.players[id]?.isHuman === false;
const isHuman = (state: GameState, id: PlayerId): boolean => state.players[id]?.alive === true && state.players[id]?.isHuman === true;

/**
 * A warning was spoken: `ai` will not declare war on `human` for WAR_WARNING_TURNS (by
 * difficulty), so the warning gives the human time to answer it (walls, a garrison, a deal).
 */
const holdWar = (state: GameState, ai: PlayerId, human: PlayerId): void => {
  const p = state.players[ai];
  if (!p) return;
  const source = WAR_WARNING_SOURCE + human;
  const until = state.turn + (WAR_WARNING_TURNS[state.difficulty] ?? WAR_WARNING_TURNS.normal);
  p.effects = p.effects.filter((e) => e.source !== source);
  p.effects.push({ source, untilTurn: until, modifiers: [] });
};

/** True while `ai` is still holding back after warning `human` (see `holdWar`). */
export const warHeldBack = (state: GameState, ai: PlayerId, human: PlayerId): boolean =>
  state.players[ai]?.effects.some((e) => e.source === WAR_WARNING_SOURCE + human && e.untilTurn >= state.turn) === true;

/** True while `ai` has threatened `human` with war (an open intent, src/sim/war-intent.ts). */
const threatening = (state: GameState, ai: PlayerId, human: PlayerId): boolean =>
  state.players[ai]?.effects.some((e) => e.source.startsWith(`${WAR_INTENT_SOURCE}${human}:`)) === true;

/**
 * Send a message from an AI civ to a human player (no-op for any other pair). `extra` adds
 * the notice's optional fields (a war warning names its objective and the turns left).
 */
export const speak = (
  ctx: SimCtx,
  speaker: PlayerId,
  listener: PlayerId,
  occasion: Occasion,
  vars: { f?: string; w?: string; c?: string } = {},
  extra: { settlement?: string; amount?: number } = {},
): void => {
  const { state } = ctx;
  if (!isAi(state, speaker) || !isHuman(state, listener)) return;
  if (occasion === 'contact' || occasion === 'borders') holdWar(state, speaker, listener);
  if (!WAR_OCCASIONS.has(occasion)) {
    // Wave 13: no small talk with someone you are fighting or have just threatened.
    if (state.wars[warKey(speaker, listener)] !== undefined || threatening(state, speaker, listener)) return;
    // Wave 13: a people the human has never met does not remark on their court (unmet leak).
    // (Touching borders is a meeting in itself.)
    if (occasion !== 'contact' && occasion !== 'borders' && !contactsOf(state, listener)[speaker]) return;
  }
  const text = voiceText(state, speaker, occasion, ctx.content, vars);
  // First contact is the one voiced occasion the UI ranks on its own ('firstContact'). Threat
  // lines carry kind 'other' plus the named city (`settlement`) and, for a warning, the turns
  // left (`amount`). TODO(contracts): a 'warWarning' NoticeKind and the speaker's id.
  const threat = occasion === 'warWarning' || occasion === 'standDown' || occasion === 'appeased';
  ctx.events.push(
    occasion === 'contact'
      ? { type: 'notice', player: listener, kind: 'firstContact', text }
      : threat
        ? { type: 'notice', player: listener, kind: 'other', text, ...extra }
        : { type: 'notice', player: listener, text },
  );
};

/**
 * A wonder was completed in `s`. An AI builder tells every human it has met; when a human
 * built it, one rival who has met them (the first in turn order with a competitive posture)
 * comments.
 */
export const announceWonder = (ctx: SimCtx, s: Settlement, wonder: string): void => {
  const { state, content } = ctx;
  if (!hasHuman(state)) return;
  const builder = s.owner;
  if (isAi(state, builder)) {
    for (const h of state.playerOrder) {
      if (isHuman(state, h) && contactsOf(state, h)[builder]) speak(ctx, builder, h, 'wonderTheirs', { w: wonder, c: s.name });
    }
    return;
  }
  if (!isHuman(state, builder)) return;
  const known = contactsOf(state, builder);
  const critic = state.playerOrder.find((id) => isAi(state, id) && known[id] && ['rival', 'aggressor'].includes(posture(state, id, content)));
  if (critic) speak(ctx, critic, builder, 'wonderYours', { w: wonder });
};

// --- Contact and borders (one-time transitions) ------------------------------------

/**
 * `TimedEffect.source` prefix remembering that a player has seen another player's units
 * (modifier-free; lasts the whole game). Land contact needs no memory: explored tiles stay
 * explored.
 */
export const MET_SOURCE = 'met:';
/** Contact markers never lapse (the age-end sweep only drops effects with untilTurn −1). */
const MET_UNTIL = Number.MAX_SAFE_INTEGER;

/** Players whose land `player` has explored at least one tile of, or whose units they have seen. */
export const contactsOf = (state: GameState, player: PlayerId): Record<PlayerId, true> => {
  const out: Record<PlayerId, true> = {};
  const p = state.players[player];
  const explored = p?.explored;
  if (!p || !explored) return out;
  const tiles = state.map.tiles;
  for (let i = 0; i < tiles.length; i++) {
    const owner = tiles[i]?.owner;
    if (owner && owner !== player && explored[i] && state.players[owner]) out[owner] = true;
  }
  for (const e of p.effects) {
    if (!e.source.startsWith(MET_SOURCE)) continue;
    const other = e.source.slice(MET_SOURCE.length);
    if (state.players[other]) out[other] = true;
  }
  return out;
};

/**
 * Other players with a unit or settlement on a tile `player` sees right now (playtest 3: two
 * scouts could pass each other without a word, since contact needed explored land).
 */
export const sightings = (state: GameState, player: PlayerId, content: ContentBundle): Record<PlayerId, true> => {
  const out: Record<PlayerId, true> = {};
  const seen = new Set(visibleTileSet(state, player, content));
  for (const id of Object.keys(state.units)) {
    const u = state.units[id];
    if (!u || u.owner === player || !state.players[u.owner]) continue;
    if (seen.has(tileIndex(state.map, u.at))) out[u.owner] = true;
  }
  return out;
};

const remember = (state: GameState, player: PlayerId, other: PlayerId): void => {
  const p = state.players[player];
  if (!p || p.effects.some((e) => e.source === MET_SOURCE + other)) return;
  p.effects.push({ source: MET_SOURCE + other, untilTurn: MET_UNTIL, modifiers: [] });
};

/**
 * Call after `player` explored new tiles or moved units, with their contacts from before.
 * First contact — by land or by sighting each other's units — between an AI and a human
 * produces one message from the AI, unless the other side had already found them (then the
 * greeting was already sent). A sighting is remembered by both sides.
 */
export const greetNewContacts = (ctx: SimCtx, player: PlayerId, before: Record<PlayerId, true>): void => {
  const { state, content } = ctx;
  if (state.playerOrder.every((o) => o === player || before[o] || !state.players[o]?.alive)) return;
  const seen = sightings(state, player, content);
  const after = contactsOf(state, player);
  for (const other of state.playerOrder) {
    if (other === player || before[other] || !(after[other] || seen[other])) continue;
    const theyKnew = contactsOf(state, other)[player] === true;
    if (seen[other]) {
      remember(state, player, other);
      remember(state, other, player);
    }
    if (theyKnew) continue;
    if (isHuman(state, player)) speak(ctx, other, player, 'contact');
    else speak(ctx, player, other, 'contact');
  }
};

/** Owners of tiles adjacent to `player`'s tiles (other players only). */
export const borderNeighbours = (state: GameState, player: PlayerId): Record<PlayerId, true> => {
  const out: Record<PlayerId, true> = {};
  for (const t of state.map.tiles) {
    if (t.owner !== player) continue;
    for (const n of hexNeighbors(t)) {
      const o = tileAt(state.map, n)?.owner;
      if (o && o !== player && state.players[o]) out[o] = true;
    }
  }
  return out;
};

/** Call after `s` claimed tiles, with its owner's border neighbours from before the claim. */
export const noteBordersTouch = (ctx: SimCtx, s: Settlement, before: Record<PlayerId, true>): void => {
  const after = borderNeighbours(ctx.state, s.owner);
  for (const other of ctx.state.playerOrder) {
    if (!after[other] || before[other]) continue;
    if (isHuman(ctx.state, s.owner)) speak(ctx, other, s.owner, 'borders');
    else speak(ctx, s.owner, other, 'borders');
  }
};

/**
 * Is this notice text a war warning? (Tooling, scripts/lib/fun-audit.ts, and the UI until the
 * contract has a 'warWarning' notice kind.) Matches the fixed part of any posture's line.
 */
export const isWarWarningText = (text: string): boolean =>
  Object.values(VOICE.warWarning).some((line) => {
    const parts = line.split('{c}').filter((x) => x.length > 8);
    return parts.length > 0 && parts.every((x) => text.includes(x));
  });
