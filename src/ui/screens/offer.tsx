/** Figure offer (GDD §4): the heart of the game. Pick one of up to three, or send them on. */
import { useEffect, useState } from 'preact/hooks';
import { closeModal, content, dispatch, game, lookup, me, myTurn, openModal } from '../store';
import type { ScreenProps } from './index';
import { Empty, FigureCard, Screen } from './shared/components';
import { nextOffer, offerPosition, offerView } from './shared/offer';

export const OfferScreen = ({ modal }: ScreenProps<'offer'>) => {
  const g = game.value;
  const player = me.value;
  const offer = g?.offers.find((o) => o.id === modal.offer && o.player === player) ?? null;
  const [selected, setSelected] = useState<string | null>(null);

  // A new offer opened in the same screen: reset the selection; preselect a lone candidate.
  useEffect(() => {
    setSelected(offer && offer.candidates.length === 1 ? (offer.candidates[0] ?? null) : null);
  }, [modal.offer, offer?.candidates.length]);

  if (!g || !player || !offer) {
    return (
      <Screen title="Great people" label="Figure offer">
        <Empty>This offer is no longer open. Someone may have joined a rival.</Empty>
      </Screen>
    );
  }

  const view = offerView(offer, content);
  const pos = offerPosition(g.offers, player, offer.id);
  const chosenDef = selected ? lookup.figures[selected] : undefined;
  const canAct = myTurn.value;

  const goOn = () => {
    const next = nextOffer(g.offers, player, offer.id);
    if (next) openModal({ kind: 'offer', offer: next.id });
    else closeModal();
  };

  const welcome = () => {
    if (!selected || !chosenDef) return;
    dispatch({ type: 'chooseOffer', offer: offer.id, figure: selected });
    // The shell already toasts the figureRecruited event (tap to open the figure).
    goOn();
  };

  const decline = () => {
    dispatch({ type: 'chooseOffer', offer: offer.id, figure: null });
    goOn();
  };

  return (
    <Screen
      title={pos ? `Offer ${pos}` : 'Great people'}
      label="Figure offer"
      className={`scr-offer scr-offer-${view.tone}`}
      footer={
        <>
          <button class="btn btn-primary btn-wide" disabled={!chosenDef || !canAct} onClick={welcome} aria-label={chosenDef ? `Welcome ${chosenDef.name}` : 'Choose someone to welcome'}>
            {chosenDef ? `Welcome ${chosenDef.name}` : 'Tap someone to welcome them'}
          </button>
          <button class="btn btn-wide" disabled={!canAct} onClick={decline} aria-label={view.declineLabel}>
            {view.declineLabel}
          </button>
        </>
      }
    >
      <div class="scr-offer-hero">
        <span class="scr-tag">{view.eyebrow}</span>
        <h2>{view.title}</h2>
        {view.story && <p class="scr-offer-story">{view.story}</p>}
      </div>
      {offer.candidates.map((id) => {
        const def = lookup.figures[id];
        if (!def) return null;
        return (
          <FigureCard
            key={id}
            def={def}
            // A deed offer's reason is the deed's story, already shown above.
            reason={view.tone === 'deed' ? null : offer.reasons[id]}
            selected={selected === id}
            onSelect={() => setSelected(id)}
          />
        );
      })}
      <p class="small muted scr-decline-note">{view.declineNote}</p>
      {!canAct && <p class="small muted scr-decline-note">You can answer on your turn.</p>}
    </Screen>
  );
};
