import { useSpotifyPlaylists } from '../hooks/useSpotifyPlaylists';
import { useSpotifyBrowserPlayer } from '../hooks/useSpotifyBrowserPlayer';
import { useSpotifyCatalog } from '../hooks/useSpotifyCatalog';
import { SpotifyMusicPanel } from './SpotifyMusicPanel';

export function MusicView() {
  const playlists = useSpotifyPlaylists();
  const catalog = useSpotifyCatalog();
  const browser = useSpotifyBrowserPlayer(
    playlists.status.authorized,
    playlists.status.playbackAuthorized === true,
  );

  return (
    <div className="music-page">
      <SpotifyMusicPanel
        snapshot={browser.snapshot}
        loading={browser.loading}
        onControl={browser.control}
        onSearch={catalog.search}
        onConnectPlayback={playlists.connect}
        library={playlists}
      />
    </div>
  );
}
