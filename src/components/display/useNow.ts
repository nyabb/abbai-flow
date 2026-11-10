/**
 * Re-render on a clock tick.
 *
 * `Clock` keeps its own second-by-second state, but the display view has several
 * panels that all show "now". This gives them one ticker and lets the caller
 * choose the cadence: a second for the big clock, a minute for the agenda.
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
