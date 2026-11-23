import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSpotifyPlaylists } from './useSpotifyPlaylists';

const PLAYLIST_ID = '4q3zB8nVYk9m2H6wX1cR0P';
const OTHER_PLAYLIST_ID = '9c3zB8nVYk9m2H6wX1cR0P';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('useSpotifyPlaylists', () => {
  it('loads the authenticated library and restores the selected playlist', async () => {
    window.localStorage.setItem('abbai-flow.spotify.selected-playlist', PLAYLIST_ID);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          configured: true,
          credentialsConfigured: true,
          authorized: true,
          redirectConfigured: true,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          total: 1,
          offset: 0,
          items: [
            {
              id: PLAYLIST_ID,
              uri: `spotify:playlist:${PLAYLIST_ID}`,
              name: 'Kitchen mix',
              artworkUrl: null,
              spotifyUrl: null,
              ownerName: 'Abbai',
              trackCount: 1,
              isPublic: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          total: 1,
          offset: 0,
          items: [
            {
              uri: 'spotify:track:song123',
              title: 'Song',
              artists: ['Artist'],
              album: 'Album',
              artworkUrl: null,
              spotifyUrl: null,
              durationMs: 190000,
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetcher);

    const { result } = renderHook(() => useSpotifyPlaylists());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.status.authorized).toBe(true);
    expect(result.current.selectedPlaylist?.name).toBe('Kitchen mix');
    expect(result.current.tracks[0]?.title).toBe('Song');
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      '/abbai-flow/music/library/status',
      '/abbai-flow/music/library/playlists?offset=0',
      `/abbai-flow/music/library/playlists/${PLAYLIST_ID}/items?offset=0`,
    ]);
  });

  it('creates a playlist, adds a song, and refreshes the visible list', async () => {
    const playlist = {
      id: PLAYLIST_ID,
      uri: `spotify:playlist:${PLAYLIST_ID}`,
      name: 'Dinner music',
      artworkUrl: null,
      spotifyUrl: null,
      ownerName: 'Abbai',
      trackCount: 0,
      isPublic: false,
    };
    let playlistListRequests = 0;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === '/abbai-flow/music/library/status') {
        return jsonResponse({
          configured: true,
          credentialsConfigured: true,
          authorized: true,
          redirectConfigured: true,
        });
      }
      if (url === '/abbai-flow/music/library/playlists?offset=0') {
        playlistListRequests += 1;
        const items = playlistListRequests > 1 ? [playlist] : [];
        return jsonResponse({ items, total: items.length, offset: 0 });
      }
      if (url === '/abbai-flow/music/library/playlists' && init?.method === 'POST') {
        return jsonResponse({ playlist }, 201);
      }
      if (
        url === `/abbai-flow/music/library/playlists/${PLAYLIST_ID}/items` &&
        init?.method === 'POST'
      ) {
        return jsonResponse({ accepted: true }, 202);
      }
      if (url === `/abbai-flow/music/library/playlists/${PLAYLIST_ID}/items?offset=0`) {
        return jsonResponse({
          items: [
            {
              uri: 'spotify:track:song123',
              title: 'Song',
              artists: ['Artist'],
              album: 'Album',
              artworkUrl: null,
              spotifyUrl: null,
              durationMs: 180000,
            },
          ],
          total: 1,
          offset: 0,
        });
      }
      return jsonResponse({ error: 'unexpected request' }, 500);
    });
    vi.stubGlobal('fetch', fetcher);

    const { result } = renderHook(() => useSpotifyPlaylists());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.createPlaylist('Dinner music')).resolves.toEqual({ ok: true });
    });
    expect(result.current.selectedPlaylist?.name).toBe('Dinner music');

    await act(async () => {
      await expect(result.current.addTrack(PLAYLIST_ID, 'spotify:track:song123')).resolves.toEqual({
        ok: true,
      });
    });
    expect(result.current.playlists).toHaveLength(1);
    expect(result.current.tracks[0]?.title).toBe('Song');
    const createCall = fetcher.mock.calls.find(
      ([url, init]) =>
        String(url) === '/abbai-flow/music/library/playlists' && init?.method === 'POST',
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({ name: 'Dinner music' });
  });

  it('removes a playlist and selects the next remaining playlist', async () => {
    const playlists = [
      {
        id: PLAYLIST_ID,
        uri: `spotify:playlist:${PLAYLIST_ID}`,
        name: 'First mix',
        artworkUrl: null,
        spotifyUrl: null,
        ownerName: 'Abbai',
        trackCount: 1,
        isPublic: false,
      },
      {
        id: OTHER_PLAYLIST_ID,
        uri: `spotify:playlist:${OTHER_PLAYLIST_ID}`,
        name: 'Second mix',
        artworkUrl: null,
        spotifyUrl: null,
        ownerName: 'Abbai',
        trackCount: 1,
        isPublic: false,
      },
    ];
    window.localStorage.setItem('abbai-flow.spotify.selected-playlist', PLAYLIST_ID);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          configured: true,
          credentialsConfigured: true,
          authorized: true,
          redirectConfigured: true,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ items: playlists, total: 2, offset: 0 }))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              uri: 'spotify:track:first123',
              title: 'First song',
              artists: ['Artist'],
              album: 'Album',
              artworkUrl: null,
              spotifyUrl: null,
              durationMs: 180000,
            },
          ],
          total: 1,
          offset: 0,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ accepted: true }, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              uri: 'spotify:track:second123',
              title: 'Second song',
              artists: ['Another artist'],
              album: 'Another album',
              artworkUrl: null,
              spotifyUrl: null,
              durationMs: 190000,
            },
          ],
          total: 1,
          offset: 0,
        }),
      );
    vi.stubGlobal('fetch', fetcher);

    const { result } = renderHook(() => useSpotifyPlaylists());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selectedPlaylist?.name).toBe('First mix');

    await act(async () => {
      await expect(result.current.removePlaylist(PLAYLIST_ID)).resolves.toEqual({ ok: true });
    });

    expect(fetcher.mock.calls[3]?.[0]).toBe(`/abbai-flow/music/library/playlists/${PLAYLIST_ID}`);
    expect(fetcher.mock.calls[3]?.[1]?.method).toBe('DELETE');
    expect(result.current.playlists).toEqual([playlists[1]]);
    expect(result.current.playlistsTotal).toBe(1);
    expect(result.current.selectedPlaylistId).toBe(OTHER_PLAYLIST_ID);
    expect(result.current.selectedPlaylist?.name).toBe('Second mix');
    expect(result.current.tracks[0]?.title).toBe('Second song');
    expect(window.localStorage.getItem('abbai-flow.spotify.selected-playlist')).toBe(
      OTHER_PLAYLIST_ID,
    );
  });

  it('does not request playlists before the Spotify account is authorized', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          configured: true,
          credentialsConfigured: true,
          authorized: false,
          redirectConfigured: true,
        }),
      );
    vi.stubGlobal('fetch', fetcher);

    const { result } = renderHook(() => useSpotifyPlaylists());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.status.configured).toBe(true);
    expect(result.current.status.authorized).toBe(false);
    expect(result.current.playlists).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
