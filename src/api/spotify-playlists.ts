const SPOTIFY_API = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN = 'https://accounts.spotify.com/api/token';
const SPOTIFY_AUTHORIZE = 'https://accounts.spotify.com/authorize';
const PLAYLIST_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
].join(' ');
const AUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface SpotifyPlaylist {
  id: string;
  uri: string;
  name: string;
  artworkUrl: string | null;
  spotifyUrl: string | null;
  ownerName: string | null;
  trackCount: number;
  isPublic: boolean | null;
}

export interface SpotifyPlaylistTrack {
  uri: string;
  title: string;
  artists: string[];
  album: string;
  artworkUrl: string | null;
  spotifyUrl: string | null;
  durationMs: number | null;
}

export interface SpotifyPlaylistPage<T> {
  items: T[];
  total: number;
  offset: number;
}

export interface SpotifyPlaylistStatus {
  configured: boolean;
  credentialsConfigured: boolean;
  authorized: boolean;
  redirectConfigured: boolean;
}

export type SpotifyPlaylistErrorCode =
  | 'not_configured'
  | 'not_authorized'
  | 'invalid_request'
  | 'authorization_failed'
  | 'rate_limited'
  | 'forbidden'
  | 'unavailable';

export class SpotifyPlaylistError extends Error {
  constructor(
    readonly code: SpotifyPlaylistErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SpotifyPlaylistError';
  }
}

export interface SpotifyPlaylistLibraryOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  market?: string;
  tokenStore?: SpotifyPlaylistTokenStore;
  createState?: () => string;
  fetcher?: typeof fetch;
  now?: () => number;
}

export interface SpotifyPlaylistTokenStore {
  load(): Promise<unknown | null>;
  save(token: { accessToken: string; refreshToken: string; expiresAt: number }): Promise<void>;
  clear?(): Promise<void>;
}

interface StoredSpotifyToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface JsonRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeSpotifyUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && url.hostname === 'open.spotify.com' ? url.toString() : null;
  } catch {
    return null;
  }
}

function imageUrl(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const image = value.find((entry) => isRecord(entry) && typeof entry.url === 'string');
  if (!isRecord(image)) return null;
  try {
    const url = new URL(image.url as string);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function spotifyId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9]{22}$/.test(value) ? value : null;
}

function normalizePlaylist(value: unknown): SpotifyPlaylist | null {
  if (!isRecord(value)) return null;
  const id = spotifyId(value.id);
  const name = text(value.name);
  if (!id || !name) return null;
  const owner = isRecord(value.owner) ? value.owner : {};
  const externalUrls = isRecord(value.external_urls) ? value.external_urls : {};
  const items = isRecord(value.items) ? value.items : {};
  const tracks = isRecord(value.tracks) ? value.tracks : {};
  const trackCount = items.total ?? tracks.total;
  return {
    id,
    uri: `spotify:playlist:${id}`,
    name,
    artworkUrl: imageUrl(value.images),
    spotifyUrl: safeSpotifyUrl(externalUrls.spotify),
    ownerName: text(owner.display_name),
    trackCount:
      typeof trackCount === 'number' && Number.isSafeInteger(trackCount) && trackCount >= 0
        ? trackCount
        : 0,
    isPublic: typeof value.public === 'boolean' ? value.public : null,
  };
}

function normalizeTrack(value: unknown): SpotifyPlaylistTrack | null {
  if (!isRecord(value) || value.type !== 'track') return null;
  const uri = text(value.uri);
  const title = text(value.name);
  if (!uri || !/^spotify:track:[A-Za-z0-9]{1,64}$/.test(uri) || !title) return null;
  const album = isRecord(value.album) ? value.album : {};
  const externalUrls = isRecord(value.external_urls) ? value.external_urls : {};
  const artists = Array.isArray(value.artists)
    ? value.artists
        .filter((artist): artist is JsonRecord => isRecord(artist))
        .map((artist) => text(artist.name))
        .filter((name): name is string => name !== null)
    : [];
  return {
    uri,
    title,
    artists,
    album: text(album.name) || '',
    artworkUrl: imageUrl(album.images),
    spotifyUrl: safeSpotifyUrl(externalUrls.spotify),
    durationMs:
      typeof value.duration_ms === 'number' && Number.isFinite(value.duration_ms)
        ? value.duration_ms
        : null,
  };
}

function validRedirectUri(value: string): boolean {
  try {
    const uri = new URL(value);
    if (uri.search || uri.hash || !uri.pathname.endsWith('/abbai-flow/music/oauth/callback')) {
      return false;
    }
    if (uri.protocol === 'https:') return true;
    return (
      uri.protocol === 'http:' &&
      (uri.hostname === 'localhost' || uri.hostname === '127.0.0.1' || uri.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

function tokenFromPayload(
  value: unknown,
  previous: StoredSpotifyToken | undefined,
  now: number,
): StoredSpotifyToken | null {
  if (!isRecord(value)) return null;
  const accessToken = text(value.access_token);
  const refreshToken = text(value.refresh_token) || previous?.refreshToken || null;
  const expiresIn = value.expires_in;
  if (
    !accessToken ||
    !refreshToken ||
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn)
  ) {
    return null;
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: now + Math.max(0, expiresIn) * 1000,
  };
}

/** Server-only user authorization and Spotify playlist API client. */
export class SpotifyPlaylistLibrary {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly market: string;
  private readonly tokenStore?: SpotifyPlaylistTokenStore;
  private readonly createState: () => string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private token: StoredSpotifyToken | null = null;
  private loadingToken: Promise<void> | null = null;
  private refreshingToken: Promise<string> | null = null;
  private readonly pendingStates = new Map<string, number>();

  constructor(options: SpotifyPlaylistLibraryOptions = {}) {
    this.clientId = options.clientId?.trim() || '';
    this.clientSecret = options.clientSecret?.trim() || '';
    this.redirectUri = options.redirectUri?.trim() || '';
    this.market = /^[A-Z]{2}$/.test(options.market || '') ? options.market! : 'NL';
    this.tokenStore = options.tokenStore;
    this.createState =
      options.createState ||
      (() => {
        const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
        return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      });
    this.fetcher = options.fetcher || fetch;
    this.now = options.now || Date.now;
  }

  async status(): Promise<SpotifyPlaylistStatus> {
    await this.loadToken();
    const credentialsConfigured = Boolean(this.clientId && this.clientSecret);
    const redirectConfigured = validRedirectUri(this.redirectUri);
    return {
      configured: credentialsConfigured && redirectConfigured,
      credentialsConfigured,
      authorized: Boolean(this.token?.refreshToken),
      redirectConfigured,
    };
  }

  async beginAuthorization(): Promise<string> {
    this.ensureConfigured();
    const state = this.createState();
    this.pendingStates.set(state, this.now() + AUTH_STATE_TTL_MS);
    for (const [oldState, expiresAt] of this.pendingStates) {
      if (expiresAt < this.now()) this.pendingStates.delete(oldState);
    }
    while (this.pendingStates.size > 10) {
      const oldest = this.pendingStates.keys().next().value;
      if (!oldest) break;
      this.pendingStates.delete(oldest);
    }

    const url = new URL(SPOTIFY_AUTHORIZE);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('scope', PLAYLIST_SCOPES);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async completeAuthorization(
    codeValue: unknown,
    stateValue: unknown,
    errorValue?: unknown,
  ): Promise<void> {
    this.ensureConfigured();
    const code = typeof codeValue === 'string' ? codeValue : '';
    const state = typeof stateValue === 'string' ? stateValue : '';
    const expiresAt = this.pendingStates.get(state);
    this.pendingStates.delete(state);
    if (!state || expiresAt === undefined || expiresAt < this.now()) {
      throw new SpotifyPlaylistError(
        'authorization_failed',
        400,
        'Spotify authorization could not be verified',
      );
    }
    if (errorValue) {
      throw new SpotifyPlaylistError(
        'authorization_failed',
        400,
        'Spotify authorization was declined',
      );
    }
    if (!code || code.length > 2048) {
      throw new SpotifyPlaylistError(
        'authorization_failed',
        400,
        'Spotify authorization did not return a code',
      );
    }

    const response = await this.fetcher(SPOTIFY_TOKEN, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${this.clientId}:${this.clientSecret}`),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
      }),
      signal: AbortSignal.timeout(12_000),
    }).catch(() => {
      throw new SpotifyPlaylistError(
        'unavailable',
        503,
        'Spotify authorization is temporarily unavailable',
      );
    });

    if (!response.ok) {
      throw new SpotifyPlaylistError(
        'authorization_failed',
        400,
        'Spotify authorization could not be completed',
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SpotifyPlaylistError(
        'authorization_failed',
        400,
        'Spotify returned an invalid authorization response',
      );
    }
    const next = tokenFromPayload(payload, undefined, this.now());
    if (!next) {
      throw new SpotifyPlaylistError(
        'authorization_failed',
        400,
        'Spotify returned an invalid authorization response',
      );
    }
    await this.saveToken(next);
  }

  async listPlaylists(offsetValue: unknown = 0): Promise<SpotifyPlaylistPage<SpotifyPlaylist>> {
    const offset = this.validateOffset(offsetValue);
    const query = new URLSearchParams({ limit: '50', offset: String(offset) });
    const response = await this.spotifyRequest(`/me/playlists?${query}`);
    const payload = await this.jsonResponse(response);
    if (!isRecord(payload) || !Array.isArray(payload.items)) {
      throw new SpotifyPlaylistError(
        'unavailable',
        502,
        'Spotify returned an invalid playlist list',
      );
    }
    const items = payload.items
      .map(normalizePlaylist)
      .filter((playlist): playlist is SpotifyPlaylist => playlist !== null);
    return {
      items,
      total: typeof payload.total === 'number' ? payload.total : items.length,
      offset,
    };
  }

  async getPlaylistItems(
    playlistIdValue: unknown,
    offsetValue: unknown = 0,
  ): Promise<SpotifyPlaylistPage<SpotifyPlaylistTrack>> {
    const playlistId = this.validatePlaylistId(playlistIdValue);
    const offset = this.validateOffset(offsetValue);
    const query = new URLSearchParams({ limit: '50', offset: String(offset), market: this.market });
    const response = await this.spotifyRequest(`/playlists/${playlistId}/items?${query}`);
    const payload = await this.jsonResponse(response);
    if (!isRecord(payload) || !Array.isArray(payload.items)) {
      throw new SpotifyPlaylistError('unavailable', 502, 'Spotify returned an invalid playlist');
    }
    const items = payload.items
      .map((entry) => (isRecord(entry) ? normalizeTrack(entry.item ?? entry.track) : null))
      .filter((track): track is SpotifyPlaylistTrack => track !== null);
    return {
      items,
      total: typeof payload.total === 'number' ? payload.total : items.length,
      offset,
    };
  }

  async createPlaylist(nameValue: unknown): Promise<SpotifyPlaylist> {
    if (typeof nameValue !== 'string') {
      throw new SpotifyPlaylistError(
        'invalid_request',
        400,
        'Playlist name must be 1 to 100 characters',
      );
    }
    const name = nameValue.trim();
    // Reject control characters before sending playlist names to Spotify.
    // eslint-disable-next-line no-control-regex
    if (!name || name.length > 100 || /[\r\n\u0000-\u001f\u007f]/.test(name)) {
      throw new SpotifyPlaylistError(
        'invalid_request',
        400,
        'Playlist name must be 1 to 100 characters',
      );
    }
    const response = await this.spotifyRequest('/me/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, public: false }),
    });
    const playlist = normalizePlaylist(await this.jsonResponse(response));
    if (!playlist) {
      throw new SpotifyPlaylistError('unavailable', 502, 'Spotify returned an invalid playlist');
    }
    return playlist;
  }

  async addTrack(playlistIdValue: unknown, uriValue: unknown): Promise<void> {
    const playlistId = this.validatePlaylistId(playlistIdValue);
    const uri =
      typeof uriValue === 'string' && /^spotify:track:[A-Za-z0-9]{1,64}$/.test(uriValue)
        ? uriValue
        : null;
    if (!uri) {
      throw new SpotifyPlaylistError(
        'invalid_request',
        400,
        'Track URI must be a Spotify track URI',
      );
    }
    await this.spotifyRequest(`/playlists/${playlistId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] }),
    });
  }

  async removePlaylist(playlistIdValue: unknown): Promise<void> {
    const playlistId = this.validatePlaylistId(playlistIdValue);
    const query = new URLSearchParams({ uris: `spotify:playlist:${playlistId}` });
    await this.spotifyRequest(`/me/library?${query}`, { method: 'DELETE' });
  }

  private ensureConfigured(): void {
    if (!this.clientId || !this.clientSecret || !validRedirectUri(this.redirectUri)) {
      throw new SpotifyPlaylistError(
        'not_configured',
        503,
        'Add Spotify developer app credentials and the OAuth redirect URL in Settings → Integrations.',
      );
    }
  }

  private async loadToken(): Promise<void> {
    if (!this.tokenStore || this.token || this.loadingToken) {
      await this.loadingToken;
      return;
    }
    this.loadingToken = this.tokenStore
      .load()
      .then((value) => {
        if (
          isRecord(value) &&
          typeof value.accessToken === 'string' &&
          typeof value.refreshToken === 'string' &&
          typeof value.expiresAt === 'number'
        ) {
          this.token = {
            accessToken: value.accessToken,
            refreshToken: value.refreshToken,
            expiresAt: value.expiresAt,
          };
        }
      })
      .catch(() => {
        // Invalid or unreadable stored credentials should not prevent the rest
        // of Abbai Flow from starting. A new Spotify authorization can replace it.
      })
      .finally(() => {
        this.loadingToken = null;
      });
    await this.loadingToken;
  }

  private async saveToken(token: StoredSpotifyToken): Promise<void> {
    if (this.tokenStore) {
      try {
        await this.tokenStore.save(token);
      } catch {
        throw new SpotifyPlaylistError(
          'unavailable',
          503,
          'Spotify credentials could not be saved securely',
        );
      }
    }
    this.token = token;
  }

  private validateOffset(value: unknown): number {
    if (typeof value === 'number') {
      if (Number.isSafeInteger(value) && value >= 0 && value <= 100_000) return value;
    } else if (typeof value === 'string' && /^\d{1,6}$/.test(value)) {
      const offset = Number(value);
      if (Number.isSafeInteger(offset) && offset <= 100_000) return offset;
    }
    throw new SpotifyPlaylistError(
      'invalid_request',
      400,
      'Playlist offset must be from 0 to 100000',
    );
  }

  private validatePlaylistId(value: unknown): string {
    const id = spotifyId(value);
    if (!id) throw new SpotifyPlaylistError('invalid_request', 400, 'Invalid Spotify playlist ID');
    return id;
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    this.ensureConfigured();
    await this.loadToken();
    if (!this.token?.refreshToken) {
      throw new SpotifyPlaylistError(
        'not_authorized',
        401,
        'Connect a Spotify account to manage playlists',
      );
    }
    if (!forceRefresh && this.token.accessToken && this.token.expiresAt > this.now() + 60_000) {
      return this.token.accessToken;
    }
    if (this.refreshingToken) return this.refreshingToken;

    const current = this.token;
    this.refreshingToken = this.refreshAccessToken(current)
      .then(async (next) => {
        await this.saveToken(next);
        return next.accessToken;
      })
      .finally(() => {
        this.refreshingToken = null;
      });
    return this.refreshingToken;
  }

  private async refreshAccessToken(current: StoredSpotifyToken): Promise<StoredSpotifyToken> {
    const response = await this.fetcher(SPOTIFY_TOKEN, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${this.clientId}:${this.clientSecret}`),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
      }),
      signal: AbortSignal.timeout(12_000),
    }).catch(() => {
      throw new SpotifyPlaylistError(
        'unavailable',
        503,
        'Spotify authorization is temporarily unavailable',
      );
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        this.token = null;
        await this.tokenStore?.clear?.().catch(() => undefined);
        throw new SpotifyPlaylistError('not_authorized', 401, 'Reconnect your Spotify account');
      }
      throw this.responseError(response.status);
    }
    const token = tokenFromPayload(await this.jsonResponse(response), current, this.now());
    if (!token)
      throw new SpotifyPlaylistError(
        'unavailable',
        502,
        'Spotify returned an invalid token response',
      );
    return token;
  }

  private async spotifyRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const send = async (accessToken: string) =>
      this.fetcher(`${SPOTIFY_API}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.headers || {}),
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(12_000),
      });
    let response: Response;
    try {
      response = await send(await this.getAccessToken());
      if (response.status === 401) response = await send(await this.getAccessToken(true));
    } catch (error) {
      if (error instanceof SpotifyPlaylistError) throw error;
      throw new SpotifyPlaylistError('unavailable', 503, 'Spotify is temporarily unavailable');
    }
    if (!response.ok) throw this.responseError(response.status);
    return response;
  }

  private responseError(status: number): SpotifyPlaylistError {
    if (status === 401)
      return new SpotifyPlaylistError('not_authorized', 401, 'Reconnect your Spotify account');
    if (status === 403)
      return new SpotifyPlaylistError('forbidden', 403, 'Spotify denied playlist access');
    if (status === 429)
      return new SpotifyPlaylistError('rate_limited', 429, 'Spotify is busy; try again shortly');
    return new SpotifyPlaylistError('unavailable', 502, 'Spotify is temporarily unavailable');
  }

  private async jsonResponse(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new SpotifyPlaylistError('unavailable', 502, 'Spotify returned an invalid response');
    }
  }
}
