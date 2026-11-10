import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePageVisibility, useVisibleInterval } from './usePageVisibility';

/**
 * A kiosk screen is hidden most of its life (screensaver, switched input,
 * sleeping panel). Polling and clock ticks during those hours burn CPU and
 * network for output nobody sees — but the moment it is visible again the data
 * must be current, so the interval has to fire immediately on return.
 */
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('usePageVisibility', () => {
  it('tracks the document visibility state', () => {
    const { result } = renderHook(() => usePageVisibility());
    expect(result.current).toBe(true);

    act(() => setVisibility('hidden'));
    expect(result.current).toBe(false);

    act(() => setVisibility('visible'));
    expect(result.current).toBe(true);
  });
});

describe('useVisibleInterval', () => {
  it('does not fire while the page is hidden', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const spy = vi.fn();

    renderHook(() => useVisibleInterval(spy, 1000));
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('fires on the interval while visible', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    const spy = vi.fn();

    renderHook(() => useVisibleInterval(spy, 1000));
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('catches up immediately when the page becomes visible', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const spy = vi.fn();

    renderHook(() => useVisibleInterval(spy, 60_000));
    expect(spy).not.toHaveBeenCalled();

    act(() => setVisibility('visible'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', () => {
    vi.useFakeTimers();
    const spy = vi.fn();

    renderHook(() => useVisibleInterval(spy, 1000, false));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(spy).not.toHaveBeenCalled();
  });
});
