import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenWakeLock } from './useScreenWakeLock';

/** `navigator.wakeLock` is stubbed because jsdom does not provide the API. */
type WakeLockListener = () => void;

function stubWakeLock(behaviour: 'grant' | 'reject' = 'grant') {
  const sentinels: Array<{ release: ReturnType<typeof vi.fn>; listeners: WakeLockListener[] }> = [];
  const request = vi.fn(async () => {
    if (behaviour === 'reject') throw new Error('NotAllowedError');
    const sentinel = {
      release: vi.fn().mockResolvedValue(undefined),
      listeners: [] as WakeLockListener[],
      addEventListener: (_: string, listener: WakeLockListener) =>
        sentinel.listeners.push(listener),
    };
    sentinels.push(sentinel);
    return sentinel;
  });

  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
    writable: true,
  });

  return { request, sentinels };
}

function removeWakeLock() {
  Object.defineProperty(navigator, 'wakeLock', {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  removeWakeLock();
});

afterEach(() => {
  vi.restoreAllMocks();
  removeWakeLock();
});

describe('useScreenWakeLock', () => {
  it('reports that the API is missing instead of throwing', () => {
    const { result } = renderHook(() => useScreenWakeLock(true));

    expect(result.current.supported).toBe(false);
    expect(result.current.active).toBe(false);
  });

  it('holds a lock while Always-On Display is enabled', async () => {
    const { request } = stubWakeLock();

    const { result } = renderHook(() => useScreenWakeLock(true));

    await act(async () => undefined);
    expect(request).toHaveBeenCalledWith('screen');
    expect(result.current.active).toBe(true);
  });

  it('treats a refused lock as a state, not an error', async () => {
    stubWakeLock('reject');

    const { result } = renderHook(() => useScreenWakeLock(true));
    await act(async () => undefined);

    // Still mounted, just not locked — a low battery must not crash the screen.
    expect(result.current.active).toBe(false);
  });

  it('re-acquires the lock after the page becomes visible again', async () => {
    const { request } = stubWakeLock();

    renderHook(() => useScreenWakeLock(true));
    await act(async () => undefined);
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => setVisibility('visible'));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('releases the lock when Always-On Display is disabled', async () => {
    const { sentinels } = stubWakeLock();

    const { rerender } = renderHook(({ enabled }) => useScreenWakeLock(enabled), {
      initialProps: { enabled: true },
    });
    await act(async () => undefined);
    expect(sentinels).toHaveLength(1);

    rerender({ enabled: false });
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('does not request a lock when the setting is off', async () => {
    const { request } = stubWakeLock();

    renderHook(() => useScreenWakeLock(false));
    await act(async () => undefined);

    expect(request).not.toHaveBeenCalled();
  });
});
