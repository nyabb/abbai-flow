export interface IntegrationDiagnosticConfig {
  spotifyClientId: string;
  spotifyClientSecret: string;
  spotifyMarket: string;
  spotifyRedirectUri?: string;
}

export interface IntegrationDiagnosticLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface IntegrationDiagnosticsOptions {
  logger?: IntegrationDiagnosticLogger;
  verifySpotifyCatalog?: () => Promise<{ ok: boolean; code?: string }>;
  verifySpotifyPlaylists?: () => Promise<{
    configured: boolean;
    authorized: boolean;
    redirectConfigured: boolean;
  }>;
}

export interface IntegrationDiagnosticsHandle {
  ready: Promise<void>;
}

type LogLevel = 'info' | 'warn';

function logSpotify(
  logger: IntegrationDiagnosticLogger,
  level: LogLevel,
  entry: Record<string, unknown>,
): void {
  logger[level]('[Spotify] ' + JSON.stringify(entry));
}

function safeErrorCode(code?: string): string | undefined {
  return code && /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? code : undefined;
}

async function checkSpotifyCatalog(
  config: IntegrationDiagnosticConfig,
  verifier: IntegrationDiagnosticsOptions['verifySpotifyCatalog'],
  logger: IntegrationDiagnosticLogger,
): Promise<void> {
  const missing = [
    !config.spotifyClientId && 'client_id',
    !config.spotifyClientSecret && 'client_secret',
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    logSpotify(logger, 'warn', {
      event: 'startup_check',
      action: 'catalog_credentials',
      ok: false,
      state: 'not_configured',
      missing_credentials: missing,
    });
    return;
  }

  if (!verifier) {
    logSpotify(logger, 'warn', {
      event: 'startup_check',
      action: 'catalog_credentials',
      ok: false,
      state: 'check_unavailable',
    });
    return;
  }

  try {
    const result = await verifier();
    logSpotify(logger, result.ok ? 'info' : 'warn', {
      event: 'startup_check',
      action: 'catalog_credentials',
      ok: result.ok,
      state: result.ok ? 'accepted' : 'rejected',
      ...(safeErrorCode(result.code) ? { error_code: safeErrorCode(result.code) } : {}),
    });
  } catch {
    logSpotify(logger, 'warn', {
      event: 'startup_check',
      action: 'catalog_credentials',
      ok: false,
      state: 'check_failed',
    });
  }
}

async function checkSpotifyPlaylists(
  verifier: IntegrationDiagnosticsOptions['verifySpotifyPlaylists'],
  logger: IntegrationDiagnosticLogger,
): Promise<void> {
  if (!verifier) {
    logSpotify(logger, 'warn', {
      event: 'startup_check',
      action: 'playlist_authorization',
      ok: false,
      state: 'check_unavailable',
    });
    return;
  }

  try {
    const status = await verifier();
    const state = !status.configured
      ? 'not_configured'
      : status.authorized
        ? 'authorized'
        : 'awaiting_authorization';
    logSpotify(logger, status.configured ? 'info' : 'warn', {
      event: 'startup_check',
      action: 'playlist_authorization',
      ok: true,
      state,
      redirect_configured: status.redirectConfigured,
    });
  } catch {
    logSpotify(logger, 'warn', {
      event: 'startup_check',
      action: 'playlist_authorization',
      ok: false,
      state: 'check_failed',
    });
  }
}

/** Start non-blocking, secret-safe Spotify startup checks. */
export function startIntegrationDiagnostics(
  config: IntegrationDiagnosticConfig,
  options: IntegrationDiagnosticsOptions = {},
): IntegrationDiagnosticsHandle {
  const logger = options.logger || console;
  const market = /^[A-Z]{2}$/.test(config.spotifyMarket) ? config.spotifyMarket : 'NL';
  logSpotify(logger, 'info', {
    event: 'startup_check',
    action: 'catalog_market',
    ok: true,
    market,
  });

  const ready = Promise.all([
    checkSpotifyCatalog(config, options.verifySpotifyCatalog, logger),
    checkSpotifyPlaylists(options.verifySpotifyPlaylists, logger),
  ]).then(() => undefined);

  return { ready };
}
