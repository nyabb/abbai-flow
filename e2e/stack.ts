import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { FakeHa } from './fake-ha';

/**
 * One complete Abbai Flow deployment for the browser suite:
 *
 *   browser → server/app.cjs (SPA + /beacon-data + /api/planner/mutate)
 *                    │
 *                    └── /api/* and /beacon-action/service → FakeHa
 *
 * Running the real backend (rather than intercepting fetch in the page) is what
 * makes the test cover the server-side planner reducer, idempotency keys and
 * the persisted redemption document as well.
 */
const require = createRequire(import.meta.url);
const { createApp } = require('../server/app.cjs') as {
  createApp: (config: Record<string, unknown>) => { server: http.Server };
};

export interface E2EStack {
  appUrl: string;
  dataDir: string;
  fakeHa: FakeHa;
  close: () => Promise<void>;
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

export async function startStack(): Promise<E2EStack> {
  const distDir = path.resolve('dist');
  const index = path.join(distDir, 'index.html');
  if (!fs.existsSync(index)) {
    throw new Error(
      `Built SPA not found at ${index}. Run \`npm run build\` (or drop E2E_SKIP_BUILD).`,
    );
  }

  const fakeHa = await FakeHa.start();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abbai-flow-e2e-'));

  const { server } = createApp({
    distDir,
    dataDir,
    haToken: 'e2e-token',
    haBaseUrl: fakeHa.url,
    allowedOrigins: [],
  });
  const port = await listen(server);

  return {
    appUrl: `http://127.0.0.1:${port}`,
    dataDir,
    fakeHa,
    close: async () => {
      await close(server);
      await fakeHa.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Write one persisted document the way the app's own `saveData` would. */
export async function putData(appUrl: string, key: string, value: unknown): Promise<void> {
  const res = await fetch(`${appUrl}/beacon-data/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) {
    throw new Error(`Seed ${key} failed: ${res.status} ${await res.text()}`);
  }
}

/** Read one persisted document, e.g. the redemption file the server wrote. */
export async function getData<T>(appUrl: string, key: string): Promise<T | null> {
  const res = await fetch(`${appUrl}/beacon-data/${key}`);
  if (!res.ok) throw new Error(`Read ${key} failed: ${res.status}`);
  return (await res.json()) as T | null;
}
