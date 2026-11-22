import { describe, expect, it, vi } from 'vitest';
import type { EncoreSnapshot } from './encore-music';
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
    haBaseUrl: 'http://ha.test:8123',
    haToken: 'server-ha-token',
    encoreToken: 'server-encore-token',
    spotifyClientId: 'server-client-id',
    spotifyClientSecret: 'server-client-secret',
    spotifyMarket: 'NL',
    weatherEntity: 'weather.home',
    photoDirectory: '/media/photos',
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
  it('checks HA and Spotify credentials, reports discovered integrations, and never logs secrets', async () => {
    let onEncoreSnapshot: ((value: EncoreSnapshot) => void) | undefined;
    const unsubscribe = vi.fn();
    const encore = {
      subscribe: (listener: (value: EncoreSnapshot) => void) => {
        onEncoreSnapshot = listener;
        listener(snapshot());
        return unsubscribe;
      },
    };
    const states = [
      { entity_id: 'calendar.home', state: 'on' },
      { entity_id: 'todo.groceries', state: '1' },
      { entity_id: 'media_player.abbai', state: 'idle' },
      { entity_id: 'sensor.grocy_shopping_list', state: '0' },
      { entity_id: 'sensor.grocy_expiring_products', state: 'unavailable' },
      { entity_id: 'sensor.grocy_meal_plan', state: 'unknown' },
      { entity_id: 'sensor.family_choreops_points', state: '12' },
      { entity_id: 'weather.home', state: 'sunny' },
    ];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'API running' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(states), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ children: [{}, {}] }), { status: 200 }),
      );
    const verifySpotifyCatalog = vi.fn(async () => ({ ok: true }));
    const { entries, logger } = diagnosticsLogger();

    const handle = startIntegrationDiagnostics(config(), encore as never, {
      fetcher,
      logger,
      verifySpotifyCatalog,
    });
    await handle.ready;

    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'http://ha.test:8123/api/',
      'http://ha.test:8123/api/states',
      'http://ha.test:8123/api/media_source/browse_media',
    ]);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer server-ha-token',
    });
    expect(verifySpotifyCatalog).toHaveBeenCalledOnce();
    expect(entries.join('\n')).toContain('Home Assistant API: connected and authenticated.');
    expect(entries.join('\n')).toContain(
      'calendars=1, media_players=1, todo_lists=1, choreops_entities=1',
    );
    expect(entries.join('\n')).toContain('sensor.grocy_expiring_products=present but unavailable');
    expect(entries.join('\n')).toContain('Weather entity weather.home: available.');
    expect(entries.join('\n')).toContain('Home Assistant media source: available (2 root item(s)).');
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
    expect(entries.join('\n')).not.toContain('server-ha-token');
    expect(entries.join('\n')).not.toContain('server-encore-token');
    expect(entries.join('\n')).not.toContain('server-client-secret');

    handle.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('explains missing integration configuration without making external requests', async () => {
    let onEncoreSnapshot: ((value: EncoreSnapshot) => void) | undefined;
    const encore = {
      subscribe: (listener: (value: EncoreSnapshot) => void) => {
        onEncoreSnapshot = listener;
        listener(snapshot({ configured: false, connection: 'disconnected' }));
        return vi.fn();
      },
    };
    const fetcher = vi.fn<typeof fetch>();
    const verifySpotifyCatalog = vi.fn(async () => ({ ok: true }));
    const { entries, logger } = diagnosticsLogger();

    const handle = startIntegrationDiagnostics(
      config({
        haToken: '',
        encoreToken: '',
        spotifyClientId: '',
        spotifyClientSecret: '',
      }),
      encore as never,
      { fetcher, logger, verifySpotifyCatalog },
    );
    await handle.ready;

    expect(fetcher).not.toHaveBeenCalled();
    expect(verifySpotifyCatalog).not.toHaveBeenCalled();
    expect(entries.join('\n')).toContain('Home Assistant API: not checked');
    expect(entries.join('\n')).toContain('Spotify playback (Encore): not configured');
    expect(entries.join('\n')).toContain('Spotify catalog search: not configured');
    expect(entries.join('\n')).toContain('ENCORE_TOKEN is missing');
    handle.stop();
    expect(onEncoreSnapshot).toBeDefined();
  });

  it('reports HTTP failures by status without logging the HA token or response body', async () => {
    const encore = {
      subscribe: (listener: (value: EncoreSnapshot) => void) => {
        listener(snapshot({ configured: false }));
        return vi.fn();
      },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('sensitive response body', { status: 401 }));
    const { entries, logger } = diagnosticsLogger();

    const handle = startIntegrationDiagnostics(config(), encore as never, {
      fetcher,
      logger,
      verifySpotifyCatalog: async () => ({ ok: true }),
    });
    await handle.ready;

    expect(entries.join('\n')).toContain('Home Assistant API: unavailable (HTTP 401)');
    expect(entries.join('\n')).not.toContain('sensitive response body');
    expect(entries.join('\n')).not.toContain('server-ha-token');
    handle.stop();
  });
});
