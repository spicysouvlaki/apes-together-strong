import { describe, expect, it } from 'vitest';
import { CULTURE_MAKERS, Composer, INSTRUMENTS, instrumentForStem, type ComposerScene, type NoteEvent } from '../src/audio/composer';
import { layerEnd, layerPitches, type Layer } from '../src/audio/layers';
import { mulberry32 } from '../src/audio/random';
import { RECIPES, SFX_LIST, TIER_GAIN } from '../src/audio/recipes';
import { inKey, pc } from '../src/audio/theory';
import { voiceLayers } from '../src/audio/voices';
import { droneFor, baseBusGain, cultureBusGain } from '../src/audio/ambience';
import { AGES } from '@contracts/content-schemas';
import cultures from '@content/cultures.json';
import type { Sfx } from '../src/audio/types';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

/** Pitches must be in D dorian unless flagged as an ornament; cents only small variation. */
const checkLayer = (l: Layer, where: string): void => {
  expect(l.gain, where).toBeGreaterThan(0);
  expect(l.gain, where).toBeLessThanOrEqual(1);
  expect(l.dur, where).toBeGreaterThan(0);
  expect(l.at, where).toBeGreaterThanOrEqual(0);
  if (l.pan !== undefined) expect(Math.abs(l.pan), where).toBeLessThanOrEqual(1);
  if (l.kind === 'noise') {
    expect(l.filter.freq, where).toBeGreaterThan(20);
    expect(l.filter.freq, where).toBeLessThan(20000);
    return;
  }
  for (const m of layerPitches(l)) {
    expect(inKey(m), `${where}: midi ${m} out of key`).toBe(true);
    expect(m, where).toBeGreaterThanOrEqual(36);
    expect(m, where).toBeLessThanOrEqual(100);
  }
  if (l.ornament) expect(Math.abs(l.cents ?? 0), where).toBeLessThanOrEqual(55);
  else expect(Math.abs(l.cents ?? 0), where).toBeLessThanOrEqual(15);
};

describe('sfx recipes', () => {
  it('cover every Sfx', () => {
    const all: Record<Sfx, true> = {
      tap: true, select: true, deselect: true, open: true, close: true, error: true, move: true, found: true, build: true,
      wonder: true, research: true, attack: true, ranged: true, unitLost: true, victory: true, offer: true, recruit: true,
      seat: true, activate: true, hint: true, coin: true, envoy: true, war: true, peace: true, crisis: true, milestone: true,
      adopt: true, ageEnd: true, ageStart: true, endTurn: true, turnStart: true, defeat: true, chronicle: true,
    };
    expect([...SFX_LIST].sort()).toEqual(Object.keys(all).sort());
  });

  it('have valid parameters for many random variations: in key, in range, gains <= 1', () => {
    for (const sfx of SFX_LIST) {
      const r = RECIPES[sfx];
      const fanfare = r.tier === 'fanfare' || r.tier === 'big';
      expect(r.dur, sfx).toBeGreaterThanOrEqual(0.06);
      expect(r.dur, sfx).toBeLessThanOrEqual(fanfare ? 2.5 : 1.0);
      expect(r.wet).toBeGreaterThanOrEqual(0);
      expect(r.wet).toBeLessThanOrEqual(1);
      expect(r.band[0]).toBeLessThan(r.band[1]);
      expect(TIER_GAIN[r.tier]).toBeLessThanOrEqual(1);
      for (const seed of SEEDS) {
        const layers = r.build(mulberry32(seed));
        expect(layers.length, sfx).toBeGreaterThan(0);
        for (const l of layers) {
          checkLayer(l, `${sfx}#${seed}`);
          expect(layerEnd(l), `${sfx}#${seed} ends after its spec`).toBeLessThanOrEqual(r.dur + 1e-9);
        }
      }
    }
  });

  it('vary between plays (no two seeds identical) but are reproducible per seed', () => {
    for (const sfx of SFX_LIST) {
      const a = JSON.stringify(RECIPES[sfx].build(mulberry32(1)));
      expect(JSON.stringify(RECIPES[sfx].build(mulberry32(1)))).toBe(a);
      expect(JSON.stringify(RECIPES[sfx].build(mulberry32(2)))).not.toBe(a);
    }
  });

  it('louder tiers for bigger moments', () => {
    expect(TIER_GAIN.ui).toBeLessThan(TIER_GAIN.event);
    expect(TIER_GAIN.event).toBeLessThan(TIER_GAIN.fanfare);
    expect(RECIPES.tap.tier).toBe('ui');
    expect(RECIPES.recruit.tier).toBe('fanfare');
  });

  it('offer asks a question (ends on E) and recruit answers it (starts on E, resolves to D)', () => {
    const plucks = (sfx: Sfx) => RECIPES[sfx].build(mulberry32(5)).filter((l) => l.kind === 'pluck').sort((a, b) => a.at - b.at);
    const offer = plucks('offer');
    const recruit = plucks('recruit');
    expect(pc(offer[offer.length - 1]!.kind === 'pluck' ? offer[offer.length - 1]!.midi : 0)).toBe(4); // E
    const [first, second] = recruit;
    expect(first?.kind === 'pluck' && pc(first.midi)).toBe(4); // picks up the E
    expect(second?.kind === 'pluck' && pc(second.midi)).toBe(2); // and resolves to D
    expect(first?.kind === 'pluck' && offer[offer.length - 1]?.kind === 'pluck' && first.midi === offer[offer.length - 1]!.midi).toBe(true);
  });

  it('ageEnd sits on G (IV) and ageStart on D (i)', () => {
    const chord = (sfx: Sfx) => RECIPES[sfx].build(mulberry32(1)).find((l) => l.kind === 'tone');
    const end = chord('ageEnd');
    const start = chord('ageStart');
    expect(end?.kind === 'tone' && pc(end.midi[0]!)).toBe(7);
    expect(start?.kind === 'tone' && pc(start.midi[0]!)).toBe(2);
  });
});

describe('ambience composer', () => {
  const scenes: ComposerScene[] = [
    ...AGES.map((age) => ({ age, crisis: false, cultures: [] })),
    { age: 'ancient', crisis: true, cultures: [] },
    { age: 'classical', crisis: false, cultures: INSTRUMENTS.map((instrument) => ({ id: instrument, instrument, weight: 1 })) },
    { age: 'modern', crisis: true, cultures: INSTRUMENTS.map((instrument) => ({ id: instrument, instrument, weight: 0.3 })) },
  ];

  const run = (scene: ComposerScene, seed: number, seconds = 120): NoteEvent[] => {
    const c = new Composer(mulberry32(seed));
    c.setScene(scene, 0);
    const out: NoteEvent[] = [];
    for (let t = 0; t < seconds; t += 0.1) out.push(...c.generate(t + 0.5));
    return out;
  };

  it('stays in key (ornaments aside) and every note renders to valid layers', () => {
    for (const scene of scenes) {
      for (const seed of [1, 2, 3]) {
        const notes = run(scene, seed);
        expect(notes.length).toBeGreaterThan(10);
        for (const n of notes) {
          const where = `${scene.age}/${n.voice}`;
          expect(inKey(n.midi), `${where} midi ${n.midi}`).toBe(true);
          if (n.ornament) expect(n.cents).toBe(-50);
          if (n.bend) expect(inKey(n.midi + n.bend), where).toBe(true);
          expect(n.gain).toBeGreaterThanOrEqual(0);
          expect(n.gain).toBeLessThanOrEqual(1);
          expect(n.dur).toBeGreaterThan(0);
          for (const l of voiceLayers(n, mulberry32(seed))) checkLayer(l, where);
        }
      }
    }
  });

  it('is seedable and deterministic', () => {
    const s = scenes[5]!;
    expect(run(s, 9)).toEqual(run(s, 9));
    expect(run(s, 9)).not.toEqual(run(s, 10));
  });

  it('emits notes in time order without crowding a window twice', () => {
    const c = new Composer(mulberry32(4));
    c.setScene(scenes[1]!, 0);
    const a = c.generate(10);
    const b = c.generate(10);
    expect(b).toEqual([]);
    for (let i = 1; i < a.length; i++) expect(a[i]!.t).toBeGreaterThanOrEqual(a[i - 1]!.t);
  });

  it('crisis is sparser and avoids the bright B in the melody', () => {
    const calm = run({ age: 'ancient', crisis: false, cultures: [] }, 3, 300);
    const dark = run({ age: 'ancient', crisis: true, cultures: [] }, 3, 300);
    expect(dark.length).toBeLessThan(calm.length);
    expect(dark.filter((n) => n.voice === 'pluck').some((n) => pc(n.midi) === 11)).toBe(false);
    expect(droneFor('ancient', true).cutoff).toBeLessThan(droneFor('ancient', false).cutoff);
  });

  it('never loops: the tune has no short repeating period', () => {
    const tune = run({ age: 'classical', crisis: false, cultures: [] }, 6, 300).filter((n) => n.voice === 'pluck').map((n) => n.midi);
    expect(tune.length).toBeGreaterThan(60);
    for (let period = 1; period <= 24; period++) {
      let same = 0;
      for (let i = period; i < tune.length; i++) if (tune[i] === tune[i - period]) same++;
      expect(same / (tune.length - period), `period ${period}`).toBeLessThan(0.6);
    }
  });

  it('is real music: harmony every bar, chord tones under the tune, a pulse', () => {
    const notes = run({ age: 'classical', crisis: false, cultures: [] }, 2, 60);
    const pads = notes.filter((n) => n.voice === 'pad');
    const beat = 60 / 78;
    expect(pads.length).toBeGreaterThanOrEqual(Math.floor(58 / (beat * 4)));
    expect(notes.filter((n) => n.voice === 'bass').length).toBeGreaterThanOrEqual(pads.length);
    expect(notes.filter((n) => n.voice === 'arp').length).toBeGreaterThan(pads.length * 2);
    expect(notes.filter((n) => n.voice === 'pluck').length).toBeGreaterThan(10);
    // Pads change chord: at least three different voicings within a minute.
    expect(new Set(pads.map((p) => (p.chord ?? []).join(','))).size).toBeGreaterThanOrEqual(3);
  });

  it('culture streams follow the scene and their weight', () => {
    const c = new Composer(mulberry32(1));
    c.setScene({ age: 'ancient', crisis: false, cultures: [{ id: 'greek', instrument: 'lyre', weight: 0.5 }] }, 0);
    expect(c.activeStreams).toContain('culture:greek');
    c.setScene({ age: 'ancient', crisis: false, cultures: [{ id: 'greek', instrument: 'lyre', weight: 0.01 }] }, 1);
    expect(c.activeStreams).not.toContain('culture:greek');
    const light = run({ age: 'ancient', crisis: false, cultures: [{ id: 'x', instrument: 'oud', weight: 0.1 }] }, 2, 300).filter((n) => n.source === 'x');
    const heavy = run({ age: 'ancient', crisis: false, cultures: [{ id: 'x', instrument: 'oud', weight: 1 }] }, 2, 300).filter((n) => n.source === 'x');
    expect(heavy.length).toBeGreaterThan(light.length);
    expect(cultureBusGain(1)).toBeGreaterThan(cultureBusGain(0.1));
    expect(baseBusGain(1)).toBeLessThan(baseBusGain(0));
  });

  it('every culture stem in content has an instrument voice', () => {
    for (const c of cultures as { id: string; musicStem: string }[]) {
      const inst = instrumentForStem(c.musicStem);
      expect(INSTRUMENTS, c.musicStem).toContain(inst);
      expect(c.musicStem.endsWith(inst), c.musicStem).toBe(true);
      expect(CULTURE_MAKERS[inst]).toBeTypeOf('function');
    }
    expect(instrumentForStem('atlantean_conch')).toBe('lyre');
  });
});
