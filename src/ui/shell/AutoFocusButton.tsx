/**
 * A button that takes focus when its dialog appears, so VoiceOver and keyboards land inside the
 * dialog rather than on the map behind it (wave 11 accessibility pass: the resume card and the
 * first-contact card opened with focus left on the page). No scroll jump: preventScroll.
 */
import { useEffect, useRef } from 'preact/hooks';
import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';

export function AutoFocusButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ComponentChildren }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return <button {...props} ref={ref} />;
}
