/**
 * Abbai Flow backend — request handling.
 *
 * This module is deliberately CommonJS (`*.cjs`) so it can be started by the
 * add-on image (which has no package.json and therefore treats `.js` as CJS)
 * *and* loaded by `node --test` here, where the root package.json declares
 * `"type": "module"`.
 *
 * Responsibilities:
 *  - serve the built SPA from ABBAI_FLOW_DIST
 *  - proxy `/api/*` (REST) and `/api/websocket` (upgrade) to Home Assistant
 *  - bridge HA's WebSocket-only calendar commands
 *  - persist JSON documents under ABBAI_FLOW_DATA
 *
 * Everything is created by `createApp(options)` so tests can drive the real
 * handlers against a fake Home Assistant without touching global state.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { randomBytes } = require('crypto');
const WebSocket = require('ws');
const { EncoreMusic, DEFAULT_ENCORE_URL } = require('./build/encore-music.js');
const { handleEncoreMusicRequest } = require('./build/encore-http.js');
const { SpotifyCatalog } = require('./build/spotify-catalog.js');
const { SpotifyPlaylistLibrary } = require('./build/spotify-playlists.js');
const { BluetoothManager, handleBluetoothRequest } = require('./build/bluetooth-runtime-bundle.js');
const { ChoresManStore, ChoresManStoreError } = require('./choresman-store.cjs');
const { ICloudRemindersWorker } = require('./icloud-reminders-worker.cjs');

/** Default request body limit (1 MiB) — matches the previous behaviour. */
const MAX_BODY_SIZE = 1024 * 1024;
/** Proxied REST requests are abandoned after this long. */
const PROXY_TIMEOUT_MS = 30000;
/** A WebSocket upgrade must be established within this window. */
const UPGRADE_TIMEOUT_MS = 15000;
/** HA WebSocket commands (calendar bridges) time out after this long. */
const WS_COMMAND_TIMEOUT_MS = 10000;

/**
 * Origins that the native shells (Capacitor iOS/Android) send. They are
 * legitimately different from the host serving the API, so they are allowed
 * explicitly instead of via the same-origin rule.
 */
const NATIVE_ORIGINS = new Set([
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
]);

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/** Transport + default port for a URL protocol. */
function transportFor(protocol) {
  return protocol === 'https:' ? https : http;
}

function defaultPortFor(protocol) {
  return protocol === 'https:' ? 443 : 80;
}

/**
 * Join a configured base URL with a request path.
 *
 * The base may carry a path (`http://supervisor/core`), so the request path is
 * resolved relatively — `new URL('/api/x', base)` would drop `/core`.
 * Throws when the base URL is not parseable so callers can answer 500/400
 * instead of silently proxying to the wrong host.
 */
function resolveHaUrl(base, requestPath) {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return new URL(String(requestPath).replace(/^\//, ''), normalizedBase);
}

/**
 * HA identifiers are lowercase `domain` / `service` names. They are spliced
 * into a proxied path, so anything else must be rejected rather than escaped.
 */
function isSafeIdentifier(value) {
  return typeof value === 'string' && /^[a-z_][a-z0-9_]*$/i.test(value) && value.length <= 64;
}

function sendJson(res, status, payload, extraHeaders = {}) {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function safeDestroy(target) {
  if (!target) return;
  try {
    target.destroy();
  } catch {
    /* already gone */
  }
}

/**
 * Read a request body with a hard size limit.
 *
 * Resolves with `{ body }` or `{ error }`; it never rejects, so a handler can
 * always answer exactly once. `req.destroy()` is deliberately avoided: it
 * tears down the socket before the 413 can be delivered.
 */
function collectBody(req, maxSize = MAX_BODY_SIZE) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    /** Assigned below; declared first so `finish` can always clear it. */
    let drainTimer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (drainTimer) clearTimeout(drainTimer);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
      resolve(result);
    };

    const onData = (chunk) => {
      total += chunk.length;
      if (total > maxSize) {
        chunks.length = 0;
        // Keep the socket alive long enough to answer 413, but do not buffer.
        req.resume();
        finish({ error: { status: 413, message: 'Request body too large' } });
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish({ body: chunks.length ? Buffer.concat(chunks) : null });
    const onError = () => finish({ body: null });
    const onAborted = () => finish({ error: { status: 400, message: 'Request aborted' } });

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);

    // A stalled upload must not pin the connection forever.
    drainTimer = setTimeout(() => {
      if (settled) return;
      safeDestroy(req);
      finish({ error: { status: 408, message: 'Request body timed out' } });
    }, PROXY_TIMEOUT_MS);
    if (typeof drainTimer.unref === 'function') drainTimer.unref();
  });
}

/** Read and parse a JSON object body. Returns `{ value }` or `{ error }`. */
async function readJsonObject(req, maxSize = MAX_BODY_SIZE) {
  const { body, error } = await collectBody(req, maxSize);
  if (error) return { error };
  const raw = (body || Buffer.from('{}')).toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: { status: 400, message: 'Body is not valid JSON' } };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: { status: 400, message: 'Body must be a JSON object' } };
  }
  return { value: parsed };
}

/**
 * CSRF guard: state-changing requests must come from the same origin that
 * served the app (or a native shell / explicitly allowed origin).
 *
 * Browsers always attach `Origin` to cross-origin requests, so a page on
 * another site can no longer drive `/beacon-action/*` or `/beacon-data/*`
 * against a wall display that is reachable on the LAN.
 */
function isAllowedOrigin(req, allowedOrigins = []) {
  const origin = req.headers.origin;
  // Same-origin `fetch` from some engines omits Origin; requests from native
  // WebViews report `null` for file-based shells.
  if (!origin || origin === 'null') return true;
  if (allowedOrigins.includes(origin) || NATIVE_ORIGINS.has(origin)) return true;

  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  return originHost.toLowerCase() === String(host).toLowerCase();
}

/** Only tolerate JSON-ish bodies on the mutating bridge endpoints. */
function hasJsonContentType(req) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  // A missing Content-Type is tolerated: HA ingress and some WebViews drop it.
  return type === '' || type.startsWith('application/json');
}

async function serveStatic(req, res, distDir) {
  const requested = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  let filePath = path.join(distDir, requested);

  // Path traversal guard
  const resolved = path.resolve(filePath);
  const root = path.resolve(distDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    sendJson(res, 400, { error: 'Bad request' });
    return;
  }

  try {
    await fsp.stat(filePath);
  } catch {
    filePath = path.join(root, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': data.length });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

/** One authenticated REST call to Home Assistant. */
function haRequest(config, method, apiPath, body, timeoutMs = PROXY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = resolveHaUrl(config.haBaseUrl, apiPath);
    } catch (err) {
      reject(err);
      return;
    }

    const bodyBuf = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const transport = transportFor(target.protocol);
    const options = {
      hostname: target.hostname,
      port: target.port || defaultPortFor(target.protocol),
      path: target.pathname + target.search,
      method,
      headers: {
        Authorization: `Bearer ${config.haToken}`,
        'Content-Type': 'application/json',
      },
    };
    if (bodyBuf) options.headers['Content-Length'] = bodyBuf.length;
    if (config.ca) options.ca = config.ca;

    const request = transport.request(options, (resp) => {
      const chunks = [];
      resp.on('data', (chunk) => chunks.push(chunk));
      resp.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: resp.statusCode, data: JSON.parse(raw) });
        } catch {
          resolve({ status: resp.statusCode, data: raw });
        }
      });
      resp.on('error', reject);
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Home Assistant request timed out'));
    });
    request.on('error', reject);
    if (bodyBuf) request.write(bodyBuf);
    request.end();
  });
}

/** Proxy `/api/*` to HA, preserving method, query and body. */
async function proxyToHA(req, res, config) {
  const { body, error } = await collectBody(req);
  if (error) {
    sendJson(res, error.status, { error: error.message });
    return;
  }

  let target;
  try {
    target = resolveHaUrl(config.haBaseUrl, req.url);
  } catch {
    sendJson(res, 500, { error: 'Home Assistant URL is misconfigured' });
    return;
  }

  const transport = transportFor(target.protocol);
  const options = {
    hostname: target.hostname,
    port: target.port || defaultPortFor(target.protocol),
    path: target.pathname + target.search,
    method: req.method,
    headers: {
      Authorization: `Bearer ${config.haToken}`,
      'Content-Type': req.headers['content-type'] || 'application/json',
    },
  };
  if (body) options.headers['Content-Length'] = body.length;
  if (config.ca) options.ca = config.ca;

  let settled = false;
  const proxyReq = transport.request(options, (proxyRes) => {
    if (settled) return;
    settled = true;
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
    proxyRes.on('error', () => safeDestroy(res));
  });

  proxyReq.setTimeout(PROXY_TIMEOUT_MS, () => {
    proxyReq.destroy(new Error('timed out'));
  });

  proxyReq.on('error', (err) => {
    if (settled) return;
    settled = true;
    console.error('Proxy error:', err.message);
    sendJson(res, 502, { error: 'Failed to reach Home Assistant' });
  });

  // The client going away must not leave the upstream request hanging.
  res.on('close', () => {
    if (!res.writableEnded) proxyReq.destroy();
  });

  if (body) proxyReq.write(body);
  proxyReq.end();
}

/**
 * Send one command over HA's WebSocket API and resolve with its result.
 *
 * HA moved calendar event update/delete to WS-only commands. A short-lived
 * connection per call keeps this simple; volume is user-triggered.
 */
function haWsCommand(config, command, timeoutMs = WS_COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!config.haToken) {
      reject(new Error('No Home Assistant token available'));
      return;
    }

    let ws;
    try {
      ws = new WebSocket(config.haWsUrl, config.ca ? { ca: config.ca } : undefined);
    } catch (err) {
      reject(err);
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      finish(reject, new Error('Home Assistant WebSocket command timed out'), true);
    }, timeoutMs);

    function finish(fn, arg, terminate = false) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (terminate) ws.terminate();
        else ws.close();
      } catch {
        /* ignore */
      }
      fn(arg);
    }

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }

      if (msg.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: config.haToken }));
        return;
      }
      if (msg.type === 'auth_invalid') {
        finish(reject, new Error('Home Assistant WebSocket auth failed'));
        return;
      }
      if (msg.type === 'auth_ok') {
        ws.send(JSON.stringify({ id: 1, ...command }));
        return;
      }
      if (msg.type === 'result' && msg.id === 1) {
        if (msg.success) {
          finish(resolve, msg.result);
        } else {
          finish(
            reject,
            Object.assign(new Error(msg.error?.message || 'Home Assistant command failed'), {
              code: msg.error?.code,
            }),
          );
        }
      }
    });

    ws.on('error', (err) => finish(reject, err, true));
    ws.on('close', () => {
      if (!settled) finish(reject, new Error('Home Assistant WebSocket closed unexpectedly'));
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Voice / natural-language intent parser (keyword-based, no LLM)    */
/* ------------------------------------------------------------------ */

const INTENT_PATTERNS = [
  {
    name: 'add_item',
    patterns: [/add\s+(.+?)\s+to\s+(?:the\s+)?(.+)/i],
    handler: (m) => ({
      domain: 'todo',
      service: 'add_item',
      data: { item: m[1].trim() },
      entityHint: m[2].trim(),
      response: `Added ${m[1].trim()} to ${m[2].trim()}`,
    }),
  },
  {
    name: 'complete_item',
    patterns: [
      /(?:check off|mark)\s+(.+?)\s+(?:as\s+)?(?:done|complete|completed)/i,
      /(?:complete|finish)\s+(.+)/i,
    ],
    handler: (m) => ({
      domain: 'todo',
      service: 'update_item',
      data: { item: m[1].trim(), status: 'completed' },
      entityHint: null,
      response: `Marked ${m[1].trim()} as done`,
    }),
  },
  {
    name: 'play_music',
    patterns: [/\b(?:play\s+music|resume\s+music|resume\s+playback|play)\b/i],
    handler: () => ({
      domain: 'media_player',
      service: 'media_play',
      data: {},
      entityHint: null,
      response: 'Playing music',
    }),
  },
  {
    name: 'pause_music',
    patterns: [/\b(?:pause|stop\s+music|pause\s+music|stop\s+playback)\b/i],
    handler: () => ({
      domain: 'media_player',
      service: 'media_pause',
      data: {},
      entityHint: null,
      response: 'Paused music',
    }),
  },
  {
    name: 'next_track',
    patterns: [/\b(?:next\s+(?:song|track)|skip)\b/i],
    handler: () => ({
      domain: 'media_player',
      service: 'media_next_track',
      data: {},
      entityHint: null,
      response: 'Skipping to next track',
    }),
  },
  {
    name: 'set_volume',
    patterns: [/set\s+volume\s+(?:to\s+)?(\d+)/i, /volume\s+(\d+)/i],
    handler: (m) => {
      const level = Math.min(100, Math.max(0, parseInt(m[1], 10)));
      return {
        domain: 'media_player',
        service: 'volume_set',
        data: { volume_level: level / 100 },
        entityHint: null,
        response: `Volume set to ${level}%`,
      };
    },
  },
  {
    name: 'navigate',
    patterns: [/(?:show|go\s+to|open|navigate\s+to)\s+(?:the\s+)?(.+)/i],
    handler: (m) => ({
      navigation: true,
      view: m[1].trim().toLowerCase(),
      response: `Navigating to ${m[1].trim()}`,
    }),
  },
  {
    name: 'calendar',
    patterns: [
      /\b(?:what(?:'s| is)\s+on\s+(?:today|my\s+calendar|my\s+schedule)|today(?:'s)?\s+(?:schedule|events|calendar|agenda))\b/i,
    ],
    handler: () => ({
      fetch: 'calendar',
      response: null,
    }),
  },
  {
    name: 'weather',
    patterns: [/\b(?:what(?:'s| is)\s+the\s+weather|weather\s+(?:today|now|forecast))\b/i],
    handler: () => ({
      fetch: 'weather',
      response: null,
    }),
  },
];

function parseIntent(text) {
  for (const intent of INTENT_PATTERNS) {
    for (const pat of intent.patterns) {
      const match = text.match(pat);
      if (match) {
        return { name: intent.name, ...intent.handler(match) };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Endpoint handlers                                                 */
/* ------------------------------------------------------------------ */

/** POST /beacon-action/service { domain, service, data, return_response } */
async function handleServiceCall(req, res, config) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!hasJsonContentType(req)) {
    sendJson(res, 415, { error: 'Expected application/json' });
    return;
  }

  const { value, error } = await readJsonObject(req);
  if (error) {
    sendJson(res, error.status, { error: error.message });
    return;
  }

  const { domain, service, data, return_response } = value;
  if (!isSafeIdentifier(domain) || !isSafeIdentifier(service)) {
    sendJson(res, 400, { error: 'Invalid domain or service' });
    return;
  }
  if (data != null && (typeof data !== 'object' || Array.isArray(data))) {
    sendJson(res, 400, { error: 'Invalid data payload' });
    return;
  }

  const qs = return_response ? '?return_response' : '';
  try {
    const result = await haRequest(
      config,
      'POST',
      `/api/services/${domain}/${service}${qs}`,
      data || {},
    );
    sendJson(res, result.status, result.data ?? {});
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
}

/**
 * POST /beacon-action/calendar-event
 * Body: { op: 'create'|'update'|'delete', entity_id, uid?, event? }
 */
async function handleCalendarEventAction(req, res, config) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!hasJsonContentType(req)) {
    sendJson(res, 415, { error: 'Expected application/json' });
    return;
  }

  const { value, error } = await readJsonObject(req);
  if (error) {
    sendJson(res, error.status, { error: error.message });
    return;
  }

  const { op, entity_id, uid, event } = value;
  if (!op || !entity_id) {
    sendJson(res, 400, { error: 'Missing op or entity_id' });
    return;
  }
  if (op !== 'create' && op !== 'update' && op !== 'delete') {
    sendJson(res, 400, { error: 'op must be "create", "update", or "delete"' });
    return;
  }
  if ((op === 'update' || op === 'delete') && !uid) {
    sendJson(res, 400, { error: 'Missing uid for update/delete' });
    return;
  }
  if ((op === 'create' || op === 'update') && (!event || typeof event !== 'object')) {
    sendJson(res, 400, { error: `Missing event payload for ${op}` });
    return;
  }

  const command =
    op === 'create'
      ? { type: 'calendar/event/create', entity_id, event }
      : op === 'update'
        ? { type: 'calendar/event/update', entity_id, uid, event }
        : { type: 'calendar/event/delete', entity_id, uid };

  try {
    const result = await haWsCommand(config, command);
    sendJson(res, 200, { ok: true, result });
  } catch (err) {
    // HA's ERR_NOT_SUPPORTED is expected for calendars without create/update/
    // delete support; surface it as 501 with the code intact.
    sendJson(res, err.code === 'not_supported' ? 501 : 502, {
      error: err.message,
      code: err.code || null,
    });
  }
}

/**
 * Read a single JSON document without reparsing failures.
 * Returns `null` for "not stored yet" and throws a typed error otherwise.
 */
async function readDataFile(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    try {
      return JSON.parse(raw);
    } catch {
      console.error('Stored document is not valid JSON:', path.basename(filePath));
      const err = new Error('Stored document is corrupt');
      err.code = 'CORRUPT_STORE';
      throw err;
    }
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Write a document atomically: a full write to a temporary file in the same
 * directory, then a rename. A crash mid-write therefore leaves the previous
 * document intact instead of a truncated one.
 */
async function writeDataFile(filePath, contents) {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    await fsp.writeFile(tmp, contents, 'utf8');
    await fsp.rename(tmp, filePath);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Persistent data API — stores JSON in ABBAI_FLOW_DATA (survives add-on rebuilds).
 *
 * GET  /beacon-data/:key  → read stored JSON (`null` when absent)
 * PUT  /beacon-data/:key  → write JSON body to storage
 */
async function handleDataApi(req, res, config) {
  const pathname = (req.url || '').split('?')[0];
  const canonical = pathname.startsWith('/abbai-flow/data/');
  const prefix = canonical ? '/abbai-flow/data/' : '/beacon-data/';
  const key = pathname.startsWith(prefix)
    ? pathname.slice(prefix.length).replace(/[^a-zA-Z0-9_-]/g, '')
    : '';
  if (!key) {
    sendJson(res, 400, { error: 'Missing key' });
    return;
  }

  const filePath = path.join(config.dataDir, `${key}.json`);

  if (req.method === 'GET') {
    try {
      let data = await readDataFile(filePath);
      if (data === null && canonical) {
        const legacyKey = key.startsWith('abbai-flow-')
          ? key.replace(/^abbai-flow-/, 'beacon-')
          : key.startsWith('abbai_flow_')
            ? key.replace(/^abbai_flow_/, 'beacon_')
            : null;
        if (legacyKey) {
          data = await readDataFile(path.join(config.dataDir, legacyKey + '.json'));
          if (data !== null) {
            try {
              await fsp.mkdir(config.dataDir, { recursive: true });
              await writeDataFile(filePath, JSON.stringify(data));
            } catch {
              // Keep serving the legacy document if copying it fails.
            }
          }
        }
      }
      sendJson(res, 200, data, { 'Cache-Control': 'no-store' });
    } catch (err) {
      sendJson(res, 500, {
        error: err.code === 'CORRUPT_STORE' ? 'Stored document is corrupt' : 'Read failed',
      });
    }
    return;
  }

  if (req.method === 'PUT') {
    const { body, error } = await collectBody(req);
    if (error) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    const raw = (body || Buffer.from('{}')).toString('utf8');
    try {
      JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: 'Body is not valid JSON' });
      return;
    }
    try {
      await fsp.mkdir(config.dataDir, { recursive: true });
      await writeDataFile(filePath, raw);
      sendJson(res, 200, { ok: true });
    } catch {
      sendJson(res, 500, { error: 'Write failed' });
    }
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

/**
 * POST /api/planner/mutate
 * Body: { target: 'meta' | 'redemptions', op: { type, ... }, key: string }
 *
 * The planner's middle layer: the browser sends an *operation* instead of a
 * whole document, the server reduces it with the same rules the client uses
 * (`src/api/planner-rules.ts`, compiled to `server/build/`), serialises
 * concurrent mutations per document and writes the result atomically.
 *
 * `key` is an idempotency key: replaying the same operation (a retry, a flaky
 * network, a double tap) returns the stored document instead of applying the
 * change twice — which is exactly what must never happen to a points
 * allocation or a reward fulfilment.
 */
const PLANNER_DOCUMENTS = {
  meta: 'beacon-planner-meta',
  redemptions: 'beacon-reward-redemptions',
};

/** Recently applied idempotency keys, persisted so a restart keeps them. */
const PLANNER_KEY_LOG = 'beacon-planner-ops';
const PLANNER_KEY_LOG_LIMIT = 500;

/** Per-document queue: read-modify-write must not interleave. */
const plannerQueues = new Map();

function withPlannerLock(name, run) {
  const previous = plannerQueues.get(name) || Promise.resolve();
  const next = previous.then(run, run);
  plannerQueues.set(
    name,
    next.catch(() => undefined),
  );
  return next;
}

async function readPlannerKeyLog(config) {
  try {
    const raw = await readDataFile(path.join(config.dataDir, `${PLANNER_KEY_LOG}.json`));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

async function handlePlannerMutate(req, res, config) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!hasJsonContentType(req)) {
    sendJson(res, 415, { error: 'Expected application/json' });
    return;
  }

  const { body, error } = await collectBody(req);
  if (error) {
    sendJson(res, error.status, { error: error.message });
    return;
  }

  let payload;
  try {
    payload = JSON.parse((body || Buffer.from('{}')).toString('utf8'));
  } catch {
    sendJson(res, 400, { error: 'Body is not valid JSON' });
    return;
  }

  const target = payload && payload.target;
  const op = payload && payload.op;
  const key = payload && typeof payload.key === 'string' ? payload.key.trim() : '';
  const documentKey = PLANNER_DOCUMENTS[target];

  if (!documentKey) {
    sendJson(res, 400, { error: 'Unknown planner target' });
    return;
  }
  if (!op || typeof op !== 'object' || typeof op.type !== 'string') {
    sendJson(res, 400, { error: 'Missing planner operation' });
    return;
  }
  if (!key) {
    sendJson(res, 400, { error: 'Missing idempotency key' });
    return;
  }

  let rules;
  try {
    rules = loadPlannerRules();
  } catch (err) {
    // A missing build must be loud, not a silent 400 on every mutation.
    sendJson(res, 500, { error: err.message || 'Planner rules unavailable' });
    return;
  }

  try {
    const outcome = await withPlannerLock(documentKey, async () => {
      const keyLog = await readPlannerKeyLog(config);
      if (keyLog[key]) {
        // Already applied: answer with the stored document, do not reduce again.
        const current = await readDataFile(path.join(config.dataDir, `${documentKey}.json`));
        return { document: current, changed: false, duplicate: true, result: null };
      }

      const current = await readDataFile(path.join(config.dataDir, `${documentKey}.json`));
      const reduced = rules.applyPlannerOp(target, current, op);

      if (reduced.changed) {
        await fsp.mkdir(config.dataDir, { recursive: true });
        await writeDataFile(
          path.join(config.dataDir, `${documentKey}.json`),
          JSON.stringify(reduced.document),
        );
      }

      const nextLog = { ...keyLog, [key]: Date.now() };
      const entries = Object.entries(nextLog).sort((left, right) => right[1] - left[1]);
      await writeDataFile(
        path.join(config.dataDir, `${PLANNER_KEY_LOG}.json`),
        JSON.stringify(Object.fromEntries(entries.slice(0, PLANNER_KEY_LOG_LIMIT))),
      );

      return {
        document: reduced.document,
        changed: reduced.changed,
        duplicate: false,
        result: reduced.result === undefined ? null : reduced.result,
      };
    });

    sendJson(res, 200, outcome, { 'Cache-Control': 'no-store' });
  } catch (err) {
    // A rejected operation must never look like a successful write.
    sendJson(res, 400, { error: err.message || 'Planner operation rejected' });
  }
}

/**
 * The planner rules are TypeScript (`src/api/planner-rules.ts`) — the single
 * implementation the browser imports too. `npm run build:server` compiles them
 * to CommonJS here, so this file requires the build artefact instead of keeping
 * a second hand-written copy in sync.
 */
let plannerRules = null;
function loadPlannerRules() {
  if (!plannerRules) {
    try {
      plannerRules = require('./build/planner-rules.js');
    } catch (err) {
      throw new Error(
        'Planner rules are not built. Run `npm run build:server` before starting the server. ' +
          `(${err && err.message ? err.message : err})`,
      );
    }
  }
  return plannerRules;
}

/**
 * POST /beacon-action/voice
 * Body: { "text": "add milk to the grocery list" }
 */
async function handleVoiceAction(req, res, config) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!hasJsonContentType(req)) {
    sendJson(res, 415, { error: 'Expected application/json' });
    return;
  }

  const { value, error } = await readJsonObject(req);
  if (error) {
    sendJson(res, error.status, { error: error.message });
    return;
  }

  const { text } = value;
  if (!text || typeof text !== 'string') {
    sendJson(res, 400, { error: 'Missing or invalid "text" field' });
    return;
  }

  const intent = parseIntent(text.trim());

  let cachedStates = null;
  async function getStates() {
    if (!cachedStates) {
      cachedStates = haRequest(config, 'GET', '/api/states').then((r) => r.data || []);
    }
    return cachedStates;
  }

  if (!intent) {
    sendJson(res, 200, {
      response: "Sorry, I didn't understand that.",
      action: null,
      success: false,
    });
    return;
  }

  if (intent.navigation) {
    sendJson(res, 200, {
      response: intent.response,
      action: 'navigate',
      view: intent.view,
      success: true,
    });
    return;
  }

  if (intent.fetch === 'calendar') {
    try {
      const states = await getStates();
      const calendars = states.filter(
        (e) => typeof e.entity_id === 'string' && e.entity_id.startsWith('calendar.'),
      );

      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

      const calResults = await Promise.all(
        calendars.map(async (cal) => {
          try {
            const evResp = await haRequest(
              config,
              'GET',
              `/api/calendars/${cal.entity_id}?start=${encodeURIComponent(startOfDay)}&end=${encodeURIComponent(endOfDay)}`,
            );
            if (Array.isArray(evResp.data)) {
              return evResp.data.map((ev) => ({
                calendar: cal.attributes?.friendly_name || cal.entity_id,
                ...ev,
              }));
            }
          } catch {
            /* skip unavailable calendars */
          }
          return [];
        }),
      );
      const allEvents = calResults.flat();

      const summary =
        allEvents.length === 0
          ? 'No events on your calendar today.'
          : `You have ${allEvents.length} event${allEvents.length > 1 ? 's' : ''} today: ${allEvents
              .map((e) => e.summary || 'Untitled')
              .join(', ')}.`;

      sendJson(res, 200, {
        response: summary,
        action: 'calendar',
        events: allEvents,
        success: true,
      });
    } catch (err) {
      sendJson(res, 200, {
        response: 'Failed to fetch calendar.',
        action: 'calendar',
        success: false,
        error: err.message,
      });
    }
    return;
  }

  if (intent.fetch === 'weather') {
    try {
      const states = await getStates();
      const weatherEntity = states.find(
        (e) => typeof e.entity_id === 'string' && e.entity_id.startsWith('weather.'),
      );
      if (!weatherEntity) {
        sendJson(res, 200, {
          response: 'No weather entity found.',
          action: 'weather',
          success: false,
        });
        return;
      }
      const attrs = weatherEntity.attributes || {};
      const temp =
        attrs.temperature != null ? `${attrs.temperature}${attrs.temperature_unit || ''}` : '';
      const condition = weatherEntity.state || '';
      const summary = `Currently ${condition}${temp ? `, ${temp}` : ''}.`;

      sendJson(res, 200, {
        response: summary,
        action: 'weather',
        entity: weatherEntity.entity_id,
        state: weatherEntity.state,
        attributes: attrs,
        success: true,
      });
    } catch (err) {
      sendJson(res, 200, {
        response: 'Failed to fetch weather.',
        action: 'weather',
        success: false,
        error: err.message,
      });
    }
    return;
  }

  let entityId = null;
  if (intent.domain === 'todo' && intent.entityHint) {
    try {
      const states = await getStates();
      const todoEntities = states.filter(
        (e) => typeof e.entity_id === 'string' && e.entity_id.startsWith('todo.'),
      );
      const hint = intent.entityHint.toLowerCase();
      const match = todoEntities.find((e) => {
        const name = (e.attributes?.friendly_name || '').toLowerCase();
        return name === hint || name.includes(hint) || e.entity_id.toLowerCase().includes(hint);
      });
      if (match) entityId = match.entity_id;
    } catch {
      /* proceed without entity */
    }
  }

  if (intent.domain === 'media_player' && !entityId) {
    try {
      const states = await getStates();
      const players = states.filter(
        (e) => typeof e.entity_id === 'string' && e.entity_id.startsWith('media_player.'),
      );
      const playing = players.find((e) => e.state === 'playing');
      const paused = players.find((e) => e.state === 'paused');
      entityId = (playing || paused || players[0])?.entity_id || null;
    } catch {
      /* proceed without entity */
    }
  }

  const serviceData = { ...intent.data };
  if (entityId) serviceData.entity_id = entityId;

  try {
    const qs = intent.domain === 'todo' ? '?return_response' : '';
    let resp = await haRequest(
      config,
      'POST',
      `/api/services/${intent.domain}/${intent.service}${qs}`,
      serviceData,
    );

    if (
      resp.status >= 400 &&
      intent.domain === 'media_player' &&
      ['media_play', 'media_pause', 'media_next_track'].includes(intent.service)
    ) {
      resp = await haRequest(
        config,
        'POST',
        '/api/services/media_player/media_play_pause',
        serviceData,
      );
      if (resp.status >= 400) {
        resp = await haRequest(config, 'POST', '/api/services/media_player/toggle', serviceData);
      }
    }

    const ok = resp.status >= 200 && resp.status < 300;
    sendJson(res, 200, {
      response: ok ? intent.response : `Action failed (${resp.status}).`,
      action: intent.name,
      entity_id: entityId,
      success: ok,
    });
  } catch (err) {
    sendJson(res, 200, {
      response: `Action failed: ${err.message}`,
      action: intent.name,
      success: false,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  WebSocket proxy                                                   */
/* ------------------------------------------------------------------ */

/**
 * Proxy the browser's `/api/websocket` upgrade to Home Assistant.
 *
 * The transport follows the configured HA URL: `https://` bases are proxied
 * with TLS and default to port 443, `http://` bases use plain HTTP on port 80.
 * (Before this, the transport was hard-coded to `http` with port 80, so an
 * HA instance served over HTTPS could never be reached.)
 */
function handleUpgrade(req, socket, head, config) {
  const reject = () => safeDestroy(socket);

  if (!config.haToken || !req.url || !req.url.startsWith('/api/websocket')) {
    reject();
    return;
  }

  let target;
  try {
    target = resolveHaUrl(config.haBaseUrl, '/api/websocket');
  } catch {
    reject();
    return;
  }

  const secure = target.protocol === 'https:';
  const transport = transportFor(target.protocol);

  const headers = {
    connection: 'Upgrade',
    upgrade: 'websocket',
    host: target.host,
    'sec-websocket-version': req.headers['sec-websocket-version'] || '13',
  };
  // Only forward the handshake headers HA needs — never the browser's
  // cookies or authorization header.
  for (const key of ['sec-websocket-key', 'sec-websocket-protocol', 'sec-websocket-extensions']) {
    if (req.headers[key]) headers[key] = req.headers[key];
  }

  const options = {
    hostname: target.hostname,
    port: target.port || defaultPortFor(target.protocol),
    path: target.pathname + target.search,
    method: 'GET',
    headers,
    servername: secure ? target.hostname : undefined,
    // One upstream socket per browser socket; nothing to reuse or leak.
    agent: false,
  };
  if (config.ca) options.ca = config.ca;

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    safeDestroy(proxyReq);
    safeDestroy(proxySocket);
    safeDestroy(socket);
  };

  const proxyReq = transport.request(options);

  const timer = setTimeout(() => {
    console.error('WebSocket proxy upgrade timed out');
    cleanup();
  }, config.upgradeTimeoutMs || UPGRADE_TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();

  let proxySocket = null;

  proxyReq.on('upgrade', (proxyRes, upstream, upstreamHead) => {
    if (closed) {
      safeDestroy(upstream);
      return;
    }
    clearTimeout(timer);
    proxySocket = upstream;

    if (proxyRes.statusCode !== 101) {
      cleanup();
      return;
    }

    const responseHeaders = Object.entries(proxyRes.headers)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\r\n');

    try {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${responseHeaders}\r\n\r\n`);
      if (upstreamHead && upstreamHead.length > 0) socket.write(upstreamHead);
    } catch {
      cleanup();
      return;
    }

    socket.setNoDelay(true);
    upstream.setNoDelay(true);

    upstream.on('error', cleanup);
    socket.on('error', cleanup);
    upstream.on('close', cleanup);
    socket.on('close', cleanup);

    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  proxyReq.on('response', (proxyRes) => {
    // A non-101 answer means HA refused the upgrade; pass the status through
    // and close instead of leaving the browser hanging.
    if (closed) return;
    try {
      socket.write(`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage || ''}\r\n\r\n`);
    } catch {
      /* ignore */
    }
    cleanup();
  });

  proxyReq.on('error', (err) => {
    if (!closed) console.error('WebSocket proxy error:', err.message);
    cleanup();
  });

  // The browser socket dropping mid-handshake must abort the upstream attempt.
  socket.on('error', cleanup);
  socket.on('close', cleanup);

  if (head && head.length > 0) proxyReq.write(head);
  proxyReq.end();
}

/* ------------------------------------------------------------------ */
/*  Application factory                                               */
/* ------------------------------------------------------------------ */

const INTEGRATION_SETTINGS_FILE = 'integration-settings.json';
const MEAL_DATA_MAPPING_KEYS = [
  'itemsPath',
  'idPath',
  'titlePath',
  'imagePath',
  'ingredientsPath',
  'stepsPath',
  'tagsPath',
  'datePath',
  'sourceUrlPath',
];
const EMPTY_MEAL_DATA_MAPPING = Object.fromEntries(MEAL_DATA_MAPPING_KEYS.map((key) => [key, '']));
const INTEGRATION_SETTING_KEYS = [
  'haToken',
  'haBaseUrl',
  'haWsUrlOverride',
  'encoreToken',
  'encoreUrl',
  'spotifyClientId',
  'spotifyClientSecret',
  'spotifyMarket',
  'spotifyRedirectUri',
  'mealSourceUrl',
  'mealSourceToken',
  'mealDataMapping',
  'icloudAppleId',
  'icloudPassword',
  'calendarSources',
];
const CALENDAR_PROVIDERS = new Set(['caldav', 'ics', 'google']);

function integrationSettingsPath(dataDir) {
  return path.join(dataDir, INTEGRATION_SETTINGS_FILE);
}

function readIntegrationSettings(dataDir, fallback) {
  try {
    const stored = JSON.parse(fs.readFileSync(integrationSettingsPath(dataDir), 'utf8'));
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return fallback;
    return {
      ...fallback,
      ...Object.fromEntries(
        INTEGRATION_SETTING_KEYS.filter((key) =>
          Object.prototype.hasOwnProperty.call(stored, key),
        ).map((key) => [key, stored[key]]),
      ),
      mealDataMapping: {
        ...EMPTY_MEAL_DATA_MAPPING,
        ...(stored.mealDataMapping &&
        typeof stored.mealDataMapping === 'object' &&
        !Array.isArray(stored.mealDataMapping)
          ? Object.fromEntries(
              MEAL_DATA_MAPPING_KEYS.filter((key) =>
                Object.prototype.hasOwnProperty.call(stored.mealDataMapping, key),
              ).map((key) => [
                key,
                typeof stored.mealDataMapping[key] === 'string' ? stored.mealDataMapping[key] : '',
              ]),
            )
          : {}),
      },
      calendarSources: normalizeCalendarSources(
        stored.calendarSources,
        fallback.calendarSources || [],
      ),
    };
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.warn(
        'Could not read saved integration settings; using default integration settings.',
      );
    }
    return fallback;
  }
}

async function writeIntegrationSettings(dataDir, settings) {
  const filePath = integrationSettingsPath(dataDir);
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const stored = Object.fromEntries(INTEGRATION_SETTING_KEYS.map((key) => [key, settings[key]]));
  try {
    await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 });
    await fsp.writeFile(temporaryPath, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 });
    await fsp.chmod(temporaryPath, 0o600);
    await fsp.rename(temporaryPath, filePath);
    await fsp.chmod(filePath, 0o600);
  } catch (error) {
    await fsp.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function mergeIntegrationSettings(current, patch) {
  const next = Object.fromEntries(INTEGRATION_SETTING_KEYS.map((key) => [key, current[key]]));
  const fields = {
    haUrl: 'haBaseUrl',
    haToken: 'haToken',
    encoreToken: 'encoreToken',
    encoreUrl: 'encoreUrl',
    spotifyClientId: 'spotifyClientId',
    spotifyClientSecret: 'spotifyClientSecret',
    spotifyMarket: 'spotifyMarket',
    spotifyRedirectUri: 'spotifyRedirectUri',
    mealSourceUrl: 'mealSourceUrl',
    mealSourceToken: 'mealSourceToken',
    icloudAppleId: 'icloudAppleId',
    icloudPassword: 'icloudPassword',
  };
  for (const [input, key] of Object.entries(fields)) {
    if (typeof patch[input] === 'string') {
      next[key] =
        input === 'icloudPassword'
          ? patch[input]
          : input === 'spotifyMarket'
            ? patch[input].trim().toUpperCase()
            : patch[input].trim();
    }
  }
  if (typeof patch.haUrl === 'string') next.haBaseUrl = normaliseHaBaseUrl(patch.haUrl);
  if (patch.clearHaToken === true) next.haToken = '';
  if (patch.clearEncoreToken === true) next.encoreToken = '';
  if (patch.clearSpotifyClientSecret === true) next.spotifyClientSecret = '';
  if (patch.clearMealSourceToken === true) next.mealSourceToken = '';
  if (patch.clearIcloudPassword === true) next.icloudPassword = '';
  if (patch.mealDataMapping && typeof patch.mealDataMapping === 'object') {
    next.mealDataMapping = { ...current.mealDataMapping };
    for (const key of MEAL_DATA_MAPPING_KEYS) {
      if (typeof patch.mealDataMapping[key] === 'string') {
        next.mealDataMapping[key] = patch.mealDataMapping[key].trim();
      }
    }
  }
  if (Array.isArray(patch.calendarSources)) {
    next.calendarSources = mergeCalendarSources(
      current.calendarSources || [],
      patch.calendarSources,
    );
  }
  return next;
}

function normalizeCalendarSources(sources, fallback = []) {
  if (!Array.isArray(sources)) return fallback;
  return sources
    .slice(0, 12)
    .filter((source) => source && typeof source === 'object' && !Array.isArray(source))
    .map((source, index) => ({
      id: typeof source.id === 'string' ? source.id.slice(0, 80) : `calendar-${index + 1}`,
      name: typeof source.name === 'string' ? source.name.slice(0, 120).trim() : '',
      provider: CALENDAR_PROVIDERS.has(source.provider) ? source.provider : 'caldav',
      url: typeof source.url === 'string' ? source.url.slice(0, 2000).trim() : '',
      username: typeof source.username === 'string' ? source.username.slice(0, 320).trim() : '',
      password: typeof source.password === 'string' ? source.password : '',
      clientId: typeof source.clientId === 'string' ? source.clientId.slice(0, 500).trim() : '',
      clientSecret: typeof source.clientSecret === 'string' ? source.clientSecret : '',
    }));
}

function mergeCalendarSources(currentSources, incomingSources) {
  const current = new Map(
    normalizeCalendarSources(currentSources).map((source) => [source.id, source]),
  );
  return normalizeCalendarSources(incomingSources).map((source) => {
    const saved = current.get(source.id);
    const incoming = incomingSources.find((item) => item && item.id === source.id) || {};
    return {
      ...source,
      password: incoming.clearPassword === true ? '' : source.password || saved?.password || '',
      clientSecret:
        incoming.clearClientSecret === true ? '' : source.clientSecret || saved?.clientSecret || '',
    };
  });
}

function isValidMealMappingPath(value) {
  let candidate = value.trim();
  if (!candidate) return true;
  if (candidate === '$') return true;
  if (candidate.startsWith('$')) {
    candidate = candidate.slice(1);
    if (candidate && !candidate.startsWith('.') && !candidate.startsWith('[')) return false;
  }
  if (candidate.startsWith('.')) candidate = candidate.slice(1);
  return /^(?:[A-Za-z_$][A-Za-z0-9_$-]*|\[\d+\]|\[\])(?:\.(?:[A-Za-z_$][A-Za-z0-9_$-]*|\[\d+\]|\[\])|\[\d+\]|\[\])*$/u.test(
    candidate,
  );
}

function validateIntegrationSettings(settings) {
  try {
    const haUrl = new URL(settings.haBaseUrl);
    if (
      !['http:', 'https:'].includes(haUrl.protocol) ||
      !haUrl.hostname ||
      haUrl.username ||
      haUrl.password
    ) {
      return 'Enter a valid Home Assistant URL using http or https.';
    }
  } catch {
    return 'Enter a valid Home Assistant URL using http or https.';
  }
  try {
    const encoreUrl = new URL(settings.encoreUrl);
    if (
      !['ws:', 'wss:'].includes(encoreUrl.protocol) ||
      !encoreUrl.hostname ||
      encoreUrl.username ||
      encoreUrl.password
    ) {
      return 'Enter a valid Encore WebSocket URL using ws or wss.';
    }
  } catch {
    return 'Enter a valid Encore WebSocket URL using ws or wss.';
  }
  if (!/^[A-Za-z]{2}$/.test(settings.spotifyMarket || '')) {
    return 'Spotify market must be a two-letter country code.';
  }
  if (settings.spotifyRedirectUri) {
    try {
      const redirect = new URL(settings.spotifyRedirectUri);
      if (
        !['http:', 'https:'].includes(redirect.protocol) ||
        redirect.username ||
        redirect.password
      ) {
        return 'Enter a valid Spotify redirect URL using http or https.';
      }
    } catch {
      return 'Enter a valid Spotify redirect URL using http or https.';
    }
  }
  const mealDataMapping = settings.mealDataMapping || EMPTY_MEAL_DATA_MAPPING;
  if (settings.mealSourceUrl) {
    try {
      const mealSourceUrl = new URL(settings.mealSourceUrl);
      if (
        !['http:', 'https:'].includes(mealSourceUrl.protocol) ||
        !mealSourceUrl.hostname ||
        mealSourceUrl.username ||
        mealSourceUrl.password
      ) {
        return 'Enter a valid meal source URL using http or https.';
      }
    } catch {
      return 'Enter a valid meal source URL using http or https.';
    }
    if (!mealDataMapping.itemsPath || !mealDataMapping.titlePath || !mealDataMapping.stepsPath) {
      return 'Meal source mapping must include items, title, and steps paths.';
    }
  }
  for (const key of MEAL_DATA_MAPPING_KEYS) {
    const value = mealDataMapping[key] || '';
    if (!isValidMealMappingPath(value)) {
      return `Meal source mapping has an invalid ${key} path.`;
    }
  }
  if (!Array.isArray(settings.calendarSources) || settings.calendarSources.length > 12) {
    return 'Calendar settings can contain up to 12 sources.';
  }
  for (const source of settings.calendarSources) {
    if (!source || typeof source !== 'object' || !CALENDAR_PROVIDERS.has(source.provider)) {
      return 'Choose a supported calendar source type.';
    }
    if (!source.name || source.name.length > 120) return 'Enter a name for every calendar source.';
    if (source.url) {
      try {
        const calendarUrl = new URL(source.url);
        if (
          !['http:', 'https:'].includes(calendarUrl.protocol) ||
          !calendarUrl.hostname ||
          calendarUrl.username ||
          calendarUrl.password
        ) {
          return `Enter a valid URL for calendar source “${source.name}”.`;
        }
      } catch {
        return `Enter a valid URL for calendar source “${source.name}”.`;
      }
    }
    if (source.provider === 'ics' && !source.url)
      return `Enter a feed URL for calendar source “${source.name}”.`;
  }
  return null;
}

function publicIntegrationSettings(settings, icloudStatus = {}) {
  return {
    haUrl:
      !settings.haToken && settings.haBaseUrl === 'http://supervisor/core'
        ? ''
        : settings.haBaseUrl,
    haConfigured: Boolean(settings.haToken),
    encoreUrl: settings.encoreUrl,
    encoreConfigured: Boolean(settings.encoreToken),
    spotifyClientId: settings.spotifyClientId,
    spotifyClientSecretConfigured: Boolean(settings.spotifyClientSecret),
    spotifyMarket: settings.spotifyMarket,
    spotifyRedirectUri: settings.spotifyRedirectUri,
    mealSourceUrl: settings.mealSourceUrl,
    mealSourceTokenConfigured: Boolean(settings.mealSourceToken),
    mealDataMapping: { ...EMPTY_MEAL_DATA_MAPPING, ...settings.mealDataMapping },
    icloudAppleId: settings.icloudAppleId || '',
    icloudPasswordConfigured: Boolean(settings.icloudPassword),
    icloudAuthState: typeof icloudStatus.state === 'string' ? icloudStatus.state : 'disconnected',
    icloudDevices: Array.isArray(icloudStatus.devices) ? icloudStatus.devices : [],
    icloudSecurityKeyNames: Array.isArray(icloudStatus.securityKeyNames)
      ? icloudStatus.securityKeyNames
      : [],
    calendarSources: normalizeCalendarSources(settings.calendarSources).map((source) => ({
      id: source.id,
      name: source.name,
      provider: source.provider,
      url: source.url,
      username: source.username,
      passwordConfigured: Boolean(source.password),
      clientId: source.clientId,
      clientSecretConfigured: Boolean(source.clientSecret),
    })),
  };
}

function updateHaWebSocketUrl(config) {
  if (config.haWsUrlOverride) {
    config.haWsUrl = config.haWsUrlOverride;
    return;
  }
  try {
    const url = new URL(config.haBaseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/$/, '')}/api/websocket`;
    config.haWsUrl = url.toString();
  } catch {
    config.haWsUrl = '';
  }
}

/**
 * Build the HTTP server.
 *
 * @param {object} options
 * @param {string} options.distDir      directory with the built SPA
 * @param {string} options.dataDir      directory for persisted JSON
 * @param {string} options.haToken      long-lived HA token (empty = disabled)
 * @param {string} options.haBaseUrl    e.g. http://supervisor/core
 * @param {string} options.haWsUrl      e.g. ws://supervisor/core/api/websocket
 * @param {string[]} [options.allowedOrigins] extra allowed CORS origins
 * @param {string} [options.ca]         extra CA (PEM) for private HA certs
 */
function createApp(options) {
  const initialIntegrationSettings = {
    haToken: options.haToken || '',
    haBaseUrl: (options.haBaseUrl || 'http://supervisor/core').replace(/\/$/, ''),
    haWsUrlOverride: options.haWsUrl || '',
    encoreToken: options.encoreToken || '',
    encoreUrl: options.encoreUrl || DEFAULT_ENCORE_URL,
    spotifyClientId: options.spotifyClientId || '',
    spotifyClientSecret: options.spotifyClientSecret || '',
    spotifyMarket: (options.spotifyMarket || 'NL').toUpperCase(),
    spotifyRedirectUri: options.spotifyRedirectUri || '',
    mealSourceUrl: '',
    mealSourceToken: '',
    mealDataMapping: { ...EMPTY_MEAL_DATA_MAPPING },
    icloudAppleId: '',
    icloudPassword: '',
    calendarSources: [],
  };
  const config = {
    distDir: options.distDir,
    dataDir: options.dataDir,
    allowedOrigins: options.allowedOrigins || [],
    ca: options.ca,
    upgradeTimeoutMs: options.upgradeTimeoutMs || UPGRADE_TIMEOUT_MS,
    ...readIntegrationSettings(options.dataDir, initialIntegrationSettings),
  };
  updateHaWebSocketUrl(config);

  const createEncore = () => new EncoreMusic({ token: config.encoreToken, url: config.encoreUrl });
  const bluetooth =
    options.bluetooth || new BluetoothManager({ dbusAddress: options.bluetoothDbusAddress || '' });
  const createSpotifyCatalog = () =>
    new SpotifyCatalog({
      clientId: config.spotifyClientId,
      clientSecret: config.spotifyClientSecret,
      market: config.spotifyMarket,
    });
  const spotifyTokenPath = path.join(config.dataDir, 'spotify-playlists-token.json');
  const spotifyTokenStore = options.spotifyTokenStore || {
    async load() {
      try {
        return JSON.parse(await fsp.readFile(spotifyTokenPath, 'utf8'));
      } catch (error) {
        if (error && error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async save(token) {
      const temporaryPath = `${spotifyTokenPath}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        await fsp.mkdir(path.dirname(spotifyTokenPath), { recursive: true, mode: 0o700 });
        await fsp.writeFile(temporaryPath, JSON.stringify(token), {
          encoding: 'utf8',
          mode: 0o600,
        });
        await fsp.chmod(temporaryPath, 0o600);
        await fsp.rename(temporaryPath, spotifyTokenPath);
        await fsp.chmod(spotifyTokenPath, 0o600);
      } catch {
        await fsp.unlink(temporaryPath).catch(() => undefined);
        throw new Error('Spotify token storage failed');
      }
    },
    async clear() {
      await fsp.unlink(spotifyTokenPath).catch((error) => {
        if (!error || error.code !== 'ENOENT') throw error;
      });
    },
  };
  const createSpotifyPlaylists = () =>
    new SpotifyPlaylistLibrary({
      clientId: config.spotifyClientId,
      clientSecret: config.spotifyClientSecret,
      redirectUri: config.spotifyRedirectUri,
      market: config.spotifyMarket,
      tokenStore: spotifyTokenStore,
      createState: options.createSpotifyState,
    });
  const services = {
    encore: options.encore || createEncore(),
    spotifyCatalog: options.spotifyCatalog || createSpotifyCatalog(),
    spotifyPlaylists: options.spotifyPlaylists || createSpotifyPlaylists(),
    choresman: options.choresman || new ChoresManStore({ dataDir: config.dataDir }),
    icloudReminders:
      options.icloudReminders ||
      new ICloudRemindersWorker({
        dataDir: config.dataDir,
        python: options.icloudPython,
        scriptPath: options.icloudWorkerPath,
      }),
  };
  const verifySpotifyCatalog = () => services.spotifyCatalog.verifyCredentials();
  const verifySpotifyPlaylists = () => services.spotifyPlaylists.status();

  const server = http.createServer((req, res) => {
    void route(req, res, config, services, bluetooth);
  });
  const choresmanMaintenanceTimer =
    typeof services.choresman.call === 'function'
      ? setInterval(() => {
          void services.choresman.call('run_scheduled_maintenance', {}).catch(() => undefined);
        }, 60_000)
      : null;
  choresmanMaintenanceTimer?.unref?.();
  if (choresmanMaintenanceTimer) {
    void services.choresman.call('run_scheduled_maintenance', {}).catch(() => undefined);
  }

  server.on('upgrade', (req, socket, head) => {
    handleUpgrade(req, socket, head, config);
  });
  server.on('close', () => {
    if (choresmanMaintenanceTimer) clearInterval(choresmanMaintenanceTimer);
    services.encore.stop();
    bluetooth.stop();
    services.icloudReminders.stop?.();
  });
  services.encore.start();
  bluetooth.start();

  async function updateIntegrations(patch) {
    const next = mergeIntegrationSettings(config, patch);
    const validation = validateIntegrationSettings(next);
    if (validation) return { error: validation };

    const haConnectionChanged =
      next.haBaseUrl !== config.haBaseUrl || next.haToken !== config.haToken;
    if (haConnectionChanged && next.haToken) {
      try {
        const result = await haRequest({ ...config, ...next }, 'GET', '/api/', null, 10000);
        if (result.status !== 200) {
          return { error: `Home Assistant rejected the connection (HTTP ${result.status})` };
        }
      } catch {
        return { error: 'Could not reach Home Assistant at that address' };
      }
    }
    try {
      await writeIntegrationSettings(config.dataDir, next);
    } catch {
      return { error: 'Could not save integration settings' };
    }

    const encoreChanged =
      next.encoreToken !== config.encoreToken || next.encoreUrl !== config.encoreUrl;
    const spotifySettingsChanged =
      next.spotifyClientId !== config.spotifyClientId ||
      next.spotifyClientSecret !== config.spotifyClientSecret ||
      next.spotifyMarket !== config.spotifyMarket ||
      next.spotifyRedirectUri !== config.spotifyRedirectUri;
    const spotifyCredentialsChanged =
      next.spotifyClientId !== config.spotifyClientId ||
      next.spotifyClientSecret !== config.spotifyClientSecret;
    const icloudCredentialsChanged =
      next.icloudAppleId !== config.icloudAppleId || next.icloudPassword !== config.icloudPassword;
    if (spotifyCredentialsChanged) {
      try {
        await spotifyTokenStore.clear();
      } catch {
        console.warn('Could not clear the old Spotify authorization after credentials changed.');
      }
    }

    Object.assign(config, next);
    updateHaWebSocketUrl(config);
    if (encoreChanged) {
      services.encore.stop();
      services.encore = createEncore();
      services.encore.start();
    }
    if (spotifySettingsChanged) {
      services.spotifyCatalog = createSpotifyCatalog();
      services.spotifyPlaylists = createSpotifyPlaylists();
    }
    if (icloudCredentialsChanged) {
      await services.icloudReminders.reset?.().catch(() => undefined);
      if (!next.icloudAppleId || !next.icloudPassword) {
        await fsp
          .rm(path.join(config.dataDir, 'icloud-reminders'), { recursive: true, force: true })
          .catch(() => undefined);
      }
    }
    return { settings: publicIntegrationSettings(config, services.icloudReminders.status?.()) };
  }
  services.updateIntegrations = updateIntegrations;

  return {
    server,
    config,
    get encore() {
      return services.encore;
    },
    bluetooth,
    verifySpotifyCatalog,
    get spotifyPlaylists() {
      return services.spotifyPlaylists;
    },
    verifySpotifyPlaylists,
    updateIntegrations,
  };
}

async function route(req, res, config, services, bluetooth) {
  const url = req.url || '/';
  const pathname = url.split('?')[0];
  const { encore, spotifyCatalog, spotifyPlaylists } = services;
  const actionPath =
    {
      '/abbai-flow/action/voice': '/beacon-action/voice',
      '/abbai-flow/action/service': '/beacon-action/service',
      '/abbai-flow/action/calendar-event': '/beacon-action/calendar-event',
    }[pathname] || pathname;

  const isMutation = req.method !== 'GET' && req.method !== 'HEAD';
  // Every state-changing endpoint goes through the origin guard — including
  // the generic `/api/*` proxy, which carries the server-side HA token and can
  // call arbitrary services.
  const guarded =
    actionPath === '/beacon-action/voice' ||
    actionPath === '/beacon-action/service' ||
    actionPath === '/beacon-action/calendar-event' ||
    pathname.startsWith('/beacon-data/') ||
    pathname.startsWith('/abbai-flow/data/') ||
    pathname === '/abbai-flow/settings/integrations' ||
    pathname.startsWith('/abbai-flow/settings/icloud-reminders') ||
    pathname.startsWith('/abbai-flow/music/control') ||
    pathname.startsWith('/abbai-flow/music/library/') ||
    pathname.startsWith('/abbai-flow/bluetooth/control') ||
    pathname === '/abbai-flow/choresman' ||
    url.startsWith('/api/');

  if (guarded && isMutation && !isAllowedOrigin(req, config.allowedOrigins)) {
    sendJson(res, 403, { error: 'Cross-origin request rejected' });
    return;
  }

  try {
    if (pathname === '/abbai-flow/choresman') {
      if (req.method === 'GET') {
        sendJson(
          res,
          200,
          { snapshot: await services.choresman.getSnapshot() },
          { 'Cache-Control': 'no-store' },
        );
        return;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });
        return;
      }
      const { value, error } = await readJsonObject(req);
      if (error) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      if (typeof value.action !== 'string' || !value.action.trim()) {
        sendJson(res, 400, { error: 'action is required' });
        return;
      }
      try {
        const result = await services.choresman.call(value.action, value.data || {});
        sendJson(
          res,
          200,
          {
            result,
            snapshot: await services.choresman.getSnapshot(),
          },
          { 'Cache-Control': 'no-store' },
        );
      } catch (err) {
        const status =
          err instanceof ChoresManStoreError && err.code === 'service_not_found'
            ? 404
            : err instanceof ChoresManStoreError
              ? 400
              : 500;
        sendJson(res, status, {
          error: err instanceof ChoresManStoreError ? err.message : 'ChoresMan action failed',
          ...(err instanceof ChoresManStoreError ? { code: err.code } : {}),
        });
      }
      return;
    }
    if (pathname === '/abbai-flow/settings/integrations') {
      if (req.method === 'GET') {
        sendJson(res, 200, publicIntegrationSettings(config, services.icloudReminders.status?.()), {
          'Cache-Control': 'no-store',
        });
        return;
      }
      const { value, error } = await readJsonObject(req);
      if (error) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      if (req.method === 'POST') {
        const candidate = { ...config, ...mergeIntegrationSettings(config, value) };
        const validation = validateIntegrationSettings(candidate);
        if (validation) {
          sendJson(res, 400, { error: validation });
          return;
        }
        try {
          const result = await haRequest(candidate, 'GET', '/api/', null, 10000);
          if (result.status !== 200) {
            sendJson(res, 400, {
              error: `Home Assistant rejected the connection (HTTP ${result.status})`,
            });
            return;
          }
          sendJson(res, 200, { ok: true });
        } catch {
          sendJson(res, 502, { error: 'Could not reach Home Assistant at that address' });
        }
        return;
      }
      if (req.method === 'PUT') {
        const result = await services.updateIntegrations(value);
        if (result.error) {
          sendJson(res, 400, { error: result.error });
          return;
        }
        sendJson(res, 200, result.settings, { 'Cache-Control': 'no-store' });
        return;
      }
      sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, POST, PUT' });
      return;
    }
    if (pathname.startsWith('/abbai-flow/settings/icloud-reminders/')) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
        return;
      }
      const { value, error } = await readJsonObject(req);
      if (error) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      let result;
      if (pathname === '/abbai-flow/settings/icloud-reminders/authenticate') {
        result = await services.icloudReminders.authenticate(
          config.icloudAppleId,
          config.icloudPassword,
        );
      } else if (pathname === '/abbai-flow/settings/icloud-reminders/request-code') {
        result = await services.icloudReminders.requestTwoStepCode(Number(value.deviceIndex));
      } else if (pathname === '/abbai-flow/settings/icloud-reminders/verify-code') {
        result = await services.icloudReminders.verifyCode(String(value.code || ''));
      } else if (pathname === '/abbai-flow/settings/icloud-reminders/fetch-preview') {
        result = await services.icloudReminders.fetchPreview();
      } else {
        sendJson(res, 404, { error: 'iCloud Reminders route not found' });
        return;
      }
      if (!result?.ok) {
        const status =
          result?.errorCode === 'apple_unreachable'
            ? 502
            : result?.errorCode === 'pyicloud_unavailable'
              ? 503
              : 400;
        sendJson(
          res,
          status,
          {
            error: result?.error || 'PyICloud request failed.',
            ...(result?.errorCode ? { code: result.errorCode } : {}),
          },
          { 'Cache-Control': 'no-store' },
        );
        return;
      }
      const response = { ...result };
      delete response.requestId;
      sendJson(res, 200, response, { 'Cache-Control': 'no-store' });
      return;
    }
    if (pathname.startsWith('/abbai-flow/bluetooth/')) {
      const handled = await handleBluetoothRequest(req, res, bluetooth, {
        sendJson,
        readJsonObject,
      });
      if (!handled) sendJson(res, 404, { error: 'Bluetooth route not found' });
      return;
    }
    if (pathname.startsWith('/abbai-flow/music/')) {
      if (pathname === '/abbai-flow/music/oauth/callback') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
          return;
        }
        const parameters = new URL(url, 'http://abbai-flow.local').searchParams;
        let outcome = 'error';
        try {
          await spotifyPlaylists.completeAuthorization(
            parameters.get('code'),
            parameters.get('state'),
            parameters.get('error'),
          );
          outcome = 'connected';
        } catch {
          outcome = 'failed';
        }
        const callbackSuffix = '/abbai-flow/music/oauth/callback';
        const basePath = pathname.endsWith(callbackSuffix)
          ? pathname.slice(0, -callbackSuffix.length)
          : '';
        res.writeHead(302, {
          Location: `${basePath}/?view=music&spotify=${outcome}`,
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }
      await handleEncoreMusicRequest(
        req,
        res,
        encore,
        { sendJson, readJsonObject },
        spotifyCatalog,
        spotifyPlaylists,
      );
      return;
    }
    if (actionPath === '/beacon-action/voice') {
      await handleVoiceAction(req, res, config);
      return;
    }
    if (actionPath === '/beacon-action/service') {
      await handleServiceCall(req, res, config);
      return;
    }
    if (actionPath === '/beacon-action/calendar-event') {
      await handleCalendarEventAction(req, res, config);
      return;
    }
    if (pathname.startsWith('/beacon-data/') || pathname.startsWith('/abbai-flow/data/')) {
      await handleDataApi(req, res, config);
      return;
    }
    if (url === '/runtime-config.js') {
      // Served dynamically, never cached: the browser must pick up the current
      // HA address after a redeploy without a hard refresh.
      const body = `window.__ABBAI_FLOW_CONFIG__ = ${JSON.stringify(runtimeConfigFor(config))};\n`;
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    }
    if (url === '/api/planner/mutate') {
      await handlePlannerMutate(req, res, config);
      return;
    }
    if (url.startsWith('/api/')) {
      if (!config.haToken) {
        sendJson(res, 503, { error: 'No Home Assistant token available' });
        return;
      }
      await proxyToHA(req, res, config);
      return;
    }
    await serveStatic(req, res, config.distDir);
  } catch (err) {
    console.error('Unhandled request error:', err.message);
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

/**
 * Normalise the configured Home Assistant address.
 *
 * People type `homeassistant.local:8123` into a container UI, paste
 * `https://ha.example.com/api`, or leave a trailing slash. All three must send
 * requests to the same place, otherwise the proxy 404s on `/api/api/...`.
 */
function normaliseHaBaseUrl(value) {
  let base = String(value || '').trim();
  if (!base) return 'http://supervisor/core';
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  base = base.replace(/\/+$/, '');
  base = base.replace(/\/api$/i, '');
  return base || 'http://supervisor/core';
}

/**
 * Runtime configuration for the browser, served at `/runtime-config.js`.
 *
 * The SPA has to know it sits behind Abbai Flow's proxy — that is what stops it
 * asking the household for a long-lived token and makes every request go
 * same-origin. The token itself is deliberately **never** included: the server
 * injects it for each proxied call.
 */
function runtimeConfigFor(config, env = process.env) {
  const payload = {
    deployment_mode: 'standalone',
    // Display/reference only; requests are always proxied in this mode.
    ha_url: config.haBaseUrl,
  };

  const passThrough = {
    family_name: env.FAMILY_NAME,
    theme: env.THEME,
    weather_entity: env.WEATHER_ENTITY,
    photo_directory: env.PHOTO_DIRECTORY,
  };
  for (const [key, value] of Object.entries(passThrough)) {
    if (typeof value === 'string' && value.trim()) payload[key] = value.trim();
  }

  const numbers = {
    photo_interval: env.PHOTO_INTERVAL,
    screen_saver_timeout: env.SCREEN_SAVER_TIMEOUT,
  };
  for (const [key, value] of Object.entries(numbers)) {
    const parsed = Number(value);
    if (value !== undefined && value !== '' && Number.isFinite(parsed)) payload[key] = parsed;
  }

  return payload;
}

/**
 * Read deployment configuration. Home Assistant, Encore, and Spotify
 * integration values are managed in Settings → Integrations and persisted in
 * the data directory, not read from environment variables.
 *
 * Paths, the CSRF allow-list and the extra CA all use `ABBAI_FLOW_*` names.
 * The pre-2.0 spelling of those variables is deliberately not accepted any
 * more: silently falling back to an old data path would split a household's
 * documents in two. `docs/upgrade-2.0.0.md` lists the rename.
 */
function configFromEnv(env = process.env) {
  return {
    distDir: env.ABBAI_FLOW_DIST || '/app/dist',
    dataDir: env.ABBAI_FLOW_DATA || '/data',
    bluetoothDbusAddress: env.ABBAI_FLOW_BLUETOOTH_DBUS_ADDRESS || '',
    weatherEntity: env.WEATHER_ENTITY || '',
    photoDirectory: env.PHOTO_DIRECTORY || '',
    allowedOrigins: (env.ABBAI_FLOW_ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    ca: env.ABBAI_FLOW_HA_CA || undefined,
  };
}

module.exports = {
  MAX_BODY_SIZE,
  createApp,
  configFromEnv,
  normaliseHaBaseUrl,
  runtimeConfigFor,
  collectBody,
  isAllowedOrigin,
  isSafeIdentifier,
  parseIntent,
  defaultPortFor,
  resolveHaUrl,
  transportFor,
  handleUpgrade,
  writeDataFile,
  readDataFile,
  handlePlannerMutate,
};
