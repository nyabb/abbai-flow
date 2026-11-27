#!/usr/bin/env node
/**
 * Abbai Flow backend entry point.
 *
 * Deliberately `.cjs`: the repo root declares `"type": "module"` for the Vite
 * frontend, so a root-level `server.js` is ESM here and cannot `require()`.
 * This file is CommonJS everywhere — `npm start` locally, and the container.
 *
 * The image also has a one-line `server.js` shim for backwards compatibility
 * with the old `CMD ["node", "server.js"]` and existing `docker run` snippets.
 */

const fs = require('fs');
const { createApp, configFromEnv } = require('./app.cjs');
const { startIntegrationDiagnostics } = require('./build/integration-diagnostics.js');

const PORT = Number(process.env.ABBAI_FLOW_PORT || process.env.PORT || 3000);
const config = configFromEnv();

// The data directory must exist before the first write.
try {
  fs.mkdirSync(config.dataDir, { recursive: true });
} catch {
  /* read-only or already present */
}

const app = createApp(config);
const { server, encore, bluetooth, verifySpotifyCatalog, verifySpotifyPlaylists } = app;
const integrationDiagnostics = startIntegrationDiagnostics(
  app.config,
  encore,
  {
    verifySpotifyCatalog,
    verifySpotifyPlaylists,
    bluetooth,
  },
);
server.on('close', integrationDiagnostics.stop);

server.listen(PORT, () => {
  console.log(`Abbai Flow server listening on port ${PORT}`);
  console.log(`Data directory: ${app.config.dataDir}`);
});

// Container shutdown should drain quickly instead of waiting for keep-alives.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
