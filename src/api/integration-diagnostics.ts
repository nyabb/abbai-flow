import type { EncoreMusic, EncoreSnapshot } from './encore-music';
import type { BluetoothSnapshot } from './bluetooth-types';

export interface IntegrationDiagnosticConfig {
  encoreToken: string;
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
  bluetooth?: {
    subscribe(listener: (snapshot: BluetoothSnapshot) => void): () => void;
  };
}

export interface IntegrationDiagnosticsHandle {
  ready: Promise<void>;
  stop(): void;
}

function cleanLabel(value: string | null | undefined): string {
  const normalized = value || '';
  return normalized
    // eslint-disable-next-line no-control-regex
    .replace(/[\r\n\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 100);
}

function logEncoreStateChanges(
  logger: IntegrationDiagnosticLogger,
  encore: Pick<EncoreMusic, 'subscribe'>,
): () => void {
  let configuredLogged = false;
  let lastConnection: EncoreSnapshot['connection'] | null = null;
  let lastLoggedIn: boolean | null = null;
  let lastDeviceKey: string | null = null;
  let lastError: string | null = null;

  return encore.subscribe((snapshot) => {
    if (!snapshot.configured) {
      if (!configuredLogged) {
        logger.warn(
          '[Integration] Spotify playback (Encore): not configured; add the connection in Settings → Integrations.',
        );
        configuredLogged = true;
      }
      return;
    }

    if (snapshot.connection !== lastConnection) {
      lastConnection = snapshot.connection;
      if (snapshot.connection === 'connecting') {
        logger.info(
          '[Integration] Spotify playback (Encore): connecting to the WebSocket gateway.',
        );
      } else if (snapshot.connection === 'connected') {
        logger.info('[Integration] Spotify playback (Encore): WebSocket connected.');
      } else {
        logger.warn('[Integration] Spotify playback (Encore): disconnected; reconnect will retry.');
      }
    }

    if (snapshot.error && snapshot.error !== lastError) {
      logger.warn('[Integration] Spotify playback (Encore): ' + cleanLabel(snapshot.error) + '.');
    }
    lastError = snapshot.error;

    if (snapshot.auth.loggedIn !== null && snapshot.auth.loggedIn !== lastLoggedIn) {
      lastLoggedIn = snapshot.auth.loggedIn;
      logger[snapshot.auth.loggedIn ? 'info' : 'warn'](
        '[Integration] Spotify session: ' +
          (snapshot.auth.loggedIn ? 'logged in.' : 'logged out; playback is unavailable.'),
      );
    }

    if (snapshot.auth.loggedIn === true) {
      const deviceName = cleanLabel(snapshot.auth.deviceName);
      const deviceKey = `${snapshot.auth.isActive}:${deviceName}`;
      if (deviceKey !== lastDeviceKey && snapshot.auth.isActive !== null) {
        lastDeviceKey = deviceKey;
        logger[snapshot.auth.isActive ? 'info' : 'warn'](
          '[Integration] Spotify Soloist device ' +
            (deviceName ? `"${deviceName}" ` : '') +
            (snapshot.auth.isActive
              ? 'is active for playback.'
              : 'is logged in but not active for playback.'),
        );
      }
    }
  });
}

function logBluetoothStateChanges(
  logger: IntegrationDiagnosticLogger,
  bluetooth: NonNullable<IntegrationDiagnosticsOptions['bluetooth']>,
): () => void {
  let lastConnection: BluetoothSnapshot['connection'] | null = null;
  let lastAdapter: string | null = null;
  let lastPowered: boolean | null = null;
  let lastError: string | null = null;
  let missingConfigurationLogged = false;

  return bluetooth.subscribe((snapshot) => {
    if (!snapshot.configured) {
      if (!missingConfigurationLogged) {
        logger.info(
          '[Integration] Bluetooth: not configured; mount the host D-Bus socket and configure its address for device management.',
        );
        missingConfigurationLogged = true;
      }
      return;
    }

    if (snapshot.connection !== lastConnection) {
      lastConnection = snapshot.connection;
      if (snapshot.connection === 'connecting') {
        logger.info('[Integration] Bluetooth: connecting to the host system D-Bus.');
      } else if (snapshot.connection === 'connected') {
        logger.info('[Integration] Bluetooth: host system D-Bus connected.');
      } else if (snapshot.connection === 'disconnected') {
        logger.warn('[Integration] Bluetooth: disconnected; reconnect will retry.');
      }
    }

    if (snapshot.error && snapshot.error !== lastError) {
      logger.warn('[Integration] Bluetooth: ' + cleanLabel(snapshot.error) + '.');
    }
    lastError = snapshot.error;

    const adapterName = cleanLabel(snapshot.adapter?.name);
    if (adapterName !== lastAdapter || snapshot.adapter?.powered !== lastPowered) {
      lastAdapter = adapterName;
      lastPowered = snapshot.adapter?.powered ?? null;
      if (snapshot.adapter) {
        logger[snapshot.adapter.powered ? 'info' : 'warn'](
          '[Integration] Bluetooth adapter' +
            (adapterName ? ` "${adapterName}"` : '') +
            (snapshot.adapter.powered ? ' is powered on.' : ' is powered off.'),
        );
      }
    }
  });
}

async function checkSpotifyCatalog(
  config: IntegrationDiagnosticConfig,
  verifier: IntegrationDiagnosticsOptions['verifySpotifyCatalog'],
  logger: IntegrationDiagnosticLogger,
): Promise<void> {
  const missing = [
    !config.spotifyClientId && 'client ID',
    !config.spotifyClientSecret && 'client secret',
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    logger.warn(
      '[Integration] Spotify catalog search: not configured; add developer app credentials in Settings → Integrations.',
    );
    return;
  }

  logger.info(
    `[Integration] Spotify catalog search: checking server credentials (market=${cleanLabel(config.spotifyMarket) || 'NL'}).`,
  );
  if (!verifier) {
    logger.warn('[Integration] Spotify catalog search: credential check is unavailable.');
    return;
  }
  try {
    const result = await verifier();
    if (result.ok) {
      logger.info('[Integration] Spotify catalog search: credentials accepted.');
    } else {
      logger.warn(
        `[Integration] Spotify catalog search: credential check failed (${cleanLabel(result.code) || 'unavailable'}).`,
      );
    }
  } catch {
    logger.warn('[Integration] Spotify catalog search: credential check failed.');
  }
}

async function checkSpotifyPlaylists(
  verifier: IntegrationDiagnosticsOptions['verifySpotifyPlaylists'],
  logger: IntegrationDiagnosticLogger,
): Promise<void> {
  if (!verifier) {
    logger.warn('[Integration] Spotify playlists: status check is unavailable.');
    return;
  }
  try {
    const status = await verifier();
    if (!status.configured) {
      logger.warn(
        '[Integration] Spotify playlists: not configured; add Spotify credentials and a valid redirect URI in Settings → Integrations.',
      );
    } else if (status.authorized) {
      logger.info('[Integration] Spotify playlists: Spotify account authorization is available.');
    } else {
      logger.info(
        '[Integration] Spotify playlists: configured; connect a Spotify account from the Music page to manage playlists.',
      );
    }
  } catch {
    logger.warn('[Integration] Spotify playlists: status check failed.');
  }
}

/** Start non-blocking, secret-safe startup checks and Encore status logging. */
export function startIntegrationDiagnostics(
  config: IntegrationDiagnosticConfig,
  encore: Pick<EncoreMusic, 'subscribe'>,
  options: IntegrationDiagnosticsOptions = {},
): IntegrationDiagnosticsHandle {
  const logger = options.logger || console;
  logger.info(
    `[Integration] Spotify playback (Encore): ${config.encoreToken ? 'token configured; connection status follows' : 'not configured; add connection details in Settings → Integrations'}.`,
  );
  logger.info(`[Integration] Spotify catalog market: ${cleanLabel(config.spotifyMarket) || 'NL'}.`);

  const unsubscribeEncore = logEncoreStateChanges(logger, encore);
  const unsubscribeBluetooth = options.bluetooth
    ? logBluetoothStateChanges(logger, options.bluetooth)
    : () => undefined;
  const ready = Promise.all([
    checkSpotifyCatalog(config, options.verifySpotifyCatalog, logger),
    checkSpotifyPlaylists(options.verifySpotifyPlaylists, logger),
  ]).then(() => undefined);

  return {
    ready,
    stop() {
      unsubscribeEncore();
      unsubscribeBluetooth();
    },
  };
}
