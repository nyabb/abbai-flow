import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';

/**
 * One complete Abbai Flow deployment for the browser suite:
 *
 *   browser → server/app.cjs (SPA + Abbai Flow data + planner + local ChoresMan)
 *                    └── /abbai-flow/choresman → the real local JSON store
 *
 * Running the real backend (rather than intercepting fetch in the page) is what
 * makes the test cover the local chore store, planner reducer, idempotency keys
 * and persisted redemption document as well.
 */
const require = createRequire(import.meta.url);
const { createApp } = require('../server/app.cjs') as {
  createApp: (config: Record<string, unknown>) => { server: http.Server };
};

export interface E2EStack {
  appUrl: string;
  dataDir: string;
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

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abbai-flow-e2e-'));

  const { server } = createApp({
    distDir,
    dataDir,
    allowedOrigins: [],
  });
  const port = await listen(server);

  return {
    appUrl: `http://127.0.0.1:${port}`,
    dataDir,
    close: async () => {
      await close(server);
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Write one persisted document the way the app's own `saveData` would. */
export async function putData(appUrl: string, key: string, value: unknown): Promise<void> {
  const res = await fetch(`${appUrl}/abbai-flow/data/${key}`, {
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
  const res = await fetch(`${appUrl}/abbai-flow/data/${key}`);
  if (!res.ok) throw new Error(`Read ${key} failed: ${res.status}`);
  return (await res.json()) as T | null;
}

/** Call the app's local chore store endpoint directly for E2E setup/assertions. */
export interface E2EChoresManSnapshot {
  members: Array<{ id: string; name: string; points: number; role?: string }>;
  chores: Array<{
    id: string;
    name: string;
    assigned_user_names: string[];
    completion_criteria?: string;
    [field: string]: unknown;
  }>;
  rewards: Array<{ id: string; name: string; assigned_user_names: string[]; cost: number; approved?: boolean }>;
  ledger: Array<Record<string, unknown>>;
  [field: string]: unknown;
}

export async function callChoresMan<T = unknown>(
  appUrl: string,
  action: string,
  data: Record<string, unknown> = {},
): Promise<{ result?: T; snapshot: E2EChoresManSnapshot }> {
  const res = await fetch(`${appUrl}/abbai-flow/choresman`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action, data }),
  });
  if (!res.ok) throw new Error(`ChoresMan action ${action} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { result?: T; snapshot: E2EChoresManSnapshot };
}

export async function loadChoresMan(appUrl: string): Promise<E2EChoresManSnapshot> {
  const res = await fetch(`${appUrl}/abbai-flow/choresman`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Read ChoresMan snapshot failed: ${res.status}`);
  const body = (await res.json()) as { snapshot: E2EChoresManSnapshot };
  return body.snapshot;
}
