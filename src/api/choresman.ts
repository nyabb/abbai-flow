import { getRuntimeConfig } from '../config';

export interface ChoresManSnapshot {
  members: Array<Record<string, unknown> & { id: string; name: string; role: 'parent' | 'child'; points: number; active?: boolean }>;
  chores: Array<Record<string, unknown> & { id: string; name: string; assigned_user_names: string[] }>;
  chore_claims: Array<Record<string, unknown>>;
  rewards: Array<Record<string, unknown> & { id: string; name: string; assigned_user_names: string[] }>;
  reward_claims: Array<Record<string, unknown>>;
  ledger: Array<Record<string, unknown>>;
  pending_approvals: { chores: number; rewards: number };
  updated_at: string | null;
}

export interface ChoresManResponse<T = unknown> {
  result?: T;
  snapshot: ChoresManSnapshot;
}

function appBasePath(): string {
  // Keep API requests beneath the current app path when reverse proxied.
  return getRuntimeConfig() ? window.location.pathname.replace(/\/$/, '') : '';
}

async function readResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `ChoresMan request failed: ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function loadChoresManSnapshot(): Promise<ChoresManSnapshot> {
  const response = await fetch(`${appBasePath()}/abbai-flow/choresman`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const result = await readResponse<{ snapshot: ChoresManSnapshot }>(response);
  return result.snapshot;
}

export async function callChoresMan<T = unknown>(
  action: string,
  data: Record<string, unknown> = {},
): Promise<ChoresManResponse<T>> {
  const response = await fetch(`${appBasePath()}/abbai-flow/choresman`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action, data }),
  });
  return readResponse<ChoresManResponse<T>>(response);
}
