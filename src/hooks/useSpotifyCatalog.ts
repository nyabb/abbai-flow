import { useCallback } from 'react';
import type { SpotifyCatalogTrack } from '../api/spotify-catalog';

export function useSpotifyCatalog() {
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
        error: 'Spotify search is unavailable',
      };
    }
  }, []);

  return { search };
}
