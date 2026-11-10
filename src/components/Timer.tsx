import { useState, useCallback } from 'react';
import { Play, Pause, RotateCcw, Flag, X, Plus, Volume2, BellOff } from 'lucide-react';
import { useTranslation } from '../i18n';
import type { TranslationKey } from '../i18n/translations/en';
import { useTimers } from '../hooks/useTimers';
import type { CountdownTimer } from '../utils/timer-state';
import { getStoredSound, playSoundOnce, setStoredSound, type SoundName } from '../utils/timer-sound';

const PRESETS = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '10m', seconds: 600 },
  { label: '15m', seconds: 900 },
  { label: '30m', seconds: 1800 },
  { label: '1h', seconds: 3600 },
];

type TimerMode = 'stopwatch' | 'timers';

const SOUND_OPTIONS: { key: SoundName; labelKey: TranslationKey }[] = [
  { key: 'chime', labelKey: 'timer.soundChime' },
  { key: 'beep', labelKey: 'timer.soundBeep' },
  { key: 'alarm', labelKey: 'timer.soundAlarm' },
  { key: 'kitchen', labelKey: 'timer.soundKitchen' },
  { key: 'gentle', labelKey: 'timer.soundGentle' },
];

interface TimerProps {
  compact?: boolean;
}

function formatTime(totalMs: number): string {
  const totalSec = Math.max(0, Math.floor(totalMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function Timer({ compact = false }: TimerProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<TimerMode>('timers');
  const [sound, setSound] = useState<SoundName>(getStoredSound);

  /** Remember the chosen sound for the alarm that rings on other pages too. */
  const changeSound = useCallback((next: SoundName) => {
    setSound(next);
    setStoredSound(next);
  }, []);

  /**
   * Countdowns and the stopwatch live in the global timer store, not in this
   * component: leaving the page must not stop a timer, drop it from the list or
   * silence its alarm. Everything below is wall-clock based, so a page switch,
   * a reload or an idle app resumes with the correct remaining time.
   */
  const {
    timers,
    addTimer: addTimerToStore,
    pause: pauseTimer,
    resume: resumeTimer,
    dismiss: dismissTimer,
    remove: cancelTimer,
    remaining,
    startSw,
    pauseSw,
    resetSw,
    lapSw,
    stopwatchElapsedMs,
    stopwatchRunning,
    laps,
  } = useTimers();

  const [newName, setNewName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState(300); // 5m default

  const addTimer = useCallback(() => {
    addTimerToStore({
      name: newName.trim() || `Timer ${timers.length + 1}`,
      totalMs: selectedPreset * 1000,
    });
    setNewName('');
  }, [addTimerToStore, newName, selectedPreset, timers.length]);

  const getRemaining = (timer: CountdownTimer) => remaining(timer);

  // The stopwatch reads straight from the store; these aliases keep the markup
  // unchanged and make it obvious where the state comes from.
  const swRunning = stopwatchRunning;
  const swElapsed = stopwatchElapsedMs;
  const swStart = startSw;
  const swPause = pauseSw;
  const swReset = resetSw;
  const swLap = lapSw;

  return (
    <div className={`timer ${compact ? 'timer--compact' : ''}`}>
      {/* Mode switcher */}
      <div className="timer-modes">
        <button
          type="button"
          className={`timer-mode-btn ${mode === 'timers' ? 'timer-mode-btn--active' : ''}`}
          onClick={() => setMode('timers')}
        >
          {t('timer.modeTimers')}
        </button>
        <button
          type="button"
          className={`timer-mode-btn ${mode === 'stopwatch' ? 'timer-mode-btn--active' : ''}`}
          onClick={() => setMode('stopwatch')}
        >
          {t('timer.modeStopwatch')}
        </button>
      </div>

      {mode === 'timers' && (
        <>
          {/* Sound picker */}
          <div className="timer-sound-picker">
            <Volume2 size={14} className="timer-sound-icon" />
            {SOUND_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`timer-sound-btn ${sound === opt.key ? 'timer-sound-btn--active' : ''}`}
                onClick={() => {
                  changeSound(opt.key);
                  playSoundOnce(opt.key);
                }}
                title={t('timer.previewSound', { name: t(opt.labelKey) })}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>

          {/* Add Timer section */}
          <div className="timer-add-section">
            <input
              type="text"
              className="timer-name-input"
              placeholder={t('timer.namePlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTimer();
              }}
            />
            <div className="timer-presets">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`timer-preset ${selectedPreset === p.seconds ? 'timer-preset--active' : ''}`}
                  onClick={() => setSelectedPreset(p.seconds)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="timer-btn timer-btn--play timer-start-btn"
              onClick={addTimer}
              title={t('timer.startTimer')}
            >
              <Plus size={compact ? 14 : 16} />
              <span>{t('timer.start')}</span>
            </button>
          </div>

          {/* Active timers list */}
          {timers.length > 0 && (
            <div className="timer-list">
              {timers.map((timerItem) => {
                const remaining = getRemaining(timerItem);
                return (
                  <div
                    key={timerItem.id}
                    className={`timer-card ${timerItem.finished ? 'timer-card--finished' : ''}`}
                  >
                    <div className="timer-card-name">{timerItem.name}</div>
                    <div
                      className={`timer-card-time ${timerItem.finished ? 'timer-display--finished' : ''}`}
                    >
                      {formatTime(remaining)}
                    </div>
                    <div className="timer-card-controls">
                      {timerItem.finished && (
                        <button
                          type="button"
                          className="timer-btn timer-btn--dismiss timer-btn--sm"
                          onClick={() => dismissTimer(timerItem.id)}
                          title={t('timer.dismissAlarm')}
                        >
                          <BellOff size={14} />
                        </button>
                      )}
                      {!timerItem.finished &&
                        (timerItem.running ? (
                          <button
                            type="button"
                            className="timer-btn timer-btn--pause timer-btn--sm"
                            onClick={() => pauseTimer(timerItem.id)}
                            title={t('timer.pause')}
                          >
                            <Pause size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="timer-btn timer-btn--play timer-btn--sm"
                            onClick={() => resumeTimer(timerItem.id)}
                            title={t('timer.resume')}
                          >
                            <Play size={14} />
                          </button>
                        ))}
                      <button
                        type="button"
                        className="timer-btn timer-btn--sm"
                        onClick={() => cancelTimer(timerItem.id)}
                        title={t('timer.remove')}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {mode === 'stopwatch' && (
        <>
          <div className="timer-display">{formatTime(swElapsed)}</div>

          <div className="timer-controls">
            {!swRunning ? (
              <button
                type="button"
                className="timer-btn timer-btn--play"
                onClick={swStart}
                title={t('timer.start')}
              >
                <Play size={compact ? 16 : 20} />
              </button>
            ) : (
              <button
                type="button"
                className="timer-btn timer-btn--pause"
                onClick={swPause}
                title={t('timer.pause')}
              >
                <Pause size={compact ? 16 : 20} />
              </button>
            )}

            {swRunning && (
              <button type="button" className="timer-btn" onClick={swLap} title={t('timer.lap')}>
                <Flag size={compact ? 16 : 20} />
              </button>
            )}

            {swElapsed > 0 && (
              <button
                type="button"
                className="timer-btn"
                onClick={swReset}
                title={t('timer.reset')}
              >
                <RotateCcw size={compact ? 16 : 20} />
              </button>
            )}
          </div>

          {!compact && laps.length > 0 && (
            <div className="timer-laps">
              {laps.map((lap, i) => (
                <div key={i} className="timer-lap">
                  <span className="timer-lap-label">{t('timer.lapN', { n: i + 1 })}</span>
                  <span className="timer-lap-time">{formatTime(lap)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
