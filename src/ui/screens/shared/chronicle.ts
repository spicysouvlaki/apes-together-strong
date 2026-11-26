/**
 * Chronicle assembly (GDD §8: "your civ's name, banner, figures, traditions and hybrids by
 * age, each with a one-line history note"). Built from `player.chronicle` plus content. Pure.
 */
import { AGES, type Age, type ContentBundle } from '@contracts/content-schemas';
import type { ChronicleEntry, GameState, PlayerId } from '@contracts/sim-api';
import { annalVoice } from '../../../emergence/figures';

export interface ChronicleFigure {
  id: string;
  name: string;
  culture: string;
  kind: string;
  bio: string;
  /** "Thales joined the court, drawn by its rivers." (neutral annal voice, as the sim writes it) */
  text: string;
  turn: number;
}

export interface ChronicleNote {
  id: string;
  name: string;
  note: string;
  /** Culture ids (one for traditions, two for hybrids, wonders' tag). */
  cultures: string[];
  turn: number;
  tier?: string;
}

export interface ChronicleAge {
  age: Age;
  figures: ChronicleFigure[];
  traditions: ChronicleNote[];
  hybrids: ChronicleNote[];
  wonders: ChronicleNote[];
  /** `against` is the rival's player id when the entry names one. */
  wars: { text: string; turn: number; against: PlayerId | null }[];
  crises: { text: string; turn: number }[];
  /** Foundings, cities, names, deeds, age markers. */
  events: { text: string; turn: number; kind: ChronicleEntry['kind'] }[];
}

export interface ChronicleView {
  player: PlayerId;
  civName: string;
  leader: string;
  dream: { native: string; romanized: string; meaning: string; language: string } | null;
  colors: { primary: string; secondary: string };
  ages: ChronicleAge[];
  result: { rank: number; of: number; score: number; won: boolean } | null;
}

/**
 * How a figure arrived. Deed figures get the deed's name: their recorded reason is the deed's
 * full story sentence, which reads badly spliced into "X joined us, …" (the deed line itself
 * is already in the age's events).
 */
const arrivalText = (def: { name: string; deed?: string | undefined }, text: string, content: ContentBundle): string => {
  if (!def.deed) return text;
  const deed = content.deeds.find((d) => d.id === def.deed);
  return deed ? `${def.name} joined the court after a deed: ${deed.name}.` : `${def.name} joined the court.`;
};

const emptyAge = (age: Age): ChronicleAge => ({
  age,
  figures: [],
  traditions: [],
  hybrids: [],
  wonders: [],
  wars: [],
  crises: [],
  events: [],
});

export const buildChronicle = (state: GameState, player: PlayerId, content: ContentBundle): ChronicleView | null => {
  const p = state.players[player];
  if (!p) return null;
  const leader = content.leaders.find((l) => l.id === p.leader)?.name ?? 'A leader';
  const dream = content.dreams.find((d) => d.id === p.dream);
  const byAge: Partial<Record<Age, ChronicleAge>> = {};
  const ageOf = (a: Age): ChronicleAge => (byAge[a] ??= emptyAge(a));
  const seenFigures = new Set<string>();

  for (const e of p.chronicle) {
    const a = ageOf(e.age);
    switch (e.kind) {
      case 'figure': {
        if (seenFigures.has(e.ref)) break; // later lines (great deeds) are about the same person
        seenFigures.add(e.ref);
        const def = content.figures.find((f) => f.id === e.ref);
        if (!def) break;
        a.figures.push({ id: def.id, name: def.name, culture: def.culture, kind: def.kind, bio: def.bio, text: arrivalText(def, e.text, content), turn: e.turn });
        break;
      }
      case 'deed':
        a.events.push({ text: e.text, turn: e.turn, kind: e.kind });
        break;
      case 'tradition': {
        const def = content.traditions.find((t) => t.id === e.ref);
        if (def) a.traditions.push({ id: def.id, name: def.name, note: def.history.note, cultures: [def.culture], turn: e.turn, tier: def.tier });
        break;
      }
      case 'hybrid': {
        const def = content.hybrids.find((h) => h.id === e.ref);
        if (def) a.hybrids.push({ id: def.id, name: def.name, note: def.history.note, cultures: [...def.cultures], turn: e.turn });
        break;
      }
      case 'wonder': {
        const def = content.wonders.find((w) => w.id === e.ref);
        a.wonders.push({ id: e.ref, name: def?.name ?? e.text, note: def ? `${e.text} ${def.history.note}` : e.text, cultures: def ? [def.culture] : [], turn: e.turn });
        break;
      }
      case 'war':
        a.wars.push({ text: e.text, turn: e.turn, against: state.players[e.ref] && e.ref !== player ? e.ref : null });
        break;
      case 'crisis':
        a.crises.push({ text: e.text, turn: e.turn });
        break;
      default:
        a.events.push({ text: e.text, turn: e.turn, kind: e.kind });
    }
  }

  // Figures held without a chronicle line (e.g. taken in conquest) still belong in the story.
  for (const fs of Object.values(state.figures)) {
    if (fs.owner !== player || seenFigures.has(fs.id)) continue;
    const def = content.figures.find((f) => f.id === fs.id);
    if (!def) continue;
    ageOf(fs.recruitedAge).figures.push({
      id: def.id,
      name: def.name,
      culture: def.culture,
      kind: def.kind,
      bio: def.bio,
      // Annal voice, like the sim's own chronicle lines: read on any civ's tab, so no "us"/"you".
      text: arrivalText(def, fs.reason ? `${def.name} joined the court, ${annalVoice(fs.reason)}.` : `${def.name} joined the court.`, content),
      turn: fs.recruitedTurn,
    });
  }

  let result: ChronicleView['result'] = null;
  if (state.result) {
    const scores = state.result.scores;
    const ids = Object.keys(scores);
    const mine = scores[player] ?? p.score;
    result = {
      rank: ids.filter((id) => (scores[id] ?? 0) > mine).length + 1,
      of: ids.length,
      score: mine,
      won: state.result.winner === player,
    };
  }

  return {
    player,
    civName: p.civName ?? `${leader}'s people`,
    leader,
    dream: dream ? { native: dream.native, romanized: dream.romanized, meaning: dream.meaning, language: dream.language } : null,
    colors: p.colors,
    ages: AGES.map((a) => byAge[a]).filter((a): a is ChronicleAge => !!a),
    result,
  };
};
