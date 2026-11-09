/**
 * Run an async mapper over a list with a bounded number of parallel calls.
 *
 * Beacon talks to Home Assistant for every calendar, chore and sensor view.
 * Firing all of them at once floods weak HA installs (and the wall display's
 * connection limit); doing them one by one makes a fifteen-calendar household
 * feel broken. This keeps the fan-out predictable.
 *
 * Results keep the input order, and a single failure never discards the work
 * of the others — the failed slot resolves to the provided fallback.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
  fallback: (item: T, index: number) => R,
): Promise<R[]> {
  if (items.length === 0) return [];

  const width = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;

      const item = items[index];
      try {
        results[index] = await mapper(item, index);
      } catch {
        results[index] = fallback(item, index);
      }
    }
  };

  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}

/** True when an error came from an aborted request rather than a real fault. */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}
