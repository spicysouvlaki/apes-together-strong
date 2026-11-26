/**
 * Screen registry, owned by the SCREENS task. The shell renders `screens[modal.kind]` with
 * `{ modal }` for the kinds listed here when `modal` is set (src/ui/store.ts).
 */
import type { ComponentType } from 'preact';
import type { Modal } from '../store';
import { CabinetScreen } from './cabinet';
import { ChronicleScreen } from './chronicle';
import { CrisisScreen } from './crisis';
import { DiplomacyScreen } from './diplomacy';
import { FigureScreen } from './figure';
import { GovernmentScreen } from './government';
import { LegacyScreen } from './legacy';
import { OfferScreen } from './offer';
import { PeopleScreen } from './people';
import { RosterScreen } from './roster';
import { TransitionScreen } from './transition';
import { TreeScreen } from './tree';
import './screens.css';

export type ScreenKind =
  | 'offer'
  | 'roster'
  | 'figure'
  | 'cabinet'
  | 'government'
  | 'tree'
  | 'diplomacy'
  | 'crisis'
  | 'transition'
  | 'legacy'
  | 'chronicle'
  | 'people';

/** Each screen receives the modal value that opened it. */
export type ScreenProps<K extends ScreenKind = ScreenKind> = { modal: Extract<Modal, { kind: K }> };

export const screens: Partial<{ [K in ScreenKind]: ComponentType<ScreenProps<K>> }> = {
  offer: OfferScreen,
  roster: RosterScreen,
  figure: FigureScreen,
  cabinet: CabinetScreen,
  government: GovernmentScreen,
  tree: TreeScreen,
  diplomacy: DiplomacyScreen,
  crisis: CrisisScreen,
  transition: TransitionScreen,
  legacy: LegacyScreen,
  chronicle: ChronicleScreen,
  people: PeopleScreen,
};

/** True for modal kinds this registry renders. */
export const isScreenKind = (kind: string): kind is ScreenKind => kind in screens;
