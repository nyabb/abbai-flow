#!/usr/bin/env node
/**
 * Beacon backend entry point.
 *
 * Kept byte-for-byte compatible with the add-on image: `run.sh` starts
 * `node /app/server.js`, so this file must stay CommonJS and must not rely on
 * a package.json being present next to it.
 *
 * All request handling lives in `./server/app.cjs` so it can be unit tested
 * with `node --test`.
 */

const fs = require('fs');
const { createApp, configFromEnv } = require('./server/app.cjs');

const PORT = Number(process.env.BEACON_PORT || process.env.PORT || 3000);
const config = configFromEnv();

// HA add-ons mount /data persistently; create it before the first write.
try {
  fs.mkdirSync(config.dataDir, { recursive: true });
} catch {
  /* read-only or already present */
}

const { server } = createApp(config);

server.listen(PORT, () => {
  console.log(`Beacon server listening on port ${PORT}`);
  console.log(`Home Assistant base: ${config.haBaseUrl}`);
  console.log(`Home Assistant token: ${config.haToken ? 'available' : 'NOT available'}`);
  console.log(`Data directory: ${config.dataDir}`);
});

// Container shutdown should drain quickly instead of waiting for keep-alives.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
