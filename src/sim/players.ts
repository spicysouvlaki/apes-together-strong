/** Fresh PlayerState for a new game (emergence fields from `initEmergence`, everything else zeroed). */
import { YIELDS, type ContentBundle, type YieldType } from '@contracts/content-schemas';
import type { PlayerSetup, PlayerState } from '@contracts/sim-api';
import { initEmergence } from '../emergence';

const zeroRecord = (): Record<YieldType, number> => {
  const out = {} as Record<YieldType, number>;
  for (const y of YIELDS) out[y] = 0;
  return out;
};

export const newPlayer = (setup: PlayerSetup, tiles: number, content: ContentBundle): PlayerState => {
  const em = initEmergence(content);
  return {
    id: setup.id,
    isHuman: setup.isHuman,
    leader: setup.leader,
    dream: setup.dream,
    colors: { primary: setup.colors.primary, secondary: setup.colors.secondary },
    skinTone: setup.skinTone,
    alive: true,
    civName: null,
    stock: zeroRecord(),
    income: zeroRecord(),
    happiness: 0,
    affinity: em.affinity,
    hintsShown: em.hintsShown,
    gp: em.gp,
    gpThreshold: em.gpThreshold,
    legendSlotUsed: em.legendSlotUsed,
    government: null,
    anarchyTurns: 0,
    cabinet: {},
    cabinetCooldown: {},
    seatedTurns: em.seatedTurns,
    traditions: [],
    hybrids: [],
    techs: [],
    research: { tech: { current: null, progress: 0 }, civic: { current: null, progress: 0 } },
    milestones: [],
    legacyPoints: 0,
    refinementPoints: 0,
    score: 0,
    effects: [],
    stats: {
      battlesWonThisTurn: 0,
      citiesCapturedThisTurn: 0,
      battlesWon: 0,
      battlesWonThisAge: 0,
      citiesCaptured: 0,
      unitsLost: 0,
      wondersBuilt: 0,
      figuresRecruited: 0,
      figuresActivated: 0,
      envoysSent: 0,
      siegeTurnsHeld: 0,
    },
    explored: new Array<number>(tiles).fill(0),
    crisisChoices: [],
    chronicle: [],
  };
};

