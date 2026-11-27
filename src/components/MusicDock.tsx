import { useEffect, useRef, useState } from 'react';
import {
  ChevronUp,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
} from 'lucide-react';
import type { MusicSnapshot } from '../api/music-player';
import { useTranslation } from '../i18n';
import { CollapsibleRegion } from './CollapsibleRegion';

interface MusicDockProps {
  snapshot: MusicSnapshot;
  onControl: (action: string, value?: unknown) => Promise<{ ok: boolean; error?: string }>;
  onOpen: () => void;
}

function formatTime(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function currentPosition(snapshot: MusicSnapshot): number {
  const anchor = snapshot.playback.position;
  if (!anchor) return 0;
  const elapsed =
    snapshot.playback.status === 'playing' && anchor.timestampMs
      ? Date.now() - anchor.timestampMs
      : 0;
  return Math.max(0, Math.min(anchor.positionMs + elapsed * anchor.speed, snapshot.playback.item?.durationMs ?? 0));
}

/** App-level controls keep Spotify playback accessible while the Music page is unmounted. */
export function MusicDock({ snapshot, onControl, onOpen }: MusicDockProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(() => currentPosition(snapshot));
  const [volume, setVolume] = useState(snapshot.playback.volume ?? 50);
  const [controlError, setControlError] = useState<string | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const track = snapshot.playback.item;
  const duration = track?.durationMs ?? 0;
  const playing = snapshot.playback.status === 'playing';
  const ready = snapshot.connection === 'connected' && snapshot.auth.loggedIn === true;

  useEffect(() => {
    const update = () => setPosition(currentPosition(snapshot));
    update();
    if (!playing) return;
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [playing, snapshot]);

  useEffect(() => {
    if (snapshot.playback.volume !== null) setVolume(snapshot.playback.volume);
  }, [snapshot.playback.volume]);

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

  if (!track) return null;

  const runControl = async (action: string, value?: unknown) => {
    setControlError(null);
    const result = await onControl(action, value);
    if (!result.ok) setControlError(result.error || 'Spotify playback failed');
  };

  const available = new Set(snapshot.playback.availableActions);
  const togglePlayback = () => void runControl(playing ? 'pause' : 'play');

  return (
    <div className={`music-dock${open ? ' is-open' : ''}`} ref={dockRef}>
      <div className="music-dock-summary">
        <button
          type="button"
          className="music-dock-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="music-dock-panel"
          aria-label={`${t('music.nowPlaying')}: ${track.title || t('music.spotifyNoTrack')}`}
          title={t('music.openMusicView')}
        >
          {track.artworkUrl ? (
            <img className="music-dock-artwork" src={track.artworkUrl} alt="" />
          ) : (
            <Music2 size={16} aria-hidden="true" />
          )}
          <span className="music-dock-track-title">{track.title || t('music.spotifyNoTrack')}</span>
          <ChevronUp size={14} className="music-dock-chevron" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="music-dock-action music-dock-summary-play"
          onClick={togglePlayback}
          disabled={!ready}
          aria-label={playing ? t('music.pause') : t('music.play')}
          title={playing ? t('music.pause') : t('music.play')}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
      </div>

      <CollapsibleRegion
        open={open}
        className="music-dock-panel"
        id="music-dock-panel"
        role="region"
        ariaLabel={t('music.nowPlaying')}
      >
        <div className="music-dock-track">
          {track.artworkUrl ? (
            <img src={track.artworkUrl} alt="" />
          ) : (
            <span className="music-dock-artwork-placeholder"><Music2 size={22} /></span>
          )}
          <span className="music-dock-track-copy">
            <strong>{track.title || t('music.spotifyNoTrack')}</strong>
            <span>{track.artists.join(', ')}</span>
          </span>
        </div>

        <div className="music-dock-progress">
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            value={Math.min(position, duration)}
            aria-label={t('music.spotifySeek')}
            disabled={!ready || !available.has('seek') || duration <= 0}
            onChange={(event) => setPosition(Number(event.currentTarget.value))}
            onPointerUp={(event) => void runControl('seek', Number(event.currentTarget.value))}
            onKeyUp={(event) => void runControl('seek', Number(event.currentTarget.value))}
          />
          <span>{formatTime(position)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        <label className="music-dock-volume">
          <Volume2 size={15} aria-hidden="true" />
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            aria-label={t('music.volume')}
            disabled={!ready}
            onChange={(event) => setVolume(Number(event.currentTarget.value))}
            onPointerUp={(event) => void runControl('volume', Number(event.currentTarget.value))}
            onKeyUp={(event) => void runControl('volume', Number(event.currentTarget.value))}
          />
          <span>{volume}%</span>
        </label>

        <div className="music-dock-controls">
          <button
            type="button"
            className="music-dock-action"
            onClick={() => void runControl('previous')}
            disabled={!ready || !available.has('skip_prev')}
            aria-label={t('music.previousTrack')}
            title={t('music.previousTrack')}
          >
            <SkipBack size={18} />
          </button>
          <button
            type="button"
            className="music-dock-action music-dock-action--primary"
            onClick={togglePlayback}
            disabled={!ready}
            aria-label={playing ? t('music.pause') : t('music.play')}
            title={playing ? t('music.pause') : t('music.play')}
          >
            {playing ? <Pause size={19} /> : <Play size={19} />}
          </button>
          <button
            type="button"
            className="music-dock-action"
            onClick={() => void runControl('next')}
            disabled={!ready || !available.has('skip_next')}
            aria-label={t('music.nextTrack')}
            title={t('music.nextTrack')}
          >
            <SkipForward size={18} />
          </button>
        </div>

        {(controlError || snapshot.error) && (
          <div className="music-dock-error" role="status">{controlError || snapshot.error}</div>
        )}
        <button type="button" className="timer-dock-open" onClick={onOpen}>
          {t('music.openMusicView')}
        </button>
      </CollapsibleRegion>
    </div>
  );
}
