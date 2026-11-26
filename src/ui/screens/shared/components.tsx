/** Shared building blocks for the decision screens (art direction: src/ui/styles/base.css). */
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import type { Figure } from '@contracts/content-schemas';
import { closeModal, lookup } from '../../store';
import { ageLabel, bioText, figureUses, KIND_LABEL } from './describe';
import { Icon } from '../../art/Icon';
import type { AnyIconName } from '../../art/icons-data';
import { CultureCrest, FigurePortrait, tonesOf } from '../../art/game-art';
import { KIND_ICON } from '../../art/portrait-spec';

export const cultureName = (id: string): string => lookup.cultures[id]?.name ?? id;
/** The culture's pigment (crest field, weight bars). */
export const cultureColor = (id: string): string => tonesOf(id).base;
export const cultureTint = (id: string): string => tonesOf(id).tint;

/** Full-height screen: sticky header with optional close, scroll body, sticky footer for primary actions. */
export const Screen = (props: {
  title: ComponentChildren;
  /** Omit the close button when false (e.g. the transition cannot be dismissed). */
  closable?: boolean;
  onBack?: (() => void) | undefined;
  headerExtra?: ComponentChildren;
  footer?: ComponentChildren;
  className?: string;
  children: ComponentChildren;
  label: string;
}) => {
  const closable = props.closable ?? true;
  useEffect(() => {
    if (!closable) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closable]);
  return (
    <section class={`screen scr ${props.className ?? ''}`} role="dialog" aria-modal="true" aria-label={props.label}>
      <header class="screen-header">
        {props.onBack && (
          <button class="btn btn-ghost btn-icon" aria-label="Back" onClick={props.onBack}>
            <Icon name="back" />
          </button>
        )}
        <h1>{props.title}</h1>
        {props.headerExtra}
        {closable && (
          <button class="btn btn-ghost btn-icon scr-close" aria-label="Close" onClick={closeModal}>
            <Icon name="close" />
          </button>
        )}
      </header>
      <div class="screen-body">{props.children}</div>
      {props.footer && <footer class="screen-footer scr-footer">{props.footer}</footer>}
    </section>
  );
};

export const Section = (props: { title: ComponentChildren; note?: ComponentChildren; children: ComponentChildren }) => (
  <section class="scr-section">
    <h2 class="section-title">{props.title}</h2>
    {props.note && <p class="muted small scr-note">{props.note}</p>}
    {props.children}
  </section>
);

/** An empty state: a small woodcut vignette (an icon in an inked roundel with sprigs) and a line. */
export const Empty = (props: { children: ComponentChildren; icon?: AnyIconName }) => (
  <div class="scr-empty-wrap">
    <span class="vignette" aria-hidden="true">
      <svg class="vignette-sprigs" viewBox="0 0 120 40" width="120" height="40">
        <path d="M8 22c14-2 26-1 36-6M112 22c-14-2-26-1-36-6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        <path d="M16 20c-1-4 1-7 4-8 0 4-1 6-4 8zM26 19c-1-4 1-7 4-8 0 4-1 6-4 8zM36 17c-1-4 1-7 4-8 0 4-1 6-4 8zM104 20c1-4-1-7-4-8 0 4 1 6 4 8zM94 19c1-4-1-7-4-8 0 4 1 6 4 8zM84 17c1-4-1-7-4-8 0 4 1 6 4 8z" fill="currentColor" />
      </svg>
      <span class="vignette-roundel">
        <Icon name={props.icon ?? 'legend'} />
      </span>
    </span>
    <p class="scr-empty muted">{props.children}</p>
  </div>
);

export const Portrait = (props: { figure: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) => <FigurePortrait figure={props.figure} size={props.size ?? 'md'} />;

export const CultureChip = (props: { culture: string; suffix?: ComponentChildren }) => (
  <span class="chip scr-culture-chip" style={{ background: cultureTint(props.culture) }}>
    <CultureCrest culture={props.culture} size={15} />
    {cultureName(props.culture)}
    {props.suffix}
  </span>
);

export const Bar = (props: { value: number; max: number; ticks?: readonly number[]; label: string; color?: string }) => {
  const pct = props.max > 0 ? Math.max(0, Math.min(100, (props.value / props.max) * 100)) : 0;
  return (
    <div class="scr-bar" role="progressbar" aria-label={props.label} aria-valuemin={0} aria-valuemax={props.max} aria-valuenow={props.value}>
      <div class="scr-bar-fill" style={{ width: `${pct}%`, background: props.color ?? 'var(--accent)' }} />
      {(props.ticks ?? []).map((t) => (
        <i class="scr-bar-tick" style={{ left: `${props.max > 0 ? (t / props.max) * 100 : 0}%` }} />
      ))}
    </div>
  );
};

/** Bottom sheet over a screen, with a dimmed backdrop. Tap outside to cancel. */
export const Sheet = (props: { title: ComponentChildren; onCancel: () => void; children: ComponentChildren; footer?: ComponentChildren }) => (
  <div class="scr-backdrop" onClick={props.onCancel}>
    <div class="sheet scr-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
      <div class="row">
        <h2 class="grow scr-sheet-title">{props.title}</h2>
        <button class="btn btn-ghost btn-icon" aria-label="Cancel" onClick={props.onCancel}>
          <Icon name="close" />
        </button>
      </div>
      <div class="scr-sheet-body">{props.children}</div>
      {props.footer && <div class="scr-sheet-footer">{props.footer}</div>}
    </div>
  </div>
);

export const ConfirmSheet = (props: {
  title: ComponentChildren;
  children: ComponentChildren;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) => (
  <Sheet
    title={props.title}
    onCancel={props.onCancel}
    footer={
      <>
        <button class="btn" onClick={props.onCancel}>
          Cancel
        </button>
        <button class={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} onClick={props.onConfirm}>
          {props.confirmLabel}
        </button>
      </>
    }
  >
    {props.children}
  </Sheet>
);

/** Portrait, name, culture, kind, age; then (unless compact) bio, quote and concrete uses. */
export const FigureCard = (props: {
  def: Figure;
  reason?: string | null | undefined;
  compact?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  extra?: ComponentChildren;
  status?: ComponentChildren;
  /** Position in a dealt hand: staggers the card's deal-in animation. */
  deal?: number;
}) => {
  const { def } = props;
  const uses = props.compact ? [] : figureUses(def, lookup);
  const body = (
    <>
      <div class="row scr-fig-head">
        <Portrait figure={def.id} size={props.compact ? 'sm' : 'md'} />
        <div class="grow">
          <div class="scr-fig-name">{def.name}</div>
          <div class="scr-chips">
            <CultureChip culture={def.culture} />
            <span class="chip">
              <Icon name={KIND_ICON[def.kind]} size="sm" />
              {KIND_LABEL[def.kind]}
            </span>
            {!props.compact && <span class="chip">{ageLabel(def.age)}</span>}
            {!props.compact && def.archetype && (
              <span class="chip scr-chip-archetype" title="A role the record keeps without a name">
                Archetype
              </span>
            )}
          </div>
          {props.status && <div class="small muted scr-fig-status">{props.status}</div>}
        </div>
      </div>
      {props.reason && (
        <blockquote class="scr-reason">
          <span class="scr-reason-mark" aria-hidden="true">“</span>
          {capitalizeFirst(props.reason).replace(/[.\s]+$/, '')}.
        </blockquote>
      )}
      {!props.compact && <p class="scr-bio">{bioText(def.bio)}</p>}
      {!props.compact && def.quote && <blockquote class="scr-quote">{def.quote}</blockquote>}
      {uses.length > 0 && (
        <dl class="scr-uses">
          {uses.map((u) => (
            <div class="scr-use">
              <dt>{u.label}</dt>
              <dd>{u.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {props.extra}
    </>
  );
  if (props.onSelect) {
    return (
      <button
        type="button"
        class={`card scr-fig-card scr-tap ${props.selected ? 'scr-selected' : ''}${props.deal !== undefined ? ' scr-deal' : ''}`}
        style={props.deal !== undefined ? { animationDelay: `${props.deal * 90}ms` } : undefined}
        aria-pressed={props.selected ? 'true' : 'false'}
        aria-label={`${def.name}, ${cultureName(def.culture)} ${KIND_LABEL[def.kind]}`}
        onClick={props.onSelect}
      >
        {body}
      </button>
    );
  }
  return <div class="card scr-fig-card">{body}</div>;
};

const capitalizeFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Culture weight bars: how the player's culture is taking shape (GDD §6, public). */
export const WeightBars = (props: { rows: { culture: string; weight: number }[] }) => {
  const max = props.rows.reduce((m, r) => Math.max(m, r.weight), 0);
  return (
    <ul class="scr-weights" aria-label="Culture weight">
      {props.rows.map((r) => (
        <li class="scr-weight-row">
          <CultureCrest culture={r.culture} size={20} />
          <span class="scr-weight-name">{cultureName(r.culture)}</span>
          <div class="grow">
            <Bar value={r.weight} max={Math.max(max, 5)} label={`${cultureName(r.culture)} weight ${r.weight}`} color={cultureColor(r.culture)} />
          </div>
          <span class="scr-weight-num">{r.weight}</span>
        </li>
      ))}
    </ul>
  );
};
