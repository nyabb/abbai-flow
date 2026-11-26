import { recordDebugLog, sanitizeDebugUrl, stringifyDebugValue, updateDebugLog } from './debug-log';

type MessageHandler = (message: HAMessage) => void;

interface HAMessage {
  id?: number;
  type: string;
  [key: string]: unknown;
}

interface HAResultMessage {
  id: number;
  type: 'result';
  success: boolean;
  result: unknown;
  error?: { code: string; message: string };
}

interface HAEventMessage {
  id: number;
  type: 'event';
  event: unknown;
}

type PendingRequest = {
  operation: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  debugLogId: number | null;
  startedAt: number;
};

export class HomeAssistantClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private msgId = 1;
  private authenticated = false;
  private pendingRequests = new Map<number, PendingRequest>();
  private subscriptions = new Map<number, MessageHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private onConnectionChange?: (connected: boolean) => void;

  constructor(url: string, token: string) {
    this.url = url.replace(/^http/, 'ws');
    if (!this.url.endsWith('/api/websocket')) {
      this.url = this.url.replace(/\/$/, '') + '/api/websocket';
    }
    this.token = token;
  }

  setConnectionChangeHandler(handler: (connected: boolean) => void) {
    this.onConnectionChange = handler;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
      } catch (err) {
        recordDebugLog({
          level: 'error',
          source: 'HA WebSocket',
          message: 'Could not create WebSocket connection',
          details: stringifyDebugValue(err),
        });
        reject(err);
        return;
      }

      this.ws.onopen = () => {
        this.reconnectDelay = 1000;
        recordDebugLog({
          level: 'event',
          source: 'HA WebSocket',
          message: `Connected to ${sanitizeDebugUrl(this.url)}`,
        });
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as HAMessage;

        if (msg.type === 'auth_required') {
          this.ws?.send(
            JSON.stringify({
              type: 'auth',
              access_token: this.token,
            }),
          );
          return;
        }

        if (msg.type === 'auth_ok') {
          this.authenticated = true;
          this.onConnectionChange?.(true);
          recordDebugLog({
            level: 'event',
            source: 'HA WebSocket',
            message: 'Home Assistant authentication succeeded',
          });
          resolve();
          return;
        }

        if (msg.type === 'auth_invalid') {
          recordDebugLog({
            level: 'error',
            source: 'HA WebSocket',
            message: 'Home Assistant authentication failed',
            details: stringifyDebugValue(msg),
          });
          reject(new Error('Invalid Home Assistant token'));
          return;
        }

        if (msg.type === 'result' && msg.id !== undefined) {
          const result = msg as unknown as HAResultMessage;
          const pending = this.pendingRequests.get(result.id);
          if (pending) {
            this.pendingRequests.delete(result.id);
            const elapsed = Math.round(
              (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
                pending.startedAt,
            );
            if (result.success) {
              updateDebugLog(pending.debugLogId, {
                level: 'success',
                message: `${pending.operation} request succeeded · ${elapsed} ms`,
                details: stringifyDebugValue(result.result),
              });
              pending.resolve(result.result);
            } else {
              updateDebugLog(pending.debugLogId, {
                level: 'error',
                message: `${pending.operation} request failed · ${elapsed} ms`,
                details: stringifyDebugValue(result.error ?? 'Unknown WebSocket error'),
              });
              const err = Object.assign(
                new Error(result.error?.message || 'Home Assistant command failed'),
                { code: result.error?.code },
              );
              pending.reject(err);
            }
          }
        }

        if (msg.type === 'event' && msg.id !== undefined) {
          const eventMsg = msg as unknown as HAEventMessage;
          const eventType =
            eventMsg.event && typeof eventMsg.event === 'object' && 'event_type' in eventMsg.event
              ? String((eventMsg.event as { event_type: unknown }).event_type)
              : 'subscribed event';
          recordDebugLog({
            level: 'event',
            source: 'HA WebSocket',
            message: `Subscription ${eventMsg.id} received ${eventType}`,
            details: stringifyDebugValue(eventMsg.event),
          });
          const handler = this.subscriptions.get(eventMsg.id);
          handler?.(eventMsg.event as HAMessage);
        }
      };

      this.ws.onclose = () => {
        this.authenticated = false;
        this.onConnectionChange?.(false);
        recordDebugLog({
          level: 'event',
          source: 'HA WebSocket',
          message: `Connection closed · ${sanitizeDebugUrl(this.url)}`,
        });
        this.scheduleReconnect();
      };

      this.ws.onerror = (event) => {
        recordDebugLog({
          level: 'error',
          source: 'HA WebSocket',
          message: 'WebSocket transport error',
          details: stringifyDebugValue(event),
        });
        // onclose will fire after this
      };
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      });
    }, this.reconnectDelay);
  }

  private sendMessage(msg: Omit<HAMessage, 'id'>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.authenticated) {
        const error = new Error('Not connected');
        recordDebugLog({
          level: 'error',
          source: 'HA WebSocket',
          message: `${msg.type} request could not be sent`,
          details: error.message,
        });
        reject(error);
        return;
      }
      const id = this.msgId++;
      const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const debugLogId = recordDebugLog({
        level: 'pending',
        source: 'HA WebSocket',
        message: `${msg.type} · pending`,
        details: stringifyDebugValue(msg),
      });
      this.pendingRequests.set(id, {
        operation: String(msg.type),
        resolve,
        reject,
        debugLogId,
        startedAt,
      });
      try {
        this.ws.send(JSON.stringify({ ...msg, id }));
      } catch (error) {
        this.pendingRequests.delete(id);
        updateDebugLog(debugLogId, {
          level: 'error',
          message: `${msg.type} request could not be sent`,
          details: stringifyDebugValue(error),
        });
        reject(error);
      }
    });
  }

  async subscribeEvents(eventType: string, handler: MessageHandler): Promise<number> {
    const id = this.msgId++;
    this.subscriptions.set(id, handler);

    if (this.ws && this.authenticated) {
      this.ws.send(
        JSON.stringify({
          id,
          type: 'subscribe_events',
          event_type: eventType,
        }),
      );
    }

    return id;
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.authenticated = false;
    this.pendingRequests.clear();
    this.subscriptions.clear();
  }

  async getStates(): Promise<
    Array<{
      entity_id: string;
      state: string;
      attributes: Record<string, unknown>;
    }>
  > {
    return this.sendMessage({ type: 'get_states' }) as Promise<
      Array<{
        entity_id: string;
        state: string;
        attributes: Record<string, unknown>;
      }>
    >;
  }

  async callService(
    domain: string,
    service: string,
    entityId: string,
    data?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.sendMessage({
      type: 'call_service',
      domain,
      service,
      target: { entity_id: entityId },
      service_data: data || {},
    });
  }

  async subscribeStateChanges(handler: MessageHandler): Promise<number> {
    return this.subscribeEvents('state_changed', handler);
  }

  unsubscribe(subscriptionId: number): void {
    this.subscriptions.delete(subscriptionId);
  }

  get isConnected(): boolean {
    return this.authenticated;
  }
}
