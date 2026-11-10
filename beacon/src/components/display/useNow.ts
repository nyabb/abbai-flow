/**
 * Re-render on a clock tick — but only while the page is visible.
 *
 * A wall display is on for weeks; ticking while hidden is pure waste, and the
 * tick that matters is the first one after the screen comes back.
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());

    const interval = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      tick();
    }, intervalMs);

    const onVisible = () => {
      if (document.visibilityState !== 'hidden') tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);

  return now;
}
