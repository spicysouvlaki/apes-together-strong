/**
 * Tappable glossary terms (`<Term id=…>`), auto-linked text (`<GlossText text=…>`) and the
 * explainer sheet they open. The sheet sits above every screen (it explains words on them).
 */
import type { ComponentChildren } from 'preact';
import { signal } from '@preact/signals';
import { GLOSSARY, splitTerms, type GlossaryId } from './glossary-terms';
import { Icon } from '../art/Icon';

export const glossaryOpen = signal<GlossaryId | null>(null);

/**
 * A span with button semantics rather than a <button>: terms sit inside other buttons (leader
 * cards in setup), where a nested button is invalid. Keyboard: Enter/Space open it.
 */
export function Term({ id, children }: { id: GlossaryId; children?: ComponentChildren }) {
  const open = (e: Event): void => {
    // Inside a choice card (setup leaders, production rows, tech nodes) the term covers much of
    // the card, so a tap meant for the card must still choose it: let the click bubble there
    // and explain the term on top. Elsewhere the term is the only target.
    const host = (e.currentTarget as HTMLElement | null)?.parentElement?.closest('button, [role="radio"], [role="option"]');
    if (!host) {
      e.stopPropagation();
      e.preventDefault();
    }
    glossaryOpen.value = id;
  };
  return (
    <span
      role="button"
      tabIndex={0}
      class="term"
      aria-label={`${GLOSSARY[id].term}: what is this?`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') open(e);
      }}
    >
      {children ?? GLOSSARY[id].term.toLowerCase()}
    </span>
  );
}

/** Plain text with the first mention of each glossary term made tappable. */
export function GlossText({ text }: { text: string }) {
  return (
    <>
      {splitTerms(text).map((p, i) => ('term' in p ? <Term key={i} id={p.term}>{p.text}</Term> : p.text))}
    </>
  );
}

export function GlossarySheet() {
  const id = glossaryOpen.value;
  if (!id) return null;
  const e = GLOSSARY[id];
  const close = (): void => {
    glossaryOpen.value = null;
  };
  return (
    <div class="gloss-backdrop" onClick={close}>
      <section class="sheet gloss-sheet" role="dialog" aria-modal="true" aria-label={e.term} onClick={(ev) => ev.stopPropagation()}>
        <div class="row">
          <h2 class="sheet-title grow">{e.term}</h2>
          <button class="btn btn-ghost btn-icon" aria-label="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
        <p class="gloss-text">{e.text}</p>
      </section>
    </div>
  );
}
