import { describe, expect, it, vi } from 'vitest';
import type { BluetoothSnapshot } from './bluetooth-types';
import {
  startIntegrationDiagnostics,
  type IntegrationDiagnosticConfig,
  type IntegrationDiagnosticLogger,
} from './integration-diagnostics';

function config(overrides: Partial<IntegrationDiagnosticConfig> = {}): IntegrationDiagnosticConfig {
  return {
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
  it('checks Spotify credentials without exposing secrets', async () => {
    const verifySpotifyCatalog = vi.fn(async () => ({ ok: true }));
    const verifySpotifyPlaylists = vi.fn(async () => ({
      configured: true,
      authorized: true,
      redirectConfigured: true,
    }));
    const { entries, logger } = diagnosticsLogger();

    const handle = startIntegrationDiagnostics(config(), {
      logger,
      verifySpotifyCatalog,
      verifySpotifyPlaylists,
    });
    await handle.ready;

    expect(verifySpotifyCatalog).toHaveBeenCalledOnce();
    expect(verifySpotifyPlaylists).toHaveBeenCalledOnce();
    expect(entries.join('\n')).toContain('Spotify catalog search: credentials accepted.');
    expect(entries.join('\n')).toContain('Spotify playlists: Spotify account authorization is available.');
    expect(entries.join('\n')).not.toContain('server-client-secret');
    handle.stop();
  });

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
    const { entries, logger } = diagnosticsLogger();
    const handle = startIntegrationDiagnostics(config(), { logger, bluetooth });
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
});
