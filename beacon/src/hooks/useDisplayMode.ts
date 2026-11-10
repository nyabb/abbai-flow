/**
 * Display Mode lifecycle: screen wake lock, fullscreen and the inactivity timer.
 *
 * Written for a Chromium kiosk that runs for weeks, so the rules are:
 *
 * - Wake lock is *optional and recoverable*. The browser releases it whenever
 *   the page is hidden (tab switch, screen off, app switch) and refuses it on a
 *   battery-powered device — so it is re-requested on `visibilitychange` and a
 *   refusal is a state, not an exception.
 * - Fullscreen can only be entered from a user gesture. Opening `/display` on
 *   boot is not one, so the request is attempted and a rejection is ignored; the
 *   caller can offer a button instead.
 * - The idle timer never fires while the user is working. A dialog, a form field
 *   with focus or a dirty-looking overlay suspends it, and the timer restarts
 *   instead of navigating away — losing a half-typed event to a screen timeout
 *   would be worse than a screen left on.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseDisplayModeOptions {
  /** Master switch: false releases the wake lock and stops the idle timer. */
  active: boolean;
  /** Request a screen wake lock while active. */
  wakeLock?: boolean;
  /** Request fullscreen when this becomes active. */
  fullscreen?: boolean;
  /** Idle timeout in minutes; 0 disables it. */
  idleMinutes?: number;
  /** Called once the idle timeout elapses with no interaction and no open UI. */
  onIdle?: () => void;
}

export interface DisplayModeState {
  /** The browser has no Screen Wake Lock API at all. */
  wakeLockSupported: boolean;
  /** A wake lock is currently held. */
  wakeLockActive: boolean;
  /** The document is in fullscreen. */
  isFullscreen: boolean;
  /** The browser cannot enter fullscreen programmatically. */
  fullscreenSupported: boolean;
  /** Enter fullscreen; must be called from a user gesture. */
  enterFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
  /** Re-request the wake lock (e.g. from a "keep awake" button). */
  requestWakeLock: () => Promise<void>;
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/** True when something is open or focused that a timeout must not interrupt. */
export function hasUnsavedWork(): boolean {
  if (typeof document === 'undefined') return false;
  const dialogs = document.querySelector(
    '[role="dialog"], .modal-overlay, .planner-sheet, .mobile-more-menu, .settings-view input:focus, .settings-view textarea:focus',
  );
  return Boolean(dialogs);
}

export function useDisplayMode({
  active,
  wakeLock = false,
  fullscreen = false,
  idleMinutes = 0,
  onIdle,
}: UseDisplayModeOptions): DisplayModeState {
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && Boolean(document.fullscreenElement),
  );

  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const idleCallbackRef = useRef(onIdle);
  idleCallbackRef.current = onIdle;

  const wakeLockSupported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator && Boolean(navigator.wakeLock);
  const fullscreenSupported =
    typeof document !== 'undefined' && Boolean(document.documentElement.requestFullscreen);

  const releaseSentinel = useCallback(() => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (sentinel) void sentinel.release().catch(() => undefined);
    setWakeLockActive(false);
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!wakeLockSupported) return;
    // A held lock cannot be re-requested; the sentinel is the single owner.
    if (sentinelRef.current) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      sentinelRef.current = sentinel;
      setWakeLockActive(true);
      // The browser can revoke the lock at any time (battery saver, tab hidden).
      sentinel.addEventListener('release', () => {
        if (sentinelRef.current === sentinel) sentinelRef.current = null;
        setWakeLockActive(false);
      });
    } catch {
      // Denied (low battery, unsupported context) — the caller keeps running.
      setWakeLockActive(false);
    }
  }, [wakeLockSupported]);

  // Acquire/release on demand, and re-acquire when the page becomes visible
  // again: the browser drops the lock on hide, so this is the normal path, not
  // an error path.
  useEffect(() => {
    if (!active || !wakeLock) {
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
  }, [active, wakeLock, requestWakeLock, releaseSentinel]);

  const enterFullscreen = useCallback(async () => {
    if (!fullscreenSupported) return;
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      /* not a user gesture, or the browser refused — nothing to recover */
    }
  }, [fullscreenSupported]);

  const exitFullscreen = useCallback(async () => {
    if (typeof document === 'undefined' || !document.fullscreenElement) return;
    try {
      await document.exitFullscreen();
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Attempt fullscreen when asked. A boot-time call will be rejected by the
  // browser (no user gesture) and that is expected; the screen still works.
  useEffect(() => {
    if (!active || !fullscreen) return;
    void enterFullscreen();
  }, [active, fullscreen, enterFullscreen]);

  // ---- Inactivity -------------------------------------------------------
  useEffect(() => {
    if (!active || idleMinutes <= 0) return;
    const timeoutMs = idleMinutes * 60_000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (hasUnsavedWork()) {
          // Someone is mid-form: restart rather than interrupt.
          schedule();
          return;
        }
        idleCallbackRef.current?.();
      }, timeoutMs);
    };

    const onActivity = () => schedule();

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    schedule();

    return () => {
      if (timer) clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity);
      }
    };
  }, [active, idleMinutes]);

  return {
    wakeLockSupported,
    wakeLockActive,
    isFullscreen,
    fullscreenSupported,
    enterFullscreen,
    exitFullscreen,
    requestWakeLock,
  };
}
