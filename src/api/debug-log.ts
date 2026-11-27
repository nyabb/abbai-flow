/** In-memory debug activity captured while Debug Mode is enabled. */
export type DebugLogLevel = 'pending' | 'success' | 'error' | 'event';

export interface DebugLogEntry {
  id: number;
  timestamp: number;
  level: DebugLogLevel;
  source: string;
  message: string;
  details?: string;
}

const MAX_DEBUG_ENTRIES = 400;
const MAX_DETAIL_LENGTH = 12_000;
const SECRET_KEY = /(authorization|token|password|secret|api.?key)/i;

let enabled = false;
let nextId = 1;
let entries: DebugLogEntry[] = [];
let fetchCaptureInstalled = false;
const listeners = new Set<() => void>();

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

function redactValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === 'object') {
    if (value instanceof Error) {
      return redactValue({
        name: value.name,
        message: value.message,
        stack: value.stack,
        code: 'code' in value ? value.code : undefined,
      });
    }
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactValue(childValue, childKey),
      ]),
    );
  }
  if (typeof value === 'string') return redactInline(value);
  return value;
}

function redactInline(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:access_token|refresh_token|token|api_key|password|secret)=)[^&\s]+/gi, '$1[redacted]');
}

function limitDetails(value: string): string {
  if (value.length <= MAX_DETAIL_LENGTH) return value;
  return `${value.slice(0, MAX_DETAIL_LENGTH)}\n… [truncated]`;
}

export function sanitizeDebugText(value: string): string {
  const redacted = redactInline(value);
  try {
    return limitDetails(JSON.stringify(redactValue(JSON.parse(redacted)), null, 2) ?? redacted);
  } catch {
    return limitDetails(redacted);
  }
}

export function stringifyDebugValue(value: unknown): string {
  try {
    return limitDetails(JSON.stringify(redactValue(value), null, 2) ?? String(value));
  } catch {
    return limitDetails(redactInline(String(value)));
  }
}

export function sanitizeDebugUrl(value: string): string {
  try {
    const url = new URL(value, window.location.href);
    for (const key of Array.from(url.searchParams.keys())) {
      if (SECRET_KEY.test(key) || /^(token|key)$/i.test(key)) {
        url.searchParams.set(key, '[redacted]');
      }
    }
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return redactInline(value);
  }
}

export function setDebugCaptureEnabled(value: boolean): void {
  enabled = value;
}

export function isDebugCaptureEnabled(): boolean {
  return enabled;
}

export function subscribeDebugLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDebugLogSnapshot(): DebugLogEntry[] {
  return entries;
}

export function recordDebugLog(
  entry: Omit<DebugLogEntry, 'id' | 'timestamp'> & { timestamp?: number },
): number | null {
  if (!enabled) return null;
  const id = nextId++;
  entries = [
    ...entries,
    {
      ...entry,
      id,
      timestamp: entry.timestamp ?? Date.now(),
      message: redactInline(entry.message),
      details: entry.details ? sanitizeDebugText(entry.details) : undefined,
    },
  ].slice(-MAX_DEBUG_ENTRIES);
  emitChange();
  return id;
}

export function updateDebugLog(
  id: number | null,
  patch: Partial<Pick<DebugLogEntry, 'level' | 'message' | 'details'>>,
): void {
  if (id === null) return;
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  entries = entries.map((entry, itemIndex) =>
    itemIndex === index
      ? {
          ...entry,
          ...patch,
          message: patch.message ? redactInline(patch.message) : entry.message,
          details:
            'details' in patch
              ? patch.details
                ? sanitizeDebugText(patch.details)
                : undefined
              : entry.details,
        }
      : entry,
  );
  emitChange();
}

export function clearDebugLog(): void {
  entries = [];
  emitChange();
}

function requestBodyText(body: BodyInit | null | undefined): string | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return sanitizeDebugText(body);
  if (body instanceof URLSearchParams) return sanitizeDebugText(`?${body.toString()}`);
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const fields: Array<[string, string]> = Array.from(body.entries()).map(([key, value]) => [
      key,
      SECRET_KEY.test(key)
        ? '[redacted]'
        : typeof value === 'string'
          ? value
          : `[file: ${value.name}, ${value.size} bytes]`,
    ]);
    return stringifyDebugValue(Object.fromEntries(fields));
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return `[binary body omitted: ${body.type || 'unknown type'}, ${body.size} bytes]`;
  }
  return '[binary body omitted]';
}

/** Install once at app startup; capture is gated by the persisted Debug Mode setting. */
export function installDebugFetchCapture(): void {
  if (typeof window === 'undefined' || fetchCaptureInstalled) return;
  fetchCaptureInstalled = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!enabled) return originalFetch(input, init);

    const request = input instanceof Request ? input : null;
    const rawUrl = input instanceof URL ? input.toString() : request?.url ?? String(input);
    const url = sanitizeDebugUrl(rawUrl);
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const requestBody = requestBodyText(init?.body);
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const details = requestBody ? `Request body:\n${requestBody}` : undefined;
    const logId = recordDebugLog({
      level: 'pending',
      source: 'HTTP',
      message: `${method} ${url} · pending`,
      details,
    });

    try {
      const response = await originalFetch(input, init);
      const elapsed = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start,
      );
      let responseDetails = details;
      if (!response.ok) {
        try {
          const responseText = await response.clone().text();
          const errorDetails = responseText ? sanitizeDebugText(responseText) : response.statusText;
          responseDetails = [details, `Response body:\n${errorDetails}`].filter(Boolean).join('\n\n');
        } catch {
          responseDetails = [details, 'Could not read the error response body.']
            .filter(Boolean)
            .join('\n\n');
        }
      }
      updateDebugLog(logId, {
        level: response.ok ? 'success' : 'error',
        message: `${method} ${url} → ${response.status}${response.statusText ? ` ${response.statusText}` : ''} · ${elapsed} ms`,
        details: responseDetails,
      });
      return response;
    } catch (error) {
      const elapsed = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start,
      );
      updateDebugLog(logId, {
        level: 'error',
        message: `${method} ${url} → failed · ${elapsed} ms`,
        details: [details, stringifyDebugValue(error)].filter(Boolean).join('\n\n'),
      });
      throw error;
    }
  };
}
