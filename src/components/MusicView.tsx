import type { UseSpotifyPlaylistsResult } from '../hooks/useSpotifyPlaylists';
import type { MusicSnapshot } from '../api/music-player';
import type { SpotifyCatalogTrack } from '../api/spotify-catalog';
import { SpotifyMusicPanel } from './SpotifyMusicPanel';

interface MusicViewProps {
  playlists: UseSpotifyPlaylistsResult;
  snapshot: MusicSnapshot;
  loading: boolean;
  onControl: (action: string, value?: unknown) => Promise<{ ok: boolean; error?: string }>;
  onSearch: (query: string) => Promise<{
    tracks: SpotifyCatalogTrack[];
    code?: string;
    error?: string;
  }>;
  onConnectPlayback: () => Promise<{ ok: boolean; error?: string }>;
}

export function MusicView({
  playlists,
  snapshot,
  loading,
  onControl,
  onSearch,
  onConnectPlayback,
}: MusicViewProps) {
  return (
    <div className="music-page">
      <SpotifyMusicPanel
        snapshot={snapshot}
        loading={loading}
        onControl={onControl}
        onSearch={onSearch}
        onConnectPlayback={onConnectPlayback}
        library={playlists}
      />
    </div>
  );
}
