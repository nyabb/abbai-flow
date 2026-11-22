import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { EncoreSnapshot } from '../api/encore-music';
import { useEncoreMusic } from './useEncoreMusic';

class FakeEventSource {
  static instance: FakeEventSource | null = null;
  private readonly listeners: Array<(event: Event) => void> = [];
  close = vi.fn();

  constructor(readonly url: string) {
    FakeEventSource.instance = this;
  }

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener === 'function') this.listeners.push(listener);
  }

  emitState(snapshot: EncoreSnapshot): void {
    const event = new MessageEvent('state', { data: JSON.stringify(snapshot) });
    for (const listener of this.listeners) listener(event);
  }
}

function state(updatedAt: number, status: EncoreSnapshot['playback']['status']): EncoreSnapshot {
  return {
    configured: true,
    connection: 'connected',
    auth: { loggedIn: true, isActive: true, deviceName: 'Abbai Party' },
    playback: {
      status,
      item: null,
      context: null,
      position: null,
      volume: 50,
      options: { shuffle: false, repeat: 'off' },
      availableActions: ['play', 'pause'],
    },
    queue: { previous: [], upcoming: [] },
    error: null,
    updatedAt,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.instance = null;
});

describe('useEncoreMusic', () => {
  it('loads initial state and applies new backend events without refreshing', async () => {
    const initial = state(10, 'paused');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => initial,
          }) as unknown as Response,
      ),
    );
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);

    const { result, unmount } = renderHook(() => useEncoreMusic());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.snapshot.playback.status).toBe('paused');
    expect(FakeEventSource.instance?.url).toBe('/abbai-flow/music/events');

    act(() => FakeEventSource.instance?.emitState(state(11, 'playing')));
    expect(result.current.snapshot.playback.status).toBe('playing');

    unmount();
    expect(FakeEventSource.instance?.close).toHaveBeenCalledOnce();
  });
});
