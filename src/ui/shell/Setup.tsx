/**
 * Game setup (GDD §2): leader archetype, founding dream (1 of 3 offered), banner colors,
 * skin tone, map size, speed, rivals, seed. Builds a GameSetup and starts the game.
 */
import { useMemo, useState } from 'preact/hooks';
import type { GameSpeed, MapSize } from '@contracts/sim-api';
import { content, lookup, route, startNewGame } from '../store';
import {
  BANNER_COLORS,
  MAP_SIZES,
  MAX_RIVALS,
  MIN_RIVALS,
  SKIN_TONES,
  SPEEDS,
  buildGameSetup,
  dreamOffer,
  parseSeed,
  randomSeed,
} from './setup-logic';
import { loading, patchSettings, settings } from './shell-state';

export function Setup() {
  const last = settings.peek().lastSetup;
  const lastHuman = last?.players.find((p) => p.isHuman);
  const dreams = useMemo(() => dreamOffer(content.dreams.map((d) => d.id), Math.random), []);
  const [leader, setLeader] = useState(lastHuman && lookup.leaders[lastHuman.leader] ? lastHuman.leader : (content.leaders[0]?.id ?? ''));
  const [dream, setDream] = useState(dreams[0] ?? '');
  const [primary, setPrimary] = useState(lastHuman?.colors.primary ?? BANNER_COLORS[0]?.hex ?? '#0072b2');
  const [secondary, setSecondary] = useState(lastHuman?.colors.secondary ?? '#ffffff');
  const [skinTone, setSkinTone] = useState(lastHuman?.skinTone ?? 2);
  const [mapSize, setMapSize] = useState<MapSize>('small');
  const [speed, setSpeed] = useState<GameSpeed>(last?.speed ?? 'standard');
  const [rivals, setRivals] = useState(MAX_RIVALS);
  const [seedText, setSeedText] = useState(() => String(randomSeed(Math.random)));
  const seed = parseSeed(seedText);
  const busy = loading.value;

  const start = (): void => {
    if (seed === null || !leader || !dream) return;
    const setup = buildGameSetup(
      { leader, dream, primary, secondary, skinTone, mapSize, speed, rivals, seed },
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
        <h1>New game</h1>
        <button class="btn btn-ghost" onClick={() => (route.value = 'title')} aria-label="Back to title">
          ‹ Back
        </button>
      </div>
      <div class="screen-body">
        <div class="section-title">Leader</div>
        <div class="choice-list" role="radiogroup" aria-label="Leader archetype">
          {content.leaders.map((l) => (
            <button
              key={l.id}
              role="radio"
              aria-checked={leader === l.id}
              class={`card choice${leader === l.id ? ' selected' : ''}`}
              onClick={() => setLeader(l.id)}
            >
              <strong>{l.name}</strong>
              <span class="small muted">{l.ability}</span>
            </button>
          ))}
        </div>

        <div class="section-title">Founding dream</div>
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
                <span class="dream-native">
                  {d.native}
                </span>
                <span class="small">
                  {d.romanized !== d.native ? <em>{d.romanized}</em> : null}
                  {d.romanized !== d.native ? ' · ' : ''}
                  {d.language}
                </span>
                <span class="small muted">“{d.meaning}”</span>
              </button>
            );
          })}
        </div>

        <div class="section-title">Banner</div>
        <div class="card">
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
          <div class="banner-preview" aria-hidden="true" style={{ background: primary, borderColor: secondary }}>
            <span style={{ background: secondary }} />
          </div>
        </div>

        <div class="section-title">Your people</div>
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

        <div class="section-title">World</div>
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
              <button class="btn" aria-label="New random seed" onClick={() => setSeedText(String(randomSeed(Math.random)))}>
                🎲
              </button>
            </div>
          </label>
        </div>
      </div>
      <div class="screen-footer">
        <button class="btn btn-primary" disabled={seed === null || !!busy} onClick={start}>
          {busy ?? 'Begin'}
        </button>
      </div>
    </div>
  );
}
