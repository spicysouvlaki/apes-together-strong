/**
 * One rule for "Are you sure?" (wave 13 playtest: confirms on priced, wanted choices were chores).
 * Ask only when an action is irreversible AND costs more than the price printed on its button
 * (a unit, a figure, a seat's bonus for turns, anarchy, a war). Anything else is a single tap whose
 * button says the price. A misfire guard (Buy's second tap where End Turn usually sits) is not a
 * confirm and is listed apart. Pure; tests/ui-wave13.test.ts locks the table.
 */
export type GameAction =
  | 'adoptTradition'
  | 'adoptHybrid'
  | 'makePeace'
  | 'sendEnvoy'
  | 'declareWar'
  | 'changeGovernment'
  | 'firstGovernment'
  | 'seat'
  | 'unseat'
  | 'activate'
  | 'consume'
  | 'disband'
  | 'quitToTitle';

export interface ActionTraits {
  irreversible: boolean;
  /** Loses something beyond the shown price. */
  hiddenCost: boolean;
  why: string;
}

export const ACTION_TRAITS: Record<GameAction, ActionTraits> = {
  adoptTradition: { irreversible: true, hiddenCost: false, why: 'Priced on the button; refinement points have no other use at the transition.' },
  adoptHybrid: { irreversible: true, hiddenCost: false, why: 'Priced on the button, like a tradition.' },
  makePeace: { irreversible: false, hiddenCost: false, why: 'Priced in influence on the button; ends a war you asked to end.' },
  sendEnvoy: { irreversible: false, hiddenCost: false, why: 'Priced on the button (asks only when it would leave too little influence to buy peace in a war).' },
  declareWar: { irreversible: true, hiddenCost: true, why: 'Peace takes turns and influence; trade routes stop.' },
  changeGovernment: { irreversible: true, hiddenCost: true, why: 'Anarchy: no cabinet bonuses for turns; figures may lose their seats.' },
  firstGovernment: { irreversible: false, hiddenCost: false, why: 'Free the first time.' },
  seat: { irreversible: false, hiddenCost: false, why: 'Free; one fitting seat is seated in one tap.' },
  unseat: { irreversible: true, hiddenCost: true, why: 'The seat stays empty for turns and its bonus stops.' },
  activate: { irreversible: true, hiddenCost: true, why: 'The figure retires for good.' },
  consume: { irreversible: true, hiddenCost: true, why: 'The figure leaves play and the score for good (one confirm: the choice sheet).' },
  disband: { irreversible: true, hiddenCost: true, why: 'The unit is gone.' },
  quitToTitle: { irreversible: false, hiddenCost: false, why: 'The game is saved after every move; Continue resumes it.' },
};

export const needsConfirm = (a: GameAction): boolean => ACTION_TRAITS[a].irreversible && ACTION_TRAITS[a].hiddenCost;
