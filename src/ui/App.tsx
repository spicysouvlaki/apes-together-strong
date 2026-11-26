/**
 * Root component: routes Title -> Setup -> Game, with the modal host, toasts and confirm
 * dialog layered over whichever route is showing.
 */
import { game, route } from './store';
import { Hud } from './shell/Hud';
import { MapView } from './shell/MapView';
import { ConfirmDialog, ModalHost, Toasts } from './shell/Overlays';
import { GlossarySheet } from './shell/GlossarySheet';
import { CombatSheet } from './shell/CombatSheet';
import { RecruitReveal } from './shell/RecruitReveal';
import { LongPressTip } from './shell/LongPressTip';
import { ResumeRecap } from './shell/ResumeRecap';
import { FirstContact } from './shell/FirstContact';
import { Setup } from './shell/Setup';
import { Title } from './shell/Title';

export function App() {
  const r = route.value;
  return (
    <>
      {r === 'title' && <Title />}
      {r === 'setup' && <Setup />}
      {r === 'game' && game.value && (
        <>
          <MapView />
          <Hud />
          <CombatSheet />
        </>
      )}
      <Toasts />
      <ModalHost />
      {r === 'game' && <RecruitReveal />}
      {r === 'game' && <ResumeRecap />}
      {r === 'game' && <FirstContact />}
      <GlossarySheet />
      <ConfirmDialog />
      <LongPressTip />
    </>
  );
}
