import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ListMusic,
  Music2,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { EncorePlayback, EncoreRepeat, EncoreSnapshot } from '../api/encore-music';
import { useTranslation } from '../i18n';

interface SpotifyMusicPanelProps {
  snapshot: EncoreSnapshot;
  loading: boolean;
  onControl: (action: string, value?: unknown) => Promise<{ ok: boolean; error?: string }>;
}

function formatTime(milliseconds: number | null | undefined): string {
  if (milliseconds == null || !Number.isFinite(milliseconds)) return '--:--';
  const seconds = Math.floor(milliseconds / 1000);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function playbackPosition(playback: EncorePlayback): number {
  const anchor = playback.position;
  if (!anchor) return 0;
  const elapsed = anchor.timestampMs ? Math.max(0, Date.now() - anchor.timestampMs) : 0;
  const moving = playback.status === 'playing' ? elapsed * anchor.speed : 0;
  const duration = playback.item?.durationMs;
  return Math.max(0, Math.min(anchor.positionMs + moving, duration ?? Number.MAX_SAFE_INTEGER));
}

export function SpotifyMusicPanel({ snapshot, loading, onControl }: SpotifyMusicPanelProps) {
  const { t } = useTranslation();
  const [position, setPosition] = useState(0);
  const [positionDraft, setPositionDraft] = useState<number | null>(null);
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const previousVolume = useRef(35);

  const isActive = snapshot.connection === 'connected' && snapshot.auth.isActive === true;
  const loggedIn = snapshot.auth.loggedIn === true;
  const canControl = isActive && loggedIn;
  const playback = snapshot.playback;
  const duration = playback.item?.durationMs ?? 0;

  const runControl = async (action: string, value?: unknown) => {
    setControlError(null);
    const result = await onControl(action, value);
    if (!result.ok) setControlError(result.error || 'Control request failed');
  };

  useEffect(() => {
    const tick = () => setPosition(playbackPosition(playback));
    tick();
    if (playback.status !== 'playing') return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [playback]);

  useEffect(() => {
    if (positionDraft === null) return;
    const timer = setTimeout(() => {
      void runControl('seek', positionDraft);
      setPositionDraft(null);
    }, 450);
    return () => clearTimeout(timer);
    // runControl is stable for the lifetime of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionDraft]);

  useEffect(() => {
    if (volumeDraft === null) return;
    const timer = setTimeout(() => {
      void runControl('volume', volumeDraft);
      setVolumeDraft(null);
    }, 180);
    return () => clearTimeout(timer);
    // runControl is stable for the lifetime of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volumeDraft]);

  const currentPosition = positionDraft ?? position;
  const volume = volumeDraft ?? playback.volume ?? 0;

  useEffect(() => {
    if (playback.volume !== null && playback.volume > 0) previousVolume.current = playback.volume;
  }, [playback.volume]);
  const statusText = useMemo(() => {
    if (loading) return t('app.connecting');
    if (!snapshot.configured) return t('music.spotifyStatusNotConfigured');
    if (snapshot.error) return t('display.connection.appDown');
    if (snapshot.connection === 'connecting') return t('app.connecting');
    if (snapshot.connection === 'disconnected') {
      return snapshot.error
        ? t('display.connection.appDown')
        : t('settings.integrations.disconnected');
    }
    if (snapshot.auth.loggedIn === false) return t('music.spotifyStatusLoggedOut');
    if (snapshot.auth.loggedIn !== true) return t('app.connecting');
    if (snapshot.auth.isActive !== true) return t('music.spotifyStatusDeviceInactive');
    if (!playback.item || playback.status === 'idle') return t('music.spotifyStatusNoPlayback');
    return playback.status === 'playing'
      ? t('music.spotifyStatusPlaying')
      : playback.status === 'paused'
        ? t('music.spotifyStatusPaused')
        : t('music.spotifyStatusBuffering');
  }, [
    loading,
    playback.item,
    playback.status,
    snapshot.auth.isActive,
    snapshot.auth.loggedIn,
    snapshot.configured,
    snapshot.connection,
    snapshot.error,
    t,
  ]);

  const repeatLabel: Record<EncoreRepeat, string> = {
    off: t('eventModal.repeatNone'),
    context: t('music.spotifyRepeatContext'),
    track: t('music.spotifyRepeatTrack'),
  };
  const nextRepeat: Record<EncoreRepeat, EncoreRepeat> = {
    off: 'context',
    context: 'track',
    track: 'off',
  };
  const nextTrack = playback.options.repeat || 'off';
  const upNext = snapshot.queue.upcoming.slice(0, 6);

  return (
    <section className="spotify-panel" aria-label={t('music.spotify')}>
      <header className="spotify-panel-header">
        <div className="spotify-panel-brand">
          <span className="spotify-panel-icon">
            <Music2 size={20} />
          </span>
          <div>
            <h2>{t('music.spotify')}</h2>
            <p>{snapshot.auth.deviceName || t('music.spotifyDevice')}</p>
          </div>
        </div>
        <span
          className={
            'spotify-status spotify-status--' +
            (!snapshot.error &&
            snapshot.connection === 'connected' &&
            snapshot.auth.loggedIn &&
            snapshot.auth.isActive
              ? 'ready'
              : snapshot.error
                ? 'disconnected'
                : snapshot.connection)
          }
          role="status"
        >
          <span className="spotify-status-dot" />
          {statusText}
        </span>
      </header>

      {!snapshot.configured && !loading && (
        <div className="spotify-message">
          <p>{t('music.spotifyConfigure')}</p>
        </div>
      )}

      {(snapshot.connection === 'disconnected' || snapshot.error) &&
        snapshot.configured &&
        !loading && (
          <div className="spotify-message" role="alert">
            <p>{t('music.spotifyConnectionHelp')}</p>
          </div>
        )}

      {snapshot.connection === 'connected' && snapshot.auth.loggedIn === false && (
        <div className="spotify-message">
          <p>{t('music.spotifyLoginHelp')}</p>
        </div>
      )}

      <div className="spotify-main-layout">
        <div className="spotify-now-playing">
          <div className="spotify-art">
            {playback.item?.artworkUrl ? (
              <img
                src={playback.item.artworkUrl}
                alt={playback.item.album || t('music.albumArt')}
              />
            ) : (
              <div className="spotify-art-placeholder">
                <Music2 size={64} strokeWidth={1.2} />
              </div>
            )}
          </div>

          <div className="spotify-player">
            <div className="spotify-track-copy">
              <p className="spotify-eyebrow">{t('music.nowPlaying')}</p>
              <h3>{playback.item?.title || t('music.spotifyNoTrack')}</h3>
              <p className="spotify-artist">{playback.item?.artists.join(', ') || '—'}</p>
              {playback.item?.album && <p className="spotify-album">{playback.item.album}</p>}
            </div>

            {playback.context?.title && (
              <div className="spotify-context">
                <ListMusic size={17} />
                <span>
                  {t('music.spotifyContext')}: {playback.context.title}
                </span>
              </div>
            )}

            <div className="spotify-progress">
              <input
                aria-label={t('music.spotifySeek')}
                type="range"
                min={0}
                max={duration || 1}
                step={1000}
                value={Math.min(currentPosition, duration || 1)}
                disabled={
                  !canControl || duration <= 0 || !playback.availableActions.includes('seek')
                }
                onChange={(event) => setPositionDraft(Number(event.target.value))}
              />
              <div className="spotify-progress-times">
                <span>{formatTime(currentPosition)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="spotify-controls">
              <button
                type="button"
                className={
                  'spotify-control-button' + (playback.options.shuffle ? ' is-active' : '')
                }
                aria-label={t('music.spotifyShuffle')}
                aria-pressed={Boolean(playback.options.shuffle)}
                disabled={!canControl || playback.options.shuffle === null}
                onClick={() => void runControl('shuffle', !playback.options.shuffle)}
              >
                <Shuffle size={21} />
              </button>
              <button
                type="button"
                className="spotify-control-button"
                aria-label={t('music.previousTrack')}
                disabled={!canControl || !playback.availableActions.includes('skip_prev')}
                onClick={() => void runControl('previous')}
              >
                <SkipBack size={24} />
              </button>
              <button
                type="button"
                className="spotify-control-button spotify-control-button--play"
                aria-label={playback.status === 'playing' ? t('music.pause') : t('music.play')}
                disabled={
                  !canControl ||
                  !playback.availableActions.includes(
                    playback.status === 'playing' ? 'pause' : 'play',
                  )
                }
                onClick={() => void runControl(playback.status === 'playing' ? 'pause' : 'play')}
              >
                {playback.status === 'playing' ? <Pause size={26} /> : <Play size={26} />}
              </button>
              <button
                type="button"
                className="spotify-control-button"
                aria-label={t('music.nextTrack')}
                disabled={!canControl || !playback.availableActions.includes('skip_next')}
                onClick={() => void runControl('next')}
              >
                <SkipForward size={24} />
              </button>
              <button
                type="button"
                className={'spotify-control-button' + (nextTrack !== 'off' ? ' is-active' : '')}
                aria-label={t('music.spotifyRepeat') + ': ' + repeatLabel[nextTrack]}
                aria-pressed={nextTrack !== 'off'}
                disabled={!canControl}
                onClick={() => void runControl('repeat', nextRepeat[nextTrack])}
              >
                <Repeat size={21} />
                <span className="spotify-repeat-mode">{nextTrack === 'track' ? '1' : ''}</span>
              </button>
            </div>

            {loggedIn && !isActive && snapshot.connection === 'connected' && (
              <button
                type="button"
                className="spotify-activate-button"
                onClick={() => void runControl('activate')}
              >
                {t('music.spotifyActivate')}
              </button>
            )}

            <div className="spotify-volume">
              <button
                type="button"
                className="spotify-volume-mute"
                aria-label={volume > 0 ? t('music.mute') : t('music.unmute')}
                disabled={!canControl || playback.volume === null}
                onClick={() => void runControl('volume', volume > 0 ? 0 : previousVolume.current)}
              >
                {volume > 0 ? <Volume2 size={20} /> : <VolumeX size={20} />}
              </button>
              <label className="sr-only" htmlFor="spotify-volume">
                {t('music.volume')}
              </label>
              <input
                id="spotify-volume"
                type="range"
                min={0}
                max={100}
                step={1}
                value={volume}
                disabled={!canControl || playback.volume === null}
                onChange={(event) => setVolumeDraft(Number(event.target.value))}
              />
              <span>{Math.round(volume)}%</span>
            </div>
            {controlError && (
              <p className="spotify-control-error" role="alert">
                {controlError}
              </p>
            )}
          </div>
        </div>

        <aside className="spotify-queue" aria-label={t('music.spotifyQueue')}>
          <div className="spotify-queue-heading">
            <h3>{t('music.spotifyQueue')}</h3>
            <span>{snapshot.queue.upcoming.length}</span>
          </div>
          {upNext.length === 0 ? (
            <p className="spotify-queue-empty">{t('music.spotifyQueueEmpty')}</p>
          ) : (
            <ol>
              {upNext.map((track, index) => (
                <li key={track.uri || track.title || index}>
                  {track.artworkUrl ? (
                    <img src={track.artworkUrl} alt="" />
                  ) : (
                    <span className="spotify-queue-art">
                      <Music2 size={18} />
                    </span>
                  )}
                  <span className="spotify-queue-copy">
                    <strong>{track.title || t('music.spotifyNoTrack')}</strong>
                    <span>{track.artists.join(', ') || '—'}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </section>
  );
}
