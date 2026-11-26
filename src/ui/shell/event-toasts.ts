/**
 * Translates SimEvents into toasts and renderer flashes for the human player. Pure: names come
 * in through `EventNames` (built from content + the latest snapshot by app-wiring.ts), so this
 * runs in Node tests. Events about other players are shown only when the human should know
 * (world news like wonders, wars, crises, eliminations); never anything affinity-derived.
 */
import type { Hex } from '@contracts/hex';
import type { GameState, PlayerId, SimEvent } from '@contracts/sim-api';
import type { Modal, Toast } from '../store';

export interface ToastSpec {
  text: string;
  tone: Toast['tone'];
  action: Modal | null;
  /** Where it happened: tapping the toast centers the map there. */
  at?: Hex;
  /** A threat to answer now (ticker.ts isThreat): a prominent slip instead of a ticker line. */
  threat?: boolean;
  /** A culture whisper (GDD §4 "hidden affinity"): "Your people" lists these as the voices that reached you. */
  whisper?: boolean;
  /**
   * Never folded under "+N more updates" (wave 11: a raider warning and a lost wonder race hid
   * there). Ranked with the rest, but always shown.
   */
  keep?: boolean;
}

export interface EventNames {
  owner(id: PlayerId): string;
  figure(id: string): string;
  settlement(id: string): { name: string; owner: PlayerId; at?: Hex } | null;
  /** Unit, building or wonder (one shared namespace). */
  item(id: string): string;
  research(id: string): string;
  /** `${milestoneId}:${tier}` -> player-facing description. */
  milestone(key: string): string;
  crisis(id: string): string;
  deed(id: string): string;
  /** Display name of a unit by id (it may have died: look in the previous snapshot too). */
  unit?(id: string): string | null;
  /** Name of the settlement standing on a hex, if any (walls hit in combat name their city). */
  settlementAt?(hex: Hex): string | null;
  /**
   * Name of a unit of `owner` that stood on a hex before this snapshot. A civilian captured in
   * combat arrives with `defender: null`, like walls (playtest 4: lost scouts and merchants were
   * reported as "our walls were breached").
   */
  unitAt?(hex: Hex, owner: PlayerId): string | null;
  /** Name of `owner`'s settlement nearest to a hex ("captured near Gadir"). */
  nearestSettlement?(hex: Hex, owner: PlayerId): string | null;
  /** Item a settlement is producing in this snapshot (a queued follow-on that just started). */
  producing?(settlement: string): string | null;
  /** Why a new settlement has its name ("Named in the Iberian fashion, your strongest strand."). */
  namingLine?(settlement: string): string | null;
}

/** "Raiders’ warrior", "Rome’s warrior". */
export const possessive = (name: string): string => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

/** Combat seen by the human: what happened to our unit (or walls), in plain words. */
const combatToast = (ev: Extract<SimEvent, { type: 'combat' }>, me: PlayerId, n: EventNames): ToastSpec | null => {
  const unitName = (id: string | null): string => (id ? (n.unit?.(id) ?? 'unit') : 'walls');
  if (ev.capturedUnitDef && !ev.defender) {
    // A civilian seized without a fight (wave 11: say what and where, from the event itself).
    const what = n.item(ev.capturedUnitDef);
    if (ev.defenderOwner === me) {
      const near = n.nearestSettlement?.(ev.at, me) ?? null;
      return { text: `${n.owner(ev.attackerOwner)} captured our ${what}${near ? ` near ${near}` : ''}.`, tone: 'bad', action: null, at: ev.at };
    }
    if (ev.attackerOwner === me) return { text: `We captured ${possessive(n.owner(ev.defenderOwner))} ${what}.`, tone: 'good', action: null, at: ev.at };
    return null;
  }
  if (ev.attackerOwner === me) {
    const target = `${possessive(n.owner(ev.defenderOwner))} ${ev.defender ? unitName(ev.defender) : 'walls'}`;
    const plural = !ev.defender; // "walls"
    const result = ev.defenderDied
      ? `${target} ${plural ? 'were breached' : 'was destroyed'}`
      : `${target} lost ${Math.round(ev.damageToDefender)} HP`;
    const cost = ev.attackerDied ? `; our ${unitName(ev.attacker)} fell` : ev.damageToAttacker > 0 ? `; our ${unitName(ev.attacker)} lost ${Math.round(ev.damageToAttacker)} HP` : '';
    return { text: `${result}${cost}.`, tone: ev.attackerDied ? 'bad' : 'good', action: null, at: ev.at };
  }
  if (ev.defenderOwner === me) {
    // "Raiders attacked: our walls were breached" did not say where (playtest 4): name the city.
    const city = ev.defender ? null : (n.settlementAt?.(ev.at) ?? null);
    const civilian = !ev.defender && !city ? (n.unitAt?.(ev.at, me) ?? null) : null;
    if (civilian) return { text: `${n.owner(ev.attackerOwner)} captured our ${civilian}.`, tone: 'bad', action: null, at: ev.at };
    const ours = ev.defender ? `our ${unitName(ev.defender)}` : city ? `the walls of ${city}` : 'our walls';
    const what = ev.defenderDied
      ? `${ours} ${ev.defender ? 'was destroyed' : 'were breached'}`
      : `${ours} lost ${Math.round(ev.damageToDefender)} HP`;
    const back = ev.attackerDied ? ' The attacker fell.' : '';
    return { text: `${n.owner(ev.attackerOwner)} attacked: ${what}.${back}`, tone: 'bad', action: null, at: ev.at };
  }
  return null;
};

/**
 * Several attacks on us by one attacker in one batch become one threat line ("The Conqueror's
 * people attacked 4 times: a Warrior band destroyed, 3 units hurt.") instead of a stack of
 * near-identical slips (playtest 4: five slips in one turn of war). Returns the summary toasts
 * and the attacks they replace; groups of one or two keep their own sentences. Pure.
 */
export const summarizeAttacks = (
  events: readonly SimEvent[],
  me: PlayerId,
  n: EventNames,
  min = 3,
): { summaries: ToastSpec[]; folded: Set<SimEvent> } => {
  const by = new Map<string, Extract<SimEvent, { type: 'combat' }>[]>();
  for (const ev of events) {
    if (ev.type !== 'combat' || ev.defenderOwner !== me || ev.attackerOwner === me) continue;
    const list = by.get(ev.attackerOwner) ?? [];
    list.push(ev);
    by.set(ev.attackerOwner, list);
  }
  const summaries: ToastSpec[] = [];
  const folded = new Set<SimEvent>();
  for (const [owner, list] of by) {
    if (list.length < min) continue;
    const lost = list.filter((e) => e.defender && e.defenderDied).map((e) => (e.defender ? (n.unit?.(e.defender) ?? 'unit') : 'unit'));
    const noUnit = list.filter((e) => !e.defender);
    const wallCities = noUnit.map((e) => n.settlementAt?.(e.at) ?? null).filter((x): x is string => !!x);
    const walls = wallCities.length;
    const cities = [...new Set(wallCities)];
    const taken = noUnit.length - walls;
    const hurt = list.length - lost.length - noUnit.length;
    const parts: string[] = [];
    if (lost.length === 1) parts.push(`${/^[aeiou]/i.test(lost[0] ?? '') ? 'an' : 'a'} ${lost[0]} destroyed`);
    else if (lost.length > 1) parts.push(`${lost.length} units destroyed`);
    if (hurt > 0) parts.push(`${hurt} ${hurt === 1 ? 'unit' : 'units'} hurt`);
    const whose = cities.length === 1 ? `the walls of ${cities[0]}` : 'walls';
    if (walls > 0) parts.push(walls === 1 ? `${whose} struck` : `${whose} struck ${walls} times`);
    if (taken > 0) parts.push(taken === 1 ? 'a civilian captured' : `${taken} civilians captured`);
    const last = list[list.length - 1];
    const who = n.owner(owner);
    const text = `${who.charAt(0).toUpperCase()}${who.slice(1)} attacked ${list.length} times: ${parts.join(', ')}.`;
    summaries.push({ text, tone: 'bad', action: null, ...(last ? { at: last.at } : {}) });
    for (const e of list) folded.add(e);
  }
  return { summaries, folded };
};

/** A toast is a sentence: civ names are stored lower-case ("the Norse Thing declared war"). */
export const eventToToast = (ev: SimEvent, me: PlayerId, n: EventNames): ToastSpec | null => {
  const t = eventToToastRaw(ev, me, n);
  return t && t.text ? { ...t, text: t.text.charAt(0).toUpperCase() + t.text.slice(1) } : t;
};

const eventToToastRaw = (ev: SimEvent, me: PlayerId, n: EventNames): ToastSpec | null => {
  switch (ev.type) {
    case 'combat':
      return combatToast(ev, me, n);
    case 'cultureHint':
      // Tapping a whisper opens "Your people", where it joins the voices that shaped you: the
      // feedback loop from play to identity (playtest 4: whispers scrolled past unexplained).
      return ev.player === me ? { text: ev.text, tone: 'culture', action: { kind: 'people' }, whisper: true } : null;
    case 'offerCreated':
      return ev.player === me
        ? { text: 'Someone famous wants to join you.', tone: 'culture', action: { kind: 'offer', offer: ev.offer } }
        : null;
    case 'figureRecruited':
      return ev.player === me
        ? { text: `${n.figure(ev.figure)} joined you.`, tone: 'good', action: { kind: 'figure', figure: ev.figure } }
        : null;
    case 'figureJoinedRival':
      // `player` is who lost the figure, `rival` who got them.
      return ev.player === me ? { text: `${n.figure(ev.figure)} joined a rival.`, tone: 'bad', action: null } : null;
    case 'figureCaptured':
      if (ev.to === me) return { text: `${n.figure(ev.figure)} is now with us.`, tone: 'good', action: { kind: 'figure', figure: ev.figure } };
      if (ev.from === me) return { text: `${n.figure(ev.figure)} was taken by ${n.owner(ev.to)}.`, tone: 'bad', action: null };
      return null;
    case 'researchCompleted':
      return ev.player === me
        ? { text: `${ev.tree === 'tech' ? 'Researched' : 'Adopted'} ${n.research(ev.id)}.`, tone: 'good', action: { kind: 'tree', tree: ev.tree } }
        : null;
    case 'productionCompleted': {
      if (ev.player !== me) return null;
      const s = n.settlement(ev.settlement);
      // A queued follow-on started at once: say so, so the line is not read as "pick something".
      const next = n.producing?.(ev.settlement) ?? null;
      return {
        text: next ? `${s?.name ?? 'A city'} finished ${n.item(ev.item)}; now building ${n.item(next)}.` : `${s?.name ?? 'A city'} finished ${n.item(ev.item)}.`,
        tone: 'good',
        action: { kind: 'city', settlement: ev.settlement },
      };
    }
    case 'wonderBuilt':
      return ev.player === me
        ? { text: `${n.item(ev.wonder)} is complete!`, tone: 'good', action: { kind: 'city', settlement: ev.settlement } }
        : { text: `${n.owner(ev.player)} built ${n.item(ev.wonder)}.`, tone: 'info', action: null };
    case 'settlementGrew': {
      const s = n.settlement(ev.settlement);
      return s && s.owner === me ? withAt({ text: `${s.name} grew to ${ev.population}.`, tone: 'info', action: null }, s.at) : null;
    }
    case 'settlementFounded': {
      // The founder saw it happen and rivals' foundings are not news, but the name needs its why
      // (wave 11: "Gadir" came from the heaviest culture with no word of explanation).
      if (ev.player !== me) return null;
      const st = n.settlement(ev.settlement);
      const why = n.namingLine?.(ev.settlement) ?? null;
      if (!st || !why) return null;
      return withAt({ text: `${st.name} was founded. ${why}`, tone: 'culture', action: { kind: 'city', settlement: ev.settlement } }, st.at);
    }
    case 'settlementCaptured': {
      const st = n.settlement(ev.settlement);
      const name = st?.name ?? 'A settlement';
      if (ev.to === me) return { text: `We took ${name}!`, tone: 'good', action: { kind: 'city', settlement: ev.settlement } };
      if (ev.from === me) return withAt({ text: `${name} fell to ${n.owner(ev.to)}.`, tone: 'bad', action: null }, st?.at);
      return null;
    }
    case 'warDeclared':
      if (ev.on === me) return { text: `${n.owner(ev.by)} declared war on us!`, tone: 'bad', action: { kind: 'diplomacy' } };
      if (ev.by === me) return { text: `We are at war with ${n.owner(ev.on)}.`, tone: 'bad', action: { kind: 'diplomacy' } };
      return { text: `${n.owner(ev.by)} declared war on ${n.owner(ev.on)}.`, tone: 'info', action: null };
    case 'peaceMade':
      if (ev.a === me || ev.b === me) {
        const other = ev.a === me ? ev.b : ev.a;
        return { text: `Peace with ${n.owner(other)}.`, tone: 'good', action: { kind: 'diplomacy' } };
      }
      return null;
    case 'milestoneReached':
      return ev.player === me ? { text: milestoneSentence(n.milestone(ev.milestone)), tone: 'good', action: { kind: 'legacy' } } : null;
    case 'crisisStarted':
      return { text: `Crisis: ${n.crisis(ev.crisis)} has begun.`, tone: 'bad', action: { kind: 'crisis' } };
    case 'crisisStage':
      return { text: `${n.crisis(ev.crisis)} deepens (stage ${ev.stage}).`, tone: 'bad', action: { kind: 'crisis' } };
    case 'deedCompleted':
      return ev.player === me
        ? { text: `Deed done: ${n.deed(ev.deed)}. ${n.figure(ev.figure)} takes notice.`, tone: 'culture', action: null }
        : { text: `${n.owner(ev.player)} achieved ${n.deed(ev.deed).replace(/^The /, 'the ')}.`, tone: 'info', action: null };
    case 'playerEliminated':
      return ev.player === me
        ? { text: 'Our people have been conquered.', tone: 'bad', action: null }
        : { text: `${n.owner(ev.player)} has fallen.`, tone: 'info', action: null };
    case 'notice':
      return ev.player === null || ev.player === me ? noticeToast(ev, n) : null;
    case 'tradeRouteOpened': {
      if (ev.player !== me) return null;
      const to = n.settlement(ev.to);
      return withAt({ text: `Trade route opened to ${to?.name ?? 'a far city'}: gold every turn.`, tone: 'good', action: null }, to?.at);
    }
    case 'suzerainChanged': {
      // Winning (or losing) a city-state's favor is the payoff of every envoy: say it.
      const cs = n.owner(`cs:${ev.cityState}`);
      if (ev.suzerain === me) return { text: `${cs} now looks to us: we are its suzerain.`, tone: 'good', action: { kind: 'diplomacy' } };
      if (ev.suzerain) return { text: `${n.owner(ev.suzerain)} is now suzerain of ${cs}.`, tone: 'info', action: { kind: 'diplomacy' } };
      return null;
    }
    case 'ageStarted':
      // Shown when the transition screen closes (toasts wait under full screens).
      return { text: `The ${AGE_WORD[ev.age]} age begins. New figures, new trees, a new meter.`, tone: 'culture', action: null };
    default:
      return null;
  }
};

/**
 * "Figures recruited: 3" (a legacy description) reads as a form field in a sentence; say it the
 * way a chronicler would: "Milestone reached: 3 figures recruited." Other shapes pass through.
 */
export const milestoneSentence = (desc: string): string => {
  const m = /^(.+?):\s*(\d+%?)$/.exec(desc.trim());
  if (!m || !m[1] || !m[2]) return `Milestone reached: ${desc.replace(/\.$/, '')}.`;
  const label = m[1].charAt(0).toLowerCase() + m[1].slice(1);
  return `Milestone reached: ${m[2]} ${label}.`;
};

/**
 * A notice, by its machine-readable `kind` when the sim gives one (wave 11 contract), else by
 * the old wording match. Pillage names the town and the gold lost; raider warnings and a lost
 * wonder race are always shown; first contact opens Nations.
 */
export const noticeToast = (ev: Extract<SimEvent, { type: 'notice' }>, n: EventNames): ToastSpec => {
  const st = ev.settlement ? n.settlement(ev.settlement) : null;
  const city = (t: ToastSpec): ToastSpec => withAt(t, st?.at);
  switch (ev.kind) {
    case 'pillaged': {
      const where = st?.name ?? null;
      const gold = ev.amount !== undefined && ev.amount > 0 ? Math.round(ev.amount) : null;
      // The sim's sentence wins when it already names both; otherwise say them ourselves.
      const says = (!where || ev.text.includes(where)) && (gold === null || ev.text.includes(`${gold} gold`));
      const text = says
        ? ev.text
        : `Raiders pillaged ${where ?? 'one of our towns'}${gold !== null ? ` and carried off ${gold} gold` : ''}. A garrison or walls would keep them out.`;
      return city({ text, tone: 'bad', action: null, keep: true });
    }
    case 'raiderWarning':
      return city({ text: ev.text, tone: 'bad', action: null, keep: true });
    case 'wonderLost':
      // Production may come back as progress elsewhere; the city needs a new pick, so open it.
      return city({ text: ev.text, tone: 'bad', action: ev.settlement ? { kind: 'city', settlement: ev.settlement } : null, keep: true });
    case 'wonderCarried':
      return city({ text: ev.text, tone: 'good', action: ev.settlement ? { kind: 'city', settlement: ev.settlement } : null });
    case 'treasury':
      return { text: ev.text, tone: 'bad', action: null, keep: true };
    case 'firstContact':
      return { text: ev.text, tone: 'culture', action: { kind: 'diplomacy' }, keep: true };
    case 'queueSkipped':
      return city({ text: ev.text, tone: 'info', action: ev.settlement ? { kind: 'city', settlement: ev.settlement } : null });
    case 'offerWithdrawn':
      return { text: ev.text, tone: 'info', action: null };
    default: {
      // No kind (older sim) or 'other': the wording fallback.
      const tone = noticeTone(ev.text);
      return { text: ev.text, tone, action: null, ...(tone === 'bad' ? { keep: true } : {}) };
    }
  }
};

/**
 * Notices are plain sentences from the sim. Raider warnings and pillage are losses the player can
 * still prevent, so they rank with the bad news instead of folding under "+N more updates"
 * (playtest 4: "Raiders are a day from Toletum" hid behind "Adopted Craftsmanship"). UI-side
 * wording match until notices carry a kind (proposal in the playtest report).
 */
export const noticeTone = (text: string): Toast['tone'] => (/\b(raiders?|pillag|no one guards)|by another people first/i.test(text) ? 'bad' : 'info');

/**
 * The same thing said twice in one batch ("Crisis: Collapse has begun", "Collapse deepens
 * (stage 1)") is one line: keeps the first toast per offer or crisis screen. Pure.
 */
export const dedupeByScreen = (specs: readonly ToastSpec[]): ToastSpec[] => {
  const seen = new Set<string>();
  return specs.filter((t) => {
    if (!t.action || (t.action.kind !== 'crisis' && t.action.kind !== 'offer')) return true;
    const k = JSON.stringify(t.action);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const AGE_WORD: Record<string, string> = { ancient: 'Ancient', classical: 'Classical', exploration: 'Exploration', modern: 'Modern' };

const withAt = (t: ToastSpec, at: Hex | undefined): ToastSpec => (at ? { ...t, at } : t);

export type FlashKindSpec = 'combat' | 'found' | 'capture' | 'recruit';

/** Where to flash the map for an event, if anywhere. Uses the snapshot that came with it. */
export const eventFlash = (ev: SimEvent, state: GameState): { hex: Hex; kind: FlashKindSpec } | null => {
  switch (ev.type) {
    case 'combat':
      return { hex: ev.at, kind: 'combat' };
    case 'settlementFounded': {
      const s = state.settlements[ev.settlement];
      return s ? { hex: s.at, kind: 'found' } : null;
    }
    case 'settlementCaptured': {
      const s = state.settlements[ev.settlement];
      return s ? { hex: s.at, kind: 'capture' } : null;
    }
    case 'figureRecruited': {
      const f = state.figures[ev.figure];
      const loc = f?.location;
      if (loc?.state === 'based') {
        const s = state.settlements[loc.settlement];
        return s ? { hex: s.at, kind: 'recruit' } : null;
      }
      if (loc?.state === 'unit') {
        const u = state.units[loc.unit];
        return u ? { hex: u.at, kind: 'recruit' } : null;
      }
      return null;
    }
    default:
      return null;
  }
};

/** How long a toast stays up. Culture hints are the emotional beat; give them time. */
export const toastDuration = (tone: Toast['tone']): number => (tone === 'culture' ? 8000 : tone === 'bad' ? 6000 : 4000);

/**
 * Importance of a toast, lower = more important. Threats you must act on first (war on us, a
 * crisis), then a figure waiting for an answer, then other losses, culture hints, our successes,
 * world news last.
 */
export const toastPriority = (t: ToastSpec): number => {
  if (t.threat) return -1;
  if (t.tone === 'bad' && t.action) return 0;
  if (t.tone === 'culture' && t.action) return 1;
  if (t.tone === 'bad') return 2;
  if (t.tone === 'culture') return 3;
  if (t.tone === 'good' && t.action) return 4;
  if (t.tone === 'good') return 5;
  return 6;
};

/** At most this many ticker lines per batch (threats are never folded away). */
export const MAX_TOASTS = 3;

/**
 * Orders one batch of toasts (e.g. everything that happened since the player's last turn) by
 * importance, keeping arrival order within a level, and folds the overflow into one summary line
 * so a busy turn start is not a wall of banners. Pure.
 */
export const rankToasts = (specs: readonly ToastSpec[], max: number = MAX_TOASTS): ToastSpec[] => {
  // Two toasts that open the same screen say the same thing ("crisis began", "stage 1"): keep the first.
  const sorted = dedupeByScreen(specs)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => toastPriority(a.t) - toastPriority(b.t) || a.i - b.i)
    .map((x) => x.t);
  const threats = sorted.filter((t) => t.threat);
  const news = sorted.filter((t) => !t.threat);
  if (news.length <= max) return [...threats, ...news];
  // Kept news is never folded; it takes slots first, the rest fill what is left.
  let room = Math.max(0, max - 1 - news.filter((t) => t.keep).length);
  const shown = news.filter((t) => t.keep || room-- > 0);
  const rest = news.length - shown.length;
  if (rest === 0) return [...threats, ...shown];
  return [...threats, ...shown, { text: `+${rest} more ${rest === 1 ? 'update' : 'updates'} this turn.`, tone: 'info', action: { kind: 'log' } }];
};

/** Two modals are "the same place" for a toast's purposes (opening one answers the toast). */
export const sameModal = (a: Modal, b: Modal): boolean => JSON.stringify(a) === JSON.stringify(b);
