/**
 * Unified read/write helper for Beacon data persistence.
 *
 * Server (/beacon-data/:key) is the source of truth when running as an
 * HA add-on.  localStorage serves as an offline cache and as the primary
 * store during local development (no add-on server).
 */

/** A server-side persistence failure (transport, HTTP status, corruption). */
export class PersistenceError extends Error {
  /** Storage key that failed. */
  readonly key: string;
  /** HTTP status when the server answered, otherwise `null`. */
  readonly status: number | null;

  constructor(key: string, message: string, status: number | null = null) {
    super(message);
    this.name = 'PersistenceError';
    this.key = key;
    this.status = status;
  }
}

/**
 * Outcome of a save. `cached` and `persisted` are deliberately separate: a
 * save that only reached localStorage must never be reported as stored.
 */
export interface PersistenceResult {
  cached: boolean;
  persisted: boolean;
  error?: PersistenceError;
}

/**
 * Per-key write queue.
 *
 * Two overlapping saves of the same document used to race: whichever PUT
 * finished last won, which was not necessarily the newest value. Chaining
 * writes per key makes the last call the last write on the server too.
 */
const writeQueues = new Map<string, Promise<unknown>>();

function isAddOn(): boolean {
  return !!window.__BEACON_CONFIG__;
}

function getIngressBasePath(): string {
  return window.location.pathname.replace(/\/$/, '');
}

/**
 * Read from server first, fall back to localStorage.
 * In non-add-on mode, reads from localStorage only.
 */
export async function loadData<T>(key: string, fallback: T): Promise<T> {
  if (isAddOn()) {
    try {
      const base = getIngressBasePath();
      const res = await fetch(`${base}/beacon-data/${key}`);
      if (res.ok) {
        const data = await res.json();
        if (data !== null) {
          // Cache locally, but never let a full/disabled localStorage discard a
          // good server read.
          try {
            localStorage.setItem(key, JSON.stringify(data));
          } catch {
            /* cache is best-effort */
          }
          return data as T;
        }
      }
    } catch {
      /* fall through to localStorage */
    }
  }
  // Fall back to localStorage
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

/**
 * Read from localStorage only (synchronous, for initial render).
 * Used to provide instant data before the async server fetch completes.
 */
export function loadDataSync<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

/** Read from the add-on server without consulting or updating localStorage. */
export async function loadServerData<T>(key: string): Promise<T | null> {
  if (!isAddOn()) return null;
  try {
    const base = getIngressBasePath();
    const res = await fetch(`${base}/beacon-data/${key}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data === null ? null : (data as T);
  } catch {
    return null;
  }
}

/**
 * Write to localStorage AND the add-on server.
 *
 * The returned promise resolves once the write has finished — including the
 * server PUT — and reports what actually happened. It never rejects: callers
 * are UI flows that must keep working offline, but they can inspect
 * `persisted`/`error` (and the app logs a warning) instead of believing a
 * failed write succeeded.
 *
 * Writes for the same key are serialised, so concurrent saves of one document
 * land on the server in call order rather than completion order.
 */
export function saveData<T>(
  key: string,
  data: T,
  options: { browserStorage?: boolean } = {},
): Promise<PersistenceResult> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.then(
    () => writeNow(key, data, options),
    () => writeNow(key, data, options),
  );
  // Keep the chain alive but never let a rejection escape it.
  writeQueues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

async function writeNow<T>(
  key: string,
  data: T,
  options: { browserStorage?: boolean },
): Promise<PersistenceResult> {
  const json = JSON.stringify(data);

  let cached = false;
  if (options.browserStorage !== false) {
    try {
      localStorage.setItem(key, json);
      cached = true;
    } catch {
      /* localStorage unavailable (private mode, quota) */
    }
  }

  if (!isAddOn()) {
    // localStorage *is* the store outside the add-on.
    return { cached, persisted: cached };
  }

  const base = getIngressBasePath();
  // Awaited on purpose: `loadData` is server-first, so any refresh that runs
  // before this PUT lands reads the OLD document and writes it back over
  // localStorage. That silently reverted fresh edits — a parent's PIN never
  // survived saving, because useFamily's refresh raced the write.
  try {
    const res = await fetch(`${base}/beacon-data/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    });
    if (!res.ok) {
      const error = new PersistenceError(
        key,
        `Server rejected the write (${res.status})`,
        res.status,
      );
      reportPersistenceFailure(error);
      return { cached, persisted: false, error };
    }
    return { cached, persisted: true };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Server unreachable';
    const error = new PersistenceError(key, message);
    reportPersistenceFailure(error);
    return { cached, persisted: false, error };
  }
}

/** Surface a failed server write once, without flooding the console. */
function reportPersistenceFailure(error: PersistenceError): void {
  const message = `[beacon-store] ${error.key} was only cached locally: ${error.message}`;
  if (error.status === null) {
    // Offline is expected on tablets; a single info line is enough.
    console.info(message);
    return;
  }
  console.error(message);
}
