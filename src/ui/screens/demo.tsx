/**
 * DEV ONLY harness for the decision screens (screens-demo.html). Builds a real game in-process
 * at a chosen stage, strips affinity like the worker does, and binds `dispatch` to a local
 * applyCommand loop with simple bots for the rivals. Not part of the game bundle.
 */
import { render } from 'preact';
import type { ComponentType } from 'preact';
import type { Command, GameState, PlayerId } from '@contracts/sim-api';
import { applyCommand } from '../../sim';
import '../styles/fonts';
import '../styles/base.css';
import '../styles/shell.css';
import { bindClient, closeModal, content, dismissToast, game, lastError, modal, openModal, pushToast, route, toasts, type Modal } from '../store';
import { advanceBots, buildScenario, DEMO_STAGES, HUMAN, stripAffinity, type DemoStage } from './demo-scenario';
import { screens, type ScreenKind, type ScreenProps } from './index';

let auth: GameState | null = null;

const publish = (s: GameState): void => {
  auth = s;
  game.value = stripAffinity(s);
};

const load = (stage: DemoStage): void => {
  const { state, errors } = buildScenario(stage, content);
  if (errors.length) console.info('[demo] scenario notes', [...new Set(errors)]);
  closeModal();
  publish(state);
  route.value = 'game';
  try {
    history.replaceState(null, '', `?stage=${stage}`);
  } catch {
    /* ignore */
  }
};

bindClient({
  command(player: PlayerId, command: Command) {
    if (!auth) return;
    const res = applyCommand(auth, player, command, content);
    if (!res.ok) {
      lastError.value = res.error;
      pushToast(res.error, 'bad');
      return;
    }
    const after = advanceBots(res.state, content);
    publish(after.state);
  },
  newGame() {
    load('start');
  },
  save() {},
  load() {},
  deleteSave() {},
  listSaves() {},
});

const OPENERS: { label: string; open: () => Modal | null }[] = [
  { label: 'Offer', open: () => {
    const o = game.value?.offers.find((x) => x.player === HUMAN);
    return o ? { kind: 'offer', offer: o.id } : null;
  } },
  { label: 'Roster', open: () => ({ kind: 'roster' }) },
  { label: 'Figure', open: () => {
    const f = Object.values(game.value?.figures ?? {}).find((x) => x.owner === HUMAN);
    return { kind: 'figure', figure: f?.id ?? 'homer' };
  } },
  { label: 'Cabinet', open: () => ({ kind: 'cabinet' }) },
  { label: 'Government', open: () => ({ kind: 'government' }) },
  { label: 'Tech', open: () => ({ kind: 'tree', tree: 'tech' }) },
  { label: 'Civics', open: () => ({ kind: 'tree', tree: 'civic' }) },
  { label: 'Diplomacy', open: () => ({ kind: 'diplomacy' }) },
  { label: 'Crisis', open: () => ({ kind: 'crisis' }) },
  { label: 'Transition', open: () => ({ kind: 'transition' }) },
  { label: 'Legacy', open: () => ({ kind: 'legacy' }) },
  { label: 'Chronicle', open: () => ({ kind: 'chronicle' }) },
];

const Host = () => {
  const m = modal.value;
  if (!m || !(m.kind in screens)) return null;
  const C = screens[m.kind as ScreenKind] as ComponentType<ScreenProps> | undefined;
  return C ? <C modal={m as ScreenProps['modal']} /> : null;
};

const Demo = () => {
  const g = game.value;
  const p = g?.players[HUMAN];
  return (
    <div style={{ padding: '12px 12px 40px', height: '100%', overflowY: 'auto' }}>
      <h1 style={{ fontSize: '1.1rem', margin: '4px 0 8px' }}>Screens demo</h1>
      <div class="row" style={{ flexWrap: 'wrap', gap: '6px' }}>
        {DEMO_STAGES.map((s) => (
          <button class="btn" onClick={() => load(s)} data-stage={s}>
            {s}
          </button>
        ))}
      </div>
      {g && p && (
        <p class="small muted">
          Turn {g.turn} · {g.age} · {g.phase} · meter {Math.round(g.ageProgress)} · current {g.currentPlayer} · offers{' '}
          {g.offers.filter((o) => o.player === HUMAN).length} · RP {Math.floor(p.refinementPoints)} · influence {Math.floor(p.stock.influence)}
        </p>
      )}
      <div class="row" style={{ flexWrap: 'wrap', gap: '6px' }}>
        {OPENERS.map((o) => (
          <button
            class="btn"
            data-open={o.label}
            onClick={() => {
              const m = o.open();
              if (m) openModal(m);
              else pushToast(`Nothing to open for ${o.label}`, 'info');
            }}
          >
            {o.label}
          </button>
        ))}
        <button class="btn btn-primary" onClick={() => game.value && bindEnd()}>
          End turn
        </button>
      </div>
      <Host />
      <div style={{ position: 'fixed', left: '8px', right: '8px', top: '8px', zIndex: 60, display: 'grid', gap: '4px', pointerEvents: 'none' }}>
        {toasts.value.map((t) => (
          <button class="card small" style={{ pointerEvents: 'auto', textAlign: 'left' }} onClick={() => dismissToast(t.id)}>
            {t.text}
          </button>
        ))}
      </div>
    </div>
  );
};

const bindEnd = (): void => {
  if (!auth) return;
  const res = applyCommand(auth, HUMAN, { type: 'endTurn' }, content);
  if (!res.ok) {
    pushToast(res.error, 'bad');
    return;
  }
  publish(advanceBots(res.state, content).state);
};

const initial = (new URLSearchParams(location.search).get('stage') ?? 'court') as DemoStage;
load(DEMO_STAGES.includes(initial) ? initial : 'court');
const root = document.getElementById('app');
if (root) render(<Demo />, root);

// Inspection hook for browser checks.
(window as unknown as { __demo: unknown }).__demo = { load, openModal, game, modal };
