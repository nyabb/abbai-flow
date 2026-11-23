import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { waitFor } from '@testing-library/react';
import { I18nContext, createI18n } from '../../i18n';
import type { EncoreSnapshot } from '../../api/encore-music';
import type { BluetoothSnapshot } from '../../api/bluetooth-types';
import type { UseSpotifyPlaylistsResult } from '../../hooks/useSpotifyPlaylists';
import { SpotifyMusicPanel } from '../SpotifyMusicPanel';

const EN = createI18n('en-US');
const BLUETOOTH: BluetoothSnapshot = {
  configured: false,
  connection: 'disabled',
  adapter: null,
  scanning: false,
  devices: [],
  challenge: null,
  notice: null,
  error: null,
  updatedAt: 1,
};

function playlistLibrary(
  overrides: Partial<UseSpotifyPlaylistsResult> = {},
): UseSpotifyPlaylistsResult {
  return {
    status: {
      configured: false,
      credentialsConfigured: false,
      authorized: false,
      redirectConfigured: false,
    },
    playlists: [],
    playlistsTotal: 0,
    selectedPlaylist: null,
    selectedPlaylistId: null,
    tracks: [],
    tracksTotal: 0,
    loading: false,
    tracksLoading: false,
    working: false,
    error: null,
    connect: vi.fn(async () => ({ ok: true })),
    refresh: vi.fn(async () => undefined),
    fetchPlaylists: vi.fn(async () => undefined),
    selectPlaylist: vi.fn(),
    loadMoreTracks: vi.fn(),
    createPlaylist: vi.fn(async () => ({ ok: true })),
    addTrack: vi.fn(async () => ({ ok: true })),
    removePlaylist: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function snapshot(overrides: Partial<EncoreSnapshot> = {}): EncoreSnapshot {
  return {
    configured: true,
    connection: 'disconnected',
    auth: { loggedIn: null, isActive: null, deviceName: null },
    playback: {
      status: 'idle',
      item: null,
      context: null,
      position: null,
      volume: null,
      options: { shuffle: null, repeat: null },
      availableActions: [],
    },
    queue: { previous: [], upcoming: [] },
    error: null,
    updatedAt: 1,
    ...overrides,
  };
}

function renderPanel(
  state: EncoreSnapshot,
  loading = false,
  onSearch = vi.fn(async () => ({ tracks: [] })),
  library = playlistLibrary(),
) {
  return render(
    <I18nContext.Provider value={EN}>
      <SpotifyMusicPanel
        snapshot={state}
        loading={loading}
        onControl={vi.fn(async () => ({ ok: true }))}
        onSearch={onSearch}
        library={library}
        bluetooth={{
          snapshot: BLUETOOTH,
          loading: false,
          control: vi.fn(async () => ({ ok: true })),
        }}
      />
    </I18nContext.Provider>,
  );
}

describe('SpotifyMusicPanel connection states', () => {
  it('shows a connecting state while the initial server request is pending', () => {
    renderPanel(snapshot({ configured: false }), true);
    expect(document.querySelector('.spotify-status')).toHaveTextContent('Connecting...');
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });

  it('explains a disconnected Encore connection and disables playback controls', () => {
    renderPanel(snapshot({ connection: 'disconnected', error: 'Encore connection lost' }));
    expect(document.querySelector('.spotify-status')).toHaveTextContent('Abbai Flow unreachable');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Encore is unavailable. Abbai Flow will reconnect automatically.',
    );
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });

  it('asks only for the redirect URL when Spotify app credentials are already configured', () => {
    renderPanel(
      snapshot(),
      false,
      undefined,
      playlistLibrary({
        status: {
          configured: false,
          credentialsConfigured: true,
          authorized: false,
          redirectConfigured: false,
        },
      }),
    );
    expect(
      screen.getByText(/Spotify app credentials are configured\. Set SPOTIFY_REDIRECT_URI/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET/),
    ).not.toBeInTheDocument();
  });

  it('searches the catalog and plays a result through Encore', async () => {
    const onSearch = vi.fn(async () => ({
      tracks: [
        {
          uri: 'spotify:track:abc123',
          title: 'Sample Song',
          artists: ['Sample Artist'],
          album: 'Sample Album',
          artworkUrl: null,
          spotifyUrl: null,
          durationMs: 180000,
        },
      ],
    }));
    const onControl = vi.fn(async () => ({ ok: true }));
    const active = snapshot({
      connection: 'connected',
      auth: { loggedIn: true, isActive: true, deviceName: 'Abbai Party' },
    });
    render(
      <I18nContext.Provider value={EN}>
        <SpotifyMusicPanel
          snapshot={active}
          loading={false}
          onSearch={onSearch}
          onControl={onControl}
          library={playlistLibrary()}
          bluetooth={{
            snapshot: BLUETOOTH,
            loading: false,
            control: vi.fn(async () => ({ ok: true })),
          }}
        />
      </I18nContext.Provider>,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Spotify' }), {
      target: { value: 'Sample Song' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Sample Song')).toBeInTheDocument();
    expect(onSearch).toHaveBeenCalledWith('Sample Song');
    fireEvent.click(screen.getByRole('button', { name: 'Play track: Sample Song' }));
    await waitFor(() =>
      expect(onControl).toHaveBeenCalledWith('playTrack', 'spotify:track:abc123'),
    );
  });

  it('keeps search results visible but disables playback while disconnected', async () => {
    const onSearch = vi.fn(async () => ({
      tracks: [
        {
          uri: 'spotify:track:abc123',
          title: 'Sample Song',
          artists: ['Sample Artist'],
          album: 'Sample Album',
          artworkUrl: null,
          spotifyUrl: null,
          durationMs: null,
        },
      ],
    }));
    renderPanel(snapshot(), false, onSearch);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Spotify' }), {
      target: { value: 'Sample Song' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('button', { name: 'Play track: Sample Song' })).toBeDisabled();
  });

  it('keeps mobile volume compact and exposes the slider when expanded', () => {
    renderPanel(snapshot());
    const volumeButton = screen.getByRole('button', { name: 'Volume' });

    expect(volumeButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(volumeButton);
    expect(volumeButton).toHaveAttribute('aria-expanded', 'true');
    expect(volumeButton).toHaveAttribute('aria-controls', 'spotify-volume');
  });

  it('keeps the playlist list visible and lets a search result be added to a playlist', async () => {
    const playlist = {
      id: '4q3zB8nVYk9m2H6wX1cR0P',
      uri: 'spotify:playlist:4q3zB8nVYk9m2H6wX1cR0P',
      name: 'Summer mix',
      artworkUrl: null,
      spotifyUrl: 'https://open.spotify.com/playlist/4q3zB8nVYk9m2H6wX1cR0P',
      ownerName: 'Abbai',
      trackCount: 1,
      isPublic: false,
    };
    const addTrack = vi.fn(async () => ({ ok: true }));
    const library = playlistLibrary({
      status: {
        configured: true,
        credentialsConfigured: true,
        authorized: true,
        redirectConfigured: true,
      },
      playlists: [playlist],
      playlistsTotal: 1,
      selectedPlaylist: playlist,
      selectedPlaylistId: playlist.id,
      tracks: [],
      addTrack,
    });
    const onSearch = vi.fn(async () => ({
      tracks: [
        {
          uri: 'spotify:track:abc123',
          title: 'Sample Song',
          artists: ['Sample Artist'],
          album: 'Sample Album',
          artworkUrl: null,
          spotifyUrl: 'https://open.spotify.com/track/abc123',
          durationMs: 180000,
        },
      ],
    }));

    render(
      <I18nContext.Provider value={EN}>
        <SpotifyMusicPanel
          snapshot={snapshot()}
          loading={false}
          onControl={vi.fn(async () => ({ ok: true }))}
          onSearch={onSearch}
          library={library}
          bluetooth={{
            snapshot: BLUETOOTH,
            loading: false,
            control: vi.fn(async () => ({ ok: true })),
          }}
        />
      </I18nContext.Provider>,
    );

    expect(screen.getByRole('heading', { name: 'Your Library' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Summer mix' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Spotify' }), {
      target: { value: 'Sample Song' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('button', { name: 'Add to playlist: Sample Song' });
    fireEvent.click(screen.getByRole('button', { name: 'Add to playlist: Sample Song' }));
    const menu = screen.getByRole('group', { name: 'Add to playlist' });
    expect(menu).toBeVisible();
    expect(menu.parentElement?.tagName).toBe('LI');
    const librarySection = document.querySelector('.spotify-library');
    expect(librarySection).not.toBeNull();
    expect(
      menu.compareDocumentPosition(librarySection as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(within(menu).getByRole('button', { name: 'Summer mix' }));

    await waitFor(() => expect(addTrack).toHaveBeenCalledWith(playlist.id, 'spotify:track:abc123'));
  });

  it('confirms playlist removal and calls the library remove action', async () => {
    const playlist = {
      id: '4q3zB8nVYk9m2H6wX1cR0P',
      uri: 'spotify:playlist:4q3zB8nVYk9m2H6wX1cR0P',
      name: 'Summer mix',
      artworkUrl: null,
      spotifyUrl: null,
      ownerName: 'Abbai',
      trackCount: 1,
      isPublic: false,
    };
    const removePlaylist = vi.fn(async () => ({ ok: true }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const library = playlistLibrary({
      status: {
        configured: true,
        credentialsConfigured: true,
        authorized: true,
        redirectConfigured: true,
      },
      playlists: [playlist],
      playlistsTotal: 1,
      selectedPlaylist: playlist,
      selectedPlaylistId: playlist.id,
      removePlaylist,
    });

    renderPanel(snapshot(), false, undefined, library);
    fireEvent.click(screen.getByRole('button', { name: 'Remove playlist' }));

    await waitFor(() => expect(removePlaylist).toHaveBeenCalledWith(playlist.id));
    expect(confirm).toHaveBeenCalledOnce();
  });
});
