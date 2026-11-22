import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { EncoreMusic, validateEncoreControl } from './encore-music';

type FakeEvent = 'open' | 'message' | 'unexpected-response' | 'error' | 'close';
type FakeListener = (...args: unknown[]) => void;

class FakeSocket {
  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<FakeEvent, FakeListener[]>();

  on(event: FakeEvent, listener: FakeListener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.fire('close');
  }

  open(): void {
    this.readyState = 1;
    this.fire('open');
  }

  receive(message: unknown): void {
    this.fire('message', { toString: () => JSON.stringify(message) });
  }

  fire(event: FakeEvent, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

class FakeWebSocket extends FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  constructor(
    readonly address: string,
    readonly options: { headers?: Record<string, string> },
  ) {
    super();
    sockets.push(this);
  }
}

const sockets: FakeWebSocket[] = [];
const FakeWebSocketClass = FakeWebSocket as unknown as typeof WebSocket;

function createMusic(options: { reconnectBaseMs?: number; reconnectMaxMs?: number } = {}) {
  return new EncoreMusic({
    token: 'server-only-test-token',
    url: 'ws://encore.test:8095/',
    WebSocketClass: FakeWebSocketClass,
    ...options,
  });
}

function entity(title: string, entityType = 'track') {
  return {
    uri: `spotify:${entityType}:sample`,
    entity_type: entityType,
    decorations: {
      identity: { name: title },
      visual_identity: { cover: [{ url: 'https://images.test/cover.jpg', size: 'large' }] },
      playback: { duration_ms: 180_000 },
      parent: { entity: { decorations: { identity: { name: 'Sample Album' } } } },
    },
    creators: [{ entity: { decorations: { identity: { name: 'Sample Artist' } } } }],
  };
}

afterEach(() => {
  vi.useRealTimers();
  sockets.length = 0;
});

describe('EncoreMusic', () => {
  it('connects once, authenticates with a backend-only header, and requests initial state', () => {
    const music = createMusic();
    music.start();
    music.start();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].address).toBe('ws://encore.test:8095/');
    expect(sockets[0].options.headers).toEqual({
      Authorization: 'Bearer server-only-test-token',
    });
    expect(JSON.stringify(music.getSnapshot())).not.toContain('server-only-test-token');

    sockets[0].open();
    sockets[0].receive({
      type: 'auth_state',
      logged_in: true,
      is_active: true,
      device_name: 'Abbai Party',
    });

    expect(music.getSnapshot()).toMatchObject({
      connection: 'connected',
      auth: { loggedIn: true, isActive: true, deviceName: 'Abbai Party' },
    });
    expect(sockets[0].sent.map((frame) => JSON.parse(frame))).toEqual([
      { type: 'command', command: 'get_state' },
      { type: 'command', command: 'get_queue' },
    ]);
    music.stop();
  });

  it('normalizes playback, track changes, pause, volume and queue events', () => {
    const music = createMusic();
    music.start();
    sockets[0].open();
    sockets[0].receive({
      type: 'auth_state',
      logged_in: true,
      is_active: true,
      device_name: 'Abbai Party',
    });
    sockets[0].receive({
      type: 'playback_state',
      status: 'playing',
      item: entity('First Song'),
      context: entity('Sunday Mix', 'playlist'),
      position: { position_ms: 20_000, timestamp_ms: 1000, speed: 1 },
      volume: 42,
      options: { shuffle: true, repeat: 'context' },
      available_actions: { pause: {}, seek: {}, skip_next: {}, skip_prev: {} },
    });

    expect(music.getSnapshot().playback).toMatchObject({
      status: 'playing',
      item: {
        title: 'First Song',
        artists: ['Sample Artist'],
        album: 'Sample Album',
        artworkUrl: 'https://images.test/cover.jpg',
        durationMs: 180_000,
      },
      context: { title: 'Sunday Mix' },
      position: { positionMs: 20_000, timestampMs: 1000 },
      volume: 42,
      options: { shuffle: true, repeat: 'context' },
      availableActions: ['pause', 'seek', 'skip_next', 'skip_prev'],
    });

    sockets[0].receive({ type: 'track_changed', item: entity('Second Song') });
    sockets[0].receive({ type: 'playback_changed', status: 'paused' });
    sockets[0].receive({ type: 'volume_changed', volume: 67 });
    sockets[0].receive({
      type: 'queue_changed',
      previous: [],
      upcoming: [{ source: 'queue', item: entity('Next Song') }],
    });

    expect(music.getSnapshot()).toMatchObject({
      playback: {
        status: 'paused',
        item: { title: 'Second Song' },
        volume: 67,
      },
      queue: { previous: [], upcoming: [{ title: 'Next Song', source: 'queue' }] },
    });
    music.stop();
  });

  it('logs Encore command errors without printing sensitive server messages', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const music = createMusic();
    music.start();
    sockets[0].open();
    sockets[0].receive({ type: 'error', message: 'command requires authentication' });
    sockets[0].receive({ type: 'error', message: 'Bearer server-only-test-token was rejected' });

    expect(warn).toHaveBeenCalledWith(
      '[Integration] Spotify playback command error: command requires authentication',
    );
    expect(warn).toHaveBeenCalledWith(
      '[Integration] Spotify playback command error: Encore returned a command error; details were omitted for safety',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('server-only-test-token');
    warn.mockRestore();
    music.stop();
  });

  it('sends control commands and sets repeat modes in Soloist order', () => {
    const music = createMusic();
    music.start();
    sockets[0].open();
    sockets[0].receive({
      type: 'auth_state',
      logged_in: true,
      is_active: true,
      device_name: 'Abbai Party',
    });

    expect(music.control('seek', 30_000)).toEqual({ ok: true });
    expect(music.control('playTrack', 'spotify:track:abc123')).toEqual({ ok: true });
    expect(music.control('volume', 55)).toEqual({ ok: true });
    expect(music.control('shuffle', true)).toEqual({ ok: true });
    expect(music.control('repeat', 'track')).toEqual({ ok: true });
    expect(sockets[0].sent.slice(2).map((frame) => JSON.parse(frame))).toEqual([
      { type: 'command', command: 'seek', position_ms: 30_000 },
      { type: 'command', command: 'play', uri: 'spotify:track:abc123' },
      { type: 'command', command: 'set_volume', volume: 55 },
      { type: 'command', command: 'set_shuffle', enabled: true },
      { type: 'command', command: 'set_repeat_context', enabled: false },
      { type: 'command', command: 'set_repeat_track', enabled: true },
    ]);
    music.stop();
  });

  it('rejects invalid controls before sending anything', () => {
    const invalid: Array<[unknown, unknown]> = [
      ['volume', 101],
      ['volume', 1.5],
      ['seek', -1],
      ['seek', 1.5],
      ['shuffle', 'true'],
      ['repeat', 'playlist'],
      ['play', false],
      ['playTrack', 'https://open.spotify.com/track/abc123'],
      ['playTrack', 'spotify:playlist:abc123'],
      ['unknown', undefined],
    ];

    for (const [action, value] of invalid) {
      expect(validateEncoreControl(action, value)).toEqual(expect.any(String));
    }
    expect(validateEncoreControl('volume', 100)).toBeNull();
    expect(validateEncoreControl('seek', 0)).toBeNull();
  });

  it('reconnects with backoff after a closed connection', async () => {
    vi.useFakeTimers();
    const music = createMusic({ reconnectBaseMs: 50, reconnectMaxMs: 200 });
    music.start();
    sockets[0].open();
    sockets[0].close();

    expect(music.getSnapshot().connection).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(49);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);
    expect(music.getSnapshot().connection).toBe('connecting');
    music.stop();
  });

  it('keeps an unconfigured backend disconnected without opening a socket', () => {
    const music = new EncoreMusic({ WebSocketClass: FakeWebSocketClass });
    music.start();
    expect(music.getSnapshot()).toMatchObject({ configured: false, connection: 'disconnected' });
    expect(sockets).toHaveLength(0);
  });
});
