/**
 * Pause work while the page is hidden.
 *
 * A display that sits in a kiosk for weeks spends most of its life behind a
 * screensaver, a switched input or a sleeping screen. Polling Home Assistant
 * every 60 seconds and re-rendering a clock every second during those hours
 * costs CPU, network and battery for output nobody can see.
 *
 * The refresh on becoming visible again is not an optimisation detail: without
 * it the screen would show data from the last time it was looked at.
 */
import { useEffect, useState } from 'react';

export function usePageVisibility(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return visible;
}

/**
 * `setInterval` that stays quiet while the page is hidden, and fires once
 * immediately when it becomes visible again.
 */
export function useVisibleInterval(callback: () => void, intervalMs: number, enabled = true): void {
  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    const tick = () => {
      if (document.visibilityState !== 'hidden') callback();
    };

    const onVisible = () => {
      if (document.visibilityState !== 'hidden') callback();
    };

    const interval = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [callback, intervalMs, enabled]);
}
