import { describe, expect, it, vi } from 'vitest';
import {
  SpotifyPlaylistError,
  SpotifyPlaylistLibrary,
  type SpotifyPlaylistTokenStore,
} from './spotify-playlists';

const PLAYLIST_ID = '4q3zB8nVYk9m2H6wX1cR0P';
const OTHER_PLAYLIST_ID = '9c3zB8nVYk9m2H6wX1cR0P';
const USER_TOKEN = 'private-user-access-token';
const REFRESH_TOKEN = 'private-user-refresh-token';
const REDIRECT_URI = 'https://abbai.example/abbai-flow/music/oauth/callback';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tokenStore(initial: unknown = null) {
  let saved = initial;
  const store: SpotifyPlaylistTokenStore = {
    load: vi.fn(async () => saved),
    save: vi.fn(async (token) => {
      saved = token;
    }),
    clear: vi.fn(async () => {
      saved = null;
    }),
  };
  return { store, read: () => saved };
}

function storedToken(expiresAt = Date.now() + 3_600_000) {
  return { accessToken: USER_TOKEN, refreshToken: REFRESH_TOKEN, expiresAt };
}

function library(
  fetcher: typeof fetch,
  store = tokenStore(storedToken()),
  overrides: Partial<ConstructorParameters<typeof SpotifyPlaylistLibrary>[0]> = {},
) {
  return new SpotifyPlaylistLibrary({
    clientId: 'spotify-client-id',
    clientSecret: 'spotify-client-secret',
    redirectUri: REDIRECT_URI,
    market: 'NL',
    tokenStore: store.store,
    createState: () => 'state-nonce',
    fetcher,
    ...overrides,
  });
}

describe('Spotify playlist library', () => {
  it('builds a server-side account authorization URL with playlist scopes and CSRF state', async () => {
    const service = library(vi.fn<typeof fetch>(), tokenStore(null));
    const authorizationUrl = new URL(await service.beginAuthorization());

    expect(authorizationUrl.origin).toBe('https://accounts.spotify.com');
    expect(authorizationUrl.pathname).toBe('/authorize');
    expect(authorizationUrl.searchParams.get('client_id')).toBe('spotify-client-id');
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(authorizationUrl.searchParams.get('scope')).toContain('playlist-modify-private');
    expect(authorizationUrl.searchParams.get('scope')).toContain('playlist-read-private');
    expect(authorizationUrl.searchParams.get('state')).toBe('state-nonce');
  });

  it('reports available app credentials separately from an invalid redirect URI', async () => {
    const missing = library(vi.fn<typeof fetch>(), tokenStore(null), {
      redirectUri: 'http://abbai.example/callback',
    });
    await expect(missing.beginAuthorization()).rejects.toMatchObject({
      code: 'not_configured',
      status: 503,
    });
    await expect(missing.status()).resolves.toEqual({
      configured: false,
      credentialsConfigured: true,
      authorized: false,
      redirectConfigured: false,
    });
  });

  it('validates state, exchanges the code server-side, and stores refresh credentials privately', async () => {
    const storage = tokenStore(null);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        access_token: USER_TOKEN,
        refresh_token: REFRESH_TOKEN,
        expires_in: 3600,
      }),
    );
    const service = library(fetcher, storage);
    await service.beginAuthorization();

    await expect(
      service.completeAuthorization('auth-code', 'incorrect-state'),
    ).rejects.toMatchObject({
      code: 'authorization_failed',
    });
    await expect(
      service.completeAuthorization('auth-code', 'state-nonce'),
    ).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://accounts.spotify.com/api/token');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa('spotify-client-id:spotify-client-secret'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    expect(storage.store.save).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: USER_TOKEN, refreshToken: REFRESH_TOKEN }),
    );
    expect(JSON.stringify(storage.read())).not.toContain('spotify-client-secret');
    await expect(service.status()).resolves.toMatchObject({ configured: true, authorized: true });
  });

  it('lists safe playlist metadata with the server-held user access token', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        total: 1,
        items: [
          {
            id: PLAYLIST_ID,
            name: 'Family favourites',
            public: false,
            images: [{ url: 'https://i.scdn.co/image/playlist.jpg' }],
            external_urls: { spotify: 'https://open.spotify.com/playlist/' + PLAYLIST_ID },
            owner: { display_name: 'Abbai' },
            items: { total: 3 },
          },
        ],
      }),
    );

    await expect(library(fetcher).listPlaylists()).resolves.toEqual({
      items: [
        {
          id: PLAYLIST_ID,
          uri: `spotify:playlist:${PLAYLIST_ID}`,
          name: 'Family favourites',
          artworkUrl: 'https://i.scdn.co/image/playlist.jpg',
          spotifyUrl: `https://open.spotify.com/playlist/${PLAYLIST_ID}`,
          ownerName: 'Abbai',
          trackCount: 3,
          isPublic: false,
        },
      ],
      total: 1,
      offset: 0,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.spotify.com/v1/me/playlists?limit=50&offset=0',
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ${USER_TOKEN}`,
    });
    expect(JSON.stringify(fetcher.mock.calls[0])).not.toContain(REFRESH_TOKEN);
  });

  it('loads playlist tracks, creates private playlists, and adds songs', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          total: 1,
          items: [
            {
              item: {
                type: 'track',
                uri: 'spotify:track:track123',
                name: 'A song',
                artists: [{ name: 'An artist' }],
                album: { name: 'An album', images: [{ url: 'https://i.scdn.co/image/cover.jpg' }] },
                duration_ms: 180000,
                external_urls: { spotify: 'https://open.spotify.com/track/track123' },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            id: OTHER_PLAYLIST_ID,
            name: 'New private list',
            public: false,
            items: { total: 0 },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ snapshot_id: 'new-snapshot' }, 201));
    const service = library(fetcher);

    await expect(service.getPlaylistItems(PLAYLIST_ID, 50)).resolves.toMatchObject({
      total: 1,
      offset: 50,
      items: [
        {
          title: 'A song',
          artists: ['An artist'],
          album: 'An album',
          spotifyUrl: 'https://open.spotify.com/track/track123',
        },
      ],
    });
    await expect(service.createPlaylist(' New private list ')).resolves.toMatchObject({
      name: 'New private list',
      isPublic: false,
    });
    await service.addTrack(PLAYLIST_ID, 'spotify:track:track123');

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `https://api.spotify.com/v1/playlists/${PLAYLIST_ID}/items?limit=50&offset=50&market=NL`,
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://api.spotify.com/v1/me/playlists');
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      name: 'New private list',
      public: false,
    });
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      `https://api.spotify.com/v1/playlists/${PLAYLIST_ID}/items`,
    );
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({
      uris: ['spotify:track:track123'],
    });
  });

  it('refreshes user tokens and persists rotated refresh credentials without exposing them', async () => {
    const storage = tokenStore(storedToken(0));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'fresh-access-token',
          refresh_token: 'rotated-refresh-token',
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ total: 0, items: [] }));
    const service = library(fetcher, storage);
    const result = await service.listPlaylists();
    expect(result).toMatchObject({ items: [], total: 0 });

    expect(fetcher.mock.calls[0]?.[0]).toBe('https://accounts.spotify.com/api/token');
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer fresh-access-token',
    });
    expect(storage.store.save).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'rotated-refresh-token' }),
    );
    expect(JSON.stringify(result)).not.toContain('fresh-access-token');
  });

  it('validates playlist IDs, offsets, names, and track URIs before sending requests', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const service = library(fetcher);
    await expect(service.listPlaylists(-1)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.getPlaylistItems('../private')).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(service.createPlaylist('  ')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      service.addTrack(PLAYLIST_ID, 'https://open.spotify.com/track/track123'),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('clears an expired/revoked refresh token and asks the user to reconnect', async () => {
    const storage = tokenStore(storedToken(0));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400));
    const service = library(fetcher, storage);

    await expect(service.listPlaylists()).rejects.toBeInstanceOf(SpotifyPlaylistError);
    await expect(service.listPlaylists()).rejects.toMatchObject({
      code: 'not_authorized',
      status: 401,
      message: 'Connect a Spotify account to manage playlists',
    });
    expect(storage.store.clear).toHaveBeenCalledOnce();
    expect(storage.read()).toBeNull();
  });
});
