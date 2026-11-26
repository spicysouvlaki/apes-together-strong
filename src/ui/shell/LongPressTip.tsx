/**
 * Long-press anything with a name (an icon button, a chip, a portrait) to see what it is
 * (GDD §11 "Touch": long-press explains). One global listener: after 480 ms without moving,
 * a small slip shows the element's accessible name; the click that would follow is swallowed.
 * The map canvas has its own long-press (tile details) and is left alone.
 */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';

interface Tip {
  text: string;
  x: number;
  y: number;
}

const tip = signal<Tip | null>(null);

const HOLD_MS = 480;
const SLOP_PX = 8;

/** The name to show for a long-pressed element: its aria-label, title or data-name. Pure. */
export const nameOf = (el: { getAttribute(name: string): string | null } | null): string | null => {
  if (!el) return null;
  const raw = el.getAttribute('data-name') ?? el.getAttribute('aria-label') ?? el.getAttribute('title');
  const text = raw?.trim();
  return text ? text : null;
};

const named = (target: EventTarget | null): Element | null => {
  const el = target instanceof Element ? target : null;
  if (!el || el.closest('canvas, input, textarea, select')) return null;
  return el.closest('[data-name], [aria-label], [title]');
};

export function LongPressTip() {
  useEffect(() => {
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    let swallow = false;
    const clear = (): void => {
      window.clearTimeout(timer);
      start = null;
    };
    const down = (e: PointerEvent): void => {
      tip.value = null;
      const el = named(e.target);
      const text = nameOf(el);
      if (!el || !text || e.button > 0) return;
      start = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        tip.value = { text, x: r.left + r.width / 2, y: r.top };
        swallow = true;
        if ('vibrate' in navigator) navigator.vibrate?.(8);
      }, HOLD_MS);
    };
    const move = (e: PointerEvent): void => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) clear();
    };
    const up = (): void => {
      clear();
      if (tip.value) window.setTimeout(() => (tip.value = null), 1600);
    };
    const click = (e: MouseEvent): void => {
      if (!swallow) return;
      swallow = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const menu = (e: Event): void => {
      if (named(e.target)) e.preventDefault();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', clear, true);
    window.addEventListener('click', click, true);
    window.addEventListener('contextmenu', menu, true);
    return () => {
      clear();
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', clear, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('contextmenu', menu, true);
    };
  }, []);
  const t = tip.value;
  if (!t) return null;
  const left = Math.max(12, Math.min(window.innerWidth - 12, t.x));
  const above = t.y > 90;
  return (
    <div class={`lp-tip${above ? '' : ' below'}`} role="tooltip" style={{ left: `${left}px`, top: `${above ? t.y - 8 : t.y + 52}px` }}>
      {t.text}
    </div>
  );
}
