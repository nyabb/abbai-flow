export type MusicConnection = 'connecting' | 'connected' | 'disconnected';
export type MusicRepeat = 'off' | 'context' | 'track';
export type MusicPlaybackStatus = 'idle' | 'playing' | 'paused' | 'buffering';

export interface MusicEntity {
  uri: string | null;
  entityType: string | null;
  title: string | null;
  artists: string[];
  album: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
}

export interface MusicQueueItem extends MusicEntity {
  source: string | null;
}

export interface MusicPlayback {
  status: MusicPlaybackStatus;
  item: MusicEntity | null;
  context: MusicEntity | null;
  position: { positionMs: number; timestampMs: number | null; speed: number } | null;
  volume: number | null;
  options: { shuffle: boolean | null; repeat: MusicRepeat | null };
  availableActions: string[];
}

export interface MusicSnapshot {
  configured: boolean;
  connection: MusicConnection;
  auth: { loggedIn: boolean | null; isActive: boolean | null; deviceName: string | null };
  playback: MusicPlayback;
  queue: { previous: MusicQueueItem[]; upcoming: MusicQueueItem[] };
  error: string | null;
  updatedAt: number;
}
