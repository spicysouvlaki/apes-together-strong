/**
 * Combat preview (GDD §7 "Combat"): both sides face to face, strength against strength, the
 * health each is likely to keep (with the roll's range), the factors in plain words and a
 * one-word outlook. A sheet before the attack, or a compact block inside the unit sheet when
 * "Confirm attacks" is off. Numbers come from SimQueries.combatPreview only.
 */
import { useEffect } from 'preact/hooks';
import { game, lookup } from '../store';
import { Icon } from '../art/Icon';
import type { AnyIconName, IconName } from '../art/icons-data';
import { FigurePortrait } from '../art/game-art';
import { hpBands, type CombatSideView } from './combat-view';
import { cancelAttack, commitAttack, pendingAttack, type PendingAttack } from './combat-state';

/** The unit's medallion: a figure's portrait, else its class figurine on the owner's colours. */
function Token({ unit, owner, walls }: { unit: string | null; owner: string | null; walls?: boolean }) {
  const g = game.value;
  const u = unit && g ? g.units[unit] : undefined;
  if (u?.figure) return <FigurePortrait figure={u.figure} size="sm" />;
  const p = owner && g ? g.players[owner] : undefined;
  const ring = p?.colors.primary ?? (owner === 'raiders' ? '#4a3a2a' : '#7a6a52');
  const icon: AnyIconName = walls ? 'capital' : ((u?.unitClass as IconName | undefined) ?? 'strength');
  return (
    <span class="cbt-token" style={{ '--own': ring }} aria-hidden="true">
      <Icon name={icon} />
    </span>
  );
}

function HpBar({ side, label }: { side: CombatSideView; label: string }) {
  const b = hpBands(side);
  const range = side.after.best === side.after.worst ? `${side.after.expected}` : `${side.after.worst}–${side.after.best}`;
  return (
    <div class="cbt-hp" role="img" aria-label={`${label}: ${side.hp} health now, about ${side.after.expected} after (${range})`}>
      <div class="cbt-hp-bar">
        <span class="cbt-hp-kept" style={{ width: `${b.kept}%` }} />
        <span class="cbt-hp-risk" style={{ width: `${b.risk}%` }} />
        <span class="cbt-hp-lost" style={{ width: `${b.lost}%` }} />
      </div>
      <div class="cbt-hp-text tnum">
        <Icon name="health" size="sm" /> {side.hp} <span class="cbt-arrow" aria-hidden="true" /> <b>{side.after.expected}</b>
        {side.after.best !== side.after.worst && <span class="muted"> ({range})</span>}
      </div>
      {side.falls === 'likely' && <div class="cbt-falls">Likely falls</div>}
      {side.falls === 'maybe' && <div class="cbt-falls maybe">May fall</div>}
    </div>
  );
}

/** Face-off block (shared by the sheet and the inline preview). */
export function CombatFaceOff({ a, compact }: { a: PendingAttack; compact?: boolean }) {
  const v = a.view;
  const g = game.value;
  const att = g?.units[a.unit];
  const capture = v.kind === 'capture';
  return (
    <div class={`cbt${compact ? ' cbt-compact' : ''}`}>
      <div class="cbt-sides">
        <div class="cbt-side">
          <Token unit={a.unit} owner={att?.owner ?? null} />
          <div class="cbt-name">{v.attacker.name}</div>
          <div class="cbt-str tnum" aria-label={`Strength ${v.attacker.strength}`}>
            <Icon name={v.ranged ? 'ranged' : 'strength'} size="sm" /> {v.attacker.strength}
          </div>
          {!capture && <HpBar side={v.attacker} label={v.attacker.name} />}
        </div>
        <div class="cbt-vs" aria-hidden="true">
          <span>vs</span>
        </div>
        <div class="cbt-side">
          <Token unit={a.defenderUnit} owner={a.defenderOwner} walls={v.kind !== 'unit'} />
          <div class="cbt-name">{cap(v.defender.name)}</div>
          {!capture && (
            <div class="cbt-str tnum" aria-label={`Strength ${v.defender.strength}`}>
              <Icon name="fortify" size="sm" /> {v.defender.strength}
            </div>
          )}
          {!capture && <HpBar side={v.defender} label={v.defender.name} />}
          {capture && <div class="small muted">Undefended: it falls to you.</div>}
        </div>
      </div>
      {!compact && v.factors.length > 0 && (
        <ul class="cbt-factors" aria-label="What counts in this fight">
          {v.factors.map((f) => (
            <li class={`cbt-factor ${f.helps ? 'helps' : 'hurts'}`}>
              <span class="cbt-factor-side">{f.side === 'attacker' ? 'You' : 'They'}</span>
              {f.label} <b class="tnum">{f.value}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function OutlookStamp({ a }: { a: PendingAttack }) {
  const o = a.view.outlook;
  return (
    <div class={`cbt-outlook tone-${o.tone}`}>
      <span class="cbt-outlook-word">{o.word}</span>
      <span class="cbt-outlook-note">{o.note}</span>
    </div>
  );
}

/** The confirm sheet. Rendered over the map (z above sheets, below full screens). */
export function CombatSheet() {
  const a = pendingAttack.value;
  useEffect(() => {
    if (!a || a.mode !== 'sheet') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelAttack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [a?.mode, a?.unit]);
  if (!a || a.mode !== 'sheet') return null;
  const v = a.view;
  const name = lookup.units[game.value?.units[a.unit]?.type ?? '']?.name;
  return (
    <div class="cbt-backdrop" onClick={cancelAttack}>
      <section class="sheet cbt-sheet" role="alertdialog" aria-modal="true" aria-label={`Attack preview. ${v.summary}`} onClick={(e) => e.stopPropagation()}>
        <div class="cbt-head">
          <div class="grow">
            <div class="cbt-kicker">{v.kindLine}</div>
            <h2 class="sheet-title cbt-title">{v.kind === 'capture' ? cap(v.defender.name) : `Attack ${v.defender.name}?`}</h2>
          </div>
          <OutlookStamp a={a} />
        </div>
        <CombatFaceOff a={a} />
        {v.warLine && (
          <p class="cbt-war" role="note">
            <Icon name="war" /> {v.warLine} Peace later costs influence and takes time; trade routes with them stop.
          </p>
        )}
        <div class="row cbt-buttons">
          <button class="btn grow" onClick={cancelAttack}>
            Cancel
          </button>
          <button
            class={`btn grow ${v.warLine || a.preview.outlook === 'reckless' ? 'btn-danger' : 'btn-primary'}`}
            aria-label={`${v.confirmLabel}${name ? ` with ${name}` : ''}`}
            // The sim's combat / warDeclared events voice the result (no sound doubled here).
            onClick={() => commitAttack(a)}
          >
            <Icon name="attack" /> {v.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
