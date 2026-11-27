import { describe, expect, it, vi } from 'vitest';
import { SpotifyCatalog } from './spotify-catalog';
import { SpotifyPlaylistError, type SpotifyPlaylistLibrary } from './spotify-playlists';
import {
  handleMusicRequest,
  type MusicHttpHelpers,
  type MusicHttpRequest,
  type MusicHttpResponse,
} from './music-http';

class FakeResponse implements MusicHttpResponse {
  destroyed = false;
  writableEnded = false;
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

  on(): this {
    return this;
  }
}

function request(url: string, method = 'GET'): MusicHttpRequest {
  return { url, method };
}

function helpers(body: Record<string, unknown> = {}): MusicHttpHelpers & {
  response: FakeResponse;
} {
  const response = new FakeResponse();
  return {
    response,
    sendJson: (target, status, payload, headers = {}) => {
      const fake = target as FakeResponse;
      fake.writeHead(status, headers);
      fake.write(JSON.stringify(payload));
      fake.writableEnded = true;
    },
    readJsonObject: vi.fn(async () => ({ value: body })),
  };
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
