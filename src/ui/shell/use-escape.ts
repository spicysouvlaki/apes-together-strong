/** Escape closes a sheet (keyboard players, iPad keyboards). The handler is pure for tests. */
import { useEffect } from 'preact/hooks';

export const escapeHandler =
  (close: () => void) =>
  (e: { key: string }): void => {
    if (e.key === 'Escape') close();
  };

export const useEscape = (close: () => void): void => {
  useEffect(() => {
    const onKey = escapeHandler(close);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
};
