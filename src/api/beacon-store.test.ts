import { describe, it, expect, vi, afterEach } from 'vitest';
import { saveData, loadData, PersistenceError } from './beacon-store';

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
    delete (window as { __ABBAI_FLOW_CONFIG__?: unknown }).__ABBAI_FLOW_CONFIG__;
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
    (window as { __ABBAI_FLOW_CONFIG__?: unknown }).__ABBAI_FLOW_CONFIG__ = {};

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
    (window as { __ABBAI_FLOW_CONFIG__?: unknown }).__ABBAI_FLOW_CONFIG__ = {};

    const result = await saveData('beacon_test_members', [{ id: '2' }]);
    expect(result.cached).toBe(true);
    expect(result.persisted).toBe(false);
    expect(result.error).toBeInstanceOf(PersistenceError);
    expect(JSON.parse(localStorage.getItem('beacon_test_members') ?? '[]')).toEqual([{ id: '2' }]);
  });

  it('reports a rejected server write instead of claiming success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
    );
    (window as { __ABBAI_FLOW_CONFIG__?: unknown }).__ABBAI_FLOW_CONFIG__ = {};

    const result = await saveData('beacon_test_http', [{ id: '3' }]);
    expect(result).toMatchObject({ cached: true, persisted: false });
    expect(result.error?.status).toBe(500);
  });

  it('serialises overlapping writes so the last save wins on the server', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        // The second request is slower; without serialisation it would finish
        // last and leave the older document on the server.
        const payload = String(init?.body ?? '');
        await new Promise((resolve) => setTimeout(resolve, payload.includes('second') ? 2 : 8));
        bodies.push(payload);
        return { ok: true, status: 200 } as unknown as Response;
      }),
    );
    (window as { __ABBAI_FLOW_CONFIG__?: unknown }).__ABBAI_FLOW_CONFIG__ = {};

    await Promise.all([
      saveData('beacon_test_order', [{ id: 'first' }]),
      saveData('beacon_test_order', [{ id: 'second' }]),
    ]);

    expect(bodies).toHaveLength(2);
    expect(bodies.at(-1)).toContain('second');
  });

  it('falls back to the cached document when the server read fails', async () => {
    localStorage.setItem('beacon_test_members', JSON.stringify([{ id: 'cached' }]));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    (window as { __ABBAI_FLOW_CONFIG__?: unknown }).__ABBAI_FLOW_CONFIG__ = {};

    await expect(loadData('beacon_test_members', [])).resolves.toEqual([{ id: 'cached' }]);
  });
});
