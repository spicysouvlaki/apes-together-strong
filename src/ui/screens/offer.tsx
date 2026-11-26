/** Figure offer (GDD §4): the heart of the game. Pick one of up to three, or send them on. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { closeModal, content, dispatch, game, lookup, me, myTurn, openModal } from '../store';
import type { ScreenProps } from './index';
import { cultureName, Empty, FigureCard, Screen } from './shared/components';
import { inSentence } from './shared/describe';
import { clampIndex, deckItems, indexFromScroll } from './shared/offer-deck';
import { CultureCrest, FigurePortrait } from '../art/game-art';
import { showRecruitReveal } from '../shell/recruit-reveal';
import { nextOffer, offerPosition, offerView } from './shared/offer';
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
  // The card in view is the one the footer welcomes (swipe, or tap the strip).
  const [index, setIndex] = useState(0);
  // Set for a moment after Welcome: the wax seal stamps the chosen card before the screen moves on.
  const [sealed, setSealed] = useState(false);
  const row = useRef<HTMLDivElement>(null);

  // A new offer opened in the same screen: back to the first card.
  useEffect(() => {
    setIndex(0);
    setSealed(false);
    row.current?.scrollTo({ left: 0 });
  }, [modal.offer]);

  if (!g || !player || !offer) {
    return (
      <Screen title="Great people" label="Figure offer">
        <Empty icon="figures">This offer is no longer open. Someone may have joined a rival.</Empty>
      </Screen>
    );
  }

  const view = offerView(offer, content);
  const pos = offerPosition(g.offers, player, offer.id);
  // A deed offer's reason is the deed's story, already shown above.
  const items = deckItems(offer, lookup.figures, lookup, view.tone !== 'deed');
  const i = clampIndex(index, items.length);
  const current = items[i];
  const chosenDef = current ? lookup.figures[current.id] : undefined;
  const canAct = myTurn.value;

  const goOn = () => {
    const next = nextOffer(g.offers, player, offer.id);
    if (next) openModal({ kind: 'offer', offer: next.id });
    else closeModal();
  };

  const jump = (k: number) => {
    const el = row.current;
    const card = el?.children[k] as HTMLElement | undefined;
    setIndex(k);
    if (el && card) el.scrollTo({ left: card.offsetLeft - el.offsetLeft - (el.clientWidth - card.clientWidth) / 2, behavior: motionOff() ? 'auto' : 'smooth' });
  };

  const onScroll = () => {
    const el = row.current;
    const first = el?.children[0] as HTMLElement | undefined;
    const second = el?.children[1] as HTMLElement | undefined;
    if (!el || !first) return;
    const step = second ? second.offsetLeft - first.offsetLeft : first.clientWidth;
    const k = indexFromScroll(el.scrollLeft, step, items.length);
    if (k !== index) setIndex(k);
  };

  const welcome = () => {
    if (!current || !chosenDef || sealed) return;
    dispatch({ type: 'chooseOffer', offer: offer.id, figure: current.id });
    // The shell already voices figureRecruited (the "answer" to the offer's call); the reveal
    // celebrates it, then offers the best next step for this figure.
    const reveal = () => showRecruitReveal(current.id);
    if (motionOff()) {
      goOn();
      reveal();
      return;
    }
    setSealed(true);
    setTimeout(() => {
      goOn();
      reveal();
    }, 480);
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
        <div class="deck-footer">
          <button
            class="btn btn-primary btn-wide scr-welcome"
            disabled={!chosenDef || !canAct || sealed}
            onClick={welcome}
            aria-label={chosenDef ? `Welcome ${inSentence(chosenDef.name)}` : 'Choose someone to welcome'}
          >
            <Icon name="seat" /> {current ? `Welcome ${inSentence(current.short)}` : 'Welcome'}
          </button>
          <button class="btn btn-ghost deck-skip" disabled={!canAct || sealed} onClick={decline} aria-label={view.declineLabel}>
            {view.declineLabel}
          </button>
        </div>
      }
    >
      <div class="scr-offer-hero deck-hero">
        <div class="scr-offer-sigil" aria-hidden="true">
          <Icon name={view.tone === 'legend' ? 'legend' : view.tone === 'deed' ? 'chronicle' : offerIcon(offer.candidates[0])} />
        </div>
        <div class="grow">
          {/* "Great people" is already the screen's title; deeds and legends keep their eyebrow. */}
          {view.tone !== 'points' && <span class="scr-tag">{view.eyebrow}</span>}
          <h2>{view.title}</h2>
        </div>
      </div>
      {view.story && <p class="scr-offer-story">{view.story}</p>}
      {!guide.value.disabled && (g.players[player]?.stats.figuresRecruited ?? 0) === 0 && (
        <aside class="advice advice-inline" aria-label="The Chronicler on great people">
          <div class="advice-who">
            <span class="advice-quill" aria-hidden="true">
              <Icon name="chronicle" size="sm" />
            </span>
            <span class="advice-name">The Chronicler</span>
          </div>
          <p class="advice-text">
            Each of them lived: a named person, or a role the record keeps without a name. They came because of how and where you play; the line in gold says what drew them.
            {items.length > 1 ? ' Swipe to compare, then welcome one.' : ' Welcome them, or send them on.'} Later you can seat them in your cabinet, deploy them on the map, spend them on a great deed, or consume them for points.
          </p>
        </aside>
      )}
      {items.length > 1 && (
        <div class="deck-strip" role="tablist" aria-label="Candidates" style={{ '--n': items.length }}>
          {items.map((it, k) => (
            <button
              key={it.id}
              role="tab"
              aria-selected={k === i ? 'true' : 'false'}
              class={`deck-chip${k === i ? ' on' : ''}`}
              onClick={() => jump(k)}
              aria-label={`${it.name}, ${cultureName(it.culture)} ${it.kindLabel}. ${it.oneLine}`}
            >
              <span class="deck-chip-face">
                <FigurePortrait figure={it.id} size="xs" />
                <span class="deck-chip-crest">
                  <CultureCrest culture={it.culture} size={14} />
                </span>
              </span>
              <span class="deck-chip-text">
                <span class="deck-chip-name">
                  <Icon name={KIND_ICON[it.kind]} size="sm" /> <span class="deck-chip-short">{it.short}</span>
                </span>
                <span class="deck-chip-line">{it.oneLine}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <div class={`deck-row${items.length === 1 ? ' single' : ''}`} ref={row} onScroll={onScroll}>
        {items.map((it, k) => {
          const def = lookup.figures[it.id];
          if (!def) return null;
          return (
            <div
              class={`deck-slide scr-offer-slot${sealed && k === i ? ' is-sealed' : ''}${sealed && k !== i ? ' is-passed' : ''}`}
              key={`${offer.id}:${it.id}`}
              aria-hidden={k === i ? undefined : 'true'}
            >
              <FigureCard deal={k} def={def} reason={it.reason} selected={k === i && items.length > 1} onSelect={() => jump(k)} />
              {sealed && k === i && (
                <span class="scr-wax" aria-hidden="true">
                  <Icon name="seat" />
                </span>
              )}
            </div>
          );
        })}
      </div>
      {items.length > 1 && (
        <div class="deck-pips" aria-hidden="true">
          {items.map((_, k) => (
            <i class={k === i ? 'on' : ''} />
          ))}
        </div>
      )}
      <p class="small muted scr-decline-note">{view.declineNote}</p>
      {!canAct && <p class="small muted scr-decline-note">You can answer on your turn.</p>}
    </Screen>
  );
};
