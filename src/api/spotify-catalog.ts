export interface SpotifyCatalogTrack {
  uri: string;
  title: string;
  artists: string[];
  album: string;
  artworkUrl: string | null;
  spotifyUrl: string | null;
  durationMs: number | null;
}

export type SpotifyCatalogErrorCode =
  'not_configured' | 'rate_limited' | 'unavailable' | 'invalid_query';

export class SpotifyCatalogError extends Error {
  constructor(
    readonly code: SpotifyCatalogErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SpotifyCatalogError';
  }
}

export interface SpotifyCatalogOptions {
  clientId?: string;
  clientSecret?: string;
  market?: string;
  fetcher?: typeof fetch;
  now?: () => number;
}

export type SpotifyCatalogVerification =
  { ok: true } | { ok: false; code: SpotifyCatalogErrorCode };

interface JsonRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeImage(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const item = value.find((entry) => isRecord(entry) && typeof entry.url === 'string');
  if (!isRecord(item)) return null;
  try {
    const url = new URL(item.url as string);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeSpotifyUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'open.spotify.com' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function validateSpotifySearchQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const query = value.trim().replace(/\s+/g, ' ');
  return query.length > 0 && query.length <= 100 ? query : null;
}

export class SpotifyCatalog {
  readonly configured: boolean;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly market: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private cachedToken: { value: string; expiresAt: number } | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(options: SpotifyCatalogOptions = {}) {
    this.clientId = options.clientId?.trim() || '';
    this.clientSecret = options.clientSecret?.trim() || '';
    this.market = /^[A-Z]{2}$/.test(options.market || '') ? options.market! : 'NL';
    this.configured = Boolean(this.clientId && this.clientSecret);
    this.fetcher = options.fetcher || fetch;
    this.now = options.now || Date.now;
  }

  async search(queryValue: unknown): Promise<SpotifyCatalogTrack[]> {
    const query = validateSpotifySearchQuery(queryValue);
    if (!query) {
      throw new SpotifyCatalogError(
        'invalid_query',
        400,
        'Search query must contain 1 to 100 characters',
      );
    }
    if (!this.configured) {
      throw new SpotifyCatalogError(
        'not_configured',
        503,
        'Spotify search is not configured; add developer app credentials in Settings → Integrations.',
      );
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.getToken();
      const url = new URL('https://api.spotify.com/v1/search');
      url.searchParams.set('q', query);
      url.searchParams.set('type', 'track');
      url.searchParams.set('limit', '8');
      url.searchParams.set('market', this.market);

      let response: Response;
      try {
        response = await this.fetcher(url, {
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new SpotifyCatalogError(
          'unavailable',
          502,
          'Spotify search is temporarily unavailable',
        );
      }

      if (response.status === 401 && attempt === 0) {
        this.cachedToken = null;
        continue;
      }
      if (response.status === 429) {
        throw new SpotifyCatalogError(
          'rate_limited',
          429,
          'Spotify search is busy. Please try again shortly.',
        );
      }
      if (!response.ok) {
        throw new SpotifyCatalogError(
          'unavailable',
          502,
          'Spotify search is temporarily unavailable',
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new SpotifyCatalogError(
          'unavailable',
          502,
          'Spotify returned an invalid search response',
        );
      }
      return this.normalizeTracks(payload);
    }

    throw new SpotifyCatalogError('unavailable', 502, 'Spotify search is temporarily unavailable');
  }

  /** Verify the configured app credentials without returning its access token. */
  async verifyCredentials(): Promise<SpotifyCatalogVerification> {
    if (!this.configured) return { ok: false, code: 'not_configured' };
    try {
      await this.getToken();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof SpotifyCatalogError ? error.code : 'unavailable',
      };
    }
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > this.now()) {
      return this.cachedToken.value;
    }
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = this.requestToken();
    try {
      return await this.tokenRequest;
    } finally {
      this.tokenRequest = null;
    }
  }

  private async requestToken(): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + btoa(this.clientId + ':' + this.clientSecret),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new SpotifyCatalogError(
        'unavailable',
        503,
        'Spotify search authentication is temporarily unavailable',
      );
    }
    if (!response.ok) {
      throw new SpotifyCatalogError('unavailable', 503, 'Spotify search authentication failed');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SpotifyCatalogError(
        'unavailable',
        503,
        'Spotify returned an invalid authentication response',
      );
    }
    if (!isRecord(payload) || typeof payload.access_token !== 'string') {
      throw new SpotifyCatalogError(
        'unavailable',
        503,
        'Spotify returned an invalid authentication response',
      );
    }

    const expiresIn =
      typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
        ? Math.max(60, payload.expires_in)
        : 3600;
    this.cachedToken = {
      value: payload.access_token,
      expiresAt: this.now() + Math.max(30, expiresIn - 30) * 1000,
    };
    return payload.access_token;
  }

  private normalizeTracks(payload: unknown): SpotifyCatalogTrack[] {
    if (!isRecord(payload) || !isRecord(payload.tracks) || !Array.isArray(payload.tracks.items)) {
      return [];
    }
    return payload.tracks.items
      .map((value): SpotifyCatalogTrack | null => {
        if (!isRecord(value)) return null;
        const uri = text(value.uri);
        const title = text(value.name);
        if (!uri || !/^spotify:track:[A-Za-z0-9]+$/.test(uri) || !title) return null;

        const artists = Array.isArray(value.artists)
          ? value.artists
              .filter(isRecord)
              .map((artist) => text(artist.name))
              .filter((name): name is string => name !== null)
          : [];
        const album = isRecord(value.album) ? value.album : {};
        const externalUrls = isRecord(value.external_urls) ? value.external_urls : {};
        const durationMs =
          typeof value.duration_ms === 'number' && Number.isFinite(value.duration_ms)
            ? value.duration_ms
            : null;

        return {
          uri,
          title,
          artists,
          album: text(album.name) || '',
          artworkUrl: safeImage(album.images),
          spotifyUrl: safeSpotifyUrl(externalUrls.spotify),
          durationMs,
        };
      })
      .filter((track): track is SpotifyCatalogTrack => track !== null)
      .slice(0, 8);
  }
}
