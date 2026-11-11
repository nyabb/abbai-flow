/**
 * The running-timer dock.
 *
 * A countdown belongs to the household, not to the timer page: it keeps running
 * after you navigate away, so something has to say so on every page. The first
 * attempt was a fixed pill in the bottom-left corner, which sat on top of page
 * content and made you open the timer page to do anything about it.
 *
 * This is a small semi-transparent dock pinned under the header's top-right
 * corner. Collapsed it is one chip showing the countdown that rings first; open
 * it and you get every running (or ringing) timer with pause/resume and delete,
 * plus a link to the timer page for anything else. It floats over the layout, so
 * no header is ever pushed around.
 */
import { useEffect, useRef, useState } from 'react';
import { BellOff, ChevronUp, Clock3, Pause, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from '../i18n';
import { useTimers } from '../hooks/useTimers';

/** `m:ss` below an hour, `h:mm:ss` above it. */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export interface TimerDockProps {
  /** Go to the timer page, e.g. to add a timer or use the presets. */
  onOpen: () => void;
}

export function TimerDock({ onOpen }: TimerDockProps) {
  const { t } = useTranslation();
  const {
    timers,
    remaining,
    stopwatchRunning,
    stopwatchElapsedMs,
    pause,
    resume,
    dismiss,
    remove,
    pauseSw,
    resetSw,
  } = useTimers();
  const [open, setOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);

  /*
   * Sit exactly under the page header.
   *
   * The header is a different component on every view (and wraps to two rows on
   * a phone), so a hard-coded `top` either covers the clock or floats half a
   * screen down. Measuring the band once per layout change keeps the dock
   * pinned to its bottom-right corner without either failure mode.
   */
  useEffect(() => {
    const measure = () => {
      // The band at the top of the view: a page header, the dashboard's topbar
      // or a role="banner" wrapper. Anything further down is page content.
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>('.beacon-header, .planner-header, [role="banner"], header'),
      ).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.height > 24 && rect.top < 48 && rect.bottom < window.innerHeight / 2;
      });
      const band = candidates.reduce<HTMLElement | null>(
        (lowest, el) =>
          !lowest || el.getBoundingClientRect().bottom > lowest.getBoundingClientRect().bottom
            ? el
            : lowest,
        null,
      );
      const top = band ? Math.round(band.getBoundingClientRect().bottom) + 8 : 92;
      document.documentElement.style.setProperty('--timer-dock-top', `${Math.max(8, top)}px`);
    };

    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(document.body);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      document.documentElement.style.removeProperty('--timer-dock-top');
    };
  }, []);

  // A popover that cannot be dismissed by clicking away feels stuck on a wall
  // display where nobody presses Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!dockRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Nothing running: keep the corner empty, exactly like before.
  if (timers.length === 0 && !stopwatchRunning) return null;

  const countdowns = timers.filter(
    (timer) => timer.running || timer.finished || timer.remainingMs > 0,
  );
  const nextUp = countdowns
    .filter((timer) => timer.running && !timer.finished)
    .sort((a, b) => remaining(a) - remaining(b))[0];
  const ringing = countdowns.some((timer) => timer.finished);
  const total = countdowns.length + (stopwatchRunning ? 1 : 0);

  return (
    <div className={`timer-dock${open ? ' is-open' : ''}`} ref={dockRef}>
      <button
        type="button"
        className={`timer-dock-toggle${ringing ? ' is-ringing' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="timer-dock-panel"
        aria-label={t('timer.modeTimers')}
        title={t('timer.modeTimers')}
      >
        <Clock3 size={16} aria-hidden="true" />
        {nextUp ? (
          <strong>{formatClock(remaining(nextUp))}</strong>
        ) : (
          <span className="timer-dock-label">{t('timer.modeTimers')}</span>
        )}
        {total > 1 && <span className="timer-dock-count">{total}</span>}
        <ChevronUp size={14} className="timer-dock-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div
          className="timer-dock-panel"
          id="timer-dock-panel"
          role="region"
          aria-label={t('timer.modeTimers')}
        >
          <ul className="timer-dock-list">
            {countdowns.map((timer) => (
              <li
                key={timer.id}
                className={`timer-dock-item${timer.finished ? ' is-ringing' : ''}${
                  !timer.running && !timer.finished ? ' is-paused' : ''
                }`}
              >
                <span className="timer-dock-avatar" aria-hidden="true">
                  {timer.finished ? (
                    <BellOff size={16} />
                  ) : timer.running ? (
                    <Clock3 size={16} />
                  ) : (
                    <Pause size={16} />
                  )}
                </span>
                <span className="timer-dock-copy">
                  <span className="timer-dock-name">{timer.name}</span>
                  <strong className="timer-dock-time">
                    {timer.finished ? t('timer.dismissAlarm') : formatClock(remaining(timer))}
                  </strong>
                </span>
                <span className="timer-dock-actions">
                  {timer.finished ? (
                    <button
                      type="button"
                      className="timer-dock-action"
                      onClick={() => dismiss(timer.id)}
                      title={t('timer.dismissAlarm')}
                      aria-label={`${t('timer.dismissAlarm')}: ${timer.name}`}
                    >
                      <BellOff size={15} />
                    </button>
                  ) : timer.running ? (
                    <button
                      type="button"
                      className="timer-dock-action"
                      onClick={() => pause(timer.id)}
                      title={t('timer.pause')}
                      aria-label={`${t('timer.pause')}: ${timer.name}`}
                    >
                      <Pause size={15} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="timer-dock-action"
                      onClick={() => resume(timer.id)}
                      title={t('timer.resume')}
                      aria-label={`${t('timer.resume')}: ${timer.name}`}
                    >
                      <Play size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="timer-dock-action timer-dock-action--danger"
                    onClick={() => remove(timer.id)}
                    title={t('timer.remove')}
                    aria-label={`${t('timer.remove')}: ${timer.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </span>
              </li>
            ))}

            {stopwatchRunning && (
              <li className="timer-dock-item">
                <span className="timer-dock-avatar" aria-hidden="true">
                  <Clock3 size={16} />
                </span>
                <span className="timer-dock-copy">
                  <span className="timer-dock-name">{t('timer.modeStopwatch')}</span>
                  <strong className="timer-dock-time">{formatClock(stopwatchElapsedMs)}</strong>
                </span>
                <span className="timer-dock-actions">
                  <button
                    type="button"
                    className="timer-dock-action"
                    onClick={pauseSw}
                    title={t('timer.pause')}
                    aria-label={`${t('timer.pause')}: ${t('timer.modeStopwatch')}`}
                  >
                    <Pause size={15} />
                  </button>
                  <button
                    type="button"
                    className="timer-dock-action timer-dock-action--danger"
                    onClick={resetSw}
                    title={t('timer.reset')}
                    aria-label={`${t('timer.reset')}: ${t('timer.modeStopwatch')}`}
                  >
                    <RotateCcw size={15} />
                  </button>
                </span>
              </li>
            )}
          </ul>

          <button type="button" className="timer-dock-open" onClick={onOpen}>
            {t('nav.timer')}
          </button>
        </div>
      )}
    </div>
  );
}
