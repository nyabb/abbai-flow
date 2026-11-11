/**
 * Backend tests for the Abbai Flow server.
 *
 * Run with `npm run test:server` (node --test). These exercise the real
 * handlers from `server/app.cjs` against a fake Home Assistant, over both
 * HTTP and HTTPS, so the proxy/WS/security behaviour is covered without a
 * live HA installation.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const WebSocket = require('ws');

const {
  createApp,
  collectBody,
  defaultPortFor,
  isAllowedOrigin,
  isSafeIdentifier,
  parseIntent,
  readDataFile,
  resolveHaUrl,
  transportFor,
  writeDataFile,
} = require('../app.cjs');

const CERT = fs.readFileSync(path.join(__dirname, 'fixtures', 'test-cert.pem'));
const KEY = fs.readFileSync(path.join(__dirname, 'fixtures', 'test-key.pem'));

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `beacon-${prefix}-`));
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    server.close(() => resolve());
    // Sockets kept open by a WS pipe would otherwise hold the close.
    server.closeAllConnections?.();
  });
}

/** Start the Abbai Flow app on an ephemeral port. */
async function startBeacon(overrides = {}) {
  const distDir = overrides.distDir || tmpDir('dist');
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>beacon</title>');

  const { server } = createApp({
    distDir,
    dataDir: overrides.dataDir || tmpDir('data'),
    haToken: overrides.haToken ?? 'test-token',
    haBaseUrl: overrides.haBaseUrl,
    haWsUrl: overrides.haWsUrl,
    allowedOrigins: overrides.allowedOrigins,
    ca: overrides.ca,
  });
  const port = await listen(server);
  return { server, port, dataDir: overrides.dataDir, close: () => close(server) };
}

/** Minimal HTTP(S) request helper. */
function request(port, options = {}) {
  const { method = 'GET', path: requestPath = '/', body, headers = {}, secure = false } = options;

  return new Promise((resolve, reject) => {
    const payload =
      body === undefined
        ? null
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));

    const transport = secure ? https : http;
    const req = transport.request(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method,
        rejectUnauthorized: false,
        headers: {
          ...(payload ? { 'Content-Length': payload.length } : {}),
          ...(payload && !headers['Content-Type'] ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode, headers: res.headers, raw, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * A fake Home Assistant: records every REST request and optionally speaks the
 * WebSocket API (auth handshake + echo/result).
 */
async function startFakeHa({ secure = false, basePath = '' } = {}) {
  const requests = [];
  const handler = (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      });

      if (req.url.includes('explode')) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'boom' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, echoed: raw ? JSON.parse(raw) : null }));
    });
  };

  const server = secure
    ? https.createServer({ key: KEY, cert: CERT }, handler)
    : http.createServer(handler);

  const wss = new WebSocket.Server({ server, path: `${basePath}/api/websocket` });
  wss.on('connection', (socket, req) => {
    requests.push({ upgrade: true, url: req.url, headers: req.headers });
    socket.send(JSON.stringify({ type: 'auth_required' }));
    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf8'));
      if (msg.type === 'auth') {
        socket.send(JSON.stringify({ type: 'auth_ok', ha_version: 'test' }));
        return;
      }
      if (msg.type === 'test/echo') {
        socket.send(
          JSON.stringify({ id: msg.id, type: 'result', success: true, result: msg.payload }),
        );
        return;
      }
      if (msg.type === 'test/fail') {
        socket.send(
          JSON.stringify({
            id: msg.id,
            type: 'result',
            success: false,
            error: { code: 'not_supported', message: 'nope' },
          }),
        );
        return;
      }
      if (msg.type === 'calendar/event/create') {
        socket.send(
          JSON.stringify({ id: msg.id, type: 'result', success: true, result: msg.event }),
        );
      }
    });
  });

  const port = await listen(server);
  return {
    port,
    requests,
    baseUrl: `${secure ? 'https' : 'http'}://127.0.0.1:${port}${basePath}`,
    close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await close(server);
    },
  };
}

/** Open a WebSocket and resolve once it is open (messages are buffered). */
function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { rejectUnauthorized: false });
    socket.received = [];
    socket.on('message', (raw) => socket.received.push(JSON.parse(raw.toString('utf8'))));
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('WebSocket did not open in time'));
    }, 5000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Next JSON message, written as a promise over the buffered queue. */
function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (socket.received.length > 0) {
        resolve(socket.received.shift());
        return;
      }
      if (Date.now() - started > 5000) {
        reject(new Error('No message received'));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                      */
/* ------------------------------------------------------------------ */

test('URL helpers keep the configured base path', () => {
  assert.equal(
    resolveHaUrl('http://supervisor/core', '/api/states').toString(),
    'http://supervisor/core/api/states',
  );
  assert.equal(
    resolveHaUrl('http://ha.local:8123', '/api/states?x=1').toString(),
    'http://ha.local:8123/api/states?x=1',
  );
  assert.equal(
    resolveHaUrl('https://ha.example.com/', '/api/calendars/calendar.home').toString(),
    'https://ha.example.com/api/calendars/calendar.home',
  );
});

test('transport and default ports follow the protocol', () => {
  assert.equal(transportFor('http:'), http);
  assert.equal(transportFor('https:'), https);
  assert.equal(defaultPortFor('http:'), 80);
  assert.equal(defaultPortFor('https:'), 443);
});

test('identifier validation blocks path traversal', () => {
  for (const valid of ['light', 'turn_on', 'homeassistant', 'notify_2']) {
    assert.equal(isSafeIdentifier(valid), true, valid);
  }
  for (const invalid of ['../evil', 'a/b', '', ' ', 'light?x=1', 'li ght', null, undefined, 42]) {
    assert.equal(isSafeIdentifier(invalid), false, String(invalid));
  }
});

test('origin guard allows same-origin and native shells only', () => {
  const allowed = [];
  assert.equal(isAllowedOrigin({ headers: {} }, allowed), true);
  assert.equal(isAllowedOrigin({ headers: { origin: 'null' } }, allowed), true);
  assert.equal(
    isAllowedOrigin(
      { headers: { origin: 'http://beacon.local:3000', host: 'beacon.local:3000' } },
      allowed,
    ),
    true,
  );
  assert.equal(
    isAllowedOrigin(
      { headers: { origin: 'https://evil.example', host: 'beacon.local:3000' } },
      allowed,
    ),
    false,
  );
  assert.equal(
    isAllowedOrigin(
      { headers: { origin: 'capacitor://localhost', host: 'beacon.local:3000' } },
      allowed,
    ),
    true,
  );
  assert.equal(
    isAllowedOrigin({ headers: { origin: 'https://tablet.example', host: 'beacon.local:3000' } }, [
      'https://tablet.example',
    ]),
    true,
  );
});

test('collectBody enforces the size limit without hanging', async () => {
  const small = new PassThrough();
  const smallResult = collectBody(small, 32);
  small.end(Buffer.from('{"a":1}'));
  const okBody = await smallResult;
  assert.equal(okBody.body.toString('utf8'), '{"a":1}');

  const big = new PassThrough();
  const bigResult = collectBody(big, 8);
  big.write(Buffer.alloc(64, 0x61));
  const errBody = await bigResult;
  assert.equal(errBody.error.status, 413);
});

test('intent parser still understands the documented phrases', () => {
  assert.equal(parseIntent('add milk to the grocery list').domain, 'todo');
  assert.equal(parseIntent('what is the weather').fetch, 'weather');
  assert.equal(parseIntent('go to calendar').navigation, true);
  assert.equal(parseIntent('gibberish nonsense'), null);
});

test('documents are written atomically and corrupt files are reported', async () => {
  const dir = tmpDir('atomic');
  const file = path.join(dir, 'family.json');

  await writeDataFile(file, '{"version":2}');
  assert.deepEqual(await readDataFile(file), { version: 2 });
  const leftovers = fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'no temporary files must be left behind');

  await writeDataFile(file, '{"version":3}');
  assert.deepEqual(await readDataFile(file), { version: 3 });

  fs.writeFileSync(file, '{broken');
  await assert.rejects(() => readDataFile(file), /corrupt/i);
});

/* ------------------------------------------------------------------ */
/*  Endpoints                                                         */
/* ------------------------------------------------------------------ */

test('persisted data API round-trips, rejects bad payloads and hides corruption', async (t) => {
  const dataDir = tmpDir('api-data');
  const beacon = await startBeacon({ dataDir, haBaseUrl: 'http://127.0.0.1:1' });
  t.after(() => beacon.close());

  const empty = await request(beacon.port, { path: '/beacon-data/family' });
  assert.equal(empty.status, 200);
  assert.equal(empty.json, null);
  assert.equal(empty.headers['cache-control'], 'no-store');

  const put = await request(beacon.port, {
    method: 'PUT',
    path: '/beacon-data/family',
    body: { name: 'Sachshaus' },
  });
  assert.equal(put.status, 200);
  assert.deepEqual(put.json, { ok: true });

  const read = await request(beacon.port, { path: '/beacon-data/family' });
  assert.deepEqual(read.json, { name: 'Sachshaus' });

  const invalid = await request(beacon.port, {
    method: 'PUT',
    path: '/beacon-data/family',
    body: '{not json',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(invalid.status, 400);

  const wrongMethod = await request(beacon.port, { method: 'DELETE', path: '/beacon-data/family' });
  assert.equal(wrongMethod.status, 405);

  // A corrupt document must surface as an error, never as a silent success.
  fs.writeFileSync(path.join(dataDir, 'broken.json'), '{oops');
  const corrupt = await request(beacon.port, { path: '/beacon-data/broken' });
  assert.equal(corrupt.status, 500);
  assert.match(corrupt.json.error, /corrupt/i);
});

test('data API rejects oversized documents', async (t) => {
  const beacon = await startBeacon({ haBaseUrl: 'http://127.0.0.1:1' });
  t.after(() => beacon.close());

  const big = 'x'.repeat(1024 * 1024 + 64);
  const res = await request(beacon.port, {
    method: 'PUT',
    path: '/beacon-data/huge',
    body: JSON.stringify({ blob: big }),
  });
  assert.equal(res.status, 413);
});

test('service bridge validates input and forwards to Home Assistant', async (t) => {
  const ha = await startFakeHa();
  t.after(() => ha.close());
  const beacon = await startBeacon({ haBaseUrl: ha.baseUrl });
  t.after(() => beacon.close());

  const get = await request(beacon.port, { path: '/beacon-action/service' });
  assert.equal(get.status, 405);

  const traversal = await request(beacon.port, {
    method: 'POST',
    path: '/beacon-action/service',
    body: { domain: '../evil', service: 'run' },
  });
  assert.equal(traversal.status, 400);

  const wrongType = await request(beacon.port, {
    method: 'POST',
    path: '/beacon-action/service',
    body: { domain: 'light', service: 'turn_on' },
    headers: { 'Content-Type': 'text/plain' },
  });
  assert.equal(wrongType.status, 415);

  const crossOrigin = await request(beacon.port, {
    method: 'POST',
    path: '/beacon-action/service',
    body: { domain: 'light', service: 'turn_on' },
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(crossOrigin.status, 403);

  const ok = await request(beacon.port, {
    method: 'POST',
    path: '/beacon-action/service',
    body: {
      domain: 'light',
      service: 'turn_on',
      data: { entity_id: 'light.kitchen' },
      return_response: true,
    },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);

  const forwarded = ha.requests.at(-1);
  assert.equal(forwarded.url, '/api/services/light/turn_on?return_response');
  assert.equal(forwarded.headers.authorization, 'Bearer test-token');
  assert.deepEqual(forwarded.body, { entity_id: 'light.kitchen' });

  const failing = await request(beacon.port, {
    method: 'POST',
    path: '/beacon-action/service',
    body: { domain: 'light', service: 'explode' },
  });
  assert.equal(failing.status, 500, 'HA status codes are passed through');
});

test('api proxy forwards the token and reports a missing token', async (t) => {
  const ha = await startFakeHa();
  t.after(() => ha.close());

  const beacon = await startBeacon({ haBaseUrl: ha.baseUrl });
  t.after(() => beacon.close());

  const res = await request(beacon.port, { path: '/api/states' });
  assert.equal(res.status, 200);
  const forwarded = ha.requests.at(-1);
  assert.equal(forwarded.url, '/api/states');
  assert.equal(forwarded.headers.authorization, 'Bearer test-token');

  const noToken = await startBeacon({ haBaseUrl: ha.baseUrl, haToken: '' });
  t.after(() => noToken.close());
  const denied = await request(noToken.port, { path: '/api/states' });
  assert.equal(denied.status, 503);
});

/* ------------------------------------------------------------------ */
/*  WebSocket proxy — both protocols                                  */
/* ------------------------------------------------------------------ */

test('websocket proxy upgrades over plain HTTP', async (t) => {
  const ha = await startFakeHa();
  t.after(() => ha.close());
  const beacon = await startBeacon({ haBaseUrl: ha.baseUrl });
  t.after(() => beacon.close());

  const socket = await openSocket(`ws://127.0.0.1:${beacon.port}/api/websocket`);
  t.after(() => socket.terminate());

  const required = await nextMessage(socket);
  assert.equal(required.type, 'auth_required');

  socket.send(JSON.stringify({ type: 'auth', access_token: 'test-token' }));
  const authOk = await nextMessage(socket);
  assert.equal(authOk.type, 'auth_ok');

  socket.send(JSON.stringify({ id: 7, type: 'test/echo', payload: { hello: 'world' } }));
  const result = await nextMessage(socket);
  assert.deepEqual(result.result, { hello: 'world' });
});

test('websocket proxy upgrades over HTTPS with a base path', async (t) => {
  const ha = await startFakeHa({ secure: true, basePath: '/core' });
  t.after(() => ha.close());
  const beacon = await startBeacon({ haBaseUrl: ha.baseUrl, ca: CERT.toString() });
  t.after(() => beacon.close());

  const socket = await openSocket(`ws://127.0.0.1:${beacon.port}/api/websocket`);
  t.after(() => socket.terminate());

  const required = await nextMessage(socket);
  assert.equal(required.type, 'auth_required');

  socket.send(JSON.stringify({ type: 'auth', access_token: 'test-token' }));
  assert.equal((await nextMessage(socket)).type, 'auth_ok');

  socket.send(JSON.stringify({ id: 9, type: 'test/echo', payload: 'secure' }));
  assert.equal((await nextMessage(socket)).result, 'secure');

  const upgrade = ha.requests.find((entry) => entry.upgrade);
  assert.equal(upgrade.url, '/core/api/websocket', 'TLS + base path must be preserved');
  assert.equal(upgrade.headers.upgrade, 'websocket');
  assert.equal(upgrade.headers.cookie, undefined, 'browser cookies must not be forwarded');
});

test('websocket upgrade is refused without a token', async (t) => {
  const ha = await startFakeHa();
  t.after(() => ha.close());
  const beacon = await startBeacon({ haBaseUrl: ha.baseUrl, haToken: '' });
  t.after(() => beacon.close());

  await assert.rejects(() => openSocket(`ws://127.0.0.1:${beacon.port}/api/websocket`));
});

test('calendar bridge maps results and not-supported errors', async (t) => {
  const ha = await startFakeHa();
  t.after(() => ha.close());
  const beacon = await startBeacon({ haBaseUrl: ha.baseUrl });
  t.after(() => beacon.close());

  const created = await request(beacon.port, {
    method: 'POST',
    path: '/beacon-action/calendar-event',
    body: { op: 'create', entity_id: 'calendar.home', event: { summary: 'Dentist' } },
  });
  assert.equal(created.status, 200);
  assert.equal(created.json.ok, true);
  assert.deepEqual(created.json.result, { summary: 'Dentist' });

  const missingUid = await request(beacon.port, {
    method: 'POST',
    path: '/beacon-action/calendar-event',
    body: { op: 'delete', entity_id: 'calendar.home' },
  });
  assert.equal(missingUid.status, 400);

  const badOp = await request(beacon.port, {
    method: 'POST',
    path: '/beacon-action/calendar-event',
    body: { op: 'explode', entity_id: 'calendar.home' },
  });
  assert.equal(badOp.status, 400);
});
