import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SpotifyPlaylist,
  SpotifyPlaylistPage,
  SpotifyPlaylistStatus,
  SpotifyPlaylistTrack,
} from '../api/spotify-playlists';

interface PlaylistActionResult {
  ok: boolean;
  error?: string;
}

export interface UseSpotifyPlaylistsResult {
  status: SpotifyPlaylistStatus;
  playlists: SpotifyPlaylist[];
  playlistsTotal: number;
  selectedPlaylist: SpotifyPlaylist | null;
  selectedPlaylistId: string | null;
  tracks: SpotifyPlaylistTrack[];
  tracksTotal: number;
  loading: boolean;
  tracksLoading: boolean;
  working: boolean;
  error: string | null;
  connect(): Promise<PlaylistActionResult>;
  refresh(): Promise<void>;
  fetchPlaylists(): Promise<void>;
  selectPlaylist(playlistId: string): void;
  loadMoreTracks(): void;
  createPlaylist(name: string): Promise<PlaylistActionResult>;
  addTrack(playlistId: string, uri: string): Promise<PlaylistActionResult>;
  removePlaylist(playlistId: string): Promise<PlaylistActionResult>;
}

const EMPTY_STATUS: SpotifyPlaylistStatus = {
  configured: false,
  credentialsConfigured: false,
  authorized: false,
  redirectConfigured: false,
};

function readSelectedId(): string | null {
  try {
    return window.localStorage.getItem('abbai-flow.spotify.selected-playlist');
  } catch {
    return null;
  }
}

function saveSelectedId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem('abbai-flow.spotify.selected-playlist', id);
    else window.localStorage.removeItem('abbai-flow.spotify.selected-playlist');
  } catch {
    // Playlist selection still works for this page view when storage is blocked.
  }
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || 'Spotify playlist request failed');
  return result;
}

export function useSpotifyPlaylists() {
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [playlistsTotal, setPlaylistsTotal] = useState(0);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(readSelectedId);
  const [tracks, setTracks] = useState<SpotifyPlaylistTrack[]>([]);
  const [tracksTotal, setTracksTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trackRequest = useRef(0);
  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedPlaylistId) || null,
    [playlists, selectedPlaylistId],
  );

  const fetchPlaylists = useCallback(
    async (append = false) => {
      const offset = append ? playlists.length : 0;
      const page = await jsonRequest<SpotifyPlaylistPage<SpotifyPlaylist>>(
        `/abbai-flow/music/library/playlists?offset=${offset}`,
      );
      setPlaylists((current) => (append ? [...current, ...page.items] : page.items));
      setPlaylistsTotal(page.total);
      return page.items;
    },
    [playlists.length],
  );

  const fetchTracks = useCallback(async (playlistId: string, offset = 0, append = false) => {
    const requestId = ++trackRequest.current;
    setTracksLoading(true);
    setError(null);
    try {
      const page = await jsonRequest<SpotifyPlaylistPage<SpotifyPlaylistTrack>>(
        `/abbai-flow/music/library/playlists/${encodeURIComponent(playlistId)}/items?offset=${offset}`,
      );
      if (requestId !== trackRequest.current) return;
      setTracks((current) => (append ? [...current, ...page.items] : page.items));
      setTracksTotal(page.total);
    } catch (caught) {
      if (requestId !== trackRequest.current) return;
      setError(caught instanceof Error ? caught.message : 'Could not load this playlist');
      if (!append) {
        setTracks([]);
        setTracksTotal(0);
      }
    } finally {
      if (requestId === trackRequest.current) setTracksLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextStatus = await jsonRequest<SpotifyPlaylistStatus>(
        '/abbai-flow/music/library/status',
      );
      setStatus(nextStatus);
      if (!nextStatus.authorized) {
        setPlaylists([]);
        setPlaylistsTotal(0);
        setSelectedPlaylistId(null);
        setTracks([]);
        setTracksTotal(0);
        saveSelectedId(null);
        return;
      }
      const page = await jsonRequest<SpotifyPlaylistPage<SpotifyPlaylist>>(
        '/abbai-flow/music/library/playlists?offset=0',
      );
      setPlaylists(page.items);
      setPlaylistsTotal(page.total);
      const preferredId = readSelectedId();
      const selected = page.items.find((playlist) => playlist.id === preferredId) || page.items[0];
      setSelectedPlaylistId(selected?.id || null);
      saveSelectedId(selected?.id || null);
      if (selected) await fetchTracks(selected.id);
      else {
        setTracks([]);
        setTracksTotal(0);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load Spotify playlists');
    } finally {
      setLoading(false);
    }
  }, [fetchTracks]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = useCallback(async (): Promise<PlaylistActionResult> => {
    try {
      const result = await jsonRequest<{ authorizationUrl: string }>(
        '/abbai-flow/music/library/connect',
        { method: 'POST' },
      );
      const authorization = new URL(result.authorizationUrl);
      if (
        authorization.protocol !== 'https:' ||
        authorization.hostname !== 'accounts.spotify.com'
      ) {
        throw new Error('Spotify returned an invalid authorization address');
      }
      window.location.assign(authorization.toString());
      return { ok: true };
    } catch (caught) {
      return {
        ok: false,
        error: caught instanceof Error ? caught.message : 'Could not connect Spotify',
      };
    }
  }, []);

  const selectPlaylist = useCallback(
    (playlistId: string) => {
      setSelectedPlaylistId(playlistId);
      saveSelectedId(playlistId);
      setTracks([]);
      setTracksTotal(0);
      void fetchTracks(playlistId);
    },
    [fetchTracks],
  );

  const loadMorePlaylists = useCallback(async () => {
    try {
      await fetchPlaylists(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load more playlists');
    }
  }, [fetchPlaylists]);

  const loadMoreTracks = useCallback(() => {
    if (selectedPlaylistId && tracks.length < tracksTotal) {
      void fetchTracks(selectedPlaylistId, tracks.length, true);
    }
  }, [fetchTracks, selectedPlaylistId, tracks.length, tracksTotal]);

  const createPlaylist = useCallback(async (name: string): Promise<PlaylistActionResult> => {
    setWorking(true);
    setError(null);
    try {
      const result = await jsonRequest<{ playlist: SpotifyPlaylist }>(
        '/abbai-flow/music/library/playlists',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        },
      );
      const playlist = result.playlist;
      setPlaylists((current) => [playlist, ...current.filter((item) => item.id !== playlist.id)]);
      setPlaylistsTotal((current) => current + 1);
      setSelectedPlaylistId(playlist.id);
      saveSelectedId(playlist.id);
      setTracks([]);
      setTracksTotal(0);
      return { ok: true };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not create playlist';
      setError(message);
      return { ok: false, error: message };
    } finally {
      setWorking(false);
    }
  }, []);

  const addTrack = useCallback(
    async (playlistId: string, uri: string): Promise<PlaylistActionResult> => {
      setWorking(true);
      setError(null);
      try {
        await jsonRequest<{ accepted: boolean }>(
          `/abbai-flow/music/library/playlists/${encodeURIComponent(playlistId)}/items`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uri }),
          },
        );
        await fetchPlaylists();
        if (selectedPlaylistId === playlistId) await fetchTracks(playlistId);
        return { ok: true };
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Could not add song to playlist';
        setError(message);
        return { ok: false, error: message };
      } finally {
        setWorking(false);
      }
    },
    [fetchPlaylists, fetchTracks, selectedPlaylistId],
  );

  const removePlaylist = useCallback(
    async (playlistId: string): Promise<PlaylistActionResult> => {
      setWorking(true);
      setError(null);
      try {
        await jsonRequest<{ accepted: boolean }>(
          `/abbai-flow/music/library/playlists/${encodeURIComponent(playlistId)}`,
          { method: 'DELETE' },
        );

        const remaining = playlists.filter((playlist) => playlist.id !== playlistId);
        const nextSelectedId =
          selectedPlaylistId === playlistId ? (remaining[0]?.id ?? null) : selectedPlaylistId;
        setPlaylists(remaining);
        setPlaylistsTotal((current) => Math.max(0, current - 1));
        setSelectedPlaylistId(nextSelectedId);
        saveSelectedId(nextSelectedId);

        if (selectedPlaylistId === playlistId) {
          if (nextSelectedId) await fetchTracks(nextSelectedId);
          else {
            setTracks([]);
            setTracksTotal(0);
          }
        }
        return { ok: true };
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Could not remove playlist';
        setError(message);
        return { ok: false, error: message };
      } finally {
        setWorking(false);
      }
    },
    [fetchTracks, playlists, selectedPlaylistId],
  );

  return {
    status,
    playlists,
    playlistsTotal,
    selectedPlaylist,
    selectedPlaylistId,
    tracks,
    tracksTotal,
    loading,
    tracksLoading,
    working,
    error,
    connect,
    refresh,
    fetchPlaylists: loadMorePlaylists,
    selectPlaylist,
    loadMoreTracks,
    createPlaylist,
    addTrack,
    removePlaylist,
  };
}
