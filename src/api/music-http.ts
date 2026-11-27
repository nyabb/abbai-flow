import { SpotifyCatalog, SpotifyCatalogError } from './spotify-catalog';
import { SpotifyPlaylistError, type SpotifyPlaylistLibrary } from './spotify-playlists';

export interface MusicHttpRequest {
  method?: string;
  url?: string;
}

export interface MusicHttpResponse {
  destroyed: boolean;
  writableEnded: boolean;
  writeHead(status: number, headers?: Record<string, string>): unknown;
  write(chunk: string): unknown;
  on(event: 'close', listener: () => void): unknown;
}

interface JsonObjectResult {
  value?: Record<string, unknown>;
  error?: { status: number; message: string };
}

export interface MusicHttpHelpers {
  sendJson(
    response: MusicHttpResponse,
    status: number,
    payload: unknown,
    extraHeaders?: Record<string, string>,
  ): void;
  readJsonObject(request: MusicHttpRequest): Promise<JsonObjectResult>;
}

/** Handle app-local Spotify catalog, OAuth, playlist, and playback routes. */
export async function handleMusicRequest(
  request: MusicHttpRequest,
  response: MusicHttpResponse,
  helpers: MusicHttpHelpers,
  catalog: SpotifyCatalog = new SpotifyCatalog(),
  playlists?: SpotifyPlaylistLibrary,
): Promise<boolean> {
  const pathname = (request.url || '/').split('?')[0];
  const method = request.method || 'GET';

  if (pathname === '/abbai-flow/music/search') {
    if (method !== 'GET') {
      helpers.sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
      return true;
    }
    const parameters = new URL(request.url || pathname, 'http://abbai-flow.local').searchParams;
    let hasUnexpectedParameter = false;
    parameters.forEach((_value, key) => {
      if (key !== 'q') hasUnexpectedParameter = true;
    });
    if (hasUnexpectedParameter || parameters.getAll('q').length !== 1) {
      helpers.sendJson(response, 400, { code: 'invalid_query', error: 'Invalid search request' });
      return true;
    }
    try {
      const tracks = await catalog.search(parameters.get('q'));
      helpers.sendJson(response, 200, { tracks });
    } catch (error) {
      if (error instanceof SpotifyCatalogError) {
        if (error.code !== 'invalid_query') {
          console.warn(
            `[Integration] Spotify catalog search failed (${error.code}, HTTP ${error.status}).`,
          );
        }
        helpers.sendJson(response, error.status, { code: error.code, error: error.message });
      } else {
        helpers.sendJson(response, 502, {
          code: 'unavailable',
          error: 'Spotify search is temporarily unavailable',
        });
      }
    }
    return true;
  }

  if (pathname === '/abbai-flow/music/library/status') {
    if (method !== 'GET') {
      helpers.sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
      return true;
    }
    if (!playlists) {
      helpers.sendJson(response, 503, { error: 'Spotify playlist integration is unavailable' });
      return true;
    }
    try {
      helpers.sendJson(response, 200, await playlists.status());
    } catch {
      helpers.sendJson(response, 503, { error: 'Spotify playlist status is unavailable' });
    }
    return true;
  }

  if (pathname === '/abbai-flow/music/library/connect') {
    if (method !== 'POST') {
      helpers.sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
      return true;
    }
    if (!playlists) {
      helpers.sendJson(response, 503, { error: 'Spotify playlist integration is unavailable' });
      return true;
    }
    try {
      helpers.sendJson(response, 200, { authorizationUrl: await playlists.beginAuthorization() });
    } catch (error) {
      sendPlaylistError(error, response, helpers);
    }
    return true;
  }

  if (pathname === '/abbai-flow/music/library/playback-token') {
    if (method !== 'GET') {
      helpers.sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
      return true;
    }
    if (!playlists) {
      helpers.sendJson(response, 503, { error: 'Spotify playback is unavailable' });
      return true;
    }
    try {
      helpers.sendJson(
        response,
        200,
        { accessToken: await playlists.getPlaybackAccessToken() },
        { 'Cache-Control': 'no-store' },
      );
    } catch (error) {
      sendPlaylistError(error, response, helpers);
    }
    return true;
  }

  if (pathname === '/abbai-flow/music/library/playback-control') {
    if (method !== 'POST') {
      helpers.sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
      return true;
    }
    if (!playlists) {
      helpers.sendJson(response, 503, { error: 'Spotify playback is unavailable' });
      return true;
    }
    const parsed = await helpers.readJsonObject(request);
    if (parsed.error) {
      helpers.sendJson(response, parsed.error.status, { error: parsed.error.message });
      return true;
    }
    const body = parsed.value;
    if (
      !body ||
      Object.keys(body).some((key) => !['action', 'value', 'deviceId'].includes(key)) ||
      typeof body.action !== 'string' ||
      typeof body.deviceId !== 'string'
    ) {
      helpers.sendJson(response, 400, { error: 'Invalid Spotify playback request' });
      return true;
    }
    try {
      await playlists.controlPlayback(body.deviceId, body.action, body.value);
      helpers.sendJson(response, 202, { accepted: true });
    } catch (error) {
      sendPlaylistError(error, response, helpers);
    }
    return true;
  }

  if (pathname === '/abbai-flow/music/library/playlists') {
    if (!playlists) {
      helpers.sendJson(response, 503, { error: 'Spotify playlist integration is unavailable' });
      return true;
    }
    if (method === 'GET') {
      const parameters = new URL(request.url || pathname, 'http://abbai-flow.local').searchParams;
      let unexpected = false;
      parameters.forEach((_value, key) => {
        if (key !== 'offset') unexpected = true;
      });
      if (unexpected || parameters.getAll('offset').length > 1) {
        helpers.sendJson(response, 400, { error: 'Invalid playlist request' });
        return true;
      }
      try {
        helpers.sendJson(response, 200, await playlists.listPlaylists(parameters.get('offset') || 0));
      } catch (error) {
        sendPlaylistError(error, response, helpers);
      }
      return true;
    }
    if (method === 'POST') {
      const parsed = await helpers.readJsonObject(request);
      if (parsed.error) {
        helpers.sendJson(response, parsed.error.status, { error: parsed.error.message });
        return true;
      }
      if (!parsed.value || Object.keys(parsed.value).some((key) => key !== 'name')) {
        helpers.sendJson(response, 400, { error: 'Invalid playlist request' });
        return true;
      }
      try {
        helpers.sendJson(response, 201, { playlist: await playlists.createPlaylist(parsed.value.name) });
      } catch (error) {
        sendPlaylistError(error, response, helpers);
      }
      return true;
    }
    helpers.sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });
    return true;
  }

  const playlistMatch = pathname.match(/^\/abbai-flow\/music\/library\/playlists\/([^/]+)$/);
  if (playlistMatch) {
    if (!playlists) {
      helpers.sendJson(response, 503, { error: 'Spotify playlist integration is unavailable' });
      return true;
    }
    if (method !== 'DELETE') {
      helpers.sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'DELETE' });
      return true;
    }
    try {
      await playlists.removePlaylist(playlistMatch[1]);
      helpers.sendJson(response, 202, { accepted: true });
    } catch (error) {
      sendPlaylistError(error, response, helpers);
    }
    return true;
  }

  const playlistItemsMatch = pathname.match(/^\/abbai-flow\/music\/library\/playlists\/([^/]+)\/items$/);
  if (playlistItemsMatch) {
    if (!playlists) {
      helpers.sendJson(response, 503, { error: 'Spotify playlist integration is unavailable' });
      return true;
    }
    if (method === 'GET') {
      const parameters = new URL(request.url || pathname, 'http://abbai-flow.local').searchParams;
      let unexpected = false;
      parameters.forEach((_value, key) => {
        if (key !== 'offset') unexpected = true;
      });
      if (unexpected || parameters.getAll('offset').length > 1) {
        helpers.sendJson(response, 400, { error: 'Invalid playlist request' });
        return true;
      }
      try {
        helpers.sendJson(
          response,
          200,
          await playlists.getPlaylistItems(playlistItemsMatch[1], parameters.get('offset') || 0),
        );
      } catch (error) {
        sendPlaylistError(error, response, helpers);
      }
      return true;
    }
    if (method === 'POST') {
      const parsed = await helpers.readJsonObject(request);
      if (parsed.error) {
        helpers.sendJson(response, parsed.error.status, { error: parsed.error.message });
        return true;
      }
      if (!parsed.value || Object.keys(parsed.value).some((key) => key !== 'uri')) {
        helpers.sendJson(response, 400, { error: 'Invalid playlist item request' });
        return true;
      }
      try {
        await playlists.addTrack(playlistItemsMatch[1], parsed.value.uri);
        helpers.sendJson(response, 202, { accepted: true });
      } catch (error) {
        sendPlaylistError(error, response, helpers);
      }
      return true;
    }
    helpers.sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });
    return true;
  }

  if (pathname.startsWith('/abbai-flow/music/')) {
    helpers.sendJson(response, 404, { error: 'Not found' });
    return true;
  }

  return false;
}

function sendPlaylistError(
  error: unknown,
  response: MusicHttpResponse,
  helpers: MusicHttpHelpers,
): void {
  if (error instanceof SpotifyPlaylistError) {
    helpers.sendJson(response, error.status, {
      code: error.code,
      error: error.message,
      ...(error.upstreamStatus === undefined ? {} : { upstreamStatus: error.upstreamStatus }),
    });
    return;
  }
  helpers.sendJson(response, 502, {
    code: 'unavailable',
    error: 'Spotify playlist service is temporarily unavailable',
  });
}
