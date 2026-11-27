import { describe, expect, it, vi } from 'vitest';
import type { EncoreSnapshot } from './encore-music';
import type { BluetoothSnapshot } from './bluetooth-types';
import {
  startIntegrationDiagnostics,
  type IntegrationDiagnosticConfig,
  type IntegrationDiagnosticLogger,
} from './integration-diagnostics';

function snapshot(overrides: Partial<EncoreSnapshot> = {}): EncoreSnapshot {
  return {
    configured: true,
    connection: 'connecting',
    auth: { loggedIn: null, isActive: null, deviceName: null },
    playback: {
      status: 'idle',
      item: null,
      context: null,
      position: null,
      volume: null,
      options: { shuffle: null, repeat: null },
      availableActions: [],
    },
    queue: { previous: [], upcoming: [] },
    error: null,
    updatedAt: 1,
    ...overrides,
  };
}

function config(overrides: Partial<IntegrationDiagnosticConfig> = {}): IntegrationDiagnosticConfig {
  return {
    encoreToken: 'server-encore-token',
    spotifyClientId: 'server-client-id',
    spotifyClientSecret: 'server-client-secret',
    spotifyMarket: 'NL',
    ...overrides,
  };
}

function diagnosticsLogger() {
  const entries: string[] = [];
  const logger: IntegrationDiagnosticLogger = {
    info: (message) => entries.push(message),
    warn: (message) => entries.push(message),
  };
  return { entries, logger };
}

describe('integration startup diagnostics', () => {
  it('logs Bluetooth connection changes without logging device addresses', async () => {
    let onBluetoothSnapshot: ((value: BluetoothSnapshot) => void) | undefined;
    const unsubscribeBluetooth = vi.fn();
    const bluetooth = {
      subscribe: (listener: (value: BluetoothSnapshot) => void) => {
        onBluetoothSnapshot = listener;
        listener({
          configured: true,
          connection: 'connecting',
          adapter: null,
          scanning: false,
          devices: [],
          challenge: null,
          notice: null,
          error: null,
          updatedAt: 1,
        });
        return unsubscribeBluetooth;
      },
    };
    const encore = { subscribe: () => vi.fn() };
    const { entries, logger } = diagnosticsLogger();
    const handle = startIntegrationDiagnostics(
      config({ encoreToken: '', spotifyClientId: '', spotifyClientSecret: '' }),
      encore as never,
      { logger, bluetooth },
    );
    await handle.ready;
    onBluetoothSnapshot?.({
      configured: true,
      connection: 'connected',
      adapter: {
        address: 'secret-device-address',
        name: 'Abbai Bluetooth',
        powered: true,
        discovering: false,
      },
      scanning: false,
      devices: [],
      challenge: null,
      notice: null,
      error: null,
      updatedAt: 2,
    });
    onBluetoothSnapshot?.({
      configured: true,
      connection: 'disconnected',
      adapter: null,
      scanning: false,
      devices: [],
      challenge: null,
      notice: null,
      error: 'The host Bluetooth service is unavailable',
      updatedAt: 3,
    });

    expect(entries.join('\n')).toContain('Bluetooth: connecting to the host system D-Bus.');
    expect(entries.join('\n')).toContain('Bluetooth adapter "Abbai Bluetooth" is powered on.');
    expect(entries.join('\n')).toContain('Bluetooth: disconnected; reconnect will retry.');
    expect(entries.join('\n')).not.toContain('secret-device-address');
    handle.stop();
    expect(unsubscribeBluetooth).toHaveBeenCalledOnce();
  });

  it('checks Spotify credentials and logs playback state without exposing secrets', async () => {
    let onEncoreSnapshot: ((value: EncoreSnapshot) => void) | undefined;
    const unsubscribe = vi.fn();
    const encore = {
      subscribe: (listener: (value: EncoreSnapshot) => void) => {
        onEncoreSnapshot = listener;
        listener(snapshot());
        return unsubscribe;
      },
    };
    const verifySpotifyCatalog = vi.fn(async () => ({ ok: true }));
    const { entries, logger } = diagnosticsLogger();

    const handle = startIntegrationDiagnostics(config(), encore as never, {
      logger,
      verifySpotifyCatalog,
    });
    await handle.ready;

    expect(verifySpotifyCatalog).toHaveBeenCalledOnce();
    expect(entries.join('\n')).toContain('Spotify catalog search: credentials accepted.');

    onEncoreSnapshot?.(
      snapshot({
        connection: 'connected',
        auth: { loggedIn: true, isActive: false, deviceName: 'Abbai Party' },
      }),
    );
    onEncoreSnapshot?.(
      snapshot({
        connection: 'connected',
        auth: { loggedIn: true, isActive: true, deviceName: 'Abbai Party' },
      }),
    );
    expect(entries.join('\n')).toContain('Spotify session: logged in.');
    expect(entries.join('\n')).toContain('device "Abbai Party" is active for playback.');
    expect(entries.join('\n')).not.toContain('server-encore-token');
    expect(entries.join('\n')).not.toContain('server-client-secret');

    handle.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
