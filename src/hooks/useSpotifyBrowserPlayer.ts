import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  MusicEntity,
  MusicPlayback,
  MusicQueueItem,
  MusicSnapshot,
} from '../api/music-player';

interface SpotifyBrowserTrack {
  uri?: string;
  type?: string;
  name?: string;
  duration_ms?: number;
  artists?: Array<{ name?: string }>;
  album?: { name?: string; images?: Array<{ url?: string }> };
}

interface SpotifyBrowserState {
  context?: {
    uri?: string;
    metadata?: Record<string, unknown>;
  };
  disallows?: Record<string, boolean | undefined>;
  paused: boolean;
  position: number;
  repeat_mode: number;
  shuffle: boolean;
  track_window: {
    current_track?: SpotifyBrowserTrack;
    previous_tracks?: SpotifyBrowserTrack[];
    next_tracks?: SpotifyBrowserTrack[];
  };
}

interface SpotifyBrowserPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(
    event: 'ready' | 'not_ready',
    listener: (payload: { device_id: string }) => void,
  ): boolean;
  addListener(
    event: 'player_state_changed',
    listener: (payload: SpotifyBrowserState | null) => void,
  ): boolean;
  addListener(event: 'autoplay_failed', listener: () => void): boolean;
  addListener(
    event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
    listener: (payload: { message: string }) => void,
  ): boolean;
  activateElement(): Promise<void>;
  getCurrentState(): Promise<SpotifyBrowserState | null>;
  getVolume(): Promise<number>;
  setVolume(volume: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  previousTrack(): Promise<void>;
  nextTrack(): Promise<void>;
  seek(positionMs: number): Promise<void>;
}

interface SpotifyBrowserSdk {
  Player: new (options: {
    name: string;
    volume: number;
    enableMediaSession: boolean;
    getOAuthToken(callback: (token: string) => void): void;
  }) => SpotifyBrowserPlayer;
}

declare global {
  interface Window {
    Spotify?: SpotifyBrowserSdk;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let sdkPromise: Promise<SpotifyBrowserSdk> | null = null;

const EMPTY_PLAYBACK: MusicPlayback = {
  status: 'idle',
  item: null,
  context: null,
  position: null,
  volume: null,
  options: { shuffle: null, repeat: null },
  availableActions: [],
};

function emptySnapshot(authorized: boolean, playbackAuthorized: boolean): MusicSnapshot {
  return {
    configured: playbackAuthorized,
    connection: 'disconnected',
    auth: {
      loggedIn: authorized,
      isActive: false,
      deviceName: null,
    },
    playback: { ...EMPTY_PLAYBACK, options: { ...EMPTY_PLAYBACK.options } },
    queue: { previous: [], upcoming: [] },
    error: null,
    updatedAt: Date.now(),
  };
}

function loadSpotifySdk(): Promise<SpotifyBrowserSdk> {
  if (window.Spotify) return Promise.resolve(window.Spotify);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-spotify-web-playback-sdk]',
    );
    const script = existingScript || document.createElement('script');
    const timeout = window.setTimeout(() => {
      sdkPromise = null;
      reject(new Error('Spotify browser player could not load'));
    }, 20_000);
    const previousReady = window.onSpotifyWebPlaybackSDKReady;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (window.Spotify) resolve(window.Spotify);
      else reject(new Error('Spotify browser player did not initialize'));
    };

    window.onSpotifyWebPlaybackSDKReady = () => {
      previousReady?.();
      finish();
    };
    script.addEventListener(
      'error',
      () => {
        window.clearTimeout(timeout);
        sdkPromise = null;
        reject(new Error('Spotify browser player could not load'));
      },
      { once: true },
    );
    if (!existingScript) {
      script.dataset.spotifyWebPlaybackSdk = 'true';
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      document.head.append(script);
    }
  });

  return sdkPromise;
}

function normalizeTrack(track: SpotifyBrowserTrack | undefined): MusicEntity | null {
  if (!track) return null;
  const artwork = track.album?.images?.find((image) => typeof image.url === 'string')?.url;
  return {
    uri: typeof track.uri === 'string' ? track.uri : null,
    entityType: typeof track.type === 'string' ? track.type : null,
    title: typeof track.name === 'string' ? track.name : null,
    artists: (track.artists || [])
      .map((artist) => artist.name)
      .filter((name): name is string => typeof name === 'string'),
    album: typeof track.album?.name === 'string' ? track.album.name : null,
    artworkUrl: typeof artwork === 'string' ? artwork : null,
    durationMs:
      typeof track.duration_ms === 'number' && Number.isFinite(track.duration_ms)
        ? track.duration_ms
        : null,
  };
}

function normalizeQueue(tracks: SpotifyBrowserTrack[] | undefined): MusicQueueItem[] {
  return (tracks || [])
    .map((track) => normalizeTrack(track))
    .filter((track): track is MusicEntity => track !== null)
    .map((track) => ({ ...track, source: null }));
}

function snapshotFromPlayerState(
  state: SpotifyBrowserState | null,
  current: MusicSnapshot,
): MusicSnapshot {
  if (!state) {
    return {
      ...current,
      playback: { ...EMPTY_PLAYBACK, volume: current.playback.volume },
      queue: { previous: [], upcoming: [] },
      updatedAt: Date.now(),
    };
  }

  const track = normalizeTrack(state.track_window.current_track);
  const contextUri = state.context?.uri;
  const contextMetadata = state.context?.metadata;
  const contextTitle =
    typeof contextMetadata?.title === 'string'
      ? contextMetadata.title
      : typeof contextMetadata?.name === 'string'
        ? contextMetadata.name
        : null;
  const context: MusicEntity | null = contextUri
    ? {
        uri: contextUri,
        entityType: contextUri.split(':')[1] || null,
        title: contextTitle,
        artists: [],
        album: null,
        artworkUrl: null,
        durationMs: null,
      }
    : null;
  const disallows = state.disallows || {};
  const availableActions = [
    ...(state.paused ? ['play'] : ['pause']),
    ...(!disallows.skipping_prev ? ['skip_prev'] : []),
    ...(!disallows.skipping_next ? ['skip_next'] : []),
    ...(!disallows.seeking ? ['seek'] : []),
  ];

  return {
    ...current,
    auth: { ...current.auth, isActive: true },
    playback: {
      status: track ? (state.paused ? 'paused' : 'playing') : 'idle',
      item: track,
      context,
      position:
        typeof state.position === 'number'
          ? { positionMs: state.position, timestampMs: Date.now(), speed: state.paused ? 0 : 1 }
          : null,
      volume: current.playback.volume,
      options: {
        shuffle: typeof state.shuffle === 'boolean' ? state.shuffle : null,
        repeat: state.repeat_mode === 1 ? 'context' : state.repeat_mode === 2 ? 'track' : 'off',
      },
      availableActions,
    },
    queue: {
      previous: normalizeQueue(state.track_window.previous_tracks),
      upcoming: normalizeQueue(state.track_window.next_tracks),
    },
    error: null,
    updatedAt: Date.now(),
  };
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Spotify playback request failed');
  return payload;
}

export function useSpotifyBrowserPlayer(authorized: boolean, playbackAuthorized: boolean) {
  const [snapshot, setSnapshot] = useState(() => emptySnapshot(authorized, playbackAuthorized));
  const [loading, setLoading] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const playerRef = useRef<SpotifyBrowserPlayer | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    if (!authorized || !playbackAuthorized) {
      setSnapshot(emptySnapshot(authorized, playbackAuthorized));
      setDeviceId(null);
      setLoading(false);
      return;
    }

    let disposed = false;
    setLoading(true);
    setSnapshot({
      ...emptySnapshot(true, true),
      connection: 'connecting',
      error: null,
    });

    const updateSnapshot = (next: MusicSnapshot) => {
      if (disposed) return;
      snapshotRef.current = next;
      setSnapshot(next);
    };

    void loadSpotifySdk()
      .then((sdk) => {
        if (disposed) return;
        const player = new sdk.Player({
          name: 'Abbai Flow Browser',
          volume: 0.5,
          enableMediaSession: true,
          getOAuthToken(callback) {
            void jsonRequest<{ accessToken: string }>('/abbai-flow/music/library/playback-token')
              .then(({ accessToken }) => callback(accessToken))
              .catch(() => {
                updateSnapshot({
                  ...snapshotRef.current,
                  error: 'Reconnect Spotify to enable browser playback',
                  updatedAt: Date.now(),
                });
              });
          },
        });
        playerRef.current = player;
        player.addListener('ready', ({ device_id }) => {
          setDeviceId(device_id);
          updateSnapshot({
            ...snapshotRef.current,
            connection: 'connected',
            auth: { loggedIn: true, isActive: false, deviceName: 'This browser' },
            error: null,
            updatedAt: Date.now(),
          });
          void player.getVolume().then((volume) => {
            updateSnapshot({
              ...snapshotRef.current,
              playback: { ...snapshotRef.current.playback, volume: Math.round(volume * 100) },
              updatedAt: Date.now(),
            });
          });
        });
        player.addListener('not_ready', () => {
          setDeviceId(null);
          updateSnapshot({
            ...snapshotRef.current,
            connection: 'disconnected',
            auth: { ...snapshotRef.current.auth, isActive: false },
            error: 'Browser player disconnected',
            updatedAt: Date.now(),
          });
        });
        player.addListener('player_state_changed', (state) => {
          updateSnapshot(snapshotFromPlayerState(state, snapshotRef.current));
        });
        player.addListener('autoplay_failed', () => {
          updateSnapshot({
            ...snapshotRef.current,
            error: 'Click play to allow the browser to start audio',
            updatedAt: Date.now(),
          });
        });
        player.addListener('initialization_error', () => {
          updateSnapshot({
            ...snapshotRef.current,
            connection: 'disconnected',
            error: 'This browser cannot initialize Spotify playback',
            updatedAt: Date.now(),
          });
        });
        player.addListener('authentication_error', () => {
          updateSnapshot({
            ...snapshotRef.current,
            connection: 'disconnected',
            error: 'Reconnect Spotify to enable browser playback',
            updatedAt: Date.now(),
          });
        });
        player.addListener('account_error', () => {
          updateSnapshot({
            ...snapshotRef.current,
            connection: 'disconnected',
            error: 'Spotify Premium is required for browser playback',
            updatedAt: Date.now(),
          });
        });
        player.addListener('playback_error', () => {
          updateSnapshot({
            ...snapshotRef.current,
            error: 'Spotify could not start playback in this browser',
            updatedAt: Date.now(),
          });
        });
        void player.connect().then((connected) => {
          if (!connected && !disposed) {
            updateSnapshot({
              ...snapshotRef.current,
              connection: 'disconnected',
              error: 'Spotify browser player could not connect',
              updatedAt: Date.now(),
            });
          }
        });
      })
      .catch((error: unknown) => {
        updateSnapshot({
          ...snapshotRef.current,
          connection: 'disconnected',
          error: error instanceof Error ? error.message : 'Spotify browser player could not load',
          updatedAt: Date.now(),
        });
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
      playerRef.current?.disconnect();
      playerRef.current = null;
      setDeviceId(null);
    };
  }, [authorized, playbackAuthorized]);

  const sendSpotifyControl = useCallback(
    async (action: string, value?: unknown) => {
      if (!deviceId) return { ok: false, error: 'Browser player is not ready yet' };
      try {
        await jsonRequest('/abbai-flow/music/library/playback-control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...(value === undefined ? {} : { value }), deviceId }),
        });
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Spotify playback request failed',
        };
      }
    },
    [deviceId],
  );

  const control = useCallback(
    async (action: string, value?: unknown) => {
      const player = playerRef.current;
      if (!player || !deviceId) return { ok: false, error: 'Browser player is not ready yet' };
      try {
        if (action === 'playTrack' || action === 'playPlaylist') {
          void player.activateElement().catch(() => undefined);
        }
        switch (action) {
          case 'playTrack':
          case 'playPlaylist':
          case 'shuffle':
          case 'repeat': {
            const result = await sendSpotifyControl(action, value);
            if (!result.ok) return result;
            if (action === 'playTrack' || action === 'playPlaylist') {
              setSnapshot((current) => ({
                ...current,
                auth: { ...current.auth, isActive: true },
                error: null,
                updatedAt: Date.now(),
              }));
            }
            return result;
          }
          case 'play':
            await player.resume();
            break;
          case 'pause':
            await player.pause();
            break;
          case 'previous':
            await player.previousTrack();
            break;
          case 'next':
            await player.nextTrack();
            break;
          case 'seek':
            if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
              return { ok: false, error: 'Seek position must be a non-negative integer' };
            }
            await player.seek(value);
            break;
          case 'volume':
            if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
              return { ok: false, error: 'Volume must be an integer from 0 to 100' };
            }
            await player.setVolume(value / 100);
            setSnapshot((current) => ({
              ...current,
              playback: { ...current.playback, volume: value },
              updatedAt: Date.now(),
            }));
            break;
          default:
            return { ok: false, error: 'Unsupported browser playback control' };
        }
        return { ok: true };
      } catch {
        return { ok: false, error: 'Spotify playback request failed' };
      }
    },
    [deviceId, sendSpotifyControl],
  );

  return {
    snapshot,
    loading,
    ready: Boolean(deviceId && snapshot.connection === 'connected'),
    control,
  };
}
