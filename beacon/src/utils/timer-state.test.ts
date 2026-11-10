import { describe, expect, it } from 'vitest';
import {
  addTimer,
  collectFinished,
  dismissTimer,
  emptyTimerState,
  hasRunningTimer,
  hydrateTimers,
  lapStopwatch,
  nextTimer,
  pauseStopwatch,
  pauseTimer,
  remainingFor,
  removeTimer,
  resetStopwatch,
  restartTimer,
  resumeTimer,
  startStopwatch,
  stopwatchElapsed,
} from './timer-state';

const T0 = 1_700_000_000_000;

describe('countdown timers', () => {
  it('starts running from the moment it was added', () => {
    const state = addTimer(emptyTimerState(), { name: 'Pasta', totalMs: 5 * 60_000, now: T0 });
    const timer = state.timers[0];

    expect(timer.running).toBe(true);
    expect(timer.endsAt).toBe(T0 + 300_000);
    expect(remainingFor(timer, T0)).toBe(300_000);
    expect(remainingFor(timer, T0 + 60_000)).toBe(240_000);
  });

  it('stops counting when paused and continues from the same point', () => {
    let state = addTimer(emptyTimerState(), { name: 'Pasta', totalMs: 300_000, now: T0 });
    const id = state.timers[0].id;

    state = pauseTimer(state, id, T0 + 60_000);
    expect(state.timers[0].running).toBe(false);
    // Time passing while paused must not eat into the remaining time.
    expect(remainingFor(state.timers[0], T0 + 600_000)).toBe(240_000);

    state = resumeTimer(state, id, T0 + 600_000);
    expect(state.timers[0].endsAt).toBe(T0 + 600_000 + 240_000);
    expect(remainingFor(state.timers[0], T0 + 660_000)).toBe(180_000);
  });

  it('finishes exactly once, so the alarm cannot ring twice for one run', () => {
    const state = addTimer(emptyTimerState(), { name: 'Pasta', totalMs: 60_000, now: T0 });

    const first = collectFinished(state, T0 + 61_000);
    expect(first.finished).toHaveLength(1);
    expect(first.state.timers[0].finished).toBe(true);
    expect(hasRunningTimer(first.state)).toBe(false);

    const second = collectFinished(first.state, T0 + 120_000);
    expect(second.finished).toHaveLength(0);
  });

  it('restarts from the full length and dismiss puts it back, stopped', () => {
    let state = addTimer(emptyTimerState(), { name: 'Pasta', totalMs: 60_000, now: T0 });
    const id = state.timers[0].id;
    state = collectFinished(state, T0 + 61_000).state;

    state = restartTimer(state, id, T0 + 100_000);
    expect(state.timers[0].running).toBe(true);
    expect(remainingFor(state.timers[0], T0 + 100_000)).toBe(60_000);

    state = dismissTimer(state, id);
    expect(state.timers[0].finished).toBe(false);
    expect(state.timers[0].running).toBe(false);
    expect(remainingFor(state.timers[0], T0 + 200_000)).toBe(60_000);
  });

  it('drops a removed timer', () => {
    const state = addTimer(emptyTimerState(), { name: 'Pasta', totalMs: 60_000, now: T0 });
    expect(removeTimer(state, state.timers[0].id).timers).toEqual([]);
  });

  it('knows which timer rings first', () => {
    let state = addTimer(emptyTimerState(), { name: 'Lang', totalMs: 600_000, now: T0 });
    state = addTimer(state, { name: 'Kort', totalMs: 60_000, now: T0 });

    expect(nextTimer(state, T0)?.name).toBe('Kort');
  });
});

describe('a reload or a page switch', () => {
  it('keeps a running timer running, with the real time left', () => {
    const state = addTimer(emptyTimerState(), { name: 'Pasta', totalMs: 600_000, now: T0 });
    const restored = hydrateTimers(JSON.parse(JSON.stringify(state)), T0 + 120_000);

    expect(restored.timers[0].running).toBe(true);
    expect(remainingFor(restored.timers[0], T0 + 120_000)).toBe(480_000);
  });

  it('marks a timer that elapsed while the app was closed as finished', () => {
    const state = addTimer(emptyTimerState(), { name: 'Pasta', totalMs: 60_000, now: T0 });
    const restored = hydrateTimers(JSON.parse(JSON.stringify(state)), T0 + 3_600_000);

    expect(restored.timers[0].finished).toBe(true);
    expect(remainingFor(restored.timers[0], T0 + 3_600_000)).toBe(0);
  });

  it('keeps a paused timer paused at the same value', () => {
    let state = addTimer(emptyTimerState(), { name: 'Pasta', totalMs: 300_000, now: T0 });
    state = pauseTimer(state, state.timers[0].id, T0 + 60_000);
    const restored = hydrateTimers(JSON.parse(JSON.stringify(state)), T0 + 900_000);

    expect(restored.timers[0].running).toBe(false);
    expect(remainingFor(restored.timers[0], T0 + 900_000)).toBe(240_000);
  });

  it('survives junk in storage', () => {
    expect(hydrateTimers(null).timers).toEqual([]);
    expect(hydrateTimers('nope').timers).toEqual([]);
    expect(hydrateTimers({ timers: [{ name: 'Kapot' }] }).timers).toEqual([]);
  });
});

describe('stopwatch', () => {
  it('keeps counting across a navigation and a reload', () => {
    const state = startStopwatch(emptyTimerState(), T0);
    const restored = hydrateTimers(JSON.parse(JSON.stringify(state)), T0 + 65_000);

    expect(restored.stopwatch.running).toBe(true);
    expect(stopwatchElapsed(restored.stopwatch, T0 + 65_000)).toBe(65_000);
  });

  it('accumulates runs and records laps', () => {
    let state = startStopwatch(emptyTimerState(), T0);
    state = lapStopwatch(state, T0 + 10_000);
    state = pauseStopwatch(state, T0 + 20_000);
    expect(stopwatchElapsed(state.stopwatch, T0 + 99_000)).toBe(20_000);

    state = startStopwatch(state, T0 + 100_000);
    expect(stopwatchElapsed(state.stopwatch, T0 + 105_000)).toBe(25_000);
    expect(state.stopwatch.laps).toEqual([10_000]);
  });

  it('resets elapsed time and laps', () => {
    let state = startStopwatch(emptyTimerState(), T0);
    state = lapStopwatch(state, T0 + 5_000);
    state = resetStopwatch(state);

    expect(state.stopwatch).toEqual({ running: false, baseMs: 0, startedAt: 0, laps: [] });
  });
});
