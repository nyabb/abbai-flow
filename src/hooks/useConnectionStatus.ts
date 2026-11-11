/**
 * Why the app cannot reach what it needs — four states, not one boolean.
 *
 * On a wall display the difference matters to whoever walks past:
 *
 *   offline      the device itself has no network (router, wifi, DNS)
 *   beacon-down  the device has network but Abbai Flow's own server does not answer
 *   ha-down      Abbai Flow is up but Home Assistant is not reachable
 *   online       everything answered
 *
 * The Abbai Flow probe is a cheap same-origin request for a static asset: it says
 * nothing about Home Assistant, only whether this app's own origin responds.
 * It is only re-probed while something is wrong, or when the browser tells us
 * the connectivity changed — probing on every render would defeat the point.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnectionState = 'online' | 'beacon-down' | 'ha-down' | 'offline';

export interface UseConnectionStatusOptions {
  /** Home Assistant reachability, as reported by the HA client. */
  haConnected: boolean;
  /** Re-probe cadence while degraded. */
  probeIntervalMs?: number;
  /** Injected for tests; defaults to `fetch`. */
  probe?: () => Promise<boolean>;
}

export interface ConnectionStatus {
  state: ConnectionState;
  /** True when the state changed to `online` from a degraded one. */
  reconnected: boolean;
  /** Probe again now (e.g. after a failed request). */
  recheck: () => void;
}

/** Same-origin liveness check for the app's own server. */
async function defaultProbe(): Promise<boolean> {
  try {
    // `no-store` matters: a cached response would report "up" during an outage.
    const response = await fetch('manifest.json', { method: 'HEAD', cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

export function browserOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

export function useConnectionStatus({
  haConnected,
  probeIntervalMs = 15_000,
  probe = defaultProbe,
}: UseConnectionStatusOptions): ConnectionStatus {
  const [beaconReachable, setAbbaiReachable] = useState(true);
  const [offline, setOffline] = useState(browserOffline);
  const [tick, setTick] = useState(0);
  const [reconnected, setReconnected] = useState(false);
  const previousRef = useRef<ConnectionState | null>(null);

  const recheck = useCallback(() => setTick((value) => value + 1), []);

  // Browser-level connectivity.
  useEffect(() => {
    const goOnline = () => {
      setOffline(false);
      recheck();
    };
    const goOffline = () => setOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [recheck]);

  // Probe the app's own origin: on demand, when the tab becomes visible again
  // (a sleeping kiosk tab may have been offline for hours), and on an interval
  // while degraded.
  useEffect(() => {
    if (offline) return;
    let cancelled = false;

    const run = async () => {
      let reachable = false;
      try {
        reachable = await probe();
      } catch {
        // A probe that throws is indistinguishable from one that fails: the
        // origin did not answer usably.
        reachable = false;
      }
      if (!cancelled) setAbbaiReachable(reachable);
    };

    void run();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);

    const interval = setInterval(() => {
      if (!beaconReachable) void run();
    }, probeIntervalMs);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [offline, probe, probeIntervalMs, beaconReachable, tick]);

  const state: ConnectionState = offline
    ? 'offline'
    : !beaconReachable
      ? 'beacon-down'
      : !haConnected
        ? 'ha-down'
        : 'online';

  // One-shot flag so callers can refresh data exactly once per recovery.
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = state;
    if (previous && previous !== 'online' && state === 'online') {
      setReconnected(true);
    } else if (state !== 'online' && reconnected) {
      setReconnected(false);
    }
  }, [state, reconnected]);

  return { state, reconnected, recheck };
}
