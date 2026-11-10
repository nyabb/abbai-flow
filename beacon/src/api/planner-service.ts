/**
 * Planner mutations — the one entry point the UI uses to change routine
 * metadata and reward pursuits.
 *
 * In **add-on mode** the change is sent to the add-on server
 * (`POST /api/planner/mutate`), which owns the document: it reduces the
 * operation with the same shared rules, serialises concurrent mutations per
 * document, deduplicates retries by idempotency key and writes the file
 * atomically. In **standalone / dev** there is no server, so the identical
 * reducer runs locally and `beacon-store` persists it.
 *
 * Either way the caller gets the resulting document back, so the UI renders what
 * was actually stored instead of assuming its own optimistic version.
 */
import { applyPlannerOp, type PlannerOp, type PlannerTarget } from '../../shared/planner-rules.mjs';
import { loadData, saveData } from './beacon-store';
import {
  loadPlannerMeta,
  PLANNER_META_KEY,
  sanitizePlannerMeta,
  type PlannerMeta,
} from './planner-meta';
import {
  loadRedemptions,
  REDEMPTIONS_KEY,
  sanitizeRedemptions,
  type Redemption,
} from './reward-redemptions';

export type { PlannerOp, PlannerTarget } from '../../shared/planner-rules.mjs';

export interface PlannerMutationResult<T> {
  document: T;
  /** Whatever the operation produced (e.g. the routine an `upsertRoutine` made). */
  result: unknown;
  /** False when the write only reached localStorage. */
  persisted: boolean;
  /** False when the operation was a no-op (deduplicated or already applied). */
  changed: boolean;
  error?: string;
}

function isAddOn(): boolean {
  return Boolean(window.__BEACON_CONFIG__);
}

function ingressBase(): string {
  return window.location.pathname.replace(/\/$/, '');
}

/** Unique per attempt; the server replays the same key instead of re-applying. */
function idempotencyKey(target: PlannerTarget): string {
  return `${target}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface MutateResponse {
  document?: unknown;
  changed?: boolean;
  result?: unknown;
  duplicate?: boolean;
  error?: string;
}

async function postMutation(
  target: PlannerTarget,
  op: PlannerOp,
): Promise<PlannerMutationResult<unknown> | null> {
  if (!isAddOn()) return null;

  const res = await fetch(`${ingressBase()}/api/planner/mutate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, op, key: idempotencyKey(target) }),
  });
  const payload = (await res.json().catch(() => ({}))) as MutateResponse;
  if (!res.ok) {
    throw new Error(payload.error ?? `Planner write failed (${res.status})`);
  }
  const document =
    target === 'meta'
      ? sanitizePlannerMeta(payload.document)
      : sanitizeRedemptions(payload.document);
  return {
    document,
    result: payload.result ?? null,
    persisted: true,
    changed: payload.changed !== false && !payload.duplicate,
  };
}

/** Read the document from the store (server first) before reducing locally. */
async function readDocument(target: PlannerTarget): Promise<unknown> {
  if (target === 'meta') return loadPlannerMeta();
  return loadRedemptions();
}

/**
 * Apply one operation and persist it.
 *
 * Throws only when the *server* refuses the write; a local (standalone) failure
 * is reported through `persisted: false` so the caller can still update the UI
 * and warn the household.
 */
export async function mutatePlanner<T>(
  target: PlannerTarget,
  op: PlannerOp,
): Promise<PlannerMutationResult<T>> {
  const remote = await postMutation(target, op);
  if (remote) return remote as PlannerMutationResult<T>;

  const current = await readDocument(target);
  const { document, changed, result } = applyPlannerOp(target, current, op);
  const key = target === 'meta' ? PLANNER_META_KEY : REDEMPTIONS_KEY;
  const saved = await saveData(key, document);
  return {
    document: document as T,
    result,
    persisted: saved.persisted,
    changed,
    ...(saved.persisted ? {} : { error: saved.error?.message ?? 'Not stored on the server' }),
  };
}

/** Convenience wrappers so call sites read as the thing they do. */
export const mutateMeta = (op: PlannerOp) => mutatePlanner<PlannerMeta>('meta', op);
export const mutateRedemptions = (op: PlannerOp) => mutatePlanner<Redemption[]>('redemptions', op);

/**
 * Fallback document for callers that need a synchronous first paint: the local
 * cache, exactly as `beacon-store` stores it.
 */
export async function loadTargetDocument<T>(target: PlannerTarget): Promise<T> {
  const raw = await loadData<unknown>(target === 'meta' ? PLANNER_META_KEY : REDEMPTIONS_KEY, null);
  return (target === 'meta' ? sanitizePlannerMeta(raw) : sanitizeRedemptions(raw)) as T;
}
