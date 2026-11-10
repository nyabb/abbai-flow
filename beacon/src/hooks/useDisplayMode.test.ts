import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { hasUnsavedWork, useDisplayMode } from './useDisplayMode';

/**
 * The display lifecycle is what keeps a wall screen usable for weeks, so the
 * cases cover the three ways it can go wrong:
 *
 * - the wake lock is dropped when the page is hidden and never comes back,
 * - fullscreen is requested without a user gesture and throws,
 * - the idle timeout navigates away from a half-filled form.
 *
 * `navigator.wakeLock` and the Fullscreen API are stubbed: jsdom has neither.
 */
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  removeWakeLock();
  delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
  document.body.innerHTML = '';
});

describe('useDisplayMode — wake lock', () => {
  it('reports that the API is missing instead of throwing', () => {
    const { result } = renderHook(() => useDisplayMode({ active: true, wakeLock: true }));

    expect(result.current.wakeLockSupported).toBe(false);
    expect(result.current.wakeLockActive).toBe(false);
  });

  it('holds a lock while the display is active', async () => {
    const { request } = stubWakeLock();

    const { result } = renderHook(() => useDisplayMode({ active: true, wakeLock: true }));

    await act(async () => undefined);
    expect(request).toHaveBeenCalledWith('screen');
    expect(result.current.wakeLockActive).toBe(true);
  });

  it('treats a refused lock as a state, not an error', async () => {
    stubWakeLock('reject');

    const { result } = renderHook(() => useDisplayMode({ active: true, wakeLock: true }));
    await act(async () => undefined);

    // Still mounted, just not locked — a low battery must not crash the screen.
    expect(result.current.wakeLockActive).toBe(false);
  });

  it('re-acquires the lock after the page becomes visible again', async () => {
    const { request } = stubWakeLock();

    renderHook(() => useDisplayMode({ active: true, wakeLock: true }));
    await act(async () => undefined);
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => setVisibility('visible'));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('releases the lock when the display view is left', async () => {
    const { sentinels } = stubWakeLock();

    const { rerender } = renderHook(({ active }) => useDisplayMode({ active, wakeLock: true }), {
      initialProps: { active: true },
    });
    await act(async () => undefined);
    expect(sentinels).toHaveLength(1);

    rerender({ active: false });
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('does not request a lock when the setting is off', async () => {
    const { request } = stubWakeLock();

    renderHook(() => useDisplayMode({ active: true, wakeLock: false }));
    await act(async () => undefined);

    expect(request).not.toHaveBeenCalled();
  });
});

describe('useDisplayMode — fullscreen', () => {
  it('reports unsupported when the document cannot go fullscreen', () => {
    const { result } = renderHook(() => useDisplayMode({ active: false }));

    expect(result.current.fullscreenSupported).toBe(false);
  });

  it('swallows a rejected fullscreen request', async () => {
    const requestFullscreen = vi.fn().mockRejectedValue(new Error('not a user gesture'));
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: requestFullscreen,
      configurable: true,
      writable: true,
    });

    const { result } = renderHook(() => useDisplayMode({ active: true, fullscreen: true }));
    await act(async () => undefined);

    expect(requestFullscreen).toHaveBeenCalled();
    // No throw, and the screen carries on windowed.
    expect(result.current.isFullscreen).toBe(false);
  });

  it('enters fullscreen on demand', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: requestFullscreen,
      configurable: true,
      writable: true,
    });

    const { result } = renderHook(() => useDisplayMode({ active: true }));
    await act(async () => {
      await result.current.enterFullscreen();
    });

    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
  });
});

describe('useDisplayMode — inactivity', () => {
  it('navigates away after the idle timeout', async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();

    renderHook(() => useDisplayMode({ active: true, idleMinutes: 5, onIdle }));
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
    });

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does not interrupt an open dialog', async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);

    renderHook(() => useDisplayMode({ active: true, idleMinutes: 5, onIdle }));
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
    });

    expect(onIdle).not.toHaveBeenCalled();
  });

  it('restarts on interaction', async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();

    renderHook(() => useDisplayMode({ active: true, idleMinutes: 5, onIdle }));

    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000);
    });
    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'));
      vi.advanceTimersByTime(4 * 60_000);
    });

    expect(onIdle).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('never runs when the timeout is disabled', async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();

    renderHook(() => useDisplayMode({ active: true, idleMinutes: 0, onIdle }));
    await act(async () => {
      vi.advanceTimersByTime(60 * 60_000);
    });

    expect(onIdle).not.toHaveBeenCalled();
  });
});

describe('hasUnsavedWork', () => {
  it('is false on a clean screen', () => {
    expect(hasUnsavedWork()).toBe(false);
  });

  it.each([
    ['a dialog', () => document.body.appendChild(mk('role', 'dialog'))],
    ['a modal overlay', () => document.body.appendChild(mk('class', 'modal-overlay'))],
    ['a planner sheet', () => document.body.appendChild(mk('class', 'planner-sheet'))],
    ['the overflow menu', () => document.body.appendChild(mk('class', 'mobile-more-menu'))],
  ])('is true with %s open', (_name, open) => {
    open();
    expect(hasUnsavedWork()).toBe(true);
  });
});

function mk(kind: 'role' | 'class', value: string): HTMLElement {
  const element = document.createElement('div');
  if (kind === 'role') element.setAttribute('role', value);
  else element.className = value;
  return element;
}
