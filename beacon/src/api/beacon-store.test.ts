import { describe, it, expect, vi, afterEach } from 'vitest';
import { saveData, loadData } from './beacon-store';

/**
 * Regression guard for a data-loss bug in proxy deployments (add-on and
 * standalone Docker).
 *
 * `loadData` is server-first, so anything that refreshes before the server has
 * the new document reads the OLD copy and writes it straight back over
 * localStorage. When `saveData` fired its PUT without awaiting it, a fresh
 * edit was routinely reverted by the refresh that followed — a parent's PIN
 * never survived being saved. `saveData` must not resolve until the write has
 * actually landed.
 */
describe('saveData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { __BEACON_CONFIG__?: unknown }).__BEACON_CONFIG__;
    localStorage.clear();
  });

  it('does not resolve until the server write has completed', async () => {
    let serverFinished = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        serverFinished = true;
        return { ok: true, json: async () => ({}) } as unknown as Response;
      }),
    );
    (window as { __BEACON_CONFIG__?: unknown }).__BEACON_CONFIG__ = {};

    await saveData('beacon_test_members', [{ id: '1', name: 'Natnael', pin: '1234' }]);

    expect(serverFinished).toBe(true);
    // And the local cache is already correct, so an immediate read is safe.
    expect(JSON.parse(localStorage.getItem('beacon_test_members') ?? '[]')).toEqual([
      { id: '1', name: 'Natnael', pin: '1234' },
    ]);
  });

  it('still writes to localStorage when the server write fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    (window as { __BEACON_CONFIG__?: unknown }).__BEACON_CONFIG__ = {};

    await expect(saveData('beacon_test_members', [{ id: '2' }])).resolves.toBeUndefined();
    expect(JSON.parse(localStorage.getItem('beacon_test_members') ?? '[]')).toEqual([{ id: '2' }]);
  });

  it('falls back to the cached document when the server read fails', async () => {
    localStorage.setItem('beacon_test_members', JSON.stringify([{ id: 'cached' }]));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    (window as { __BEACON_CONFIG__?: unknown }).__BEACON_CONFIG__ = {};

    await expect(loadData('beacon_test_members', [])).resolves.toEqual([{ id: 'cached' }]);
  });
});
