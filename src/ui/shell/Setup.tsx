/**
 * Game setup (GDD §2): leader archetype, founding dream (1 of 3 offered), banner colors,
 * skin tone, map size, speed, rivals, seed. Builds a GameSetup and starts the game.
 */
import { useMemo, useState } from 'preact/hooks';
import type { Difficulty, GameSpeed, MapSize } from '@contracts/sim-api';
import { DIFFICULTY_HUMAN_SETTLEMENT_HAPPINESS, DIFFICULTY_RIVAL_COST_PERCENT, DIFFICULTY_RIVAL_YIELD_PERCENT } from '../../sim/constants';
import { GlossText } from './GlossarySheet';
import { content, lookup, route, startNewGame } from '../store';
import {
  BANNER_COLORS,
  DIFFICULTIES,
  MAP_SIZES,
  MAX_RIVALS,
  MIN_RIVALS,
  SKIN_TONES,
  SPEEDS,
  buildGameSetup,
  difficultyNote,
  dreamOffer,
  knownDifficulty,
  parseSeed,
  randomSeed,
} from './setup-logic';
import { loading, patchSettings, settings } from './shell-state';
import { Icon } from '../art/Icon';
import { SetupBanner } from '../art/game-art';
import { leaderEmblem } from '../art/heraldry-spec';

/** A numbered step of the founding ritual (roman numeral rubric). */
const Step = ({ n, title, note }: { n: string; title: string; note?: string }) => (
  <div class="setup-step">
    <span class="setup-step-n" aria-hidden="true">
      {n}
    </span>
    <span class="setup-step-text">
      <span class="setup-step-title">{title}</span>
      {note && <span class="setup-step-note">{note}</span>}
    </span>
  </div>
);

export function Setup() {
  const last = settings.peek().lastSetup;
  const lastHuman = last?.players.find((p) => p.isHuman);
  const dreams = useMemo(() => dreamOffer(content.dreams.map((d) => d.id), Math.random), []);
  const [leader, setLeader] = useState(lastHuman && lookup.leaders[lastHuman.leader] ? lastHuman.leader : (content.leaders[0]?.id ?? ''));
  const [dream, setDream] = useState(dreams[0] ?? '');
  const [primary, setPrimary] = useState(lastHuman?.colors.primary ?? BANNER_COLORS[0]?.hex ?? '#0072b2');
  const [secondary, setSecondary] = useState(lastHuman?.colors.secondary ?? '#ffffff');
  const [skinTone, setSkinTone] = useState(lastHuman?.skinTone ?? 2);
  const [mapSize, setMapSize] = useState<MapSize>(last?.mapSize ?? 'small');
  const [speed, setSpeed] = useState<GameSpeed>(last?.speed ?? 'standard');
  const [rivals, setRivals] = useState(last ? Math.max(MIN_RIVALS, Math.min(MAX_RIVALS, last.players.length - 1)) : MAX_RIVALS);
  const [difficulty, setDifficulty] = useState<Difficulty>(knownDifficulty(last?.difficulty));
  const [seedText, setSeedText] = useState(() => String(randomSeed(Math.random)));
  const seed = parseSeed(seedText);
  const busy = loading.value;

  const start = (): void => {
    if (seed === null || !leader || !dream) return;
    const setup = buildGameSetup(
      { leader, dream, primary, secondary, skinTone, mapSize, speed, rivals, seed, difficulty },
      content.leaders.map((l) => l.id),
      content.dreams.map((d) => d.id),
    );
    patchSettings({ lastSetup: setup });
    loading.value = 'Shaping the world…';
    startNewGame(setup);
  };

  return (
    <div class="screen setup" role="main">
      <div class="screen-header">
        <button class="btn btn-ghost btn-icon" onClick={() => (route.value = 'title')} aria-label="Back to title">
          <Icon name="back" />
        </button>
        <h1>Found a people</h1>
      </div>
      <div class="screen-body">
        <Step n="I" title="Who leads them" note="Your leader's gift lasts the whole game." />
        <div class="choice-list" role="radiogroup" aria-label="Leader archetype">
          {content.leaders.map((l) => (
            <button
              key={l.id}
              role="radio"
              aria-checked={leader === l.id}
              class={`card choice leader-choice${leader === l.id ? ' selected' : ''}`}
              onClick={() => setLeader(l.id)}
            >
              <span class="leader-emblem" aria-hidden="true">
                <Icon name={leaderEmblem(l.id)} />
              </span>
              <span class="leader-text">
                <strong>{l.name}</strong>
                <span class="small muted">
                  <GlossText text={l.ability} />
                </span>
              </span>
            </button>
          ))}
        </div>

        <Step n="II" title="The founding dream" note="An idea in an old tongue, carried as your motto." />
        <div class="choice-list" role="radiogroup" aria-label="Founding dream">
          {dreams.map((id) => {
            const d = lookup.dreams[id];
            if (!d) return null;
            return (
              <button
                key={id}
                role="radio"
                aria-checked={dream === id}
                class={`card choice dream${dream === id ? ' selected' : ''}`}
                onClick={() => setDream(id)}
              >
                <span class={`dream-native${d.native.length > 10 ? ' dream-long' : ''}`} lang="und">
                  {d.native}
                </span>
                {d.romanized !== d.native && <span class="dream-roman">{d.romanized}</span>}
                <span class="dream-meaning">“{d.meaning}”</span>
                <span class="dream-lang">{d.language}</span>
              </button>
            );
          })}
        </div>

        <Step n="III" title="Your banner" />
        <div class="card banner-card">
          <div class="banner-stand" aria-hidden="true">
            <SetupBanner primary={primary} secondary={secondary} leader={leader} width={76} />
          </div>
          <div class="grow">
          <div class="small muted">Primary</div>
          <div class="swatches" role="radiogroup" aria-label="Primary banner color">
            {BANNER_COLORS.filter((c) => c.hex !== '#ffffff').map((c) => (
              <button
                key={c.hex}
                role="radio"
                aria-checked={primary === c.hex}
                aria-label={c.name}
                class={`swatch${primary === c.hex ? ' selected' : ''}`}
                style={{ background: c.hex }}
                onClick={() => {
                  setPrimary(c.hex);
                  if (secondary === c.hex) setSecondary(c.hex === '#000000' ? '#ffffff' : '#000000');
                }}
              />
            ))}
          </div>
          <div class="small muted mt8">Secondary</div>
          <div class="swatches" role="radiogroup" aria-label="Secondary banner color">
            {BANNER_COLORS.filter((c) => c.hex !== primary).map((c) => (
              <button
                key={c.hex}
                role="radio"
                aria-checked={secondary === c.hex}
                aria-label={c.name}
                class={`swatch${secondary === c.hex ? ' selected' : ''}`}
                style={{ background: c.hex }}
                onClick={() => setSecondary(c.hex)}
              />
            ))}
          </div>
          </div>
        </div>

        <Step n="IV" title="Your people" />
        <div class="swatches" role="radiogroup" aria-label="Skin tone">
          {SKIN_TONES.map((hex, i) => (
            <button
              key={hex}
              role="radio"
              aria-checked={skinTone === i}
              aria-label={`Skin tone ${i + 1}`}
              class={`swatch round${skinTone === i ? ' selected' : ''}`}
              style={{ background: hex }}
              onClick={() => setSkinTone(i)}
            />
          ))}
        </div>

        <Step n="V" title="The world" />
        <div class="card">
          <div class="small muted">Map size</div>
          <div class="segmented" role="radiogroup" aria-label="Map size">
            {MAP_SIZES.map((m) => (
              <button key={m.id} role="radio" aria-checked={mapSize === m.id} class={mapSize === m.id ? 'on' : ''} onClick={() => setMapSize(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <div class="small muted mt8">Speed</div>
          <div class="segmented" role="radiogroup" aria-label="Game speed">
            {SPEEDS.map((s) => (
              <button key={s.id} role="radio" aria-checked={speed === s.id} class={speed === s.id ? 'on' : ''} onClick={() => setSpeed(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          <div class="small muted mt8">Difficulty</div>
          <div class="segmented" role="radiogroup" aria-label="Difficulty">
            {DIFFICULTIES.map((d) => (
              <button key={d.id} role="radio" aria-checked={difficulty === d.id} class={difficulty === d.id ? 'on' : ''} onClick={() => setDifficulty(d.id)}>
                {d.label}
              </button>
            ))}
          </div>
          <p class="small muted setup-note">{difficultyNote(difficulty, DIFFICULTY_RIVAL_YIELD_PERCENT, DIFFICULTY_RIVAL_COST_PERCENT, DIFFICULTY_HUMAN_SETTLEMENT_HAPPINESS)}</p>
          <div class="small muted mt8">Rivals</div>
          <div class="segmented" role="radiogroup" aria-label="Number of rivals">
            {Array.from({ length: MAX_RIVALS - MIN_RIVALS + 1 }, (_, i) => i + MIN_RIVALS).map((n) => (
              <button key={n} role="radio" aria-checked={rivals === n} class={rivals === n ? 'on' : ''} onClick={() => setRivals(n)}>
                {n}
              </button>
            ))}
          </div>
          <label class="small muted mt8 seed-label">
            Seed
            <div class="row">
              <input
                class="seed-input grow"
                inputMode="numeric"
                value={seedText}
                aria-invalid={seed === null}
                onInput={(e) => setSeedText((e.target as HTMLInputElement).value)}
              />
              <button class="btn btn-icon" aria-label="New random seed" onClick={() => setSeedText(String(randomSeed(Math.random)))}>
                <Icon name="dice" />
              </button>
            </div>
          </label>
        </div>
      </div>
      <div class="screen-footer">
        <button class="btn btn-primary setup-begin" disabled={seed === null || !!busy} onClick={start}>
          {busy ? busy : (
            <>
              <Icon name="found" /> Found your people
            </>
          )}
        </button>
      </div>
    </div>
  );
}
