/**
 * Countdown timers: the state itself, independent of React.
 *
 * Why it lives outside a component: the timer page unmounts when you navigate
 * away, and everything in `useState` went with it — the countdown stopped, the
 * list disappeared and the completion sound never fired. All of this is now
 * wall-clock based (`endsAt`, `Date.now()`), so a timer keeps running across
 * pages, across a reload, and even while the app was closed.
 */

export interface CountdownTimer {
  id: string;
  name: string;
  /** What the timer was set to. */
  totalMs: number;
  /** Epoch ms at which the current run ends; `0` while paused. */
  endsAt: number;
  /** Remaining ms while paused (and the fallback when the run finishes). */
  remainingMs: number;
  running: boolean;
  finished: boolean;
}

export interface StopwatchState {
  running: boolean;
  /** Elapsed time carried over from earlier runs. */
  baseMs: number;
  /** Epoch ms when the current run started; `0` while paused. */
  startedAt: number;
  laps: number[];
}

export interface TimerState {
  timers: CountdownTimer[];
  stopwatch: StopwatchState;
}

const STORAGE_KEY = 'beacon-timers';

export function emptyTimerState(): TimerState {
  return {
    timers: [],
    stopwatch: { running: false, baseMs: 0, startedAt: 0, laps: [] },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rehydrate from storage.
 *
 * A timer that was running while the app was closed is resolved against the
 * wall clock: still in the future → keeps counting from its real `endsAt`;
 * already past → finished, so the child sees the alarm instead of a stale clock.
 */
export function hydrateTimers(raw: unknown, now = Date.now()): TimerState {
  const base = emptyTimerState();
  if (!isRecord(raw)) return base;

  const timers: CountdownTimer[] = [];
  for (const item of Array.isArray(raw.timers) ? raw.timers : []) {
    if (!isRecord(item) || typeof item.name !== 'string') continue;
    const totalMs = typeof item.totalMs === 'number' && item.totalMs > 0 ? item.totalMs : 0;
    if (totalMs === 0) continue;
    const endsAt = typeof item.endsAt === 'number' ? item.endsAt : 0;
    const remainingMs =
      typeof item.remainingMs === 'number'
        ? Math.max(0, Math.min(item.remainingMs, totalMs))
        : totalMs;
    const id = typeof item.id === 'string' && item.id ? item.id : `t-${timers.length + 1}`;
    const running = item.running === true && endsAt > 0;

    if (running && endsAt <= now) {
      timers.push({
        id,
        name: item.name,
        totalMs,
        endsAt: 0,
        remainingMs: 0,
        running: false,
        finished: true,
      });
      continue;
    }
    timers.push({
      id,
      name: item.name,
      totalMs,
      endsAt: running ? endsAt : 0,
      remainingMs: running ? Math.max(0, endsAt - now) : remainingMs,
      running,
      finished: item.finished === true && !running,
    });
  }

  const sw = isRecord(raw.stopwatch) ? raw.stopwatch : {};
  const stopwatch: StopwatchState = {
    running: sw.running === true,
    baseMs: typeof sw.baseMs === 'number' && sw.baseMs >= 0 ? sw.baseMs : 0,
    startedAt: typeof sw.startedAt === 'number' && sw.running === true ? sw.startedAt : 0,
    laps: Array.isArray(sw.laps)
      ? sw.laps.filter((lap): lap is number => typeof lap === 'number')
      : [],
  };
  // A stopwatch can keep running across a reload: it only ever needs "when did
  // this run start", which survives being closed.
  if (stopwatch.running && stopwatch.startedAt === 0) stopwatch.startedAt = now;

  return { timers, stopwatch };
}

export function remainingFor(timer: CountdownTimer, now = Date.now()): number {
  if (timer.finished) return 0;
  if (timer.running) return Math.max(0, timer.endsAt - now);
  return Math.max(0, timer.remainingMs);
}

export function addTimer(
  state: TimerState,
  input: { name: string; totalMs: number; now?: number },
): TimerState {
  const now = input.now ?? Date.now();
  const totalMs = Math.max(1000, Math.round(input.totalMs));
  const timer: CountdownTimer = {
    id: `t-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name,
    totalMs,
    endsAt: now + totalMs,
    remainingMs: totalMs,
    running: true,
    finished: false,
  };
  return { ...state, timers: [...state.timers, timer] };
}

function patch(
  state: TimerState,
  id: string,
  change: (timer: CountdownTimer, now: number) => CountdownTimer,
  now = Date.now(),
): TimerState {
  return {
    ...state,
    timers: state.timers.map((timer) => (timer.id === id ? change(timer, now) : timer)),
  };
}

export function pauseTimer(state: TimerState, id: string, now = Date.now()): TimerState {
  return patch(
    state,
    id,
    (timer) => {
      if (!timer.running || timer.finished) return timer;
      return { ...timer, running: false, endsAt: 0, remainingMs: remainingFor(timer, now) };
    },
    now,
  );
}

export function resumeTimer(state: TimerState, id: string, now = Date.now()): TimerState {
  return patch(
    state,
    id,
    (timer) => {
      if (timer.running || timer.finished) return timer;
      const remaining = Math.max(0, timer.remainingMs);
      if (remaining === 0) return timer;
      return { ...timer, running: true, endsAt: now + remaining };
    },
    now,
  );
}

/** Restart from the beginning, still running. */
export function restartTimer(state: TimerState, id: string, now = Date.now()): TimerState {
  return patch(
    state,
    id,
    (timer) => ({
      ...timer,
      running: true,
      finished: false,
      endsAt: now + timer.totalMs,
      remainingMs: timer.totalMs,
    }),
    now,
  );
}

/** Acknowledge a finished timer: it goes back to full length, stopped. */
export function dismissTimer(state: TimerState, id: string): TimerState {
  return patch(state, id, (timer) => ({
    ...timer,
    running: false,
    finished: false,
    endsAt: 0,
    remainingMs: timer.totalMs,
  }));
}

export function removeTimer(state: TimerState, id: string): TimerState {
  return { ...state, timers: state.timers.filter((timer) => timer.id !== id) };
}

/** Timers whose run has just elapsed. Called by the ticker. */
export function collectFinished(
  state: TimerState,
  now = Date.now(),
): { state: TimerState; finished: CountdownTimer[] } {
  const finished: CountdownTimer[] = [];
  const timers = state.timers.map((timer) => {
    if (!timer.running || timer.finished) return timer;
    if (timer.endsAt > now) return timer;
    finished.push(timer);
    return { ...timer, running: false, finished: true, endsAt: 0, remainingMs: 0 };
  });
  return { state: finished.length > 0 ? { ...state, timers } : state, finished };
}

export function hasRunningTimer(state: TimerState): boolean {
  return state.timers.some((timer) => timer.running && !timer.finished);
}

/** The timer that will ring first, for the "still running" indicator. */
export function nextTimer(state: TimerState, now = Date.now()): CountdownTimer | null {
  const running = state.timers.filter((timer) => timer.running && !timer.finished);
  if (running.length === 0) return null;
  return running.reduce((soonest, timer) =>
    remainingFor(timer, now) < remainingFor(soonest, now) ? timer : soonest,
  );
}

/* -------------------------------------------------------------------------- */
/* Stopwatch                                                                   */
/* -------------------------------------------------------------------------- */

export function stopwatchElapsed(state: StopwatchState, now = Date.now()): number {
  return state.baseMs + (state.running ? Math.max(0, now - state.startedAt) : 0);
}

export function startStopwatch(state: TimerState, now = Date.now()): TimerState {
  if (state.stopwatch.running) return state;
  return { ...state, stopwatch: { ...state.stopwatch, running: true, startedAt: now } };
}

export function pauseStopwatch(state: TimerState, now = Date.now()): TimerState {
  if (!state.stopwatch.running) return state;
  return {
    ...state,
    stopwatch: {
      ...state.stopwatch,
      running: false,
      baseMs: stopwatchElapsed(state.stopwatch, now),
      startedAt: 0,
    },
  };
}

export function resetStopwatch(state: TimerState): TimerState {
  return { ...state, stopwatch: { running: false, baseMs: 0, startedAt: 0, laps: [] } };
}

export function lapStopwatch(state: TimerState, now = Date.now()): TimerState {
  if (!state.stopwatch.running) return state;
  const elapsed = stopwatchElapsed(state.stopwatch, now);
  return { ...state, stopwatch: { ...state.stopwatch, laps: [...state.stopwatch.laps, elapsed] } };
}

export { STORAGE_KEY as TIMERS_STORAGE_KEY };
