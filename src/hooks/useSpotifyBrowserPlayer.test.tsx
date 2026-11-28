import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSpotifyBrowserPlayer } from './useSpotifyBrowserPlayer';

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.Spotify;
  delete window.onSpotifyWebPlaybackSDKReady;
});

describe('useSpotifyBrowserPlayer', () => {
  it('sets volume through Spotify’s device API as well as the local player', async () => {
    const listeners = new Map<string, (payload?: unknown) => void>();
    const player = {
      addListener: vi.fn((event: string, listener: (payload?: unknown) => void) => {
        listeners.set(event, listener);
        return true;
      }),
      connect: vi.fn(async () => {
        listeners.get('ready')?.({ device_id: 'browser-device-id' });
        return true;
      }),
      disconnect: vi.fn(),
      getVolume: vi.fn(async () => 0.5),
      setVolume: vi.fn(async () => undefined),
    };
    window.Spotify = {
      Player: vi.fn(function SpotifyPlayerMock() {
        return player as never;
      }),
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetcher);

    const { result } = renderHook(() => useSpotifyBrowserPlayer(true, true));
    await waitFor(() => expect(result.current.snapshot.connection).toBe('connected'));

    await act(async () => {
      await expect(result.current.control('volume', 32)).resolves.toEqual({ ok: true });
    });

    expect(fetcher).toHaveBeenCalledWith(
      '/abbai-flow/music/library/playback-control',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'volume', value: 32, deviceId: 'browser-device-id' }),
      }),
    );
    expect(player.setVolume).toHaveBeenCalledWith(0.32);
    expect(result.current.snapshot.playback.volume).toBe(32);
  });
});
