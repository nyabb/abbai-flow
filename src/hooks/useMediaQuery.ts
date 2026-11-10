import { useEffect, useState } from 'react';

/**
 * Tracks a CSS media query in JS.
 *
 * Only used where the difference is structural rather than cosmetic: the chore
 * board shows every member side by side on a wall display, but a phone shows one
 * member at a time with a tab row. CSS alone cannot do that without rendering
 * both layouts at once, which would duplicate every row.
 *
 * Returns `false` when `matchMedia` is unavailable (jsdom, old browsers), so
 * callers fall back to the wide layout and tests keep asserting it.
 */
export function useMediaQuery(query: string): boolean {
  const supported = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

  const [matches, setMatches] = useState(() =>
    supported() ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (!supported()) return;
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
