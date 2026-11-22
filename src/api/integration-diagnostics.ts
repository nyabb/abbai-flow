import type { EncoreMusic, EncoreSnapshot } from './encore-music';
import type { BluetoothSnapshot } from './bluetooth-types';

export interface IntegrationDiagnosticConfig {
  haBaseUrl: string;
  haToken: string;
  encoreToken: string;
  spotifyClientId: string;
  spotifyClientSecret: string;
  spotifyMarket: string;
  spotifyRedirectUri?: string;
  weatherEntity?: string;
  photoDirectory?: string;
  customHaCaConfigured?: boolean;
}

export interface IntegrationDiagnosticLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface IntegrationDiagnosticsOptions {
  fetcher?: typeof fetch;
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

interface HaState {
  entity_id: string;
  state: string;
}

const CHECK_TIMEOUT_MS = 8_000;

function cleanLabel(value: string | null | undefined): string {
  // Remove control characters so configured labels cannot forge log lines.
  const normalized = value || '';
  return normalized
    // eslint-disable-next-line no-control-regex
    .replace(/[\r\n\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 100);
}

function describeEntity(states: HaState[], entityId: string): string {
  const entity = states.find((candidate) => candidate.entity_id === entityId);
  if (!entity) return 'not found';
  if (entity.state === 'unavailable') return 'present but unavailable';
  if (entity.state === 'unknown') return 'present but has no state yet';
  return 'available';
}

function availableCount(states: HaState[], domain: string): number {
  return states.filter(
    (entity) =>
      entity.entity_id.startsWith(domain + '.') &&
      entity.state !== 'unavailable' &&
      entity.state !== 'unknown',
  ).length;
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
          '[Integration] Spotify playback (Encore): not configured; ENCORE_TOKEN is missing.',
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
          '[Integration] Bluetooth: not configured; mount the host D-Bus socket and set ABBAI_FLOW_BLUETOOTH_DBUS_ADDRESS to enable device management.',
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

async function checkHomeAssistant(
  config: IntegrationDiagnosticConfig,
  fetcher: typeof fetch,
  logger: IntegrationDiagnosticLogger,
): Promise<void> {
  if (!config.haToken) {
    logger.warn(
      '[Integration] Home Assistant API: not checked because HA_TOKEN/SUPERVISOR_TOKEN is missing.',
    );
    return;
  }
  if (config.customHaCaConfigured) {
    logger.warn(
      '[Integration] Home Assistant API: connectivity check skipped because ABBAI_FLOW_HA_CA is configured; the application proxy still uses that CA.',
    );
    return;
  }

  const baseUrl = config.haBaseUrl.replace(/\/$/, '');
  const headers = {
    Accept: 'application/json',
    Authorization: 'Bearer ' + config.haToken,
  };
  const request = (path: string) =>
    fetcher(baseUrl + path, {
      headers,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });

  logger.info('[Integration] Home Assistant API: checking connectivity and installed entities.');
  let apiResponse: Response;
  try {
    apiResponse = await request('/api/');
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    logger.warn(
      '[Integration] Home Assistant API: connection ' +
        (timedOut
          ? `timed out after ${CHECK_TIMEOUT_MS} ms.`
          : 'failed; check HA_URL and network access.'),
    );
    return;
  }
  if (!apiResponse.ok) {
    logger.warn(
      `[Integration] Home Assistant API: unavailable (HTTP ${apiResponse.status}); check the URL and token.`,
    );
    return;
  }

  logger.info('[Integration] Home Assistant API: connected and authenticated.');

  let statesResponse: Response;
  try {
    statesResponse = await request('/api/states');
  } catch {
    logger.warn(
      '[Integration] Home Assistant entities: state request failed after API connection.',
    );
    return;
  }
  if (!statesResponse.ok) {
    logger.warn(
      `[Integration] Home Assistant entities: unavailable (HTTP ${statesResponse.status}).`,
    );
    return;
  }

  let payload: unknown;
  try {
    payload = await statesResponse.json();
  } catch {
    logger.warn('[Integration] Home Assistant entities: the state response was not valid JSON.');
    return;
  }
  if (!Array.isArray(payload)) {
    logger.warn('[Integration] Home Assistant entities: the state response was not a list.');
    return;
  }

  const states = payload.filter(
    (value): value is HaState =>
      value !== null &&
      typeof value === 'object' &&
      typeof value.entity_id === 'string' &&
      typeof value.state === 'string',
  );
  const calendars = availableCount(states, 'calendar');
  const mediaPlayers = availableCount(states, 'media_player');
  const todoLists = states.filter(
    (entity) => entity.entity_id.startsWith('todo.') && entity.state !== 'unavailable',
  ).length;
  const choreOpsEntities = states.filter((entity) => /_choreops_/i.test(entity.entity_id)).length;

  logger.info(
    `[Integration] Home Assistant entities: ${states.length} total; calendars=${calendars}, media_players=${mediaPlayers}, todo_lists=${todoLists}, choreops_entities=${choreOpsEntities}.`,
  );

  const grocyEntities = [
    'sensor.grocy_shopping_list',
    'sensor.grocy_expiring_products',
    'sensor.grocy_meal_plan',
  ];
  logger.info(
    '[Integration] Grocy via Home Assistant: ' +
      grocyEntities
        .map((entityId) => `${entityId}=${describeEntity(states, entityId)}`)
        .join(', ') +
      '.',
  );
  logger.info(
    `[Integration] AnyList/Home Assistant todo lists: ${todoLists} available entity/entities detected.`,
  );
  logger.info(
    `[Integration] ChoreOps: ${choreOpsEntities} related entity/entities detected in Home Assistant.`,
  );
  logger.info(
    `[Integration] Home Assistant calendars: ${calendars} available; local Abbai Flow calendar is always available.`,
  );
  logger.info(`[Integration] Home Assistant media players: ${mediaPlayers} available.`);

  const weatherEntity = cleanLabel(config.weatherEntity || 'weather.home');
  logger.info(
    `[Integration] Weather entity ${weatherEntity || 'weather.home'}: ${describeEntity(states, weatherEntity || 'weather.home')}.`,
  );

  const photoDirectoryConfigured = Boolean(config.photoDirectory?.trim());
  logger.info(
    `[Integration] Photos local directory: ${photoDirectoryConfigured ? 'configured' : 'using the application default'}.`,
  );

  let mediaResponse: Response;
  try {
    mediaResponse = await request('/api/media_source/browse_media');
  } catch {
    logger.warn('[Integration] Home Assistant media source: connectivity check failed.');
    return;
  }
  if (!mediaResponse.ok) {
    logger.warn(
      `[Integration] Home Assistant media source: unavailable (HTTP ${mediaResponse.status}).`,
    );
    return;
  }
  try {
    const media = (await mediaResponse.json()) as { children?: unknown };
    const rootItems = Array.isArray(media.children) ? media.children.length : 0;
    logger.info(
      `[Integration] Home Assistant media source: available (${rootItems} root item(s)).`,
    );
  } catch {
    logger.warn('[Integration] Home Assistant media source: invalid response.');
  }
}

async function checkSpotifyCatalog(
  config: IntegrationDiagnosticConfig,
  verifier: IntegrationDiagnosticsOptions['verifySpotifyCatalog'],
  logger: IntegrationDiagnosticLogger,
): Promise<void> {
  const missing = [
    !config.spotifyClientId && 'SPOTIFY_CLIENT_ID',
    !config.spotifyClientSecret && 'SPOTIFY_CLIENT_SECRET',
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    logger.warn(
      `[Integration] Spotify catalog search: not configured; missing ${missing.join(' and ')}.`,
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
        '[Integration] Spotify playlists: not configured; set Spotify client credentials and a valid SPOTIFY_REDIRECT_URI.',
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
  const fetcher = options.fetcher || fetch;

  logger.info(
    `[Integration] Home Assistant: ${config.haToken ? 'token configured' : 'token missing'}; base URL is ${config.haBaseUrl}.`,
  );
  logger.info(
    `[Integration] Spotify playback (Encore): ${config.encoreToken ? 'token configured; connection status follows' : 'not configured; set ENCORE_TOKEN'}.`,
  );
  logger.info(`[Integration] Spotify catalog market: ${cleanLabel(config.spotifyMarket) || 'NL'}.`);
  logger.info(
    `[Integration] Google Photos: not connected; Google Photos OAuth is not implemented in this build.`,
  );

  const unsubscribeEncore = logEncoreStateChanges(logger, encore);
  const unsubscribeBluetooth = options.bluetooth
    ? logBluetoothStateChanges(logger, options.bluetooth)
    : () => undefined;
  const ready = Promise.all([
    checkHomeAssistant(config, fetcher, logger),
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
