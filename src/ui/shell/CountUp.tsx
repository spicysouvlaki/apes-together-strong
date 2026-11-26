/**
 * A number that counts up from zero when it first appears (~0.9 s, eased), for ceremonies
 * (the age's tally). Shows the final value at once under reduce motion.
 */
import { useEffect, useRef } from 'preact/hooks';

const reduced = (): boolean =>
  typeof document === 'undefined' ||
  document.documentElement.classList.contains('reduce-motion') ||
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

export function CountUp({ value, delay = 0, ms = 900 }: { value: number; delay?: number; ms?: number }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = el.current;
    const text = node?.firstChild;
    if (!node || !(text instanceof Text) || reduced() || value <= 0) return undefined;
    text.data = '0';
    let raf = 0;
    const t0 = performance.now() + delay;
    const step = (now: number): void => {
      const k = Math.max(0, Math.min(1, (now - t0) / ms));
      text.data = String(Math.round(value * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      text.data = String(value);
    };
  }, [value]);
  return (
    <span ref={el} class="tnum">
      {String(value)}
    </span>
  );
}
