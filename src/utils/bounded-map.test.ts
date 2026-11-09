import { describe, it, expect } from 'vitest';
import { mapWithConcurrency, isAbortError } from './bounded-map';

describe('mapWithConcurrency', () => {
  it('keeps the input order of the results', async () => {
    const result = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async (value) => {
        // Later items resolve first, which would reorder a naive Promise.all.
        await new Promise((resolve) => setTimeout(resolve, (6 - value) * 2));
        return value * 10;
      },
      () => -1,
    );

    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it('never runs more than the limit at once', async () => {
    let active = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 12 }, (_, index) => index),
      3,
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return null;
      },
      () => null,
    );

    expect(peak).toBeLessThanOrEqual(3);
  });

  it('keeps partial results when one call fails', async () => {
    const result = await mapWithConcurrency(
      ['ok', 'boom', 'ok2'],
      3,
      async (value) => {
        if (value === 'boom') throw new Error('calendar unavailable');
        return value;
      },
      () => null,
    );

    expect(result).toEqual(['ok', null, 'ok2']);
  });

  it('handles an empty input', async () => {
    await expect(
      mapWithConcurrency(
        [],
        4,
        async () => 1,
        () => 0,
      ),
    ).resolves.toEqual([]);
  });
});

describe('isAbortError', () => {
  it('recognises DOMException-style aborts only', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
    expect(isAbortError(new Error('nope'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
