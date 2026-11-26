/** Figure offer (GDD §4): the heart of the game. Pick one of up to three, or send them on. */
import { useEffect, useState } from 'preact/hooks';
import { closeModal, content, dispatch, game, lookup, me, myTurn, openModal } from '../store';
import type { ScreenProps } from './index';
import { Empty, FigureCard, Screen } from './shared/components';
import { nextOffer, offerPosition, offerView } from './shared/offer';
import { shortName } from './shared/describe';
import { Icon } from '../art/Icon';
import { KIND_ICON } from '../art/portrait-spec';
import { guide } from '../shell/guide-state';

const motionOff = (): boolean =>
  document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;

const offerIcon = (id: string | undefined) => {
  const k = id ? lookup.figures[id]?.kind : undefined;
  return k ? KIND_ICON[k] : 'figures';
};

export const OfferScreen = ({ modal }: ScreenProps<'offer'>) => {
  const g = game.value;
  const player = me.value;
  const offer = g?.offers.find((o) => o.id === modal.offer && o.player === player) ?? null;
  const [selected, setSelected] = useState<string | null>(null);
  // Set for a moment after Welcome: the wax seal stamps the chosen card before the screen moves on.
  const [sealed, setSealed] = useState(false);

  // A new offer opened in the same screen: reset the selection; preselect a lone candidate.
  useEffect(() => {
    setSelected(offer && offer.candidates.length === 1 ? (offer.candidates[0] ?? null) : null);
    setSealed(false);
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
    if (!selected || !chosenDef || sealed) return;
    dispatch({ type: 'chooseOffer', offer: offer.id, figure: selected });
    // The shell already toasts the figureRecruited event (tap to open the figure).
    if (motionOff()) {
      goOn();
      return;
    }
    setSealed(true);
    setTimeout(goOn, 520);
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
          <button class="btn btn-primary btn-wide scr-welcome" disabled={!chosenDef || !canAct || sealed} onClick={welcome} aria-label={chosenDef ? `Welcome ${chosenDef.name}` : 'Choose someone to welcome'}>
            {chosenDef ? (
              <>
                <Icon name="seat" /> Welcome {shortName(chosenDef.name)}
              </>
            ) : (
              'Tap someone to welcome them'
            )}
          </button>
          <button class="btn btn-wide" disabled={!canAct || sealed} onClick={decline} aria-label={view.declineLabel}>
            {view.declineLabel}
          </button>
        </>
      }
    >
      <div class="scr-offer-hero">
        <div class="scr-offer-sigil" aria-hidden="true">
          <Icon name={view.tone === 'legend' ? 'legend' : view.tone === 'deed' ? 'chronicle' : offerIcon(offer.candidates[0])} />
        </div>
        <span class="scr-tag">{view.eyebrow}</span>
        <h2>{view.title}</h2>
        {view.story && <p class="scr-offer-story">{view.story}</p>}
      </div>
      {!guide.value.disabled && (g.players[player]?.stats.figuresRecruited ?? 0) === 0 && (
        <aside class="advice advice-inline" aria-label="The Chronicler on great people">
          <div class="advice-who">
            <span class="advice-quill" aria-hidden="true">
              <Icon name="chronicle" size="sm" />
            </span>
            <span class="advice-name">The Chronicler</span>
          </div>
          <p class="advice-text">
            Each of them lived: a named person, or a role the record keeps without a name. They came because of how and where you play; the line under each name says what drew them.
            Welcome one: later you can seat them in your cabinet, deploy them on the map, spend them on a great deed, or consume them for points.
          </p>
        </aside>
      )}
      {offer.candidates.map((id, i) => {
        const def = lookup.figures[id];
        if (!def) return null;
        return (
          <div class={`scr-offer-slot${sealed && selected === id ? ' is-sealed' : ''}${sealed && selected !== id ? ' is-passed' : ''}`} key={`${offer.id}:${id}`}>
          <FigureCard
            deal={i}
            def={def}
            // A deed offer's reason is the deed's story, already shown above.
            reason={view.tone === 'deed' ? null : offer.reasons[id]}
            selected={selected === id}
            onSelect={() => !sealed && setSelected(id)}
          />
          {sealed && selected === id && (
            <span class="scr-wax" aria-hidden="true">
              <Icon name="seat" />
            </span>
          )}
          </div>
        );
      })}
      <p class="small muted scr-decline-note">{view.declineNote}</p>
      {!canAct && <p class="small muted scr-decline-note">You can answer on your turn.</p>}
    </Screen>
  );
};
