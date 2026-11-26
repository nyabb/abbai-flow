/**
 * Shared helpers for HA REST API calls.
 *
 * In server-proxy mode, API calls go through Abbai Flow's backend, which uses
 * the Home Assistant URL and token saved in integration settings.
 *
 * In standalone mode, API calls go directly to the HA instance with a
 * user-provided long-lived access token.
 */
import { getConfig } from '../config';
import { usesServerProxy, getIngressBasePath } from '../utils/ha-env';

/**
 * Get the base URL for API calls.
 * - Add-on mode: use the ingress base path (e.g. /api/hassio_ingress/<token>)
 * - Standalone mode: use the configured HA URL or current origin
 */
function resolveBaseUrl(): string {
  if (usesServerProxy()) return getIngressBasePath();

  // In standalone mode, use the Home Assistant URL saved by the user.
  const config = getConfig();
  if (config.ha_url && !config.ha_url.includes('supervisor')) {
    return config.ha_url.replace(/\/$/, '');
  }

  try {
    if (window !== window.parent) return window.parent.location.origin;
  } catch {
    /* cross-origin */
  }

  return window.location.origin;
}

// Lazy-resolve
let _baseUrl: string | null = null;
let _haToken: string | null = null;

function getBaseUrl() {
  if (!_baseUrl) _baseUrl = resolveBaseUrl();
  return _baseUrl;
}

/** Resolve HA-hosted resources through Abbai Flow when a backend proxy is available. */
export function getHaResourceUrl(path: string): string {
  if (path.startsWith('http')) return path;

  const resourcePath = path.startsWith('/') ? path : `/${path}`;
  if (usesServerProxy()) return `${getIngressBasePath()}${resourcePath}`;

  return `${getConfig().ha_url.replace(/\/$/, '')}${resourcePath}`;
}

function getHaToken() {
  if (_haToken === null) _haToken = getConfig().ha_token;
  return _haToken;
}

/** Keep Home Assistant's validation detail when a service call is rejected. */
async function responseErrorDetail(res: Response): Promise<string> {
  const raw = (await res.text()).trim();
  if (!raw) return res.statusText || `HTTP ${res.status}`;

  try {
    const body: unknown = JSON.parse(raw);
    if (typeof body === 'string') return body;
    // Keep the full structured response. HA error bodies often contain useful
    // validation context outside the first `message` field.
    return JSON.stringify(body, null, 2) ?? raw;
  } catch {
    // Some HA versions return plain text on errors.
  }

  return raw;
}

/**
 * Set the HA token dynamically (e.g. from ingress token request).
 */
export function setHaToken(token: string) {
  _haToken = token;
}

/** A service error with the request and full response ready to display/copy. */
export class HomeAssistantServiceError extends Error {
  constructor(
    message: string,
    readonly details: string,
  ) {
    super(message);
    this.name = 'HomeAssistantServiceError';
  }
}

/**
 * Fetch from the HA REST API.
 * In add-on mode, requests go through the ingress proxy (no auth header needed).
 * In standalone mode, requests go directly to HA with Bearer token.
 */
export async function haFetch(path: string, options?: RequestInit): Promise<unknown> {
  const token = getHaToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  // Only add auth header in standalone mode (not add-on proxy)
  if (token && !usesServerProxy()) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const base = getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    throw new Error(`HA API ${res.status}: ${await responseErrorDetail(res)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Call a HA service via the REST API.
 * In add-on mode, uses /abbai-flow/action/service to avoid ingress POST issues.
 */
export async function callHaService(
  domain: string,
  service: string,
  data?: Record<string, unknown>,
  returnResponse = false,
): Promise<unknown> {
  const serviceData = data ?? {};
  const servicePath = `/api/services/${domain}/${service}${returnResponse ? '?return_response' : ''}`;
  const proxy = usesServerProxy();
  const proxyPayload = {
    domain,
    service,
    data: serviceData,
    return_response: returnResponse,
  };

  const wrapError = (error: unknown): HomeAssistantServiceError => {
    if (error instanceof HomeAssistantServiceError) return error;
    const message = error instanceof Error ? error.message : String(error);
    const details = [
      'Home Assistant service call failed',
      `Service: ${domain}.${service}`,
      '',
      `Client request: POST ${proxy ? '/abbai-flow/action/service' : servicePath}`,
      'Client request payload:',
      JSON.stringify(proxy ? proxyPayload : serviceData, null, 2),
      ...(proxy
        ? [
            '',
            `Forwarded Home Assistant request: POST ${servicePath}`,
            'Home Assistant service payload:',
            JSON.stringify(serviceData, null, 2),
          ]
        : []),
      '',
      'Error response:',
      message,
      ...(error instanceof Error && error.stack ? ['', 'Stack:', error.stack] : []),
    ].join('\n');
    return new HomeAssistantServiceError(message, details);
  };

  // In add-on mode, route through the dedicated service endpoint
  // (HA ingress proxy can mangle POST bodies on /api/* paths)
  if (proxy) {
    try {
      const base = getBaseUrl();
      const res = await fetch(`${base}/abbai-flow/action/service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyPayload),
      });
      if (!res.ok) {
        throw new Error(`Service call ${res.status}: ${await responseErrorDetail(res)}`);
      }
      return await res.json();
    } catch (error) {
      throw wrapError(error);
    }
  }

  try {
    return await haFetch(servicePath, {
      method: 'POST',
      body: JSON.stringify(serviceData),
    });
  } catch (error) {
    throw wrapError(error);
  }
}

/**
 * Fetch a single entity state from the HA REST API.
 */
export async function getEntityState(entityId: string): Promise<{
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
} | null> {
  try {
    return (await haFetch(`/api/states/${entityId}`)) as {
      entity_id: string;
      state: string;
      attributes: Record<string, unknown>;
    };
  } catch {
    return null;
  }
}

/**
 * Fetch every entity state from the HA REST API (used by HA entity picker
 * UIs and generic entity/sensor cards).
 */
export async function getAllEntityStates(): Promise<
  Array<{
    entity_id: string;
    state: string;
    attributes: Record<string, unknown>;
  }>
> {
  try {
    const states = (await haFetch('/api/states')) as Array<{
      entity_id: string;
      state: string;
      attributes: Record<string, unknown>;
    }>;
    return states ?? [];
  } catch {
    return [];
  }
}

/** Whether HA API calls should work (server proxy or token configured) */
export function hasToken(): boolean {
  return usesServerProxy() || !!getHaToken();
}

/**
 * Error thrown by callAbbaiAction when the add-on server bridge (or HA
 * itself, relayed through it) rejects the request. Carries the HA error
 * `code` when available (e.g. "not_supported" for calendars that don't
 * support event update/delete) so callers can branch on it instead of
 * pattern-matching the message string.
 */
export class AbbaiActionError extends Error {
  code: string | null;
  status: number;
  constructor(message: string, code: string | null, status: number) {
    super(message);
    this.name = 'AbbaiActionError';
    this.code = code;
    this.status = status;
  }
}

/**
 * POST to one of the add-on server's /abbai-flow/action/* endpoints and return
 * the parsed JSON body — including on error responses, since those bridge
 * endpoints return `{ error, code }` bodies that callers need to inspect
 * Bridge app-specific operations through the add-on server in proxy mode.
 */
export async function callAbbaiAction(
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const base = getBaseUrl();
  const token = getHaToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token && !usesServerProxy()) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Abbai Flow action ${path} failed: ${res.status}`;
    const code =
      data && typeof data === 'object' && 'code' in data
        ? (data as { code: string | null }).code
        : null;
    throw new AbbaiActionError(message, code, res.status);
  }

  return data;
}
