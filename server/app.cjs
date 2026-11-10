/**
 * Beacon backend — request handling.
 *
 * This module is deliberately CommonJS (`*.cjs`) so it can be started by the
 * add-on image (which has no package.json and therefore treats `.js` as CJS)
 * *and* loaded by `node --test` here, where the root package.json declares
 * `"type": "module"`.
 *
 * Responsibilities:
 *  - serve the built SPA from BEACON_DIST
 *  - proxy `/api/*` (REST) and `/api/websocket` (upgrade) to Home Assistant
 *  - bridge HA's WebSocket-only calendar commands
 *  - persist JSON documents under BEACON_DATA
 *
 * Everything is created by `createApp(options)` so tests can drive the real
 * handlers against a fake Home Assistant without touching global state.
 */

const http = require('http');
const https = require('https');
const fsp = require('fs/promises');
const path = require('path');
const { randomBytes } = require('crypto');
const WebSocket = require('ws');

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
 * Persistent data API — stores JSON in BEACON_DATA (survives add-on rebuilds).
 *
 * GET  /beacon-data/:key  → read stored JSON (`null` when absent)
 * PUT  /beacon-data/:key  → write JSON body to storage
 */
async function handleDataApi(req, res, config) {
  const key = req.url.replace('/beacon-data/', '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!key) {
    sendJson(res, 400, { error: 'Missing key' });
    return;
  }

  const filePath = path.join(config.dataDir, `${key}.json`);

  if (req.method === 'GET') {
    try {
      const data = await readDataFile(filePath);
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
 * (`shared/planner-rules.mjs`), serialises concurrent mutations per document and
 * writes the result atomically.
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

  const rules = await loadPlannerRules();

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

/** The shared rules are ESM; the server is CommonJS, so load them once. */
let plannerRulesPromise = null;
function loadPlannerRules() {
  if (!plannerRulesPromise) {
    plannerRulesPromise = import(
      pathToFileUrl(path.join(__dirname, '..', 'shared', 'planner-rules.mjs'))
    );
  }
  return plannerRulesPromise;
}

function pathToFileUrl(filePath) {
  return require('url').pathToFileURL(filePath).href;
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
  const config = {
    distDir: options.distDir,
    dataDir: options.dataDir,
    haToken: options.haToken || '',
    haBaseUrl: (options.haBaseUrl || 'http://supervisor/core').replace(/\/$/, ''),
    allowedOrigins: options.allowedOrigins || [],
    ca: options.ca,
    upgradeTimeoutMs: options.upgradeTimeoutMs || UPGRADE_TIMEOUT_MS,
  };
  config.haWsUrl =
    options.haWsUrl ||
    (() => {
      const url = new URL(config.haBaseUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = `${url.pathname.replace(/\/$/, '')}/api/websocket`;
      return url.toString();
    })();

  const server = http.createServer((req, res) => {
    void route(req, res, config);
  });

  server.on('upgrade', (req, socket, head) => {
    handleUpgrade(req, socket, head, config);
  });

  return { server, config };
}

async function route(req, res, config) {
  const url = req.url || '/';

  const isMutation = req.method !== 'GET' && req.method !== 'HEAD';
  // Every state-changing endpoint goes through the origin guard — including
  // the generic `/api/*` proxy, which carries the server-side HA token and can
  // call arbitrary services.
  const guarded =
    url === '/beacon-action/voice' ||
    url === '/beacon-action/service' ||
    url === '/beacon-action/calendar-event' ||
    url.startsWith('/beacon-data/') ||
    url.startsWith('/api/');

  if (guarded && isMutation && !isAllowedOrigin(req, config.allowedOrigins)) {
    sendJson(res, 403, { error: 'Cross-origin request rejected' });
    return;
  }

  try {
    if (url === '/beacon-action/voice') {
      await handleVoiceAction(req, res, config);
      return;
    }
    if (url === '/beacon-action/service') {
      await handleServiceCall(req, res, config);
      return;
    }
    if (url === '/beacon-action/calendar-event') {
      await handleCalendarEventAction(req, res, config);
      return;
    }
    if (url.startsWith('/beacon-data/')) {
      await handleDataApi(req, res, config);
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

/** Read configuration from the environment (what run.sh provides). */
function configFromEnv(env = process.env) {
  const haBaseUrl = (env.HA_API_BASE_OVERRIDE || 'http://supervisor/core').replace(/\/$/, '');
  return {
    distDir: env.BEACON_DIST || '/app/dist',
    dataDir: env.BEACON_DATA || '/data',
    haToken: env.HA_TOKEN || env.SUPERVISOR_TOKEN || '',
    haBaseUrl,
    haWsUrl: env.HA_WS_URL_OVERRIDE || undefined,
    allowedOrigins: (env.BEACON_ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    ca: env.BEACON_HA_CA || undefined,
  };
}

module.exports = {
  MAX_BODY_SIZE,
  createApp,
  configFromEnv,
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
