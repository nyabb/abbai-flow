/**
 * Global timer store.
 *
 * The timer screen is a page you navigate away from, so its state must not live
 * in that page's component: this module owns it, persists it, and keeps a single
 * ticker running (and ringing) no matter which page is on screen.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  addTimer as addTimerState,
  collectFinished,
  dismissTimer as dismissState,
  hydrateTimers,
  lapStopwatch,
  hasRunningTimer,
  nextTimer,
  pauseStopwatch,
  pauseTimer as pauseState,
  removeTimer as removeState,
  remainingFor,
  resetStopwatch as resetState,
  restartTimer as restartState,
  resumeTimer as resumeState,
  startStopwatch,
  stopwatchElapsed,
  TIMERS_STORAGE_KEY,
  type CountdownTimer,
  type TimerState,
} from '../utils/timer-state';

function readStored(): TimerState {
  try {
    const raw = localStorage.getItem(TIMERS_STORAGE_KEY);
    return hydrateTimers(raw ? JSON.parse(raw) : null);
  } catch {
    return hydrateTimers(null);
  }
}

let state: TimerState = readStored();
const listeners = new Set<() => void>();
const finishListeners = new Set<(timer: CountdownTimer) => void>();
let ticker: ReturnType<typeof setInterval> | null = null;
/** Snapshot identity must change on every tick, or a running clock never redraws. */
let snapshot = { state, seq: 0 };

function publish() {
  snapshot = { state, seq: snapshot.seq + 1 };
  for (const listener of listeners) listener();
}

function persist() {
  try {
    localStorage.setItem(TIMERS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Storage is optional; the timers still run in memory. */
  }
}

function emit() {
  persist();
  publish();
  syncTicker();
}

function setState(next: TimerState) {
  if (next === state) return;
  state = next;
  emit();
}

function tick() {
  const { state: next, finished } = collectFinished(state, Date.now());
  state = next;
  publish();
  for (const timer of finished) for (const listener of finishListeners) listener(timer);
}

function syncTicker() {
  const needed = hasRunningTimer(state) || state.stopwatch.running;
  if (needed && ticker === null) {
    ticker = setInterval(tick, 250);
  } else if (!needed && ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

/** Ring when a timer finishes, even if the timer screen is not mounted. */
export function onTimerFinished(listener: (timer: CountdownTimer) => void): () => void {
  finishListeners.add(listener);
  return () => {
    finishListeners.delete(listener);
  };
}

/** Re-check the clock when the app comes back from the background. */
function handleVisibility() {
  if (!document.hidden) tick();
}

export interface UseTimersResult {
  timers: CountdownTimer[];
  /** Epoch ms; changes on every tick, so a component showing a clock re-renders. */
  now: number;
  stopwatchElapsedMs: number;
  stopwatchRunning: boolean;
  laps: number[];
  runningTimer: CountdownTimer | null;
  addTimer: (input: { name: string; totalMs: number }) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  restart: (id: string) => void;
  dismiss: (id: string) => void;
  remove: (id: string) => void;
  remaining: (timer: CountdownTimer) => number;
  startSw: () => void;
  pauseSw: () => void;
  resetSw: () => void;
  lapSw: () => void;
}

export function useTimers(): UseTimersResult {
  const latest = useSyncExternalStore(subscribe, getSnapshot);
  const snapshot = latest.state;

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibility);
    // A page that mounts while timers already run must start the ticker.
    syncTicker();
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const addTimer = useCallback((input: { name: string; totalMs: number }) => {
    setState(addTimerState(state, input));
  }, []);

  return {
    timers: snapshot.timers,
    // The ticker lives outside React; the snapshot object changes identity on
    // every tick, so reading Date.now() here stays consistent with it.
    now: Date.now(),
    stopwatchElapsedMs: stopwatchElapsed(snapshot.stopwatch),
    stopwatchRunning: snapshot.stopwatch.running,
    laps: snapshot.stopwatch.laps,
    runningTimer: nextTimer(snapshot),
    addTimer,
    pause: useCallback((id: string) => setState(pauseState(state, id)), []),
    resume: useCallback((id: string) => setState(resumeState(state, id)), []),
    restart: useCallback((id: string) => setState(restartState(state, id)), []),
    dismiss: useCallback((id: string) => setState(dismissState(state, id)), []),
    remove: useCallback((id: string) => setState(removeState(state, id)), []),
    remaining: useCallback((timer: CountdownTimer) => remainingFor(timer), []),
    startSw: useCallback(() => setState(startStopwatch(state)), []),
    pauseSw: useCallback(() => setState(pauseStopwatch(state)), []),
    resetSw: useCallback(() => setState(resetState(state)), []),
    lapSw: useCallback(() => setState(lapStopwatch(state)), []),
  };
}

/** Test helper: reset the module store between cases. */
export function resetTimerStoreForTests(next: Partial<TimerState> = {}) {
  state = { ...hydrateTimers(null), ...next };
  emit();
}
