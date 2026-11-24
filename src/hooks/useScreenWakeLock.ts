/**
 * Keep the device screen awake when the user enables Always-On Display.
 *
 * Browsers release a wake lock whenever the page is hidden, so request it again
 * when the page becomes visible. A refusal (for example, battery saver) is a
 * state rather than an error and does not interrupt the app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ScreenWakeLockState {
  supported: boolean;
  active: boolean;
}

export function useScreenWakeLock(enabled: boolean): ScreenWakeLockState {
  const [active, setActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const supported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator && Boolean(navigator.wakeLock);

  const releaseSentinel = useCallback(() => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (sentinel) void sentinel.release().catch(() => undefined);
    setActive(false);
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!supported || sentinelRef.current) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      sentinelRef.current = sentinel;
      setActive(true);
      sentinel.addEventListener('release', () => {
        if (sentinelRef.current === sentinel) sentinelRef.current = null;
        setActive(false);
      });
    } catch {
      setActive(false);
    }
  }, [supported]);

  useEffect(() => {
    if (!enabled) {
      releaseSentinel();
      return;
    }

    void requestWakeLock();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        sentinelRef.current = null;
        void requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      releaseSentinel();
    };
  }, [enabled, requestWakeLock, releaseSentinel]);

  return { supported, active };
}
