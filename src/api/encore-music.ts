import WebSocket from 'ws';

export const DEFAULT_ENCORE_URL = 'ws://host.docker.internal:8095/';
const MAX_VOLUME = 100;

export type EncoreConnection = 'connecting' | 'connected' | 'disconnected';
export type EncoreRepeat = 'off' | 'context' | 'track';
export type EncorePlaybackStatus = 'idle' | 'playing' | 'paused' | 'buffering';

export interface EncoreEntity {
  uri: string | null;
  entityType: string | null;
  title: string | null;
  artists: string[];
  album: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
}

export interface EncoreQueueItem extends EncoreEntity {
  source: string | null;
}

export interface EncorePlayback {
  status: EncorePlaybackStatus;
  item: EncoreEntity | null;
  context: EncoreEntity | null;
  position: { positionMs: number; timestampMs: number | null; speed: number } | null;
  volume: number | null;
  options: { shuffle: boolean | null; repeat: EncoreRepeat | null };
  availableActions: string[];
}

export interface EncoreSnapshot {
  configured: boolean;
  connection: EncoreConnection;
  auth: { loggedIn: boolean | null; isActive: boolean | null; deviceName: string | null };
  playback: EncorePlayback;
  queue: { previous: EncoreQueueItem[]; upcoming: EncoreQueueItem[] };
  error: string | null;
  updatedAt: number;
}

type JsonRecord = Record<string, unknown>;
type Listener = (snapshot: EncoreSnapshot) => void;
type Socket = InstanceType<typeof WebSocket>;

function emptyPlayback(): EncorePlayback {
  return {
    status: 'idle',
    item: null,
    context: null,
    position: null,
    volume: null,
    options: { shuffle: null, repeat: null },
    availableActions: [],
  };
}

function emptyState(configured = false): EncoreSnapshot {
  return {
    configured,
    connection: configured ? 'connecting' : 'disconnected',
    auth: { loggedIn: null, isActive: null, deviceName: null },
    playback: emptyPlayback(),
    queue: { previous: [], upcoming: [] },
    error: null,
    updatedAt: Date.now(),
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nameOf(entity: JsonRecord | undefined): string | null {
  const decorations = entity?.decorations;
  if (!isRecord(decorations) || !isRecord(decorations.identity)) return null;
  return typeof decorations.identity.name === 'string' ? decorations.identity.name : null;
}

function artworkOf(entity: JsonRecord | undefined): string | null {
  const decorations = entity?.decorations;
  if (!isRecord(decorations) || !isRecord(decorations.visual_identity)) return null;
  const covers = decorations.visual_identity.cover;
  if (!Array.isArray(covers)) return null;
  const preferred = covers.find(
    (cover) => isRecord(cover) && (cover.size === 'large' || cover.size === 'xlarge'),
  );
  const firstWithUrl = covers.find((cover) => isRecord(cover) && typeof cover.url === 'string');
  const cover = preferred || firstWithUrl;
  return isRecord(cover) && typeof cover.url === 'string' ? cover.url : null;
}

function normalizeEntity(value: unknown): EncoreEntity | null {
  if (!isRecord(value)) return null;
  const decorations = isRecord(value.decorations) ? value.decorations : {};
  const playback = isRecord(decorations.playback) ? decorations.playback : {};
  const parent =
    isRecord(decorations.parent) && isRecord(decorations.parent.entity)
      ? decorations.parent.entity
      : undefined;
  const creators = Array.isArray(value.creators) ? value.creators : [];
  const artists = creators
    .map((creator) => (isRecord(creator) ? creator.entity : null))
    .map((entity) => (isRecord(entity) ? nameOf(entity) : null))
    .filter((name): name is string => typeof name === 'string');
  return {
    uri: typeof value.uri === 'string' ? value.uri : null,
    entityType: typeof value.entity_type === 'string' ? value.entity_type : null,
    title: nameOf(value),
    artists,
    album: nameOf(parent),
    artworkUrl: artworkOf(value),
    durationMs: finiteNumber(playback.duration_ms),
  };
}

function normalizePosition(value: unknown): EncorePlayback['position'] {
  if (!isRecord(value)) return null;
  const positionMs = finiteNumber(value.position_ms);
  if (positionMs === null) return null;
  return {
    positionMs,
    timestampMs: finiteNumber(value.timestamp_ms),
    speed: finiteNumber(value.speed) ?? 0,
  };
}

function normalizeOptions(value: unknown): EncorePlayback['options'] {
  if (!isRecord(value)) return { shuffle: null, repeat: null };
  const repeat = value.repeat;
  return {
    shuffle: typeof value.shuffle === 'boolean' ? value.shuffle : null,
    repeat: repeat === 'off' || repeat === 'context' || repeat === 'track' ? repeat : null,
  };
}

function normalizeQueueEntries(value: unknown): EncoreQueueItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): EncoreQueueItem | null => {
      if (!isRecord(entry)) return null;
      const item = normalizeEntity(entry.item);
      return item
        ? { ...item, source: typeof entry.source === 'string' ? entry.source : null }
        : null;
    })
    .filter((entry): entry is EncoreQueueItem => entry !== null);
}

function normalizePlayback(value: JsonRecord): EncorePlayback {
  const status = value.status;
  const availableActions = isRecord(value.available_actions)
    ? Object.keys(value.available_actions)
    : [];
  return {
    status:
      status === 'playing' || status === 'paused' || status === 'buffering' || status === 'idle'
        ? status
        : 'idle',
    item: normalizeEntity(value.item),
    context: normalizeEntity(value.context),
    position: normalizePosition(value.position),
    volume: finiteNumber(value.volume),
    options: normalizeOptions(value.options),
    availableActions,
  };
}

export function validateEncoreControl(action: unknown, value: unknown): string | null {
  const noValue = ['play', 'pause', 'previous', 'next', 'activate'];
  if (typeof action !== 'string') return 'Unsupported music control';
  if (action === 'playTrack') {
    return typeof value === 'string' && /^spotify:track:[A-Za-z0-9]+$/.test(value)
      ? null
      : 'Track URI must be a Spotify track URI';
  }
  if (noValue.includes(action)) {
    return value === undefined ? null : 'This control does not accept a value';
  }
  if (action === 'seek') {
    return Number.isSafeInteger(value) && Number(value) >= 0
      ? null
      : 'Seek position must be a non-negative integer';
  }
  if (action === 'volume') {
    return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= MAX_VOLUME
      ? null
      : 'Volume must be an integer from 0 to 100';
  }
  if (action === 'shuffle') {
    return typeof value === 'boolean' ? null : 'Shuffle value must be a boolean';
  }
  if (action === 'repeat') {
    return value === 'off' || value === 'context' || value === 'track'
      ? null
      : 'Repeat must be off, context, or track';
  }
  return 'Unsupported music control';
}

export interface EncoreMusicOptions {
  token?: string;
  url?: string;
  WebSocketClass?: typeof WebSocket;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

export class EncoreMusic {
  private readonly token: string;
  private readonly url: string;
  private readonly WebSocketClass: typeof WebSocket;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private reconnectDelay: number;
  private state: EncoreSnapshot;
  private readonly listeners = new Set<Listener>();
  private socket: Socket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private stopped = false;

  constructor(options: EncoreMusicOptions = {}) {
    this.token = options.token || '';
    this.url = options.url || DEFAULT_ENCORE_URL;
    this.WebSocketClass = options.WebSocketClass || WebSocket;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30000;
    this.reconnectDelay = this.reconnectBaseMs;
    this.state = emptyState(Boolean(this.token));
  }

  getSnapshot(): EncoreSnapshot {
    return JSON.parse(JSON.stringify(this.state)) as EncoreSnapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.started || !this.token) return;
    this.started = true;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < this.WebSocketClass.CLOSING) socket.close();
    this.state = { ...this.state, connection: 'disconnected', updatedAt: Date.now() };
    this.emit();
  }

  private setState(patch: Partial<EncoreSnapshot>): void {
    this.state = { ...this.state, ...patch, updatedAt: Date.now() };
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // A failed HTTP stream must not interrupt the shared connection.
      }
    }
  }

  private connect(): void {
    if (this.stopped || !this.token || this.socket) return;
    this.setState({ connection: 'connecting', error: null });
    let socket: Socket;
    try {
      socket = new this.WebSocketClass(this.url, {
        headers: { Authorization: 'Bearer ' + this.token },
        handshakeTimeout: 10000,
        perMessageDeflate: false,
      });
    } catch {
      this.connectionFailed('Could not connect to Encore');
      return;
    }
    this.socket = socket;

    socket.on('open', () => {
      if (this.socket !== socket || this.stopped) return;
      this.reconnectDelay = this.reconnectBaseMs;
      this.setState({ connection: 'connected', error: null });
    });
    socket.on('message', (raw) => {
      if (this.socket === socket) this.handleMessage(raw.toString('utf8'));
    });
    socket.on('unexpected-response', (_request, response) => {
      const message =
        response.statusCode === 401 || response.statusCode === 403
          ? 'Encore rejected the configured token'
          : 'Encore connection failed';
      if (this.socket === socket) {
        this.socket = null;
        try {
          socket.close();
        } catch {
          // The rejected handshake may already have closed the socket.
        }
      }
      this.connectionFailed(message);
    });
    socket.on('error', () => {
      if (this.socket === socket) this.setState({ error: 'Encore connection error' });
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) return;
      this.state = {
        ...this.state,
        connection: 'disconnected',
        error: this.state.error || 'Encore connection lost',
        updatedAt: Date.now(),
      };
      this.emit();
      this.scheduleReconnect();
    });
  }

  private connectionFailed(message: string): void {
    this.state = {
      ...this.state,
      connection: 'disconnected',
      error: message,
      updatedAt: Date.now(),
    };
    this.emit();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(message) || typeof message.type !== 'string') return;

    switch (message.type) {
      case 'auth_state': {
        const loggedIn = typeof message.logged_in === 'boolean' ? message.logged_in : null;
        this.state = {
          ...this.state,
          auth: {
            loggedIn,
            isActive: typeof message.is_active === 'boolean' ? message.is_active : null,
            deviceName: typeof message.device_name === 'string' ? message.device_name : null,
          },
          ...(loggedIn === false
            ? { playback: emptyPlayback(), queue: { previous: [], upcoming: [] } }
            : {}),
          error: null,
          updatedAt: Date.now(),
        };
        this.emit();
        if (loggedIn) {
          this.sendCommand({ command: 'get_state' });
          this.sendCommand({ command: 'get_queue' });
        }
        return;
      }
      case 'playback_state':
        this.setState({ playback: normalizePlayback(message) });
        return;
      case 'track_changed':
        this.setState({
          playback: { ...this.state.playback, item: normalizeEntity(message.item) },
        });
        return;
      case 'playback_changed':
        if (
          message.status === 'idle' ||
          message.status === 'playing' ||
          message.status === 'paused' ||
          message.status === 'buffering'
        ) {
          this.setState({ playback: { ...this.state.playback, status: message.status } });
        }
        return;
      case 'context_changed':
        this.setState({
          playback: { ...this.state.playback, context: normalizeEntity(message.context) },
        });
        return;
      case 'options_changed':
        this.setState({
          playback: { ...this.state.playback, options: normalizeOptions(message.options) },
        });
        return;
      case 'position_sync': {
        const position = normalizePosition(message.position);
        if (position) this.setState({ playback: { ...this.state.playback, position } });
        return;
      }
      case 'volume_changed': {
        const volume = finiteNumber(message.volume);
        if (volume !== null) {
          this.setState({
            playback: { ...this.state.playback, volume: Math.max(0, Math.min(MAX_VOLUME, volume)) },
          });
        }
        return;
      }
      case 'device_changed':
        this.setState({
          auth: {
            ...this.state.auth,
            isActive:
              typeof message.is_active === 'boolean' ? message.is_active : this.state.auth.isActive,
            deviceName:
              typeof message.device_name === 'string'
                ? message.device_name
                : this.state.auth.deviceName,
          },
        });
        return;
      case 'queue_changed':
        this.setState({
          queue: {
            previous: normalizeQueueEntries(message.previous),
            upcoming: normalizeQueueEntries(message.upcoming),
          },
        });
        return;
      default:
        return;
    }
  }

  private sendCommand(command: JsonRecord): boolean {
    if (!this.socket || this.socket.readyState !== this.WebSocketClass.OPEN) return false;
    try {
      this.socket.send(JSON.stringify({ type: 'command', ...command }));
      return true;
    } catch {
      return false;
    }
  }

  control(
    action: string,
    value?: unknown,
  ): { ok: true } | { ok: false; status: number; error: string } {
    const invalid = validateEncoreControl(action, value);
    if (invalid) return { ok: false, status: 400, error: invalid };
    if (!this.token) {
      return { ok: false, status: 503, error: 'Spotify integration is not configured' };
    }
    if (this.state.connection !== 'connected') {
      return { ok: false, status: 503, error: 'Encore is not connected' };
    }
    if (this.state.auth.loggedIn !== true) {
      return { ok: false, status: 409, error: 'Spotify is logged out' };
    }
    if (action !== 'activate' && this.state.auth.isActive !== true) {
      return { ok: false, status: 409, error: 'The Spotify device is not active' };
    }

    let sent = false;
    switch (action) {
      case 'playTrack':
        sent = this.sendCommand({ command: 'play', uri: value });
        break;
      case 'play':
        sent = this.sendCommand({ command: 'play' });
        break;
      case 'pause':
        sent = this.sendCommand({ command: 'pause' });
        break;
      case 'previous':
        sent = this.sendCommand({ command: 'skip_prev' });
        break;
      case 'next':
        sent = this.sendCommand({ command: 'skip_next' });
        break;
      case 'seek':
        sent = this.sendCommand({ command: 'seek', position_ms: value });
        break;
      case 'volume':
        sent = this.sendCommand({ command: 'set_volume', volume: value });
        break;
      case 'shuffle':
        sent = this.sendCommand({ command: 'set_shuffle', enabled: value });
        break;
      case 'repeat': {
        const track = value === 'track';
        const context = value === 'context';
        const commands =
          value === 'track'
            ? [
                { command: 'set_repeat_context', enabled: false },
                { command: 'set_repeat_track', enabled: track },
              ]
            : [
                { command: 'set_repeat_track', enabled: false },
                { command: 'set_repeat_context', enabled: context },
              ];
        sent = commands.every((command) => this.sendCommand(command));
        break;
      }
      case 'activate':
        sent = this.sendCommand({ command: 'activate' });
        break;
    }
    return sent ? { ok: true } : { ok: false, status: 503, error: 'Encore is not connected' };
  }
}
