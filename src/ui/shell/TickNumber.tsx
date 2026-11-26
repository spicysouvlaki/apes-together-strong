/**
 * A number that counts to its new value (~320 ms) when it changes, so yield income lands with
 * a little weight. Writes the text node directly from requestAnimationFrame (no re-renders);
 * jumps straight to the value under reduce motion.
 */
import { useEffect, useRef } from 'preact/hooks';

const reduced = (): boolean =>
  typeof document === 'undefined' ||
  document.documentElement.classList.contains('reduce-motion') ||
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

export function TickNumber({ value }: { value: number }) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  useEffect(() => {
    const node = el.current;
    const from = shown.current;
    // Write into Preact's own text node (replacing it would detach it from later renders).
    const text = node?.firstChild;
    if (!node || !(text instanceof Text) || from === value) return undefined;
    shown.current = value;
    if (reduced()) return undefined;
    const write = (n: number): void => {
      text.data = String(n);
    };
    node.classList.remove('tick-pop', 'tick-drop');
    void node.offsetWidth; // restart the pop animation
    node.classList.add(value > from ? 'tick-pop' : 'tick-drop');
    const start = performance.now();
    let raf = 0;
    const step = (now: number): void => {
      const k = Math.min(1, (now - start) / 320);
      const eased = 1 - (1 - k) ** 3;
      write(Math.round(from + (value - from) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      write(value);
    };
  }, [value]);
  return (
    <span ref={el} class="tnum">
      {value}
    </span>
  );
}
