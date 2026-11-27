import { useState } from 'react';
import { useEncoreMusic } from '../hooks/useEncoreMusic';
import { useSpotifyPlaylists } from '../hooks/useSpotifyPlaylists';
import { useSpotifyBrowserPlayer } from '../hooks/useSpotifyBrowserPlayer';
import { SpotifyMusicPanel } from './SpotifyMusicPanel';

export function MusicView() {
  const encore = useEncoreMusic();
  const playlists = useSpotifyPlaylists();
  const browser = useSpotifyBrowserPlayer(
    playlists.status.authorized,
    playlists.status.playbackAuthorized === true,
  );
  const [output, setOutput] = useState<'encore' | 'browser'>('encore');

  const selectBrowser = async () => {
    if (!browser.ready) {
      browser.retry();
      return { ok: false, error: 'Browser player is reconnecting' };
    }
    const result = await browser.activate();
    if (result.ok) setOutput('browser');
    return result;
  };

  const selectEncore = async () => {
    const result = await encore.control('activate');
    setOutput('encore');
    return result;
  };

  return (
    <div className="music-page">
      <SpotifyMusicPanel
        snapshot={output === 'browser' ? browser.snapshot : encore.snapshot}
        loading={output === 'browser' ? browser.loading : encore.loading}
        output={output}
        browserLoading={browser.loading || browser.snapshot.connection === 'connecting'}
        browserError={browser.snapshot.error}
        onSelectBrowser={selectBrowser}
        onSelectEncore={selectEncore}
        onControl={output === 'browser' ? browser.control : encore.control}
        onSearch={encore.search}
        library={playlists}
      />
    </div>
  );
}
