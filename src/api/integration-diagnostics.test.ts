import { describe, expect, it, vi } from 'vitest';
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
  it('logs Spotify credential and account status with a stable label and no secrets', async () => {
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
    expect(entries.every((entry) => entry.startsWith('[Spotify] '))).toBe(true);
    expect(entries.join('\n')).toContain('"action":"catalog_credentials","ok":true,"state":"accepted"');
    expect(entries.join('\n')).toContain('"action":"playlist_authorization","ok":true,"state":"authorized"');
    expect(entries.join('\n')).not.toContain('server-client-secret');
  });

  it('reports missing Spotify configuration without including credential values', async () => {
    const { entries, logger } = diagnosticsLogger();

    const handle = startIntegrationDiagnostics(
      config({ spotifyClientId: '', spotifyClientSecret: '' }),
      {
        logger,
        verifySpotifyCatalog: vi.fn(async () => ({ ok: true })),
        verifySpotifyPlaylists: vi.fn(async () => ({
          configured: false,
          authorized: false,
          redirectConfigured: false,
        })),
      },
    );
    await handle.ready;

    expect(entries.join('\n')).toContain('"state":"not_configured"');
    expect(entries.join('\n')).not.toContain('server-client-secret');
  });
});
