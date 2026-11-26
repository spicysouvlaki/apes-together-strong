/**
 * What each Sfx is for, in words, grouped the way a listener thinks about them. Dev-only
 * (the audition page); the game never imports it. Keep in step with recipes.ts and the
 * planner's EVENT_CUES / the UI's COMMAND_SFX.
 */
import type { Sfx } from './types';

export interface SfxInfo {
  group: string;
  /** When the game plays it. */
  when: string;
  /** What it should sound like (from the recipe comments). */
  sound: string;
}

export const SFX_GROUPS = ['Interface', 'Map and units', 'Cities and progress', 'Famous people', 'Diplomacy and war', 'Turns, ages and endings'] as const;

export const SFX_INFO: Record<Sfx, SfxInfo> = {
  tap: { group: 'Interface', when: 'Any button press (also your own city growing, if the UI gives the planner settlement owners).', sound: 'A wooden piece set down on felt.' },
  select: { group: 'Interface', when: 'A unit or tile is selected; choosing production or research; fortify.', sound: 'Wood tap with a small high pluck.' },
  deselect: { group: 'Interface', when: 'The selection is cleared.', sound: 'Two soft wood taps, falling.' },
  open: { group: 'Interface', when: 'A sheet or screen opens; deploying a figure.', sound: 'Parchment sliding open.' },
  close: { group: 'Interface', when: 'A sheet closes; unseating or recalling a figure; a figure retires.', sound: 'Parchment folded shut, a knock.' },
  error: { group: 'Interface', when: 'A command is rejected.', sound: 'A soft low "nuh-uh": two dull knocks.' },
  coin: { group: 'Interface', when: 'Buying an item or upgrading a settlement; a trade route opens.', sound: 'Two or three coins dropping.' },
  move: { group: 'Map and units', when: 'A unit moves.', sound: 'Footsteps on packed earth.' },
  attack: { group: 'Map and units', when: 'A melee hit involving you.', sound: 'Thud, clack and a faint ring of metal.' },
  ranged: { group: 'Map and units', when: 'A ranged attack involving you.', sound: 'An arrow swish, then a thunk.' },
  unitLost: { group: 'Map and units', when: 'You lose a unit or a figure.', sound: 'A bowed fifth sagging a step over a muffled drum.' },
  victory: { group: 'Map and units', when: 'You win a battle or take a city.', sound: 'Drum, two bright plucks and bells.' },
  found: { group: 'Cities and progress', when: 'You found a settlement.', sound: 'A stake driven in, then an open fifth rising.' },
  build: { group: 'Cities and progress', when: 'Production completes.', sound: 'Three hammer taps and a pluck.' },
  research: { group: 'Cities and progress', when: 'A tech or civic completes.', sound: 'A rising pentatonic pluck run with a glass tip.' },
  wonder: { group: 'Cities and progress', when: 'You build a wonder (a rival\'s plays far and muffled); also winning the game.', sound: 'Drums, a swelling chord, a cascade of plucks and bells.' },
  adopt: { group: 'Cities and progress', when: 'A tradition or hybrid is adopted; you become a city-state\'s suzerain.', sound: 'A wax seal, then a slow strum on D.' },
  offer: { group: 'Famous people', when: 'A famous person offers to join you.', sound: 'The call: a climb A–D–E that stops on the 2nd, a question.' },
  recruit: { group: 'Famous people', when: 'You welcome a famous person.', sound: 'The answer: picks up the E, resolves to D over a warm chord.' },
  seat: { group: 'Famous people', when: 'You seat a figure in your cabinet.', sound: 'A wax seal pressed: thump, squish, a low string.' },
  activate: { group: 'Famous people', when: 'A figure acts or completes a deed.', sound: 'A rising bowed fifth with a bell.' },
  hint: { group: 'Famous people', when: 'A culture hint toast: someone is drawn to your play.', sound: 'A small glass motif and a breath.' },
  envoy: { group: 'Diplomacy and war', when: 'You send an envoy.', sound: 'A reed call A up to D and a letter rustle.' },
  war: { group: 'Diplomacy and war', when: 'War is declared on you or by you; you lose a city.', sound: 'Frame drums and a low trembling D minor.' },
  peace: { group: 'Diplomacy and war', when: 'Peace is made.', sound: 'Two singing bowls over a soft pad.' },
  crisis: { group: 'Diplomacy and war', when: 'A crisis begins or worsens.', sound: 'A deep drum, a dark trembling cluster, a lone bowl.' },
  turnStart: { group: 'Turns, ages and endings', when: 'Your turn begins (usually the last of the phrase).', sound: 'A bowl and a pluck: "your move".' },
  endTurn: { group: 'Turns, ages and endings', when: 'You press End Turn.', sound: 'A page turned and a low string.' },
  milestone: { group: 'Turns, ages and endings', when: 'A legacy milestone; your civilization is named.', sound: 'Drum, rising plucks, a bright chord and bells.' },
  ageEnd: { group: 'Turns, ages and endings', when: 'An age ends (first half of the cadence).', sound: 'G major swells and hangs, unresolved.' },
  ageStart: { group: 'Turns, ages and endings', when: 'A new age begins (answers ageEnd).', sound: 'Home on D: drums and bells.' },
  defeat: { group: 'Turns, ages and endings', when: 'You are eliminated or lose the game.', sound: 'A slow falling line over a darkening fifth.' },
  chronicle: { group: 'Turns, ages and endings', when: 'The Chronicle opens at the end.', sound: 'A resolved phrase A–G–E–D over a warm chord.' },
};
