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
  route,
  selection,
  thinking,
} from '../store';
import { screens, type ScreenKind } from '../screens';
import type { ModalKind } from '../store';
import { decisionLabel, decisionModal, planEndTurn, type Prompt } from './decisions';
import { AGE_NAME, HUD_YIELDS, YIELD_GLYPH, YIELD_NAME, happinessFace, happinessWord, num, signed } from './format';
import { firstFounder, idleUnits, nextIdleUnit } from './hexutil';
import { selectUnit } from './MapView';
import { endTurnSent, foundNudgeTurn, idleConfirmedTurn, legendOpen, skipped } from './shell-state';
import { YieldLegend } from './YieldLegend';
import { UnitSheet } from './UnitSheet';
import { quitToTitle } from './Panels';

const SHELL_KINDS: ReadonlySet<ModalKind> = new Set(['city', 'tileInfo', 'menu', 'saves', 'settings']);
export const isRegistered = (kind: ModalKind): boolean => SHELL_KINDS.has(kind) || !!screens[kind as ScreenKind];

const pending = computed(() => {
  const g = game.value;
  const my = me.value;
  return g && my ? q.pendingDecisions(g, my, content) : [];
});

/** A unit that can found the first settlement, while the player has none (UI nudge only). */
const founder = computed(() => {
  const g = game.value;
  const my = me.value;
  if (!g || !my || foundNudgeTurn.value === g.turn) return null;
  return firstFounder(g, my, (id) => !!content.units.find((u) => u.id === id)?.canFound);
});

const plan = computed(() => planEndTurn(pending.value, isRegistered, founder.value));

function TopBar() {
  const p = myPlayer.value;
  const g = game.value;
  if (!p || !g) return null;
  const crisis = g.crisis !== null;
  return (
    <header class="hud-top" aria-label="Empire status">
      <button
        class="hud-yields"
        aria-expanded={legendOpen.value}
        aria-label={`${HUD_YIELDS.map((y) => `${YIELD_NAME[y]} ${Math.floor(p.stock[y])}, ${signed(p.income[y])} per turn`).join('; ')}. Show what the symbols mean.`}
        onClick={() => (legendOpen.value = !legendOpen.value)}
      >
        {HUD_YIELDS.map((y) => (
          <span class="hud-yield" key={y} aria-hidden="true">
            <span class="hud-yield-top">
              <span aria-hidden="true">{YIELD_GLYPH[y]}</span> {Math.floor(p.stock[y])}
            </span>
            <span class="hud-yield-inc">{signed(p.income[y])}</span>
          </span>
        ))}
      </button>
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
      {legendOpen.value && <YieldLegend player={p} onClose={() => (legendOpen.value = false)} />}
    </header>
  );
}

const endTurn = (): void => {
  const g = game.value;
  if (!g || !myTurn.value || endTurnSent.value) return;
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
      onConfirm: () => sendEndTurn(),
      onCancel: () => openDecision({ type: 'production', settlement: idle }),
    });
    return;
  }
  sendEndTurn();
};

const sendEndTurn = (): void => {
  if (endTurnSent.value) return;
  selectUnit(null);
  endTurnSent.value = true; // cleared by the next snapshot or error (app-wiring.ts)
  dispatch({ type: 'endTurn' });
};

const openDecision = (d: Prompt): void => {
  if (d.type === 'found') {
    const g = game.value;
    if (g) foundNudgeTurn.value = g.turn;
    selectUnit(d.unit, { focus: true });
    return;
  }
  const m = decisionModal(d);
  if (!m) return;
  if (m.kind === 'city') {
    const s = game.value?.settlements[m.settlement];
    if (s) focusMap(s.at);
  }
  openModal(m);
};

function EndTurnButton() {
  const pl = plan.value;
  const busy = thinking.value !== null || endTurnSent.value;
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
  // "Nations" fits the 46px button; the screen itself is titled Diplomacy (aria-label says so).
  { kind: 'diplomacy', glyph: '🤝', label: 'Nations' },
];

const QUICK_ARIA: Record<string, string> = { diplomacy: 'Diplomacy' };

/** Open the tree that needs a pick (tech first), else technology. */
const researchTree = (): 'tech' | 'civic' => {
  const d = pending.value.find((x) => x.type === 'research');
  return d && d.type === 'research' ? d.tree : 'tech';
};

function QuickButtons() {
  const g = game.value;
  const my = me.value;
  if (!g || !my) return null;
  // Badge only what wants attention: figures at home who could take a free cabinet seat now.
  const figures = Object.values(g.figures).filter(
    (f) => f.owner === my && f.location.state === 'based' && q.figureActions(g, f.id, content).seat.length > 0,
  ).length;
  const researchIdle = pending.value.filter((d) => d.type === 'research').length;
  const badgeFor = (k: string): number => (k === 'roster' ? figures : k === 'tree' ? researchIdle : 0);
  const badgeText = (k: string, n: number): string =>
    k === 'roster' ? `${n} could take a cabinet seat` : k === 'tree' ? `${n} ${n === 1 ? 'tree' : 'trees'} idle` : String(n);
  return (
    <nav class="quick" aria-label="Panels">
      {QUICK.map((b) => {
        const badge = badgeFor(b.kind);
        return (
          <button
            key={b.kind}
            class="quick-btn"
            aria-label={badge ? `${QUICK_ARIA[b.kind] ?? b.label}, ${badgeText(b.kind, badge)}` : (QUICK_ARIA[b.kind] ?? b.label)}
            onClick={() => openModal(b.kind === 'tree' ? { kind: 'tree', tree: researchTree() } : { kind: b.kind })}
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

/**
 * Shown when the human has no settlement and no settler left (sim sets alive=false). The rivals
 * may play on, but the player's story is over: offer the Chronicle and a way out.
 */
function Defeat() {
  const g = game.value;
  return (
    <section class="screen defeat" role="alertdialog" aria-modal="true" aria-label="Defeat">
      <div class="screen-body defeat-body">
        <div class="defeat-mark" aria-hidden="true">
          ⚑
        </div>
        <h1 class="defeat-title">Your people have been conquered</h1>
        <p class="muted">
          With no settlement and no settler left, your story ends{g ? ` on turn ${g.turn}` : ''}. The Chronicle remembers what you built.
        </p>
        <div class="title-buttons defeat-buttons">
          <button class="btn btn-primary" onClick={() => openModal({ kind: 'chronicle' })}>
            Read the Chronicle
          </button>
          <button class="btn" onClick={() => openModal({ kind: 'saves' })}>
            Load a save
          </button>
          <button
            class="btn"
            onClick={() => {
              quitToTitle();
              route.value = 'setup';
            }}
          >
            New game
          </button>
          <button class="btn" onClick={quitToTitle}>
            Title screen
          </button>
        </div>
      </div>
    </section>
  );
}

export function Hud() {
  const p = myPlayer.value;
  if (p && !p.alive) return modal.value ? null : <Defeat />;
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
