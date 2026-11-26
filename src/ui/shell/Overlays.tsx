/**
 * Toast stack, confirm dialog and the modal host that routes `modal` to shell panels or to the
 * sibling's screen registry (src/ui/screens/index.ts).
 */
import { useEffect } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { signal } from '@preact/signals';
import { closeModal, confirmRequest, dismissToast, focusMap, modal, openModal, route, selection, toasts, type Modal, type Toast } from '../store';
import { CodexScreen } from './Codex';
import { TurnLog } from './TurnLog';
import { screens, type ScreenKind } from '../screens';
import { CitySheet } from './CitySheet';
import { SLIP_DURATION_MS, splitToasts, tickerDuration, tickerMore } from './ticker';
import { MenuPanel, SavesPanel, SettingsPanel } from './Panels';
import { TileInfo } from './TileInfo';
import { Icon } from '../art/Icon';
import { recruitReveal } from './recruit-reveal';

/** Act on a toast: center the map where it happened and/or open what it points at. */
const actOn = (t: Toast): void => {
  dismissToast(t.id);
  if (t.at) focusMap(t.at);
  if (t.action) openModal(t.action);
};

/** Map sheets leave the map in view; every other modal is a full screen. */
const SHEET_KINDS: ReadonlySet<string> = new Set(['city', 'tileInfo', 'log']);

const tickerOpen = signal(false);

/**
 * One line under the top bar: the newest piece of news, one at a time. Tap the line to act on it
 * (show it on the map, open its screen); tap the count to unfold this turn's news.
 */
function Ticker({ items }: { items: Toast[] }) {
  const t = items[0];
  const open = tickerOpen.value;
  useEffect(() => {
    if (!t || open) return undefined;
    const timer = setTimeout(() => dismissToast(t.id), tickerDuration(t.tone));
    return () => clearTimeout(timer);
  }, [t?.id, open]);
  useEffect(() => {
    if (items.length === 0 && open) tickerOpen.value = false;
  }, [items.length, open]);
  if (!t) return null;
  const more = tickerMore(items.length);
  const actionable = !!(t.action || t.at);
  return (
    <div class={`ticker${open ? ' is-open' : ''}`}>
      <div class={`ticker-line tone-${t.tone}`}>
        <button
          key={t.id}
          class="ticker-text"
          onClick={() => (actionable ? actOn(t) : (tickerOpen.value = !open))}
          aria-label={actionable ? `${t.text} ${t.action ? 'Tap to open.' : 'Tap to show on the map.'}` : t.text}
        >
          <span class="ticker-ribbon" aria-hidden="true" />
          <span class="ticker-words">{t.text}</span>
          {actionable && <Icon name="chevron" size="sm" />}
        </button>
        <button
          class="ticker-more"
          aria-expanded={open}
          aria-label={open ? 'Fold the news' : `Show this turn's news${more ? `, ${items.length} items` : ''}`}
          onClick={() => (tickerOpen.value = !open)}
        >
          {more && <span class="tnum">{more}</span>}
          <Icon name={open ? 'close' : 'turn'} size="sm" />
        </button>
      </div>
      {open && (
        <div class="ticker-list card" role="log" aria-label="This turn's news">
          {items.map((x) => (
            <button key={x.id} class={`ticker-item tone-${x.tone}`} onClick={() => (x.action || x.at ? actOn(x) : dismissToast(x.id))}>
              <span class="grow">{x.text}</span>
              {(x.action || x.at) && <Icon name="chevron" size="sm" />}
            </button>
          ))}
          <button
            class="btn btn-ghost ticker-log"
            onClick={() => {
              tickerOpen.value = false;
              openModal({ kind: 'log' });
            }}
          >
            <Icon name="chronicle" size="sm" /> All recent events
          </button>
        </div>
      )}
    </div>
  );
}

/** A threat the player must see now (war on us, a city attacked, raiders): a madder slip. */
function ThreatSlip({ t, i }: { t: Toast; i: number }) {
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(t.id), SLIP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [t.id]);
  return (
    <div class="threat-slip" role="alert" style={{ animationDelay: `${i * 80}ms` }}>
      <span class="threat-seal" aria-hidden="true">
        <Icon name="war" />
      </span>
      <button class="threat-text" onClick={() => actOn(t)} aria-label={`${t.text} ${t.action || t.at ? 'Tap to show.' : ''}`}>
        {t.text}
      </button>
      <button class="threat-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
        <Icon name="close" size="sm" />
      </button>
    </div>
  );
}

export function Toasts() {
  const list = toasts.value;
  if (list.length === 0) return null;
  // Held (not lost) while a full screen is up: unmounting pauses their timers, and they come
  // back when the screen closes, so "war declared on us" survives a long decision screen.
  const m = modal.value;
  if (m && !SHEET_KINDS.has(m.kind)) return null;
  // The recruit reveal covers the screen too: hold news under it, or its timers run out unseen
  // (playtest 4: "Crisis: Collapse has begun" expired behind a welcome ceremony).
  if (recruitReveal.value) return null;
  // Once the player has a unit in hand they are answering the threat: the slips fold into the
  // one-line ticker so they no longer cover the raiders the unit is about to strike (playtest 3).
  const answering = selection.value.unit !== null;
  const { slips, ticker } = answering ? { slips: [], ticker: list } : splitToasts(list);
  return (
    <div class={`toasts${route.value === 'game' ? '' : ' toasts-free'}`} aria-live="polite">
      <Ticker items={ticker} />
      {slips.length > 0 && (
        <div class="threat-slips">
          {slips.map((t, i) => (
            <ThreatSlip key={t.id} t={t} i={i} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ConfirmDialog() {
  const req = confirmRequest.value;
  if (!req) return null;
  const done = (ok: boolean): void => {
    confirmRequest.value = null;
    if (ok) req.onConfirm();
    else req.onCancel?.();
  };
  return (
    <div class="confirm-backdrop" role="alertdialog" aria-modal="true" aria-label={req.title}>
      <div class="confirm card">
        <h2 class="sheet-title">{req.title}</h2>
        {req.body && <p class="small">{req.body}</p>}
        <div class="row confirm-buttons">
          <button class="btn grow" onClick={() => done(false)}>
            {req.cancelLabel ?? 'Cancel'}
          </button>
          <button class={`btn grow ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => done(true)}>
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Placeholder({ m }: { m: Modal }) {
  return (
    <section class="sheet" role="dialog" aria-label="Coming soon">
      <div class="row">
        <h2 class="sheet-title grow">{m.kind[0]?.toUpperCase() + m.kind.slice(1)}</h2>
        <button class="btn" onClick={closeModal}>
          Close
        </button>
      </div>
      <p class="small muted">This screen is not built yet.</p>
    </section>
  );
}

export function ModalHost() {
  const m = modal.value;
  if (!m) return null;
  switch (m.kind) {
    case 'city':
      return <CitySheet key={m.settlement} settlement={m.settlement} />;
    case 'tileInfo':
      return <TileInfo hex={m.hex} />;
    case 'menu':
      return <MenuPanel />;
    case 'saves':
      return <SavesPanel />;
    case 'settings':
      return <SettingsPanel />;
    case 'codex':
      return <CodexScreen />;
    case 'log':
      return <TurnLog />;
    default: {
      // The registry is keyed by kind; each screen takes the modal that opened it.
      const Screen = screens[m.kind as ScreenKind] as ComponentType<{ modal: Modal }> | undefined;
      return Screen ? <Screen modal={m} /> : <Placeholder m={m} />;
    }
  }
}
