import { describe, expect, it, vi } from 'vitest';
import { SpotifyCatalog, SpotifyCatalogError } from './spotify-catalog';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function catalog(fetcher: typeof fetch) {
  return new SpotifyCatalog({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    market: 'NL',
    fetcher,
  });
}

describe('Spotify catalog search', () => {
  it('gets a server-side app token and returns safe track metadata', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'server-access-token', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          tracks: {
            items: [
              {
                uri: 'spotify:track:abc123',
                name: 'Sample Song',
                artists: [{ name: 'Sample Artist' }],
                album: { name: 'Sample Album', images: [{ url: 'https://img.test/cover.jpg' }] },
                duration_ms: 188000,
                external_urls: { spotify: 'https://open.spotify.com/track/abc123' },
              },
            ],
          },
        }),
      );

    await expect(catalog(fetcher).search('  Sample   Song ')).resolves.toEqual([
      {
        uri: 'spotify:track:abc123',
        title: 'Sample Song',
        artists: ['Sample Artist'],
        album: 'Sample Album',
        artworkUrl: 'https://img.test/cover.jpg',
        durationMs: 188000,
      },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://accounts.spotify.com/api/token');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa('test-client-id:test-client-secret'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    expect(fetcher.mock.calls[1]?.[0].toString()).toContain('q=Sample+Song');
    expect(fetcher.mock.calls[1]?.[0].toString()).toContain('market=NL');
  });

  it('rejects empty or overly long queries and reports missing credentials clearly', async () => {
    const service = new SpotifyCatalog();
    await expect(service.search('')).rejects.toMatchObject({ code: 'invalid_query', status: 400 });
    await expect(service.search('x'.repeat(101))).rejects.toMatchObject({
      code: 'invalid_query',
      status: 400,
    });
    await expect(service.search('song')).rejects.toMatchObject({
      code: 'not_configured',
      status: 503,
    });
  });

  it('verifies server credentials without returning or logging an access token', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'private-access-token', expires_in: 3600 }),
      );
    const service = catalog(fetcher);

    await expect(service.verifyCredentials()).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(await service.verifyCredentials())).not.toContain('private-access-token');
  });

  it('converts Spotify rate limits and service failures to safe errors', async () => {
    const limited = catalog(
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({ access_token: 'server-access-token', expires_in: 3600 }),
        )
        .mockResolvedValueOnce(jsonResponse({}, 429)),
    );
    await expect(limited.search('song')).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });

    const failed = catalog(vi.fn<typeof fetch>().mockRejectedValue(new Error('network detail')));
    await expect(failed.search('song')).rejects.toBeInstanceOf(SpotifyCatalogError);
    await expect(failed.search('song')).rejects.toMatchObject({ code: 'unavailable', status: 503 });
  });
});
