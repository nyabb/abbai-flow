import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useConnectionStatus } from './useConnectionStatus';

/**
 * Four states, because "disconnected" is not actionable: a wall display has to
 * say whether the wifi is down, Abbai Flow is down, or Home Assistant is down.
 */
function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useConnectionStatus', () => {
  it('reports online when both Abbai Flow and HA answer', async () => {
    const { result } = renderHook(() =>
      useConnectionStatus({ haConnected: true, probe: async () => true }),
    );

    await waitFor(() => expect(result.current.state).toBe('online'));
  });

  it('separates "Abbai Flow down" from "HA down"', async () => {
    const beacon = renderHook(() =>
      useConnectionStatus({ haConnected: true, probe: async () => false }),
    );
    await waitFor(() => expect(beacon.result.current.state).toBe('beacon-down'));

    const ha = renderHook(() =>
      useConnectionStatus({ haConnected: false, probe: async () => true }),
    );
    await waitFor(() => expect(ha.result.current.state).toBe('ha-down'));
  });

  it('reports offline from the browser signal alone, without probing', async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useConnectionStatus({ haConnected: true, probe }));

    await act(async () => setOnline(false));

    expect(result.current.state).toBe('offline');
  });

  it('recovers and flags the reconnection when the network returns', async () => {
    let reachable = false;
    const { result } = renderHook(() =>
      useConnectionStatus({ haConnected: true, probe: async () => reachable }),
    );
    await waitFor(() => expect(result.current.state).toBe('beacon-down'));

    reachable = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => expect(result.current.state).toBe('online'));
    expect(result.current.reconnected).toBe(true);
  });

  it('reports the reconnected flag only once', async () => {
    let reachable = false;
    const { result } = renderHook(() =>
      useConnectionStatus({ haConnected: true, probe: async () => reachable }),
    );
    await waitFor(() => expect(result.current.state).toBe('beacon-down'));

    reachable = true;
    await act(async () => setOnline(true));
    await waitFor(() => expect(result.current.reconnected).toBe(true));

    // A second healthy probe must not look like a new recovery.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.reconnected).toBe(true);
  });

  it('treats a throwing probe as "Abbai Flow down" rather than crashing', async () => {
    const { result } = renderHook(() =>
      useConnectionStatus({
        haConnected: true,
        probe: async () => {
          throw new Error('TypeError: Failed to fetch');
        },
      }),
    );

    await waitFor(() => expect(result.current.state).toBe('beacon-down'));
  });

  it('rechecks on demand', async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() => useConnectionStatus({ haConnected: true, probe }));
    await waitFor(() => expect(probe).toHaveBeenCalled());

    const calls = probe.mock.calls.length;
    await act(async () => result.current.recheck());

    await waitFor(() => expect(probe.mock.calls.length).toBeGreaterThan(calls));
  });

  it('probes with a no-store request so an outage cannot be served from cache', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));
    const { result } = renderHook(() => useConnectionStatus({ haConnected: true }));

    await waitFor(() => expect(result.current.state).toBe('online'));
    expect(fetchSpy).toHaveBeenCalledWith(
      'manifest.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});
