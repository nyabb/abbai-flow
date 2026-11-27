import { describe, expect, it, vi } from 'vitest';
import { SpotifyCatalog, SpotifyCatalogError } from './spotify-catalog';
import { SpotifyPlaylistError, type SpotifyPlaylistLibrary } from './spotify-playlists';
import {
  handleMusicRequest,
  type MusicHttpHelpers,
  type MusicHttpRequest,
  type MusicHttpResponse,
} from './music-http';

class FakeResponse implements MusicHttpResponse {
  status = 0;
  headers: Record<string, string> = {};
  readonly chunks: string[] = [];

  writeHead(status: number, headers: Record<string, string> = {}): this {
    this.status = status;
    this.headers = headers;
    return this;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

}

function request(url: string, method = 'GET'): MusicHttpRequest {
  return { url, method };
}

function helpers(
  body: Record<string, unknown> = {},
  parseError?: { status: number; message: string },
): MusicHttpHelpers & {
  response: FakeResponse;
} {
  const response = new FakeResponse();
  return {
    response,
    sendJson: (target, status, payload, headers = {}) => {
      const fake = target as FakeResponse;
      fake.writeHead(status, headers);
      fake.write(JSON.stringify(payload));
    },
    readJsonObject: vi.fn(async () => (parseError ? { error: parseError } : { value: body })),
  };
}

function payload(response: FakeResponse): unknown {
  return JSON.parse(response.chunks.join(''));
}

describe('Spotify music HTTP routes', () => {
  it('serves validated Spotify catalog search results', async () => {
    const tracks = [
      {
        uri: 'spotify:track:abc123',
        title: 'Sample Song',
        artists: ['Sample Artist'],
        album: 'Sample Album',
        artworkUrl: null,
        spotifyUrl: null,
        durationMs: 180000,
      },
    ];
    const catalog = { search: vi.fn(async () => tracks) } as unknown as SpotifyCatalog;
    const bridge = helpers();

    await handleMusicRequest(
      request('/abbai-flow/music/search?q=sample%20song'),
      bridge.response,
      bridge,
      catalog,
    );

    expect(catalog.search).toHaveBeenCalledWith('sample song');
    expect(bridge.response.status).toBe(200);
    expect(JSON.parse(bridge.response.chunks.join(''))).toEqual({ tracks });
  });

  it('rejects malformed Spotify search requests before querying Spotify', async () => {
    const catalog = { search: vi.fn() } as unknown as SpotifyCatalog;
    const bridge = helpers();

    await handleMusicRequest(
      request('/abbai-flow/music/search?q=song&q=other'),
      bridge.response,
      bridge,
      catalog,
    );

    expect(bridge.response.status).toBe(400);
    expect(catalog.search).not.toHaveBeenCalled();
  });

  it('handles unsupported search methods and catalog failures safely', async () => {
    const catalog = { search: vi.fn() } as unknown as SpotifyCatalog;
    const wrongMethod = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/search?q=song', 'POST'),
      wrongMethod.response,
      wrongMethod,
      catalog,
    );
    expect(wrongMethod.response.status).toBe(405);
    expect(wrongMethod.response.headers.Allow).toBe('GET');

    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const catalogFailure = new SpotifyCatalogError('unavailable', 502, 'Catalog unavailable');
    (catalog.search as ReturnType<typeof vi.fn>).mockRejectedValueOnce(catalogFailure);
    const failed = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/search?q=song'),
      failed.response,
      failed,
      catalog,
    );
    expect(failed.response.status).toBe(502);
    expect(payload(failed.response)).toMatchObject({ code: 'unavailable' });
    expect(warning).toHaveBeenCalledOnce();

    (catalog.search as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new SpotifyCatalogError('invalid_query', 400, 'Invalid query'),
    );
    const invalidQuery = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/search?q=song'),
      invalidQuery.response,
      invalidQuery,
      catalog,
    );
    expect(warning).toHaveBeenCalledOnce();

    (catalog.search as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('private detail'));
    const unexpected = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/search?q=song'),
      unexpected.response,
      unexpected,
      catalog,
    );
    expect(unexpected.response.status).toBe(502);
    expect(payload(unexpected.response)).toEqual({
      code: 'unavailable',
      error: 'Spotify search is temporarily unavailable',
    });
    warning.mockRestore();
  });

  it('serves safe Spotify playlist status', async () => {
    const playlistService = {
      status: vi.fn(async () => ({
        configured: true,
        credentialsConfigured: true,
        authorized: true,
        redirectConfigured: true,
        playbackAuthorized: true,
      })),
    } as unknown as SpotifyPlaylistLibrary;
    const bridge = helpers();

    await handleMusicRequest(
      request('/abbai-flow/music/library/status'),
      bridge.response,
      bridge,
      new SpotifyCatalog(),
      playlistService,
    );

    expect(bridge.response.status).toBe(200);
    expect(JSON.parse(bridge.response.chunks.join(''))).toMatchObject({
      configured: true,
      authorized: true,
      playbackAuthorized: true,
    });
  });

  it('handles playlist status method, missing service, and service failure', async () => {
    const wrongMethod = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/status', 'POST'),
      wrongMethod.response,
      wrongMethod,
    );
    expect(wrongMethod.response.status).toBe(405);

    const missingService = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/status'),
      missingService.response,
      missingService,
    );
    expect(missingService.response.status).toBe(503);

    const failingService = { status: vi.fn(async () => { throw new Error('private detail'); }) };
    const failed = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/status'),
      failed.response,
      failed,
      new SpotifyCatalog(),
      failingService as unknown as SpotifyPlaylistLibrary,
    );
    expect(failed.response.status).toBe(503);
    expect(payload(failed.response)).toEqual({ error: 'Spotify playlist status is unavailable' });
  });

  it('starts Spotify authorization and reports safe connection errors', async () => {
    const wrongMethod = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/connect', 'GET'),
      wrongMethod.response,
      wrongMethod,
    );
    expect(wrongMethod.response.status).toBe(405);

    const missingService = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/connect', 'POST'),
      missingService.response,
      missingService,
    );
    expect(missingService.response.status).toBe(503);

    const successService = {
      beginAuthorization: vi.fn(async () => 'https://accounts.spotify.com/authorize?state=test'),
    };
    const success = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/connect', 'POST'),
      success.response,
      success,
      new SpotifyCatalog(),
      successService as unknown as SpotifyPlaylistLibrary,
    );
    expect(success.response.status).toBe(200);
    expect(payload(success.response)).toEqual({
      authorizationUrl: 'https://accounts.spotify.com/authorize?state=test',
    });

    const failureService = {
      beginAuthorization: vi.fn(async () => {
        throw new SpotifyPlaylistError('not_configured', 503, 'Configure Spotify first');
      }),
    };
    const failure = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/connect', 'POST'),
      failure.response,
      failure,
      new SpotifyCatalog(),
      failureService as unknown as SpotifyPlaylistLibrary,
    );
    expect(failure.response.status).toBe(503);
    expect(payload(failure.response)).toMatchObject({ code: 'not_configured' });
  });

  it('provides a no-store playback token and handles missing or failed authorization', async () => {
    const wrongMethod = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playback-token', 'POST'),
      wrongMethod.response,
      wrongMethod,
    );
    expect(wrongMethod.response.status).toBe(405);

    const missingService = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playback-token'),
      missingService.response,
      missingService,
    );
    expect(missingService.response.status).toBe(503);

    const tokenService = { getPlaybackAccessToken: vi.fn(async () => 'private-access-token') };
    const success = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playback-token'),
      success.response,
      success,
      new SpotifyCatalog(),
      tokenService as unknown as SpotifyPlaylistLibrary,
    );
    expect(success.response.status).toBe(200);
    expect(success.response.headers['Cache-Control']).toBe('no-store');
    expect(payload(success.response)).toEqual({ accessToken: 'private-access-token' });

    const failureService = {
      getPlaybackAccessToken: vi.fn(async () => {
        throw new Error('private detail');
      }),
    };
    const failure = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playback-token'),
      failure.response,
      failure,
      new SpotifyCatalog(),
      failureService as unknown as SpotifyPlaylistLibrary,
    );
    expect(failure.response.status).toBe(502);
    expect(payload(failure.response)).toMatchObject({
      code: 'unavailable',
      error: 'Spotify playlist service is temporarily unavailable',
    });
  });

  it('includes Spotify upstream status in playback failures', async () => {
    const playlistService = {
      controlPlayback: vi.fn(async () => {
        throw new SpotifyPlaylistError(
          'unavailable',
          502,
          'Spotify could not find the browser player. Refresh the Music page and try again.',
          404,
        );
      }),
    } as unknown as SpotifyPlaylistLibrary;
    const bridge = helpers({ action: 'playTrack', deviceId: 'browser-device-id', value: 'spotify:track:abc123' });

    await handleMusicRequest(
      request('/abbai-flow/music/library/playback-control', 'POST'),
      bridge.response,
      bridge,
      new SpotifyCatalog(),
      playlistService,
    );

    expect(bridge.response.status).toBe(502);
    expect(JSON.parse(bridge.response.chunks.join(''))).toMatchObject({
      code: 'unavailable',
      upstreamStatus: 404,
    });
  });

  it('validates playback control methods and request bodies before calling Spotify', async () => {
    const wrongMethod = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playback-control', 'GET'),
      wrongMethod.response,
      wrongMethod,
    );
    expect(wrongMethod.response.status).toBe(405);

    const missingService = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playback-control', 'POST'),
      missingService.response,
      missingService,
    );
    expect(missingService.response.status).toBe(503);

    const readFailure = helpers({}, { status: 413, message: 'Request too large' });
    await handleMusicRequest(
      request('/abbai-flow/music/library/playback-control', 'POST'),
      readFailure.response,
      readFailure,
      new SpotifyCatalog(),
      {} as SpotifyPlaylistLibrary,
    );
    expect(readFailure.response.status).toBe(413);

    for (const body of [
      null,
      { action: 1, deviceId: 'browser-device-id' },
      { action: 'play', deviceId: 1 },
      { action: 'play', deviceId: 'browser-device-id', extra: true },
    ]) {
      const invalid = helpers(body as Record<string, unknown>);
      await handleMusicRequest(
        request('/abbai-flow/music/library/playback-control', 'POST'),
        invalid.response,
        invalid,
        new SpotifyCatalog(),
        {} as SpotifyPlaylistLibrary,
      );
      expect(invalid.response.status).toBe(400);
    }

    const controlPlayback = vi.fn(async () => undefined);
    const service = { controlPlayback } as unknown as SpotifyPlaylistLibrary;
    const valid = helpers({ action: 'play', deviceId: 'browser-device-id' });
    await handleMusicRequest(
      request('/abbai-flow/music/library/playback-control', 'POST'),
      valid.response,
      valid,
      new SpotifyCatalog(),
      service,
    );
    expect(controlPlayback).toHaveBeenCalledWith('browser-device-id', 'play', undefined);
    expect(valid.response.status).toBe(202);
  });

  it('lists playlists, validates query strings, and safely handles service failures', async () => {
    const missingService = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists'),
      missingService.response,
      missingService,
    );
    expect(missingService.response.status).toBe(503);

    const malformedService = { listPlaylists: vi.fn() };
    for (const url of [
      '/abbai-flow/music/library/playlists?offset=0&secret=bad',
      '/abbai-flow/music/library/playlists?offset=0&offset=1',
    ]) {
      const malformed = helpers();
      await handleMusicRequest(
        request(url),
        malformed.response,
        malformed,
        new SpotifyCatalog(),
        malformedService as unknown as SpotifyPlaylistLibrary,
      );
      expect(malformed.response.status).toBe(400);
    }
    expect(malformedService.listPlaylists).not.toHaveBeenCalled();

    const listPlaylists = vi.fn(async () => ({ items: [], total: 0, offset: 0 }));
    const service = { listPlaylists } as unknown as SpotifyPlaylistLibrary;
    const listed = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists?offset=12'),
      listed.response,
      listed,
      new SpotifyCatalog(),
      service,
    );
    expect(listPlaylists).toHaveBeenCalledWith('12');
    expect(listed.response.status).toBe(200);

    const serviceError = vi.fn(async () => {
      throw new Error('private detail');
    });
    const failed = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists'),
      failed.response,
      failed,
      new SpotifyCatalog(),
      { listPlaylists: serviceError } as unknown as SpotifyPlaylistLibrary,
    );
    expect(failed.response.status).toBe(502);

    const wrongMethod = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists', 'DELETE'),
      wrongMethod.response,
      wrongMethod,
      new SpotifyCatalog(),
      service,
    );
    expect(wrongMethod.response.status).toBe(405);
    expect(wrongMethod.response.headers.Allow).toBe('GET, POST');
  });

  it('creates playlists after validating requests and reports service errors', async () => {
    const missingService = helpers({ name: 'Family mix' });
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists', 'POST'),
      missingService.response,
      missingService,
    );
    expect(missingService.response.status).toBe(503);

    const parseFailure = helpers({}, { status: 400, message: 'Malformed JSON' });
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists', 'POST'),
      parseFailure.response,
      parseFailure,
      new SpotifyCatalog(),
      {} as SpotifyPlaylistLibrary,
    );
    expect(parseFailure.response.status).toBe(400);

    const invalid = helpers({ name: 'Family mix', extra: true });
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists', 'POST'),
      invalid.response,
      invalid,
      new SpotifyCatalog(),
      {} as SpotifyPlaylistLibrary,
    );
    expect(invalid.response.status).toBe(400);

    const createPlaylist = vi.fn(async (name: unknown) => ({ id: 'playlist-id', name }));
    const service = { createPlaylist } as unknown as SpotifyPlaylistLibrary;
    const created = helpers({ name: 'Family mix' });
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists', 'POST'),
      created.response,
      created,
      new SpotifyCatalog(),
      service,
    );
    expect(createPlaylist).toHaveBeenCalledWith('Family mix');
    expect(created.response.status).toBe(201);

    const failed = helpers({ name: 'Family mix' });
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists', 'POST'),
      failed.response,
      failed,
      new SpotifyCatalog(),
      { createPlaylist: vi.fn(async () => { throw new Error('private detail'); }) } as unknown as SpotifyPlaylistLibrary,
    );
    expect(failed.response.status).toBe(502);
  });

  it('removes playlists and rejects unsupported methods', async () => {
    const missingService = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists/playlist-id', 'DELETE'),
      missingService.response,
      missingService,
    );
    expect(missingService.response.status).toBe(503);

    const removePlaylist = vi.fn(async () => undefined);
    const service = { removePlaylist } as unknown as SpotifyPlaylistLibrary;
    const removed = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists/playlist-id', 'DELETE'),
      removed.response,
      removed,
      new SpotifyCatalog(),
      service,
    );
    expect(removePlaylist).toHaveBeenCalledWith('playlist-id');
    expect(removed.response.status).toBe(202);

    const failed = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists/playlist-id', 'DELETE'),
      failed.response,
      failed,
      new SpotifyCatalog(),
      { removePlaylist: vi.fn(async () => { throw new Error('private detail'); }) } as unknown as SpotifyPlaylistLibrary,
    );
    expect(failed.response.status).toBe(502);

    const wrongMethod = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists/playlist-id', 'POST'),
      wrongMethod.response,
      wrongMethod,
      new SpotifyCatalog(),
      service,
    );
    expect(wrongMethod.response.status).toBe(405);
    expect(wrongMethod.response.headers.Allow).toBe('DELETE');
  });

  it('reads and adds playlist items with query and body validation', async () => {
    const missingService = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists/playlist-id/items'),
      missingService.response,
      missingService,
    );
    expect(missingService.response.status).toBe(503);

    const getPlaylistItems = vi.fn(async () => ({ items: [], total: 0, offset: 0 }));
    const addTrack = vi.fn(async () => undefined);
    const service = { getPlaylistItems, addTrack } as unknown as SpotifyPlaylistLibrary;

    const list = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists/playlist-id/items?offset=5'),
      list.response,
      list,
      new SpotifyCatalog(),
      service,
    );
    expect(getPlaylistItems).toHaveBeenCalledWith('playlist-id', '5');
    expect(list.response.status).toBe(200);

    for (const url of [
      '/abbai-flow/music/library/playlists/playlist-id/items?offset=1&secret=bad',
      '/abbai-flow/music/library/playlists/playlist-id/items?offset=1&offset=2',
    ]) {
      const malformed = helpers();
      await handleMusicRequest(
        request(url),
        malformed.response,
        malformed,
        new SpotifyCatalog(),
        service,
      );
      expect(malformed.response.status).toBe(400);
    }

    const listFailure = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists/playlist-id/items'),
      listFailure.response,
      listFailure,
      new SpotifyCatalog(),
      { getPlaylistItems: vi.fn(async () => { throw new Error('private detail'); }) } as unknown as SpotifyPlaylistLibrary,
    );
    expect(listFailure.response.status).toBe(502);

    const parseFailure = helpers({}, { status: 400, message: 'Malformed JSON' });
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists/playlist-id/items', 'POST'),
      parseFailure.response,
      parseFailure,
      new SpotifyCatalog(),
      service,
    );
    expect(parseFailure.response.status).toBe(400);

    const invalid = helpers({ uri: 'spotify:track:abc123', extra: true });
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists/playlist-id/items', 'POST'),
      invalid.response,
      invalid,
      new SpotifyCatalog(),
      service,
    );
    expect(invalid.response.status).toBe(400);

    const added = helpers({ uri: 'spotify:track:abc123' });
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists/playlist-id/items', 'POST'),
      added.response,
      added,
      new SpotifyCatalog(),
      service,
    );
    expect(addTrack).toHaveBeenCalledWith('playlist-id', 'spotify:track:abc123');
    expect(added.response.status).toBe(202);

    const addFailure = helpers({ uri: 'spotify:track:abc123' });
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists/playlist-id/items', 'POST'),
      addFailure.response,
      addFailure,
      new SpotifyCatalog(),
      { addTrack: vi.fn(async () => { throw new Error('private detail'); }) } as unknown as SpotifyPlaylistLibrary,
    );
    expect(addFailure.response.status).toBe(502);

    const wrongMethod = helpers();
    await handleMusicRequest(
      request('/abbai-flow/music/library/playlists/playlist-id/items', 'DELETE'),
      wrongMethod.response,
      wrongMethod,
      new SpotifyCatalog(),
      service,
    );
    expect(wrongMethod.response.status).toBe(405);
    expect(wrongMethod.response.headers.Allow).toBe('GET, POST');
  });

  it('does not expose the retired music state, event, or control endpoints', async () => {
    for (const path of [
      '/abbai-flow/music/state',
      '/abbai-flow/music/events',
      '/abbai-flow/music/control',
    ]) {
      const bridge = helpers({ action: 'play' });
      await handleMusicRequest(request(path, 'GET'), bridge.response, bridge);
      expect(bridge.response.status, path).toBe(404);
    }
  });
});
