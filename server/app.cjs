/**
 * Abbai Flow backend — request handling.
 *
 * This module is deliberately CommonJS (`*.cjs`) so it can be loaded by
 * `node --test` here, where the root package.json declares
 * `"type": "module"`.
 *
 * Responsibilities:
 *  - serve the built SPA from ABBAI_FLOW_DIST
 *  - persist JSON documents under ABBAI_FLOW_DATA
 *
 * Everything is created by `createApp(options)` so tests can drive the real
 * handlers without touching global state.
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { randomBytes } = require('crypto');
const { handleMusicRequest } = require('./build/music-http.js');
const { SpotifyCatalog } = require('./build/spotify-catalog.js');
const { SpotifyPlaylistLibrary } = require('./build/spotify-playlists.js');
const { BluetoothManager, handleBluetoothRequest } = require('./build/bluetooth-runtime-bundle.js');
const { ChoresManStore, ChoresManStoreError } = require('./choresman-store.cjs');
const { ICloudRemindersWorker } = require('./icloud-reminders-worker.cjs');
const { prepareForecastUrl } = require('./open-meteo.cjs');
const { createScreenSaverPhotoLibrary } = require('./screensaver-photo-library.cjs');
const {
  WEATHER_MAPPING_KEYS,
  DEFAULT_WEATHER_MAPPING,
  createWeatherService,
  isValidPath,
  normalizeCustomUrl,
} = require('./weather-service.cjs');
const { createCaldavCalendarService } = require('./build/caldav-calendar-bundle.js');

/** Default request body limit (1 MiB) — matches the previous behaviour. */
const MAX_BODY_SIZE = 1024 * 1024;
const PHOTO_UPLOAD_BODY_SIZE = 9 * 1024 * 1024;
const REQUEST_BODY_TIMEOUT_MS = 30_000;

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
      req.resume();
      finish({ error: { status: 408, message: 'Request body timed out' } });
    }, REQUEST_BODY_TIMEOUT_MS);
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
 * another site can no longer drive state-changing endpoints against the app
 * server from a wall display's browser.
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
  // A missing Content-Type is tolerated for native and embedded browsers.
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
 * Persistent data API — stores JSON in ABBAI_FLOW_DATA across app restarts.
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
const DEFAULT_WEATHER_DATA_MAPPING = { ...DEFAULT_WEATHER_MAPPING };
const INTEGRATION_SETTING_KEYS = [
  'openMeteoUrl',
  'weatherApiUrl',
  'weatherApiKey',
  'weatherApiKeyMode',
  'weatherApiKeyParameter',
  'weatherDataMapping',
  'spotifyClientId',
  'spotifyClientSecret',
  'spotifyMarket',
  'spotifyRedirectUri',
  'mealSourceUrl',
  'mealSourceToken',
  'mealDataMapping',
  'icloudAppleId',
  'icloudPassword',
  'icloudRemindersListKey',
  'calendarSources',
];
const CALENDAR_PROVIDERS = new Set(['caldav', 'ics', 'google']);

function integrationSettingsPath(dataDir) {
  return path.join(dataDir, INTEGRATION_SETTINGS_FILE);
}

function hasObsoleteIntegrationSettings(dataDir) {
  try {
    const stored = JSON.parse(fs.readFileSync(integrationSettingsPath(dataDir), 'utf8'));
    return (
      stored &&
      typeof stored === 'object' &&
      !Array.isArray(stored) &&
      Object.keys(stored).some((key) => !INTEGRATION_SETTING_KEYS.includes(key))
    );
  } catch {
    return false;
  }
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
      weatherDataMapping: {
        ...DEFAULT_WEATHER_DATA_MAPPING,
        ...(stored.weatherDataMapping &&
        typeof stored.weatherDataMapping === 'object' &&
        !Array.isArray(stored.weatherDataMapping)
          ? Object.fromEntries(
              WEATHER_MAPPING_KEYS.filter((key) =>
                Object.prototype.hasOwnProperty.call(stored.weatherDataMapping, key),
              ).map((key) => [
                key,
                typeof stored.weatherDataMapping[key] === 'string'
                  ? stored.weatherDataMapping[key]
                  : DEFAULT_WEATHER_DATA_MAPPING[key],
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
    weatherApiUrl: 'weatherApiUrl',
    openMeteoUrl: 'openMeteoUrl',
    weatherApiKey: 'weatherApiKey',
    weatherApiKeyMode: 'weatherApiKeyMode',
    weatherApiKeyParameter: 'weatherApiKeyParameter',
    spotifyClientId: 'spotifyClientId',
    spotifyClientSecret: 'spotifyClientSecret',
    spotifyMarket: 'spotifyMarket',
    spotifyRedirectUri: 'spotifyRedirectUri',
    mealSourceUrl: 'mealSourceUrl',
    mealSourceToken: 'mealSourceToken',
    icloudAppleId: 'icloudAppleId',
    icloudPassword: 'icloudPassword',
    icloudRemindersListKey: 'icloudRemindersListKey',
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
  if (typeof next.icloudRemindersListKey === 'string') {
    next.icloudRemindersListKey = next.icloudRemindersListKey.trim();
  }
  if (patch.clearWeatherApiKey === true) next.weatherApiKey = '';
  if (patch.weatherApiKeyMode === 'query' || patch.weatherApiKeyMode === 'bearer') {
    next.weatherApiKeyMode = patch.weatherApiKeyMode;
  }
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
  if (patch.weatherDataMapping && typeof patch.weatherDataMapping === 'object') {
    next.weatherDataMapping = { ...current.weatherDataMapping };
    for (const key of WEATHER_MAPPING_KEYS) {
      if (typeof patch.weatherDataMapping[key] === 'string') {
        next.weatherDataMapping[key] = patch.weatherDataMapping[key].trim();
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
  if (settings.openMeteoUrl) {
    try {
      prepareForecastUrl(settings.openMeteoUrl);
    } catch (error) {
      return error instanceof Error ? error.message : 'Enter a valid Open-Meteo forecast URL.';
    }
  }
  if (settings.weatherApiUrl) {
    try {
      normalizeCustomUrl(settings.weatherApiUrl);
    } catch (error) {
      return error instanceof Error ? error.message : 'Enter a valid custom weather API URL.';
    }
    if (!settings.openMeteoUrl) {
      return 'Set an Open-Meteo URL to use as the default weather source and backup.';
    }
    if (!['query', 'bearer'].includes(settings.weatherApiKeyMode || 'query')) {
      return 'Choose query parameter or Bearer authentication for the custom weather API.';
    }
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(settings.weatherApiKeyParameter || 'apikey')) {
      return 'Enter a valid API key query parameter name.';
    }
  }
  const weatherDataMapping = settings.weatherDataMapping || DEFAULT_WEATHER_DATA_MAPPING;
  for (const key of WEATHER_MAPPING_KEYS) {
    const value = weatherDataMapping[key] || '';
    if (!isValidPath(value)) return `Weather data mapping has an invalid ${key} path.`;
  }
  if (settings.weatherApiUrl) {
    const requiredWeatherPaths = [
      'currentPath',
      'currentTemperaturePath',
      'currentConditionPath',
      'forecastPath',
      'forecastDatePath',
      'forecastConditionPath',
      'forecastHighPath',
      'forecastLowPath',
      'hourlyPath',
      'hourlyDateTimePath',
      'hourlyConditionPath',
      'hourlyTemperaturePath',
    ];
    if (requiredWeatherPaths.some((key) => !weatherDataMapping[key])) {
      return 'Custom weather mapping must include current, daily forecast, and hourly forecast paths.';
    }
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
        redirect.password ||
        redirect.hostname === 'localhost' ||
        (redirect.protocol === 'http:' &&
          redirect.hostname !== '127.0.0.1' &&
          redirect.hostname !== '[::1]')
      ) {
        return 'Use HTTPS or an explicit loopback IP address for the Spotify redirect URL.';
      }
    } catch {
      return 'Use HTTPS or an explicit loopback IP address for the Spotify redirect URL.';
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
  if (settings.icloudRemindersListKey && !/^[a-f0-9]{64}$/.test(settings.icloudRemindersListKey)) {
    return 'Choose a valid iCloud Reminders list.';
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
    openMeteoUrl: settings.openMeteoUrl || '',
    weatherApiUrl: settings.weatherApiUrl || '',
    weatherApiKeyConfigured: Boolean(settings.weatherApiKey),
    weatherApiKeyMode: settings.weatherApiKeyMode === 'bearer' ? 'bearer' : 'query',
    weatherApiKeyParameter: settings.weatherApiKeyParameter || 'apikey',
    weatherDataMapping: { ...DEFAULT_WEATHER_DATA_MAPPING, ...settings.weatherDataMapping },
    spotifyClientId: settings.spotifyClientId,
    spotifyClientSecretConfigured: Boolean(settings.spotifyClientSecret),
    spotifyMarket: settings.spotifyMarket,
    spotifyRedirectUri: settings.spotifyRedirectUri,
    mealSourceUrl: settings.mealSourceUrl,
    mealSourceTokenConfigured: Boolean(settings.mealSourceToken),
    mealDataMapping: { ...EMPTY_MEAL_DATA_MAPPING, ...settings.mealDataMapping },
    icloudAppleId: settings.icloudAppleId || '',
    icloudPasswordConfigured: Boolean(settings.icloudPassword),
    icloudRemindersListKey: settings.icloudRemindersListKey || '',
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

/**
 * Build the HTTP server.
 *
 * @param {object} options
 * @param {string} options.distDir      directory with the built SPA
 * @param {string} options.dataDir      directory for persisted JSON
 * @param {string[]} [options.allowedOrigins] extra allowed CORS origins
 */
function createApp(options) {
  const initialIntegrationSettings = {
    openMeteoUrl: '',
    weatherApiUrl: '',
    weatherApiKey: '',
    weatherApiKeyMode: 'query',
    weatherApiKeyParameter: 'apikey',
    weatherDataMapping: { ...DEFAULT_WEATHER_DATA_MAPPING },
    spotifyClientId: options.spotifyClientId || '',
    spotifyClientSecret: options.spotifyClientSecret || '',
    spotifyMarket: (options.spotifyMarket || 'NL').toUpperCase(),
    spotifyRedirectUri: options.spotifyRedirectUri || '',
    mealSourceUrl: '',
    mealSourceToken: '',
    mealDataMapping: { ...EMPTY_MEAL_DATA_MAPPING },
    icloudAppleId: '',
    icloudPassword: '',
    icloudRemindersListKey: '',
    calendarSources: [],
  };
  const config = {
    distDir: options.distDir,
    dataDir: options.dataDir,
    allowedOrigins: options.allowedOrigins || [],
    ...readIntegrationSettings(options.dataDir, initialIntegrationSettings),
  };
  if (hasObsoleteIntegrationSettings(options.dataDir)) {
    void writeIntegrationSettings(options.dataDir, config).catch(() => {
      console.warn('Could not remove obsolete integration settings.');
    });
  }

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
    caldavCalendars:
      options.caldavCalendars ||
      createCaldavCalendarService({ getSources: () => config.calendarSources }),
    weather: options.weather || createWeatherService(),
    screensaverPhotos:
      options.screensaverPhotos || createScreenSaverPhotoLibrary({ dataDir: options.dataDir }),
  };
  const verifySpotifyCatalog = () => services.spotifyCatalog.verifyCredentials();
  const verifySpotifyPlaylists = () => services.spotifyPlaylists.status();

  const server = http.createServer((req, res) => {
    void route(req, res, config, services, bluetooth);
  });
  if (config.icloudAppleId && config.icloudPassword) {
    const startedAt = Date.now();
    console.info('[iCloud Reminders] Startup authentication started.');
    void services.icloudReminders
      .authenticate(config.icloudAppleId, config.icloudPassword)
      .then((result) => {
        if (result?.ok) {
          console.info(
            `[iCloud Reminders] Startup authentication completed: state=${result.state || 'unknown'}, durationMs=${Date.now() - startedAt}.`,
          );
        } else {
          console.warn(
            `[iCloud Reminders] Startup authentication failed: code=${result?.errorCode || 'unknown'}, durationMs=${Date.now() - startedAt}.`,
          );
        }
      })
      .catch(() => {
        console.warn(
          `[iCloud Reminders] Startup authentication could not complete, durationMs=${Date.now() - startedAt}.`,
        );
      });
  } else {
    console.info(
      '[iCloud Reminders] Startup authentication skipped: saved credentials are missing.',
    );
  }
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

  server.on('close', () => {
    if (choresmanMaintenanceTimer) clearInterval(choresmanMaintenanceTimer);
    bluetooth.stop();
    services.icloudReminders.stop?.();
  });
  bluetooth.start();

  async function updateIntegrations(patch) {
    const next = mergeIntegrationSettings(config, patch);
    const validation = validateIntegrationSettings(next);
    if (validation) return { error: validation };

    const icloudCredentialsChanged =
      next.icloudAppleId !== config.icloudAppleId || next.icloudPassword !== config.icloudPassword;
    if (icloudCredentialsChanged) next.icloudRemindersListKey = '';

    try {
      await writeIntegrationSettings(config.dataDir, next);
    } catch {
      return { error: 'Could not save integration settings' };
    }

    const spotifySettingsChanged =
      next.spotifyClientId !== config.spotifyClientId ||
      next.spotifyClientSecret !== config.spotifyClientSecret ||
      next.spotifyMarket !== config.spotifyMarket ||
      next.spotifyRedirectUri !== config.spotifyRedirectUri;
    const spotifyCredentialsChanged =
      next.spotifyClientId !== config.spotifyClientId ||
      next.spotifyClientSecret !== config.spotifyClientSecret;
    if (spotifyCredentialsChanged) {
      try {
        await spotifyTokenStore.clear();
      } catch {
        console.warn('Could not clear the old Spotify authorization after credentials changed.');
      }
    }

    Object.assign(config, next);
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
  const { spotifyCatalog, spotifyPlaylists } = services;

  const isMutation = req.method !== 'GET' && req.method !== 'HEAD';
  // Every state-changing endpoint goes through the origin guard.
  const guarded =
    pathname.startsWith('/beacon-data/') ||
    pathname.startsWith('/abbai-flow/data/') ||
    pathname.startsWith('/abbai-flow/photos') ||
    pathname === '/abbai-flow/settings/integrations' ||
    pathname.startsWith('/abbai-flow/weather/') ||
    pathname === '/abbai-flow/calendars/test' ||
    pathname === '/abbai-flow/calendars/event' ||
    pathname.startsWith('/abbai-flow/settings/icloud-reminders') ||
    pathname.startsWith('/abbai-flow/music/control') ||
    pathname.startsWith('/abbai-flow/music/library/') ||
    pathname.startsWith('/abbai-flow/bluetooth/control') ||
    pathname === '/abbai-flow/choresman' ||
    url === '/api/planner/mutate';

  if (guarded && isMutation && !isAllowedOrigin(req, config.allowedOrigins)) {
    sendJson(res, 403, { error: 'Cross-origin request rejected' });
    return;
  }

  try {
    if (pathname === '/abbai-flow/photos') {
      if (req.method === 'GET') {
        sendJson(res, 200, { photos: await services.screensaverPhotos.list() }, {
          'Cache-Control': 'no-store',
        });
        return;
      }
      if (req.method === 'POST') {
        const { value, error } = await readJsonObject(req, PHOTO_UPLOAD_BODY_SIZE);
        if (error) {
          sendJson(res, error.status, { error: error.message });
          return;
        }
        try {
          const photo = await services.screensaverPhotos.add(value);
          sendJson(res, 201, { photo });
        } catch (err) {
          const status = err.status || 500;
          sendJson(res, status, {
            error: status >= 500 ? 'Could not save the uploaded photo.' : err.message,
          });
        }
        return;
      }
      sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });
      return;
    }
    if (pathname === '/abbai-flow/photos/delete') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
        return;
      }
      const { value, error } = await readJsonObject(req);
      if (error) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      try {
        const deletedCount = await services.screensaverPhotos.remove(value.ids);
        sendJson(res, 200, { deletedCount });
      } catch (err) {
        const status = err.status || 500;
        sendJson(res, status, {
          error: status >= 500 ? 'Could not delete the selected photos.' : err.message,
        });
      }
      return;
    }
    if (pathname.startsWith('/abbai-flow/photos/')) {
      const id = pathname.slice('/abbai-flow/photos/'.length);
      if (req.method === 'GET') {
        try {
          const bytes = await services.screensaverPhotos.read(id);
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': bytes.length,
            'Cache-Control': 'private, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(bytes);
        } catch (err) {
          const status = err.status || 500;
          sendJson(res, status, {
            error: status >= 500 ? 'Could not read the saved photo.' : err.message,
          });
        }
        return;
      }
      if (req.method === 'DELETE') {
        try {
          const deletedCount = await services.screensaverPhotos.remove([id]);
          sendJson(res, 200, { deletedCount });
        } catch (err) {
          const status = err.status || 500;
          sendJson(res, status, {
            error: status >= 500 ? 'Could not delete the photo.' : err.message,
          });
        }
        return;
      }
      sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, DELETE' });
      return;
    }
    if (pathname === '/abbai-flow/calendars') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
        return;
      }
      sendJson(res, 200, { calendars: await services.caldavCalendars.listCalendars() }, {
        'Cache-Control': 'no-store',
      });
      return;
    }
    if (pathname === '/abbai-flow/calendars/events') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
        return;
      }
      const parameters = new URL(url, 'http://abbai-flow.local').searchParams;
      const calendarId = parameters.get('calendarId') || '';
      const start = parameters.get('start') || '';
      const end = parameters.get('end') || '';
      if (!calendarId || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(start) >= Date.parse(end)) {
        sendJson(res, 400, { error: 'Choose a calendar and a valid event date range.' });
        return;
      }
      try {
        const events = await services.caldavCalendars.fetchEvents(calendarId, start, end);
        sendJson(res, 200, { events }, { 'Cache-Control': 'no-store' });
      } catch {
        sendJson(res, 502, { error: 'Could not retrieve events from the selected calendar.' }, {
          'Cache-Control': 'no-store',
        });
      }
      return;
    }
    if (pathname === '/abbai-flow/calendars/test') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
        return;
      }
      const { value, error } = await readJsonObject(req);
      if (error) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      const submitted = normalizeCalendarSources([value.source])[0];
      if (!submitted) {
        sendJson(res, 400, { error: 'Choose a calendar source.' });
        return;
      }
      if (submitted.provider === 'ics') {
        if (!submitted.url) {
          sendJson(res, 400, { error: 'Enter an ICS feed URL.' });
          return;
        }
        try {
          sendJson(res, 200, await services.caldavCalendars.testSource(submitted), {
            'Cache-Control': 'no-store',
          });
        } catch (error) {
          sendJson(res, 502, {
            error: error instanceof Error ? error.message : 'Could not retrieve the ICS feed.',
          }, {
            'Cache-Control': 'no-store',
          });
        }
        return;
      }
      if (submitted.provider !== 'caldav') {
        sendJson(res, 400, { error: 'Choose CalDAV or an ICS feed as the calendar source type.' });
        return;
      }
      const saved = config.calendarSources.find((item) => item.id === submitted.id);
      if (!submitted.password && !value.source?.clearPassword) {
        submitted.password = saved?.password || '';
      }
      if (!submitted.url || !submitted.username || !submitted.password) {
        sendJson(res, 400, { error: 'Enter the CalDAV server URL, username, and password.' });
        return;
      }
      try {
        sendJson(res, 200, await services.caldavCalendars.testSource(submitted), {
          'Cache-Control': 'no-store',
        });
      } catch {
        sendJson(res, 502, { error: 'Could not connect to that CalDAV account. Check the URL and credentials.' }, {
          'Cache-Control': 'no-store',
        });
      }
      return;
    }
    if (pathname === '/abbai-flow/calendars/event') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
        return;
      }
      const { value, error } = await readJsonObject(req);
      if (error) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      try {
        let result;
        if (value.operation === 'create') {
          result = await services.caldavCalendars.createEvent(value.calendarId, value.event);
        } else if (value.operation === 'update') {
          result = await services.caldavCalendars.updateEvent(
            value.calendarId,
            value.eventId,
            value.event,
          );
        } else if (value.operation === 'delete') {
          result = await services.caldavCalendars.deleteEvent(value.calendarId, value.eventId);
        } else {
          sendJson(res, 400, { error: 'Choose a supported calendar event operation.' });
          return;
        }
        sendJson(res, 200, result, { 'Cache-Control': 'no-store' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'CalDAV event change failed.';
        sendJson(res, 502, { error: message }, { 'Cache-Control': 'no-store' });
      }
      return;
    }
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
      if (req.method !== 'PUT') {
        sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, PUT' });
        return;
      }
      const { value, error } = await readJsonObject(req);
      if (error) {
        sendJson(res, error.status, { error: error.message });
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
    }
    if (pathname === '/abbai-flow/weather/forecast') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
        return;
      }
      try {
        const data = await services.weather.getForecast(config);
        sendJson(res, 200, data, { 'Cache-Control': 'no-store' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not retrieve weather data.';
        sendJson(res, 502, { error: message }, { 'Cache-Control': 'no-store' });
      }
      return;
    }
    if (pathname === '/abbai-flow/weather/test') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
        return;
      }
      const { value, error } = await readJsonObject(req);
      if (error) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      try {
        const settings = {
          ...config,
          openMeteoUrl: String(value.openMeteoUrl || ''),
          weatherApiUrl: String(value.weatherApiUrl || ''),
          weatherApiKey:
            typeof value.apiKey === 'string' && value.apiKey.trim()
              ? value.apiKey.trim()
              : config.weatherApiKey || '',
          weatherApiKeyMode:
            value.weatherApiKeyMode === 'bearer' ? 'bearer' : 'query',
          weatherApiKeyParameter: String(value.weatherApiKeyParameter || 'apikey'),
          weatherDataMapping:
            value.weatherDataMapping && typeof value.weatherDataMapping === 'object'
              ? value.weatherDataMapping
              : config.weatherDataMapping,
        };
        const result = await services.weather.test(settings);
        sendJson(res, 200, result, { 'Cache-Control': 'no-store' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not test the weather API settings.';
        sendJson(res, 502, { error: message }, { 'Cache-Control': 'no-store' });
      }
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
      } else if (pathname === '/abbai-flow/settings/icloud-reminders/lists') {
        result = await services.icloudReminders.listLists();
      } else if (pathname === '/abbai-flow/settings/icloud-reminders/fetch-preview') {
        result = await services.icloudReminders.fetchPreview(String(value.listKey || ''));
      } else if (pathname === '/abbai-flow/settings/icloud-reminders/fetch-list') {
        result = await services.icloudReminders.fetchList(
          String(value.listKey || ''),
          Number.isInteger(value.revision) ? value.revision : undefined,
        );
      } else if (pathname === '/abbai-flow/settings/icloud-reminders/task-lists') {
        result = await services.icloudReminders.fetchTaskLists(
          Array.isArray(value.listKeys) ? value.listKeys : [],
          value.revisions && typeof value.revisions === 'object' ? value.revisions : {},
        );
      } else if (pathname === '/abbai-flow/settings/icloud-reminders/create-reminder') {
        result = await services.icloudReminders.createReminder(value);
      } else if (pathname === '/abbai-flow/settings/icloud-reminders/update-reminder') {
        result = await services.icloudReminders.updateReminder(value);
      } else if (pathname === '/abbai-flow/settings/icloud-reminders/delete-reminder') {
        result = await services.icloudReminders.deleteReminder(value);
      } else if (pathname === '/abbai-flow/settings/icloud-reminders/move-section') {
        result = await services.icloudReminders.moveReminderSection(value);
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
      await handleMusicRequest(
        req,
        res,
        { sendJson, readJsonObject },
        spotifyCatalog,
        spotifyPlaylists,
      );
      return;
    }
    if (pathname.startsWith('/beacon-data/') || pathname.startsWith('/abbai-flow/data/')) {
      await handleDataApi(req, res, config);
      return;
    }
    if (url === '/runtime-config.js') {
      // Served dynamically, never cached, so deployment settings can change
      // without a hard refresh.
      const body = `window.__ABBAI_FLOW_CONFIG__ = ${JSON.stringify(runtimeConfigFor())};\n`;
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
      sendJson(res, 404, { error: 'API route not found' });
      return;
    }
    await serveStatic(req, res, config.distDir);
  } catch (err) {
    console.error('Unhandled request error:', err.message);
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

/** Runtime configuration for the browser, served at `/runtime-config.js`. */
function runtimeConfigFor(env = process.env) {
  const payload = {};

  const passThrough = {
    family_name: env.FAMILY_NAME,
    theme: env.THEME,
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
 * Read deployment configuration. Integration values are managed in Settings
 * and persisted in the data directory, not read from environment variables.
 *
 * Paths and the CSRF allow-list use `ABBAI_FLOW_*` names.
 * The pre-2.0 spelling of those variables is deliberately not accepted any
 * more: silently falling back to an old data path would split a household's
 * documents in two. `docs/upgrade-2.0.0.md` lists the rename.
 */
function configFromEnv(env = process.env) {
  return {
    distDir: env.ABBAI_FLOW_DIST || '/app/dist',
    dataDir: env.ABBAI_FLOW_DATA || '/data',
    bluetoothDbusAddress: env.ABBAI_FLOW_BLUETOOTH_DBUS_ADDRESS || '',
    allowedOrigins: (env.ABBAI_FLOW_ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

module.exports = {
  MAX_BODY_SIZE,
  createApp,
  configFromEnv,
  runtimeConfigFor,
  collectBody,
  isAllowedOrigin,
  writeDataFile,
  readDataFile,
  handlePlannerMutate,
};
