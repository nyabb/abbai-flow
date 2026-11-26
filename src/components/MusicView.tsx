import { useEncoreMusic } from '../hooks/useEncoreMusic';
import { useBluetoothDevices } from '../hooks/useBluetoothDevices';
import { useSpotifyPlaylists } from '../hooks/useSpotifyPlaylists';
import { SpotifyMusicPanel } from './SpotifyMusicPanel';

export function MusicView() {
  const encore = useEncoreMusic();
  const bluetooth = useBluetoothDevices();
  const playlists = useSpotifyPlaylists();

  return (
    <div className="music-page">
      <SpotifyMusicPanel
        snapshot={encore.snapshot}
        loading={encore.loading}
        onControl={encore.control}
        onSearch={encore.search}
        library={playlists}
        bluetooth={bluetooth}
      />
    </div>
  );
}
