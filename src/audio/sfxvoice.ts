/**
 * Wires one Sfx into a graph: voice gain (tier x planned gain) -> dry bus (muffled when
 * distant) plus a reverb send. Shared by the engine and the offline self-check so what we
 * measure is what plays.
 */
import type { Graph } from './graph';
import type { Layer } from './layers';
import { RECIPES, TIER_GAIN } from './recipes';
import { newVoice, renderLayers, type Voice } from './synth';
import type { Sfx } from './types';

export interface SfxVoice extends Voice {
  sfx: Sfx;
  gain: GainNode;
}

export const spawnSfx = (g: Graph, sfx: Sfx, layers: readonly Layer[], start: number, gain: number, distant: boolean): SfxVoice => {
  const { ctx } = g;
  const recipe = RECIPES[sfx];
  const vg = ctx.createGain();
  vg.gain.value = Math.min(1, Math.max(0, gain)) * TIER_GAIN[recipe.tier];
  const voice: SfxVoice = { ...newVoice(start), sfx, gain: vg };
  voice.nodes.push(vg);
  let dryOut: AudioNode = g.sfxDry;
  let wet = recipe.wet;
  if (distant) {
    // Far away: muffled and roomier.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.connect(g.sfxDry);
    voice.nodes.push(lp);
    dryOut = lp;
    wet = Math.min(1, wet + 0.35);
  }
  vg.connect(dryOut);
  if (wet > 0) {
    const send = ctx.createGain();
    send.gain.value = wet;
    vg.connect(send);
    send.connect(g.sfxWet);
    voice.nodes.push(send);
  }
  renderLayers(g, layers, start, vg, voice);
  return voice;
};
