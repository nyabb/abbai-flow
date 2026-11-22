import type { EncoreMusic, EncoreSnapshot } from './encore-music';
import { SpotifyCatalog, SpotifyCatalogError } from './spotify-catalog';

export interface EncoreHttpRequest {
  method?: string;
  url?: string;
}

export interface EncoreHttpResponse {
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

export interface EncoreHttpHelpers {
  sendJson(
    response: EncoreHttpResponse,
    status: number,
    payload: unknown,
    extraHeaders?: Record<string, string>,
  ): void;
  readJsonObject(request: EncoreHttpRequest): Promise<JsonObjectResult>;
}

/** Handle the app-local HTTP and SSE routes for the single Encore connection. */
export async function handleEncoreMusicRequest(
  request: EncoreHttpRequest,
  response: EncoreHttpResponse,
  encore: EncoreMusic,
  helpers: EncoreHttpHelpers,
  catalog: SpotifyCatalog = new SpotifyCatalog(),
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

  if (pathname === '/abbai-flow/music/state') {
    if (method !== 'GET') {
      helpers.sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
      return true;
    }
    helpers.sendJson(response, 200, encore.getSnapshot());
    return true;
  }

  if (pathname === '/abbai-flow/music/events') {
    if (method !== 'GET') {
      helpers.sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
      return true;
    }
    streamEncoreState(response, encore);
    return true;
  }

  if (pathname === '/abbai-flow/music/control') {
    if (method !== 'POST') {
      helpers.sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
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
      Object.keys(body).some((key) => key !== 'action' && key !== 'value') ||
      typeof body.action !== 'string'
    ) {
      helpers.sendJson(response, 400, { error: 'Invalid music control request' });
      return true;
    }

    const result = encore.control(body.action, body.value);
    helpers.sendJson(
      response,
      result.ok ? 202 : result.status,
      result.ok ? { accepted: true } : { error: result.error },
    );
    return true;
  }

  if (pathname.startsWith('/abbai-flow/music/')) {
    helpers.sendJson(response, 404, { error: 'Not found' });
    return true;
  }

  return false;
}

function streamEncoreState(response: EncoreHttpResponse, encore: EncoreMusic): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write(': connected\n\n');
  const unsubscribe = encore.subscribe((snapshot: EncoreSnapshot) => {
    if (!response.destroyed && !response.writableEnded) {
      response.write('event: state\ndata: ' + JSON.stringify(snapshot) + '\n\n');
    }
  });
  const heartbeat = setInterval(() => {
    if (!response.destroyed && !response.writableEnded) response.write(': keepalive\n\n');
  }, 20_000);
  response.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
