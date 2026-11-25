/**
 * Map HUD (GDD §11): 44px top bar with stockpiles, happiness, age meter and turn; bottom-left
 * quick buttons; bottom-right End Turn / "Next: …"; next-unit cycling; the unit sheet.
 * Portrait, one-handed, 44px targets, safe-area aware.
 */
import { computed } from '@preact/signals';
import {
  askConfirm,
  content,
  dispatch,
  focusMap,
  game,
  me,
  modal,
  myPlayer,
  myTurn,
  openModal,
  q,
  selection,
  thinking,
} from '../store';
import { screens, type ScreenKind } from '../screens';
import type { ModalKind } from '../store';
import { decisionLabel, decisionModal, planEndTurn } from './decisions';
import { AGE_NAME, HUD_YIELDS, YIELD_GLYPH, YIELD_NAME, happinessFace, happinessWord, num, signed } from './format';
import { idleUnits, nextIdleUnit } from './hexutil';
import { selectUnit } from './MapView';
import { idleConfirmedTurn, skipped } from './shell-state';
import { UnitSheet } from './UnitSheet';

const SHELL_KINDS: ReadonlySet<ModalKind> = new Set(['city', 'tileInfo', 'menu', 'saves', 'settings']);
export const isRegistered = (kind: ModalKind): boolean => SHELL_KINDS.has(kind) || !!screens[kind as ScreenKind];

const pending = computed(() => {
  const g = game.value;
  const my = me.value;
  return g && my ? q.pendingDecisions(g, my, content) : [];
});

const plan = computed(() => planEndTurn(pending.value, isRegistered));

function TopBar() {
  const p = myPlayer.value;
  const g = game.value;
  if (!p || !g) return null;
  const crisis = g.crisis !== null;
  return (
    <header class="hud-top" aria-label="Empire status">
      <div class="hud-yields">
        {HUD_YIELDS.map((y) => (
          <div class="hud-yield" key={y} aria-label={`${YIELD_NAME[y]} ${Math.floor(p.stock[y])}, ${signed(p.income[y])} per turn`}>
            <span class="hud-yield-top">
              <span aria-hidden="true">{YIELD_GLYPH[y]}</span> {Math.floor(p.stock[y])}
            </span>
            <span class="hud-yield-inc">{signed(p.income[y])}</span>
          </div>
        ))}
      </div>
      <button class="hud-icon" aria-label="Menu" onClick={() => openModal({ kind: 'menu' })}>
        ☰
      </button>
      <div class="hud-sub">
        <span class="hud-pill" role="img" aria-label={`Happiness ${num(p.happiness)}, ${happinessWord(p.happiness)}`}>
          {happinessFace(p.happiness)} {num(p.happiness)}
        </span>
        <button
          class={`hud-age${crisis ? ' crisis' : ''}`}
          aria-label={`${AGE_NAME[g.age]} age, ${Math.floor(g.ageProgress)} percent${crisis ? ', crisis under way' : ''}. Open legacy.`}
          onClick={() => openModal({ kind: 'legacy' })}
        >
          <span class="hud-age-name">{AGE_NAME[g.age]}</span>
          <span class="hud-meter" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, g.ageProgress))}%` }} />
          </span>
        </button>
        <span class="hud-pill" aria-label={`Turn ${g.turn}`}>
          Turn {g.turn}
        </span>
      </div>
    </header>
  );
}

const endTurn = (): void => {
  const g = game.value;
  if (!g || !myTurn.value) return;
  const pl = plan.value;
  if (pl.mode === 'next' && pl.next) {
    openDecision(pl.next);
    return;
  }
  const idle = pl.idleCities[0];
  if (idle && idleConfirmedTurn.value !== g.turn) {
    idleConfirmedTurn.value = g.turn;
    askConfirm({
      title: 'A city has nothing to build',
      body: 'You can end the turn anyway; the production is lost.',
      confirmLabel: 'End turn',
      cancelLabel: 'Choose production',
      onConfirm: () => dispatch({ type: 'endTurn' }),
      onCancel: () => openDecision({ type: 'production', settlement: idle }),
    });
    return;
  }
  selectUnit(null);
  dispatch({ type: 'endTurn' });
};

const openDecision = (d: Parameters<typeof decisionModal>[0]): void => {
  const m = decisionModal(d);
  if (m.kind === 'city') {
    const s = game.value?.settlements[m.settlement];
    if (s) focusMap(s.at);
  }
  openModal(m);
};

function EndTurnButton() {
  const pl = plan.value;
  const busy = thinking.value !== null;
  const disabled = busy || !myTurn.value;
  const label = busy ? 'Rivals are moving…' : pl.mode === 'next' && pl.next ? `Next: ${decisionLabel(pl.next)}` : 'End Turn';
  const badge = pl.mode === 'end' ? pl.advisory.length : 0;
  return (
    <button
      class={`btn btn-primary end-turn${pl.mode === 'next' ? ' is-next' : ''}`}
      disabled={disabled}
      onClick={endTurn}
      aria-label={badge > 0 ? `${label}. ${badge} things still open.` : label}
    >
      {pl.mode === 'next' && pl.next && !busy ? (
        <span class="end-turn-two" aria-hidden="true">
          <span class="end-turn-kicker">Next</span>
          <span>{decisionLabel(pl.next)}</span>
        </span>
      ) : (
        <span aria-hidden="true">{busy ? 'Rivals…' : label}</span>
      )}
      {badge > 0 && (
        <span class="badge" aria-hidden="true">
          {badge}
        </span>
      )}
    </button>
  );
}

function AdvisoryChip() {
  const pl = plan.value;
  const next = pl.mode === 'end' ? pl.next : null;
  if (!next || !myTurn.value) return null;
  return (
    <button class="btn advisory" onClick={() => openDecision(next)} aria-label={`Open ${decisionLabel(next)}`}>
      {decisionLabel(next)} ›
    </button>
  );
}

function NextUnit() {
  const g = game.value;
  const my = me.value;
  if (!g || !my || !myTurn.value) return null;
  const count = idleUnits(g, my, skipped.value).length;
  const sel = selection.value.unit;
  const goNext = (): void => {
    const u = nextIdleUnit(g, my, skipped.value, sel);
    if (u) selectUnit(u.id, { focus: true });
  };
  if (count === 0) return null;
  return (
    <button class="btn next-unit" onClick={goNext} aria-label={`Next unit. ${count} waiting for orders.`}>
      ⟳ Unit <span class="badge">{count}</span>
    </button>
  );
}

const QUICK: { kind: 'roster' | 'cabinet' | 'tree' | 'diplomacy'; glyph: string; label: string }[] = [
  { kind: 'roster', glyph: '👥', label: 'Figures' },
  { kind: 'cabinet', glyph: '🏛', label: 'Cabinet' },
  { kind: 'tree', glyph: '⚗', label: 'Research' },
  { kind: 'diplomacy', glyph: '🤝', label: 'Diplomacy' },
];

function QuickButtons() {
  const g = game.value;
  const my = me.value;
  if (!g || !my) return null;
  const figures = Object.values(g.figures).filter(
    (f) => f.owner === my && f.location.state !== 'retired' && f.location.state !== 'consumed',
  ).length;
  const researchIdle = pending.value.filter((d) => d.type === 'research').length;
  const badgeFor = (k: string): number => (k === 'roster' ? figures : k === 'tree' ? researchIdle : 0);
  return (
    <nav class="quick" aria-label="Panels">
      {QUICK.map((b) => {
        const badge = badgeFor(b.kind);
        return (
          <button
            key={b.kind}
            class="quick-btn"
            aria-label={badge ? `${b.label}, ${badge}` : b.label}
            onClick={() => openModal(b.kind === 'tree' ? { kind: 'tree', tree: 'tech' } : { kind: b.kind })}
          >
            <span aria-hidden="true">{b.glyph}</span>
            <span class="quick-label">{b.label}</span>
            {badge > 0 && <span class={`badge${b.kind === 'tree' ? ' warn' : ''}`}>{badge}</span>}
          </button>
        );
      })}
    </nav>
  );
}

export function Hud() {
  const m = modal.value;
  // City and tile sheets take the bottom of the screen; hide the controls under them.
  const sheetOpen = m !== null;
  const unitSelected = selection.value.unit !== null && !sheetOpen;
  return (
    <>
      <TopBar />
      {!sheetOpen && (
        <div class="hud-bottom">
          <div class="hud-controls">
            <QuickButtons />
            <div class="hud-right">
              <AdvisoryChip />
              <NextUnit />
              <EndTurnButton />
            </div>
          </div>
          {unitSelected && <UnitSheet key={selection.value.unit} />}
        </div>
      )}
      {thinking.value !== null && (
        <div class="thinking" role="status" aria-live="polite">
          Rivals are moving…
        </div>
      )}
    </>
  );
}
