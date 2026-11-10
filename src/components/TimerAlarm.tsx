/**
 * The audible part of a timer.
 *
 * Mounted once, next to the app shell, so a countdown that finishes while the
 * family is on another page still rings — the old implementation cancelled its
 * beep loop when the timer page unmounted.
 */
import { useEffect } from 'react';
import { useTimers, onTimerFinished } from '../hooks/useTimers';
import { getStoredSound, playSoundOnce } from '../utils/timer-sound';

/** How often a finished timer re-rings until somebody acknowledges it. */
const REPEAT_MS = 2500;

export function TimerAlarm() {
  const { timers } = useTimers();
  const ringing = timers.filter((timer) => timer.finished);

  // Ring the moment a timer elapses, wherever the user is.
  useEffect(() => onTimerFinished(() => playSoundOnce(getStoredSound())), []);

  // Keep ringing while a finished timer is still on the list.
  useEffect(() => {
    if (ringing.length === 0) return;
    const interval = setInterval(() => playSoundOnce(getStoredSound()), REPEAT_MS);
    return () => clearInterval(interval);
  }, [ringing.length]);

  return null;
}
