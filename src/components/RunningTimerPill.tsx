/**
 * A running countdown stays visible on every page.
 *
 * Once the timers moved into the global store they kept counting when you left
 * the timer screen — but nothing on screen said so, which read as "it stopped
 * and disappeared". This pill shows the timer that will ring first and takes you
 * back to the timer page when tapped.
 */
import { Clock3 } from 'lucide-react';
import { useTimers } from '../hooks/useTimers';

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function RunningTimerPill({ onOpen }: { onOpen: () => void }) {
  const { runningTimer, remaining, timers } = useTimers();
  if (!runningTimer) return null;

  const extra = timers.filter((timer) => timer.running && !timer.finished).length - 1;

  return (
    <button
      type="button"
      className="timer-pill"
      onClick={onOpen}
      aria-label={`${runningTimer.name} ${formatRemaining(remaining(runningTimer))}`}
    >
      <Clock3 size={16} />
      <span className="timer-pill-name">{runningTimer.name}</span>
      <strong>{formatRemaining(remaining(runningTimer))}</strong>
      {extra > 0 && <span className="timer-pill-more">+{extra}</span>}
    </button>
  );
}
