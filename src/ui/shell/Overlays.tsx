/**
 * Toast stack, confirm dialog and the modal host that routes `modal` to shell panels or to the
 * sibling's screen registry (src/ui/screens/index.ts).
 */
import { useEffect } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { closeModal, confirmRequest, dismissToast, modal, openModal, toasts, type Modal, type Toast } from '../store';
import { screens, type ScreenKind } from '../screens';
import { CitySheet } from './CitySheet';
import { toastDuration } from './event-toasts';
import { MenuPanel, SavesPanel, SettingsPanel } from './Panels';
import { TileInfo } from './TileInfo';
import { Icon } from '../art/Icon';

function ToastItem({ t }: { t: Toast }) {
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(t.id), toastDuration(t.tone));
    return () => clearTimeout(timer);
  }, [t.id]);
  return (
    <button
      class={`toast tone-${t.tone}`}
      onClick={() => {
        dismissToast(t.id);
        if (t.action) openModal(t.action);
      }}
      aria-label={t.action ? `${t.text} Tap to open.` : t.text}
    >
      <span class="toast-text">{t.text}</span>
      {t.action && <Icon name="chevron" size="sm" />}
    </button>
  );
}

/** Map sheets leave the map in view; every other modal is a full screen. */
const SHEET_KINDS: ReadonlySet<string> = new Set(['city', 'tileInfo']);

export function Toasts() {
  const list = toasts.value;
  if (list.length === 0) return null;
  // Held (not lost) while a full screen is up: unmounting pauses their timers, and they come
  // back when the screen closes, so "war declared on us" survives a long decision screen.
  const m = modal.value;
  if (m && !SHEET_KINDS.has(m.kind)) return null;
  return (
    <div class="toasts" role="log" aria-live="polite">
      {list.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
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
    default: {
      // The registry is keyed by kind; each screen takes the modal that opened it.
      const Screen = screens[m.kind as ScreenKind] as ComponentType<{ modal: Modal }> | undefined;
      return Screen ? <Screen modal={m} /> : <Placeholder m={m} />;
    }
  }
}
