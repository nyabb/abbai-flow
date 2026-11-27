import { describe, expect, it, vi } from 'vitest';
import { EncoreMusic, type EncoreSnapshot } from './encore-music';
import { SpotifyCatalog } from './spotify-catalog';
import { SpotifyPlaylistError, type SpotifyPlaylistLibrary } from './spotify-playlists';
import {
  handleEncoreMusicRequest,
  type EncoreHttpHelpers,
  type EncoreHttpRequest,
  type EncoreHttpResponse,
} from './encore-http';

class FakeResponse implements EncoreHttpResponse {
  destroyed = false;
  writableEnded = false;
  status = 0;
  headers: Record<string, string> = {};
  readonly chunks: string[] = [];
  private closeListener: (() => void) | null = null;

  writeHead(status: number, headers: Record<string, string> = {}): this {
    this.status = status;
    this.headers = headers;
    return this;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  on(_event: 'close', listener: () => void): this {
    this.closeListener = listener;
    return this;
  }

  close(): void {
    this.destroyed = true;
    this.closeListener?.();
  }
}

function request(path: string, method = 'GET'): EncoreHttpRequest {
  return { url: path, method };
}

function helpers(body: Record<string, unknown> = {}): EncoreHttpHelpers & {
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

describe('Encore HTTP bridge', () => {
  it('returns a safe snapshot without exposing connection credentials', async () => {
    const encore = new EncoreMusic({ token: 'server-only-secret' });
    const bridge = helpers();

    await expect(
      handleEncoreMusicRequest(
        request('/abbai-flow/music/state?fresh=1'),
        bridge.response,
        encore,
        bridge,
      ),
    ).resolves.toBe(true);
    expect(bridge.response.status).toBe(200);
    expect(bridge.response.chunks.join('')).not.toContain('server-only-secret');
    expect(JSON.parse(bridge.response.chunks.join(''))).toMatchObject({
      configured: true,
      connection: 'connecting',
    });
  });

  it('rejects unknown or malformed control payloads', async () => {
    const encore = new EncoreMusic();
    const bridge = helpers({ action: 'exploit', extra: 'field' });

    await handleEncoreMusicRequest(
      request('/abbai-flow/music/control', 'POST'),
      bridge.response,
      encore,
      bridge,
    );

    expect(bridge.response.status).toBe(400);
    expect(bridge.response.chunks.join('')).toContain('Invalid music control request');
  });

  it('validates control values through the Encore service', async () => {
    const encore = new EncoreMusic();
    const bridge = helpers({ action: 'volume', value: 101 });

    await handleEncoreMusicRequest(
      request('/abbai-flow/music/control', 'POST'),
      bridge.response,
      encore,
      bridge,
    );

    expect(bridge.response.status).toBe(400);
    expect(bridge.response.chunks.join('')).toContain('integer from 0 to 100');
  });

  it('serves validated Spotify search results from the server-side catalog', async () => {
    const encore = new EncoreMusic();
    const track = {
      uri: 'spotify:track:abc123',
      title: 'Sample Song',
      artists: ['Sample Artist'],
      album: 'Sample Album',
      artworkUrl: null,
      durationMs: 180000,
    };
    const catalog = {
      search: vi.fn(async (query: unknown) => (query === 'sample song' ? [track] : [])),
    } as unknown as SpotifyCatalog;
    const bridge = helpers();

    await handleEncoreMusicRequest(
      request('/abbai-flow/music/search?q=sample%20song'),
      bridge.response,
      encore,
      bridge,
      catalog,
    );

    expect(catalog.search).toHaveBeenCalledWith('sample song');
    expect(bridge.response.status).toBe(200);
    expect(JSON.parse(bridge.response.chunks.join(''))).toEqual({ tracks: [track] });
  });

  it('exposes safe playlist status and library data through the application API', async () => {
    const encore = new EncoreMusic();
    const playlistService = {
      status: vi.fn(async () => ({
        configured: true,
        credentialsConfigured: true,
        authorized: true,
        redirectConfigured: true,
      })),
      listPlaylists: vi.fn(async () => ({ items: [], total: 0, offset: 0 })),
    } as unknown as SpotifyPlaylistLibrary;
    const bridge = helpers();

    await handleEncoreMusicRequest(
      request('/abbai-flow/music/library/status'),
      bridge.response,
      encore,
      bridge,
      new SpotifyCatalog(),
      playlistService,
    );
    expect(bridge.response.status).toBe(200);
    expect(JSON.parse(bridge.response.chunks.join(''))).toEqual({
      configured: true,
      credentialsConfigured: true,
      authorized: true,
      redirectConfigured: true,
    });
    expect(bridge.response.chunks.join('')).not.toMatch(
      /access_token|refresh_token|client_secret/i,
    );

    const listBridge = helpers();
    await handleEncoreMusicRequest(
      request('/abbai-flow/music/library/playlists?offset=0'),
      listBridge.response,
      encore,
      listBridge,
      new SpotifyCatalog(),
      playlistService,
    );
    expect(playlistService.listPlaylists).toHaveBeenCalledWith('0');
    expect(listBridge.response.status).toBe(200);
    expect(JSON.parse(listBridge.response.chunks.join(''))).toEqual({
      items: [],
      total: 0,
      offset: 0,
    });
  });

  it('includes Spotify upstream status for playback failures', async () => {
    const encore = new EncoreMusic();
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
    const bridge = helpers({ action: 'activate', deviceId: 'browser-device-id' });

    await handleEncoreMusicRequest(
      request('/abbai-flow/music/library/playback-control', 'POST'),
      bridge.response,
      encore,
      bridge,
      new SpotifyCatalog(),
      playlistService,
    );

    expect(bridge.response.status).toBe(502);
    expect(JSON.parse(bridge.response.chunks.join(''))).toEqual({
      code: 'unavailable',
      error: 'Spotify could not find the browser player. Refresh the Music page and try again.',
      upstreamStatus: 404,
    });
  });

  it('removes a playlist through the application API and rejects other methods', async () => {
    const encore = new EncoreMusic();
    const removePlaylist = vi.fn(async () => undefined);
    const playlistService = { removePlaylist } as unknown as SpotifyPlaylistLibrary;
    const bridge = helpers();

    await handleEncoreMusicRequest(
      request('/abbai-flow/music/library/playlists/4q3zB8nVYk9m2H6wX1cR0P', 'DELETE'),
      bridge.response,
      encore,
      bridge,
      new SpotifyCatalog(),
      playlistService,
    );

    expect(removePlaylist).toHaveBeenCalledWith('4q3zB8nVYk9m2H6wX1cR0P');
    expect(bridge.response.status).toBe(202);
    expect(JSON.parse(bridge.response.chunks.join(''))).toEqual({ accepted: true });

    const wrongMethod = helpers();
    await handleEncoreMusicRequest(
      request('/abbai-flow/music/library/playlists/4q3zB8nVYk9m2H6wX1cR0P', 'POST'),
      wrongMethod.response,
      encore,
      wrongMethod,
      new SpotifyCatalog(),
      playlistService,
    );
    expect(wrongMethod.response.status).toBe(405);
    expect(wrongMethod.response.headers.Allow).toBe('DELETE');
    expect(removePlaylist).toHaveBeenCalledOnce();
  });

  it('rejects unexpected playlist query parameters before calling Spotify', async () => {
    const encore = new EncoreMusic();
    const playlistService = { listPlaylists: vi.fn() } as unknown as SpotifyPlaylistLibrary;
    const bridge = helpers();

    await handleEncoreMusicRequest(
      request('/abbai-flow/music/library/playlists?offset=0&secret=bad'),
      bridge.response,
      encore,
      bridge,
      new SpotifyCatalog(),
      playlistService,
    );

    expect(bridge.response.status).toBe(400);
    expect(playlistService.listPlaylists).not.toHaveBeenCalled();
  });

  it('rejects malformed search requests before querying Spotify', async () => {
    const encore = new EncoreMusic();
    const catalog = { search: vi.fn() } as unknown as SpotifyCatalog;
    const bridge = helpers();

    await handleEncoreMusicRequest(
      request('/abbai-flow/music/search?q=song&q=other'),
      bridge.response,
      encore,
      bridge,
      catalog,
    );

    expect(bridge.response.status).toBe(400);
    expect(catalog.search).not.toHaveBeenCalled();
  });

  it('streams state changes until the browser response closes', async () => {
    let listener: ((snapshot: EncoreSnapshot) => void) | undefined;
    const unsubscribe = vi.fn();
    const snapshot = {
      configured: false,
      connection: 'disconnected' as const,
      auth: { loggedIn: null, isActive: null, deviceName: null },
      playback: {
        status: 'idle' as const,
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
    } satisfies EncoreSnapshot;
    const encore = {
      subscribe: (next: (value: EncoreSnapshot) => void) => {
        listener = next;
        next(snapshot);
        return unsubscribe;
      },
    } as unknown as EncoreMusic;
    const bridge = helpers();

    await handleEncoreMusicRequest(
      request('/abbai-flow/music/events'),
      bridge.response,
      encore,
      bridge,
    );
    expect(bridge.response.headers['Content-Type']).toContain('text/event-stream');
    expect(bridge.response.chunks.join('')).toContain('event: state\ndata:');

    listener?.({ ...snapshot, updatedAt: 2 });
    expect(bridge.response.chunks.join('')).toContain('"updatedAt":2');
    bridge.response.close();
    expect(unsubscribe).toHaveBeenCalledOnce();

    const writesAfterClose = bridge.response.chunks.length;
    listener?.({ ...snapshot, updatedAt: 3 });
    expect(bridge.response.chunks).toHaveLength(writesAfterClose);
  });

  it('returns false for non-music routes and 405 for the wrong route method', async () => {
    const encore = new EncoreMusic();
    const bridge = helpers();

    await expect(
      handleEncoreMusicRequest(request('/health'), bridge.response, encore, bridge),
    ).resolves.toBe(false);
    await handleEncoreMusicRequest(
      request('/abbai-flow/music/events', 'POST'),
      bridge.response,
      encore,
      bridge,
    );
    expect(bridge.response.status).toBe(405);
    expect(bridge.response.headers.Allow).toBe('GET');
  });
});
