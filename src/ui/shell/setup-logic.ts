/**
 * Game setup screen logic (GDD §2). Pure: randomness is injected so tests are deterministic.
 * UI-side randomness is fine here (outside the sim); the resulting GameSetup carries the seed
 * the sim will use.
 */
import type { Difficulty, GameSetup, GameSpeed, MapSize, PlayerSetup } from '@contracts/sim-api';

/**
 * Banner colors: the Okabe–Ito colorblind-safe palette (plus white/black for secondaries).
 * Cosmetic only, so it lives with the UI rather than in content.
 */
export const BANNER_COLORS: readonly { hex: string; name: string }[] = [
  { hex: '#0072b2', name: 'Blue' },
  { hex: '#d55e00', name: 'Vermillion' },
  { hex: '#009e73', name: 'Bluish green' },
  { hex: '#e69f00', name: 'Orange' },
  { hex: '#cc79a7', name: 'Reddish purple' },
  { hex: '#56b4e9', name: 'Sky blue' },
  { hex: '#f0e442', name: 'Yellow' },
  { hex: '#000000', name: 'Black' },
  { hex: '#ffffff', name: 'White' },
];

/** Skin tones by index (PlayerSetup.skinTone). Cosmetic only. */
export const SKIN_TONES: readonly string[] = ['#f6d7c3', '#e8b796', '#c98e63', '#a46a43', '#7a4b2c', '#4f301c'];

export const MAP_SIZES: readonly { id: MapSize; label: string }[] = [
  { id: 'small', label: 'Small' },
  { id: 'standard', label: 'Standard' },
  { id: 'large', label: 'Large' },
];

export const SPEEDS: readonly { id: GameSpeed; label: string }[] = [
  { id: 'quick', label: 'Quick' },
  { id: 'standard', label: 'Standard' },
  { id: 'epic', label: 'Epic' },
];

/** Difficulty only scales rivals (GDD §9 "yield bonuses and depth, never hidden information"). */
export const DIFFICULTIES: readonly { id: Difficulty; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'normal', label: 'Normal' },
  { id: 'hard', label: 'Hard' },
];

/** One plain line per difficulty, from the sim's percentages (sim/constants.ts). */
export const difficultyNote = (
  d: Difficulty,
  yieldPercent: Record<Difficulty, number>,
  costPercent: Record<Difficulty, number>,
  humanHappiness: Record<Difficulty, number> = { easy: 0, normal: 0, hard: 0 },
): string => {
  const y = yieldPercent[d];
  const c = costPercent[d];
  const yields = y === 0 ? 'Rivals play on even terms with you' : y < 0 ? `Rivals gather ${-y}% less food, production, gold, science and culture` : `Rivals gather ${y}% more food, production, gold, science and culture`;
  const cost = c < 0 ? ` and build ${-c}% cheaper` : c > 0 ? ` and build ${c}% dearer` : '';
  const h = humanHappiness[d];
  const mood = h > 0 ? `; each of your settlements adds ${h} happiness` : '';
  return `${yields}${cost}${mood}.`;
};

/** A stored difficulty if it is a known one, else 'normal'. */
export const knownDifficulty = (d: unknown): Difficulty => (DIFFICULTIES.some((x) => x.id === d) ? (d as Difficulty) : 'normal');

export const MIN_RIVALS = 1;
export const MAX_RIVALS = 2;

export type Rand = () => number;

/** Small seeded PRNG for UI-side picks, so one seed reproduces the whole setup. */
export const mulberry32 = (seed: number): Rand => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const randomSeed = (rand: Rand): number => Math.floor(rand() * 2_000_000_000) + 1;

/** Fisher–Yates on a copy. */
export const shuffled = <T>(list: readonly T[], rand: Rand): T[] => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const x = a[i] as T;
    a[i] = a[j] as T;
    a[j] = x;
  }
  return a;
};

/** The founding dream is picked from 3 offered at random (GDD §2). */
export const dreamOffer = (dreamIds: readonly string[], rand: Rand, n = 3): string[] => shuffled(dreamIds, rand).slice(0, n);

/**
 * Accessible name for a founding-dream radio: the romanized word (screen readers mangle most
 * native scripts), its meaning and its language. The native spelling stays visible on the card.
 */
export const dreamLabel = (d: { native: string; romanized: string; meaning: string; language: string }): string =>
  `${d.romanized}, “${d.meaning}”, ${d.language}`;

export interface SetupChoices {
  leader: string;
  dream: string;
  primary: string;
  secondary: string;
  skinTone: number;
  mapSize: MapSize;
  speed: GameSpeed;
  rivals: number;
  seed: number;
  /** Default 'normal'. */
  difficulty?: Difficulty;
}

/** Parse the editable seed field; null when it is not a usable positive integer. */
export const parseSeed = (text: string): number | null => {
  const t = text.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= 4_294_967_295 ? n : null;
};

/**
 * Human `p1` plus AI rivals `p2`, `p3`… with leaders, dreams and banner colors distinct from
 * the human's and each other's. AI picks are seeded from the game seed.
 */
export const buildGameSetup = (c: SetupChoices, leaderIds: readonly string[], dreamIds: readonly string[]): GameSetup => {
  const rand = mulberry32(c.seed ^ 0x5eed);
  const rivals = Math.max(MIN_RIVALS, Math.min(MAX_RIVALS, Math.round(c.rivals)));
  const leaders = shuffled(
    leaderIds.filter((l) => l !== c.leader),
    rand,
  );
  const dreams = shuffled(
    dreamIds.filter((d) => d !== c.dream),
    rand,
  );
  const primaries = shuffled(
    BANNER_COLORS.map((x) => x.hex).filter((h) => h !== c.primary && h !== '#ffffff' && h !== '#000000'),
    rand,
  );
  const players: PlayerSetup[] = [
    {
      id: 'p1',
      isHuman: true,
      leader: c.leader,
      dream: c.dream,
      colors: { primary: c.primary, secondary: c.secondary },
      skinTone: c.skinTone,
    },
  ];
  for (let i = 0; i < rivals; i++) {
    const primary = primaries[i] ?? '#777777';
    players.push({
      id: `p${i + 2}`,
      isHuman: false,
      leader: leaders[i % Math.max(1, leaders.length)] ?? c.leader,
      dream: dreams[i % Math.max(1, dreams.length)] ?? c.dream,
      colors: { primary, secondary: i % 2 === 0 ? '#ffffff' : '#000000' },
      skinTone: Math.floor(rand() * SKIN_TONES.length),
    });
  }
  return { seed: c.seed, mapSize: c.mapSize, speed: c.speed, players, difficulty: c.difficulty ?? 'normal' };
};
