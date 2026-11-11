#!/usr/bin/env node
/**
 * Abbai Flow backend entry point.
 *
 * The container image starts `node /app/server.js`, so this file must stay
 * CommonJS and must not rely on a package.json being present next to it.
 *
 * All request handling lives in `./server/app.cjs` so it can be unit tested
 * with `node --test`.
 */

const fs = require('fs');
const { createApp, configFromEnv } = require('./server/app.cjs');

const PORT = Number(process.env.ABBAI_FLOW_PORT || process.env.PORT || 3000);
const config = configFromEnv();

// HA add-ons mount /data persistently; create it before the first write.
try {
  fs.mkdirSync(config.dataDir, { recursive: true });
} catch {
  /* read-only or already present */
}

const { server } = createApp(config);

server.listen(PORT, () => {
  console.log(`Abbai Flow server listening on port ${PORT}`);
  console.log(`Home Assistant base: ${config.haBaseUrl}`);
  console.log(`Home Assistant token: ${config.haToken ? 'available' : 'NOT available'}`);
  console.log(`Data directory: ${config.dataDir}`);

  // Misconfiguration used to fail silently: the SPA loaded, then every /api/*
  // call answered 503 (no token) or hung against the Supervisor address that
  // does not exist outside the add-on sandbox. Say it plainly instead.
  if (!config.haToken) {
    console.warn(
      'Home Assistant token is missing — set HA_TOKEN to a long-lived access token ' +
        '(Profile → Security → Long-lived access tokens). Without it every /api/* ' +
        'request answers 503.',
    );
  }
  if (config.haBaseUrl === 'http://supervisor/core' && !process.env.HA_URL) {
    console.warn(
      'HA_URL is not set, so requests target http://supervisor/core, which only ' +
        'exists inside a Home Assistant add-on. Set HA_URL=http://<your-ha-host>:8123 ' +
        'when running the container standalone (e.g. in Portainer).',
    );
  }
});

// Container shutdown should drain quickly instead of waiting for keep-alives.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
