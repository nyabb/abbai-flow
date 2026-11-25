import { useEffect, useState, type FormEvent } from 'react';
import {
  ExternalLink,
  ListMusic,
  Music2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { SpotifyPlaylist, SpotifyPlaylistTrack } from '../api/spotify-playlists';
import type { UseSpotifyPlaylistsResult } from '../hooks/useSpotifyPlaylists';
import { useTranslation } from '../i18n';
import { LoadingPlaceholder } from './LoadingPlaceholder';

interface SpotifyPlaylistLibraryProps {
  library: UseSpotifyPlaylistsResult;
  onPlayTrack: (uri: string) => void;
}

function SpotifyArtwork({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className: string;
}) {
  return src ? (
    <img className={className} src={src} alt={alt} loading="lazy" />
  ) : (
    <span className={`${className} spotify-library-art-placeholder`} aria-hidden="true">
      <Music2 size={20} />
    </span>
  );
}

export function SpotifyPlaylistLibrary({ library, onPlayTrack }: SpotifyPlaylistLibraryProps) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get('spotify');
    if (result === 'connected') setNotice(t('music.spotifyPlaylistConnected'));
    if (result === 'failed') setActionError(t('music.spotifyPlaylistConnectFailed'));
    if (result) {
      url.searchParams.delete('spotify');
      window.history.replaceState(window.history.state, '', url.toString());
    }
  }, [t]);

  const connect = async () => {
    setConnecting(true);
    setActionError(null);
    const result = await library.connect();
    if (!result.ok) setActionError(result.error || t('music.spotifyPlaylistConnectFailed'));
    setConnecting(false);
  };

  const createPlaylist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = playlistName.trim();
    if (!name || creatingPlaylist) return;
    setCreatingPlaylist(true);
    setActionError(null);
    const result = await library.createPlaylist(name);
    if (result.ok) {
      setPlaylistName('');
      setCreating(false);
      setNotice(t('music.spotifyPlaylistCreated'));
    } else {
      setActionError(result.error || t('music.spotifyPlaylistCreateFailed'));
    }
    setCreatingPlaylist(false);
  };

  const removeSelectedPlaylist = async () => {
    const playlist = library.selectedPlaylist;
    if (!playlist || library.working) return;
    if (!window.confirm(t('music.spotifyRemovePlaylistConfirm', { name: playlist.name }))) return;

    setActionError(null);
    const result = await library.removePlaylist(playlist.id);
    if (result.ok) setNotice(t('music.spotifyPlaylistRemoved'));
    else setActionError(result.error || t('music.spotifyPlaylistRemoveFailed'));
  };

  const playlistButton = (playlist: SpotifyPlaylist) => (
    <button
      type="button"
      key={playlist.id}
      className={
        'spotify-playlist-item' + (library.selectedPlaylistId === playlist.id ? ' is-selected' : '')
      }
      aria-current={library.selectedPlaylistId === playlist.id ? 'true' : undefined}
      onClick={() => library.selectPlaylist(playlist.id)}
    >
      <SpotifyArtwork src={playlist.artworkUrl} alt="" className="spotify-playlist-art" />
      <span className="spotify-playlist-item-copy">
        <strong>{playlist.name}</strong>
        <span>{t('music.spotifyPlaylistTrackCount', { count: playlist.trackCount })}</span>
      </span>
    </button>
  );

  const trackRow = (track: SpotifyPlaylistTrack, index: number) => (
    <li key={`${track.uri}-${index}`} className="spotify-playlist-track">
      <span className="spotify-playlist-track-index">{index + 1}</span>
      <SpotifyArtwork src={track.artworkUrl} alt="" className="spotify-playlist-track-art" />
      <span className="spotify-playlist-track-copy">
        {track.spotifyUrl ? (
          <a href={track.spotifyUrl} target="_blank" rel="noreferrer">
            {track.title}
          </a>
        ) : (
          <strong>{track.title}</strong>
        )}
        <span>{track.artists.join(', ') || '—'}</span>
      </span>
      <span className="spotify-playlist-track-album">{track.album || '—'}</span>
      <span className="spotify-playlist-track-duration">
        {track.durationMs == null
          ? '—'
          : `${Math.floor(track.durationMs / 60000)}:${String(
              Math.floor(track.durationMs / 1000) % 60,
            ).padStart(2, '0')}`}
      </span>
      <button
        type="button"
        className="spotify-playlist-track-play"
        aria-label={`${t('music.spotifyPlayTrack')}: ${track.title}`}
        onClick={() => onPlayTrack(track.uri)}
      >
        {t('music.play')}
      </button>
    </li>
  );

  return (
    <section className="spotify-library" aria-label={t('music.spotifyYourLibrary')}>
      <aside className="spotify-library-sidebar">
        <div className="spotify-library-heading">
          <div>
            <h3>{t('music.spotifyYourLibrary')}</h3>
            <span>{t('music.spotifyPlaylists')}</span>
          </div>
          {library.status.authorized && (
            <button
              type="button"
              className="spotify-library-add"
              aria-label={t('music.spotifyCreatePlaylist')}
              title={t('music.spotifyCreatePlaylist')}
              onClick={() => {
                setCreating((value) => !value);
                setActionError(null);
              }}
            >
              <Plus size={21} />
            </button>
          )}
        </div>

        {library.loading ? (
          <LoadingPlaceholder
            label={t('app.connecting')}
            lines={4}
            className="loading-placeholder--compact spotify-library-loading"
          />
        ) : !library.status.configured ? (
          <div className="spotify-library-placeholder">
            <p>
              {library.status.credentialsConfigured
                ? t('music.spotifyPlaylistRedirectConfigure')
                : t('music.spotifyPlaylistConfigure')}
            </p>
          </div>
        ) : !library.status.authorized ? (
          <div className="spotify-library-connect">
            <p>{t('music.spotifyPlaylistConnectHelp')}</p>
            <button
              type="button"
              disabled={connecting}
              aria-busy={connecting}
              onClick={() => void connect()}
            >
              {connecting ? t('music.spotifyConnecting') : t('music.spotifyConnectAccount')}
            </button>
          </div>
        ) : (
          <>
            {creating && (
              <form
                className="spotify-create-playlist"
                onSubmit={(event) => void createPlaylist(event)}
              >
                <label htmlFor="spotify-playlist-name">{t('music.spotifyNewPlaylist')}</label>
                <input
                  id="spotify-playlist-name"
                  value={playlistName}
                  maxLength={100}
                  placeholder={t('music.spotifyPlaylistNamePlaceholder')}
                  onChange={(event) => setPlaylistName(event.target.value)}
                />
                <div>
                  <button type="button" onClick={() => setCreating(false)}>
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={!playlistName.trim() || creatingPlaylist}
                    aria-busy={creatingPlaylist}
                  >
                    {creatingPlaylist ? t('app.connecting') : t('common.create')}
                  </button>
                </div>
              </form>
            )}
            <nav className="spotify-playlist-list" aria-label={t('music.spotifyPlaylists')}>
              {library.playlists.map(playlistButton)}
              {library.playlists.length === 0 && !library.error && (
                <p className="spotify-library-placeholder">{t('music.spotifyNoPlaylists')}</p>
              )}
            </nav>
            {library.playlists.length < library.playlistsTotal && (
              <button
                className="spotify-library-load-more"
                type="button"
                onClick={() => void library.fetchPlaylists()}
              >
                {t('music.spotifyLoadMore')}
              </button>
            )}
          </>
        )}
      </aside>

      <div className="spotify-playlist-detail">
        {actionError && (
          <p className="spotify-library-alert" role="alert">
            {actionError}
          </p>
        )}
        {library.error && !actionError && (
          <p className="spotify-library-alert" role="alert">
            {library.error}
          </p>
        )}
        {notice && (
          <p className="spotify-library-notice" role="status">
            <Sparkles size={16} /> {notice}
          </p>
        )}

        {library.selectedPlaylist ? (
          <>
            <header className="spotify-playlist-detail-heading">
              <SpotifyArtwork
                src={library.selectedPlaylist.artworkUrl}
                alt=""
                className="spotify-playlist-detail-art"
              />
              <div>
                <p className="spotify-eyebrow">{t('music.spotifyPlaylist')}</p>
                <h3>{library.selectedPlaylist.name}</h3>
                <p>
                  {t('music.spotifyPlaylistTrackCount', {
                    count: library.selectedPlaylist.trackCount,
                  })}
                  {library.selectedPlaylist.ownerName
                    ? ` · ${library.selectedPlaylist.ownerName}`
                    : ''}
                  {library.selectedPlaylist.isPublic === false
                    ? ` · ${t('music.spotifyPlaylistPrivate')}`
                    : ''}
                </p>
              </div>
              {library.selectedPlaylist.spotifyUrl && (
                <a
                  className="spotify-open-playlist"
                  href={library.selectedPlaylist.spotifyUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t('music.spotifyOpenInSpotify')}
                  title={t('music.spotifyOpenInSpotify')}
                >
                  <ExternalLink size={18} />
                  <span>Spotify</span>
                </a>
              )}
              <button
                type="button"
                className="spotify-remove-playlist"
                aria-label={t('music.spotifyRemovePlaylist')}
                title={t('music.spotifyRemovePlaylist')}
                disabled={library.working}
                aria-busy={library.working}
                onClick={() => void removeSelectedPlaylist()}
              >
                <Trash2 size={18} />
                <span>{t('music.spotifyRemovePlaylist')}</span>
              </button>
            </header>
            <div className="spotify-playlist-track-heading" aria-hidden="true">
              <span>#</span>
              <span />
              <span>{t('music.spotifyTrackTitle')}</span>
              <span>{t('music.spotifyTrackAlbum')}</span>
              <span>{t('music.spotifyTrackDuration')}</span>
              <span />
            </div>
            {library.tracksLoading && library.tracks.length === 0 ? (
              <LoadingPlaceholder
                label={t('music.spotifyPlaylistLoading')}
                lines={6}
                className="loading-placeholder--compact spotify-library-track-loading"
              />
            ) : library.tracks.length === 0 ? (
              <p className="spotify-library-placeholder">{t('music.spotifyPlaylistEmpty')}</p>
            ) : (
              <ol className="spotify-playlist-track-list">{library.tracks.map(trackRow)}</ol>
            )}
            {library.tracks.length < library.tracksTotal && (
              <button
                className="spotify-library-load-more"
                type="button"
                disabled={library.tracksLoading}
                aria-busy={library.tracksLoading}
                onClick={library.loadMoreTracks}
              >
                {library.tracksLoading
                  ? t('music.spotifyPlaylistLoading')
                  : t('music.spotifyLoadMore')}
              </button>
            )}
          </>
        ) : (
          <div className="spotify-playlist-empty-state">
            <span>
              <ListMusic size={30} />
            </span>
            <h3>{t('music.spotifyNoPlaylistSelected')}</h3>
            <p>{t('music.spotifyPlaylistEmptyHelp')}</p>
          </div>
        )}
      </div>
    </section>
  );
}
