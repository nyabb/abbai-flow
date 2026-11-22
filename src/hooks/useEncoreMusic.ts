import { useCallback, useEffect, useRef, useState } from 'react';
import type { EncoreSnapshot } from '../api/encore-music';
import type { SpotifyCatalogTrack } from '../api/spotify-catalog';

const EMPTY_STATE: EncoreSnapshot = {
  configured: false,
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
  updatedAt: 0,
};

export function useEncoreMusic() {
  const [snapshot, setSnapshot] = useState<EncoreSnapshot>(EMPTY_STATE);
  const snapshotRef = useRef(snapshot);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    const applySnapshot = (next: EncoreSnapshot) => {
      if (disposed || next.updatedAt < snapshotRef.current.updatedAt) return;
      snapshotRef.current = next;
      setSnapshot(next);
      setLoading(false);
    };

    fetch('/abbai-flow/music/state', { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Music service unavailable');
        applySnapshot((await response.json()) as EncoreSnapshot);
      })
      .catch(() => {
        if (disposed) return;
        const disconnected = {
          ...snapshotRef.current,
          connection: 'disconnected' as const,
          error: 'Music service unavailable',
        };
        snapshotRef.current = disconnected;
        setSnapshot(disconnected);
        setLoading(false);
      });

    const events = new EventSource('/abbai-flow/music/events');
    events.addEventListener('state', (event) => {
      try {
        applySnapshot(JSON.parse((event as MessageEvent<string>).data) as EncoreSnapshot);
      } catch {
        // Ignore malformed data and keep rendering the latest valid snapshot.
      }
    });

    return () => {
      disposed = true;
      events.close();
    };
  }, []);

  const control = useCallback(async (action: string, value?: unknown) => {
    try {
      const response = await fetch('/abbai-flow/music/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value === undefined ? { action } : { action, value }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) return { ok: false, error: result.error || 'Control request failed' };
      return { ok: true };
    } catch {
      return { ok: false, error: 'Music service unavailable' };
    }
  }, []);

  const search = useCallback(async (query: string) => {
    try {
      const response = await fetch(
        '/abbai-flow/music/search?' + new URLSearchParams({ q: query }),
        { headers: { Accept: 'application/json' } },
      );
      const result = (await response.json()) as {
        tracks?: SpotifyCatalogTrack[];
        code?: string;
        error?: string;
      };
      if (!response.ok) {
        return {
          tracks: [] as SpotifyCatalogTrack[],
          code: result.code,
          error: result.error || 'Spotify search is unavailable',
        };
      }
      return { tracks: result.tracks || [] };
    } catch {
      return {
        tracks: [] as SpotifyCatalogTrack[],
        code: 'unavailable',
        error: 'Music service unavailable',
      };
    }
  }, []);

  return { snapshot, loading, control, search };
}
