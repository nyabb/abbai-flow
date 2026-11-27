/**
 * Backend tests for the Abbai Flow server.
 *
 * Run with `npm run test:server` (node --test). These exercise the real
 * handlers from `server/app.cjs` over HTTP, including persistence and security.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const {
  createApp,
  collectBody,
  configFromEnv,
  isAllowedOrigin,
  readDataFile,
  runtimeConfigFor,
  writeDataFile,
} = require('../app.cjs');
const { ICloudRemindersWorker } = require('../icloud-reminders-worker.cjs');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `abbai-flow-${prefix}-`));
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
    server.closeAllConnections?.();
  });
}

/** Start the Abbai Flow app on an ephemeral port. */
async function startApp(overrides = {}) {
  const distDir = overrides.distDir || tmpDir('dist');
  const dataDir = overrides.dataDir || tmpDir('data');
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>Abbai Flow</title>');

  const { server } = createApp({
    distDir,
    dataDir,
    spotifyClientId: overrides.spotifyClientId,
    spotifyClientSecret: overrides.spotifyClientSecret,
    spotifyMarket: overrides.spotifyMarket,
    spotifyRedirectUri: overrides.spotifyRedirectUri,
    allowedOrigins: overrides.allowedOrigins,
    spotifyPlaylists: overrides.spotifyPlaylists,
    icloudReminders: overrides.icloudReminders,
    caldavCalendars: overrides.caldavCalendars,
    bluetooth: overrides.bluetooth,
    bluetoothDbusAddress: overrides.bluetoothDbusAddress,
  });
  const port = await listen(server);
  return { server, port, dataDir, close: () => close(server) };
}

/** Minimal HTTP(S) request helper. */
function request(port, options = {}) {
  const { method = 'GET', path: requestPath = '/', body, headers = {} } = options;

  return new Promise((resolve, reject) => {
    const payload =
      body === undefined
        ? null
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));

    const req = http.request(
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

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                      */
/* ------------------------------------------------------------------ */

test('origin guard allows same-origin and native shells only', () => {
  const allowed = [];
  assert.equal(isAllowedOrigin({ headers: {} }, allowed), true);
  assert.equal(isAllowedOrigin({ headers: { origin: 'null' } }, allowed), true);
  assert.equal(
    isAllowedOrigin(
      { headers: { origin: 'http://abbai-flow.local:3000', host: 'abbai-flow.local:3000' } },
      allowed,
    ),
    true,
  );
  assert.equal(
    isAllowedOrigin(
      { headers: { origin: 'https://evil.example', host: 'abbai-flow.local:3000' } },
      allowed,
    ),
    false,
  );
  assert.equal(
    isAllowedOrigin(
      { headers: { origin: 'capacitor://localhost', host: 'abbai-flow.local:3000' } },
      allowed,
    ),
    true,
  );
  assert.equal(
    isAllowedOrigin({ headers: { origin: 'https://tablet.example', host: 'abbai-flow.local:3000' } }, [
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
  const app = await startApp({ dataDir });
  t.after(() => app.close());

  const empty = await request(app.port, { path: '/abbai-flow/data/family' });
  assert.equal(empty.status, 200);
  assert.equal(empty.json, null);
  assert.equal(empty.headers['cache-control'], 'no-store');

  const put = await request(app.port, {
    method: 'PUT',
    path: '/abbai-flow/data/family',
    body: { name: 'Sachshaus' },
  });
  assert.equal(put.status, 200);
  assert.deepEqual(put.json, { ok: true });

  const read = await request(app.port, { path: '/abbai-flow/data/family' });
  assert.deepEqual(read.json, { name: 'Sachshaus' });

  const invalid = await request(app.port, {
    method: 'PUT',
    path: '/abbai-flow/data/family',
    body: '{not json',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(invalid.status, 400);

  const wrongMethod = await request(app.port, { method: 'DELETE', path: '/abbai-flow/data/family' });
  assert.equal(wrongMethod.status, 405);

  // A corrupt document must surface as an error, never as a silent success.
  fs.writeFileSync(path.join(dataDir, 'broken.json'), '{oops');
  const corrupt = await request(app.port, { path: '/abbai-flow/data/broken' });
  assert.equal(corrupt.status, 500);
  assert.match(corrupt.json.error, /corrupt/i);
});

test('data API rejects oversized documents', async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const big = 'x'.repeat(1024 * 1024 + 64);
  const res = await request(app.port, {
    method: 'PUT',
    path: '/abbai-flow/data/huge',
    body: JSON.stringify({ blob: big }),
  });
  assert.equal(res.status, 413);
});

test('integration settings redact secrets and persist saved values across restarts', async (t) => {
  const dataDir = tmpDir('integration-settings');
  const legacy = {
    dataDir,
    spotifyClientId: 'legacy-client-id',
    spotifyClientSecret: 'legacy-client-secret',
    spotifyMarket: 'NL',
    spotifyRedirectUri: 'https://abbai.example/old-callback',
  };
  const app = await startApp(legacy);
  t.after(() => app.close());

  const initial = await request(app.port, { path: '/abbai-flow/settings/integrations' });
  assert.equal(initial.status, 200);
  assert.equal(initial.headers['cache-control'], 'no-store');
  assert.equal(initial.json.spotifyClientSecretConfigured, true);
  assert.equal(initial.json.spotifyClientId, 'legacy-client-id');
  assert.doesNotMatch(JSON.stringify(initial.json), /legacy-client-secret/);

  const saved = await request(app.port, {
    method: 'PUT',
    path: '/abbai-flow/settings/integrations',
    body: {
      spotifyClientId: 'new-client-id',
      spotifyClientSecret: 'new-client-secret',
      spotifyMarket: 'us',
      spotifyRedirectUri: 'https://abbai.example/abbai-flow/music/oauth/callback',
      icloudRemindersListKey: 'b'.repeat(64),
      mealSourceUrl: 'https://food.example/api/recipes',
      mealSourceToken: 'meal-source-secret',
      mealDataMapping: {
        itemsPath: '$.data.recipes',
        idPath: '$.id',
        titlePath: '$.name',
        imagePath: '$.photo.url',
        ingredientsPath: '$.ingredients[]',
        stepsPath: '$.instructions[].text',
        tagsPath: '$.tags[]',
        datePath: '$.dinner_date',
        sourceUrlPath: '$.url',
      },
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.spotifyClientId, 'new-client-id');
  assert.equal(saved.json.spotifyMarket, 'US');
  assert.equal(saved.json.spotifyClientSecretConfigured, true);
  assert.equal(saved.json.icloudRemindersListKey, 'b'.repeat(64));
  assert.equal(saved.json.mealSourceUrl, 'https://food.example/api/recipes');
  assert.equal(saved.json.mealSourceTokenConfigured, true);
  assert.equal(saved.json.mealDataMapping.stepsPath, '$.instructions[].text');
  assert.doesNotMatch(
    JSON.stringify(saved.json),
    /new-client-secret|meal-source-secret/,
  );

  const invalidMapping = await request(app.port, {
    method: 'PUT',
    path: '/abbai-flow/settings/integrations',
    body: { mealDataMapping: { stepsPath: '$.instructions[?(@.done)]' } },
  });
  assert.equal(invalidMapping.status, 400);

  const invalidMealUrl = await request(app.port, {
    method: 'PUT',
    path: '/abbai-flow/settings/integrations',
    body: { mealSourceUrl: 'file:///etc/passwd' },
  });
  assert.equal(invalidMealUrl.status, 400);

  const settingsPath = path.join(dataDir, 'integration-settings.json');
  const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(persisted.spotifyClientSecret, 'new-client-secret');
  assert.equal(persisted.mealSourceToken, 'meal-source-secret');
  assert.equal(persisted.mealDataMapping.itemsPath, '$.data.recipes');
  assert.equal(persisted.icloudRemindersListKey, 'b'.repeat(64));
  assert.equal(fs.statSync(settingsPath).mode & 0o777, 0o600);

  const restarted = await startApp(legacy);
  t.after(() => restarted.close());
  const afterRestart = await request(restarted.port, { path: '/abbai-flow/settings/integrations' });
  assert.equal(afterRestart.status, 200);
  assert.equal(afterRestart.json.spotifyClientId, 'new-client-id');
  assert.equal(afterRestart.json.spotifyMarket, 'US');
  assert.equal(afterRestart.json.spotifyClientSecretConfigured, true);
  assert.equal(afterRestart.json.icloudRemindersListKey, 'b'.repeat(64));
  assert.equal(afterRestart.json.mealSourceUrl, 'https://food.example/api/recipes');
  assert.equal(afterRestart.json.mealSourceTokenConfigured, true);
  assert.equal(afterRestart.json.mealDataMapping.titlePath, '$.name');

  const cleared = await request(restarted.port, {
    method: 'PUT',
    path: '/abbai-flow/settings/integrations',
    body: { clearMealSourceToken: true },
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.mealSourceTokenConfigured, false);
  assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).mealSourceToken, '');
});

test('integration settings report the current iCloud authentication state', async (t) => {
  const state = {
    state: 'disconnected',
    devices: [],
    securityKeyNames: [],
  };
  let requestedListKey = '';
  const icloudReminders = {
    status: () => ({ ...state }),
    authenticate: async () => {
      state.state = 'authenticated';
      return { ok: true, state: state.state };
    },
    listLists: async () => ({
      ok: true,
      state: 'authenticated',
      listCount: 1,
      lists: [
        {
          key: 'a'.repeat(64),
          title: 'Shopping',
          scope: 'private',
          deleted: false,
          isGroup: false,
          count: 3,
        },
      ],
    }),
    fetchPreview: async (listKey) => {
      requestedListKey = listKey;
      return { ok: true, state: 'fetched', lists: [] };
    },
    fetchTaskLists: async (listKeys, revisions) => ({
      ok: true,
      state: 'unchanged',
      changed: false,
      listKeys,
      revisions,
    }),
    stop() {},
  };
  const app = await startApp({ icloudReminders });
  t.after(() => app.close());

  const initial = await request(app.port, { path: '/abbai-flow/settings/integrations' });
  assert.equal(initial.json.icloudAuthState, 'disconnected');
  assert.deepEqual(initial.json.icloudDevices, []);
  assert.deepEqual(initial.json.icloudSecurityKeyNames, []);

  const authenticated = await request(app.port, {
    method: 'POST',
    path: '/abbai-flow/settings/icloud-reminders/authenticate',
    body: {},
  });
  assert.equal(authenticated.status, 200);

  const afterAuthentication = await request(app.port, {
    path: '/abbai-flow/settings/integrations',
  });
  assert.equal(afterAuthentication.json.icloudAuthState, 'authenticated');

  const lists = await request(app.port, {
    method: 'POST',
    path: '/abbai-flow/settings/icloud-reminders/lists',
    body: {},
  });
  assert.equal(lists.status, 200);
  assert.equal(lists.json.lists[0].title, 'Shopping');

  const preview = await request(app.port, {
    method: 'POST',
    path: '/abbai-flow/settings/icloud-reminders/fetch-preview',
    body: { listKey: 'a'.repeat(64) },
  });
  assert.equal(preview.status, 200);
  assert.equal(requestedListKey, 'a'.repeat(64));

  const taskLists = await request(app.port, {
    method: 'POST',
    path: '/abbai-flow/settings/icloud-reminders/task-lists',
    body: { listKeys: ['a'.repeat(64)], revisions: { ['a'.repeat(64)]: 17 } },
  });
  assert.equal(taskLists.status, 200);
  assert.deepEqual(taskLists.json.revisions, { ['a'.repeat(64)]: 17 });
});

test('saved iCloud credentials are authenticated at server startup', async (t) => {
  const dataDir = tmpDir('icloud-startup-auth');
  fs.writeFileSync(
    path.join(dataDir, 'integration-settings.json'),
    JSON.stringify({ icloudAppleId: 'example@icloud.com', icloudPassword: 'stored-test-password' }),
  );
  let credentials;
  const icloudReminders = {
    authenticate: async (appleId, password) => {
      credentials = [appleId, password];
      return { ok: true, state: 'authenticated' };
    },
    status: () => ({ state: 'disconnected', devices: [], securityKeyNames: [] }),
    stop() {},
  };
  const app = await startApp({ dataDir, icloudReminders });
  t.after(() => app.close());

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(credentials, ['example@icloud.com', 'stored-test-password']);
});

test('iCloud worker retains safe authentication status between requests', () => {
  const worker = new ICloudRemindersWorker({ dataDir: tmpDir('icloud-status') });
  assert.deepEqual(worker.status(), {
    state: 'disconnected',
    devices: [],
    securityKeyNames: [],
  });

  const sendResponse = (response, action) => {
    const timeout = setTimeout(() => {}, 10000);
    worker.pending.set(response.requestId, {
      resolve() {},
      reject() {},
      timeout,
      action,
    });
    worker.onLine(JSON.stringify(response));
  };

  sendResponse({
    requestId: 'challenge',
    ok: true,
    state: 'device_selection_required',
    devices: [{ index: 0, name: 'Trusted phone' }],
  }, 'request_2sa_code');
  assert.deepEqual(worker.status(), {
    state: 'device_selection_required',
    devices: [{ index: 0, name: 'Trusted phone' }],
    securityKeyNames: [],
  });

  sendResponse({ requestId: 'verified', ok: true, state: 'authenticated' }, 'verify_code');
  assert.deepEqual(worker.status(), {
    state: 'authenticated',
    devices: [],
    securityKeyNames: [],
  });

  sendResponse({ requestId: 'reset', ok: true, state: 'disconnected' }, 'reset');
  assert.equal(worker.status().state, 'disconnected');
});

test('iCloud worker logs only reminder mutations', () => {
  const worker = new ICloudRemindersWorker({ dataDir: tmpDir('icloud-logs') });
  const logged = [];
  const originalInfo = console.info;
  console.info = (line) => logged.push(line);
  try {
    worker.onWorkerLog(JSON.stringify({
      service: 'pyicloud-reminders',
      event: 'worker_started',
      pyicloud_available: true,
    }));
    worker.onWorkerLog(JSON.stringify({
      service: 'pyicloud-reminders',
      event: 'request_finished',
      action: 'fetch_task_lists',
      ok: true,
      list_count: 8,
    }));
    worker.onWorkerLog(JSON.stringify({
      service: 'pyicloud-reminders',
      event: 'cloudkit_response_inspected',
      operation: 'records/modify',
      records: [{ title: 'private reminder text' }],
    }));
    worker.onWorkerLog(JSON.stringify({
      service: 'pyicloud-reminders',
      event: 'request_finished',
      action: 'move_reminder_section',
      request_id: 'req-123',
      ok: false,
      error_code: 'icloud_section_update_failed',
      failure_stage: 'list_record_update',
      apple_error_code: 'CONFLICT',
      http_status: 409,
      partial: true,
      reminder_id: 'must-not-be-logged',
      response_body: 'must-not-be-logged',
      duration_ms: 120,
    }));
  } finally {
    console.info = originalInfo;
  }

  assert.equal(logged.length, 1);
  assert.match(logged[0], /"action":"move_reminder_section"/);
  assert.match(logged[0], /"failure_stage":"list_record_update"/);
  assert.match(logged[0], /"apple_error_code":"CONFLICT"/);
  assert.match(logged[0], /"partial":true/);
  assert.doesNotMatch(logged[0], /private reminder text/);
  assert.doesNotMatch(logged[0], /must-not-be-logged/);
});

test('calendar catalog returns calendars discovered by the CalDAV service', async (t) => {
  const calendars = [{ id: 'caldav/source/family', name: 'Family', sourceId: 'source' }];
  let listCallCount = 0;
  const listCalendars = async () => {
    listCallCount += 1;
    return calendars;
  };
  const app = await startApp({ caldavCalendars: { listCalendars } });
  t.after(() => app.close());

  const response = await request(app.port, { path: '/abbai-flow/calendars' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json.calendars, calendars);
  assert.equal(listCallCount, 1);
});

/* ------------------------------------------------------------------ */
/*  Planner middle layer (/api/planner/mutate)                        */
/* ------------------------------------------------------------------ */

test('planner mutate applies an operation and writes the document', async (t) => {
  const app = await startApp({});
  t.after(() => app.close());

  const applied = await request(app.port, {
    method: 'POST',
    path: '/api/planner/mutate',
    body: {
      target: 'meta',
      key: 'op-1',
      op: { type: 'upsertRoutine', name: 'Morning' },
    },
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.json.changed, true);
  assert.equal(applied.json.duplicate, false);
  assert.equal(applied.json.result.name, 'Morning');

  const stored = await request(app.port, { path: '/abbai-flow/data/abbai-flow-planner-meta' });
  assert.equal(stored.status, 200);
  assert.deepEqual(
    stored.json.routines.map((routine) => routine.name),
    ['Morning'],
  );
});

test('planner mutate replays an idempotency key instead of applying twice', async (t) => {
  const app = await startApp({});
  t.after(() => app.close());

  const op = {
    target: 'redemptions',
    key: 'points-once',
    op: { type: 'addPoints', user: 'Ada', reward: 'Cinema', cost: 100, amount: 30 },
  };

  const first = await request(app.port, {
    method: 'POST',
    path: '/api/planner/mutate',
    body: op,
  });
  assert.equal(first.status, 200);
  assert.equal(first.json.changed, true);

  const replay = await request(app.port, {
    method: 'POST',
    path: '/api/planner/mutate',
    body: op,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.changed, false);
  assert.equal(replay.json.duplicate, true);

  const stored = await request(app.port, { path: '/abbai-flow/data/abbai-flow-reward-redemptions' });
  assert.equal(stored.json.length, 1);
  assert.equal(stored.json[0].points, 30);
});

test('planner mutate rejects malformed requests without writing', async (t) => {
  const app = await startApp({});
  t.after(() => app.close());

  const unknownTarget = await request(app.port, {
    method: 'POST',
    path: '/api/planner/mutate',
    body: { target: 'nope', key: 'k1', op: { type: 'upsertRoutine', name: 'X' } },
  });
  assert.equal(unknownTarget.status, 400);

  const missingKey = await request(app.port, {
    method: 'POST',
    path: '/api/planner/mutate',
    body: { target: 'meta', op: { type: 'upsertRoutine', name: 'X' } },
  });
  assert.equal(missingKey.status, 400);

  const missingOp = await request(app.port, {
    method: 'POST',
    path: '/api/planner/mutate',
    body: { target: 'meta', key: 'k2' },
  });
  assert.equal(missingOp.status, 400);

  // An operation the rules do not know must fail loudly, not look like a no-op.
  const unknownOp = await request(app.port, {
    method: 'POST',
    path: '/api/planner/mutate',
    body: { target: 'meta', key: 'k3', op: { type: 'explode' } },
  });
  assert.equal(unknownOp.status, 400);

  const wrongMethod = await request(app.port, { method: 'GET', path: '/api/planner/mutate' });
  assert.equal(wrongMethod.status, 405);

  const stored = await request(app.port, { path: '/abbai-flow/data/abbai-flow-planner-meta' });
  assert.ok(stored.json === null || !stored.json.routines || stored.json.routines.length === 0);
});

test('ChoresMan serves and persists local chores', async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const initial = await request(app.port, { path: '/abbai-flow/choresman' });
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.json.snapshot.members, []);

  const sync = await request(app.port, {
    method: 'POST',
    path: '/abbai-flow/choresman',
    body: {
      action: 'family.sync_members',
      data: {
        members: [
          { id: 'local-member-1', name: 'Maya', role: 'child', avatar: '👧', color: '#22c55e' },
        ],
      },
    },
  });
  assert.equal(sync.status, 200);
  assert.equal(sync.json.snapshot.members[0].name, 'Maya');

  const created = await request(app.port, {
    method: 'POST',
    path: '/abbai-flow/choresman',
    body: {
      action: 'choresman.create_chore',
      data: {
        name: 'Water plants',
        assigned_user_names: ['Maya'],
        frequency: 'daily',
        points: 3,
      },
    },
  });
  assert.equal(created.status, 200);
  assert.equal(created.json.snapshot.chores[0].name, 'Water plants');
  assert.equal(created.json.snapshot.chores[0].assigned_user_names[0], 'Maya');

  const stored = JSON.parse(fs.readFileSync(path.join(app.dataDir, 'choresman.json'), 'utf8'));
  assert.equal(stored.chores[0].name, 'Water plants');
  assert.equal(stored.members[0].id, 'local-member-1');
  assert.equal(stored.members[0].family_member_id, 'local-member-1');

  const rejected = await request(app.port, {
    method: 'POST',
    path: '/abbai-flow/choresman',
    headers: { Origin: 'https://untrusted.example' },
    body: { action: 'family.sync_members', data: { members: [] } },
  });
  assert.equal(rejected.status, 403);
});

/* ------------------------------------------------------------------ */
/*  Integration settings are persisted in /data, not container env        */
/* ------------------------------------------------------------------ */

test('configFromEnv reads deployment settings, not integration credentials', () => {
  const config = configFromEnv({
    SPOTIFY_CLIENT_ID: 'client-id',
    SPOTIFY_CLIENT_SECRET: 'client-secret',
    SPOTIFY_MARKET: 'US',
    SPOTIFY_REDIRECT_URI: 'https://abbai.example/abbai-flow/music/oauth/callback',
    ABBAI_FLOW_BLUETOOTH_DBUS_ADDRESS: 'unix:path=/run/dbus/system_bus_socket',
  });
  assert.equal(config.spotifyClientId, undefined);
  assert.equal(config.spotifyClientSecret, undefined);
  assert.equal(config.spotifyMarket, undefined);
  assert.equal(config.spotifyRedirectUri, undefined);
  assert.equal(config.bluetoothDbusAddress, 'unix:path=/run/dbus/system_bus_socket');
});

test('Spotify playlist API is same-origin guarded and its OAuth callback returns to Music', async (t) => {
  const calls = [];
  const spotifyPlaylists = {
    status: async () => ({
      configured: true,
      credentialsConfigured: true,
      authorized: false,
      redirectConfigured: true,
    }),
    beginAuthorization: async () => 'https://accounts.spotify.com/authorize',
    completeAuthorization: async (...args) => calls.push(args),
  };
  const app = await startApp({ spotifyPlaylists });
  t.after(() => app.close());

  const status = await request(app.port, { path: '/abbai-flow/music/library/status' });
  assert.equal(status.status, 200);
  assert.deepEqual(status.json, {
    configured: true,
    credentialsConfigured: true,
    authorized: false,
    redirectConfigured: true,
  });

  const denied = await request(app.port, {
    method: 'POST',
    path: '/abbai-flow/music/library/connect',
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(denied.status, 403);

  const callback = await request(app.port, {
    path: '/abbai-flow/music/oauth/callback?code=one-time-code&state=verified-state',
  });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.location, '/?view=music&spotify=connected');
  assert.deepEqual(calls, [['one-time-code', 'verified-state', null]]);
});

test('Bluetooth status is readable while Bluetooth controls remain same-origin guarded', async (t) => {
  const calls = [];
  const bluetooth = {
    start() {},
    stop() {},
    getSnapshot: () => ({
      configured: true,
      connection: 'disconnected',
      adapter: null,
      scanning: false,
      devices: [],
      challenge: null,
      notice: null,
      error: 'The host Bluetooth service is unavailable',
      updatedAt: 1,
    }),
    control: async (control) => calls.push(control),
  };
  const app = await startApp({ bluetooth });
  t.after(() => app.close());

  const state = await request(app.port, { path: '/abbai-flow/bluetooth/state' });
  assert.equal(state.status, 200);
  assert.equal(state.json.connection, 'disconnected');

  const denied = await request(app.port, {
    method: 'POST',
    path: '/abbai-flow/bluetooth/control',
    body: { action: 'scan' },
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(calls, []);

  const accepted = await request(app.port, {
    method: 'POST',
    path: '/abbai-flow/bluetooth/control',
    body: { action: 'scan' },
  });
  assert.equal(accepted.status, 202);
  assert.deepEqual(calls, [{ action: 'scan' }]);
});

test('runtimeConfigFor maps optional appearance env vars', () => {
  const payload = runtimeConfigFor({
    FAMILY_NAME: '  The Abbatis ',
    THEME: 'midnight',
    PHOTO_INTERVAL: '45',
    SCREEN_SAVER_TIMEOUT: 'disaster',
    WEATHER_ENTITY: '',
  });
  assert.equal(payload.family_name, 'The Abbatis');
  assert.equal(payload.theme, 'midnight');
  assert.equal(payload.photo_interval, 45);
  assert.equal(payload.screen_saver_timeout, undefined);
  assert.equal(payload.weather_entity, undefined);
});
