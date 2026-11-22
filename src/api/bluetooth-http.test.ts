import { describe, expect, it, vi } from 'vitest';
import { BluetoothManager } from './bluetooth-manager';
import {
  handleBluetoothRequest,
  type BluetoothHttpHelpers,
  type BluetoothHttpRequest,
  type BluetoothHttpResponse,
} from './bluetooth-http';
import type { BluetoothSnapshot } from './bluetooth-types';

class FakeResponse implements BluetoothHttpResponse {
  destroyed = false;
  writableEnded = false;
  status = 0;
  headers: Record<string, string> = {};
  readonly chunks: string[] = [];
  private closeListener: (() => void) | null = null;

  writeHead(status: number, headers: Record<string, string> = {}): this {
    this.status = status;
    this.headers = headers;
    return this;
  }

  write(chunk: string): this {
    this.chunks.push(chunk);
    return this;
  }

  on(_event: 'close', listener: () => void): this {
    this.closeListener = listener;
    return this;
  }

  close(): void {
    this.destroyed = true;
    this.closeListener?.();
  }
}

function request(url: string, method = 'GET'): BluetoothHttpRequest {
  return { url, method };
}

function createHelpers(body: Record<string, unknown> = {}) {
  const response = new FakeResponse();
  const helpers: BluetoothHttpHelpers = {
    sendJson(target, status, payload, headers = {}) {
      target.writeHead(status, headers);
      target.write(JSON.stringify(payload));
      (target as FakeResponse).writableEnded = true;
    },
    readJsonObject: vi.fn(async () => ({ value: body })),
  };
  return { response, helpers };
}

const snapshot: BluetoothSnapshot = {
  configured: true,
  connection: 'disconnected',
  adapter: null,
  scanning: false,
  devices: [],
  challenge: null,
  notice: null,
  error: 'The host Bluetooth service is unavailable',
  updatedAt: 1,
};

describe('Bluetooth HTTP API', () => {
  it('returns connection state without exposing D-Bus credentials', async () => {
    const manager = { getSnapshot: () => snapshot } as unknown as BluetoothManager;
    const { response, helpers } = createHelpers();
    await expect(
      handleBluetoothRequest(request('/abbai-flow/bluetooth/state'), response, manager, helpers),
    ).resolves.toBe(true);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.chunks.join(''))).toMatchObject({
      configured: true,
      connection: 'disconnected',
    });
    expect(response.chunks.join('')).not.toMatch(/token|secret|bearer/i);
  });

  it('rejects unknown actions and malformed addresses before dispatch', async () => {
    const control = vi.fn();
    const manager = { control } as unknown as BluetoothManager;
    const { response, helpers } = createHelpers({ action: 'pair', address: '../adapter' });
    await handleBluetoothRequest(
      request('/abbai-flow/bluetooth/control', 'POST'),
      response,
      manager,
      helpers,
    );
    expect(response.status).toBe(400);
    expect(control).not.toHaveBeenCalled();
  });

  it('dispatches a valid scan request through the manager', async () => {
    const control = vi.fn(async () => undefined);
    const manager = { control } as unknown as BluetoothManager;
    const { response, helpers } = createHelpers({ action: 'scan' });
    await handleBluetoothRequest(
      request('/abbai-flow/bluetooth/control', 'POST'),
      response,
      manager,
      helpers,
    );
    expect(control).toHaveBeenCalledWith({ action: 'scan' });
    expect(response.status).toBe(202);
    expect(JSON.parse(response.chunks.join(''))).toEqual({ accepted: true });
  });

  it('streams initial and subsequent state updates to connected clients', async () => {
    let listener: ((next: BluetoothSnapshot) => void) | undefined;
    const manager = {
      getSnapshot: () => snapshot,
      subscribe: (next: (value: BluetoothSnapshot) => void) => {
        listener = next;
        next(snapshot);
        return () => {
          listener = undefined;
        };
      },
    } as unknown as BluetoothManager;
    const { response, helpers } = createHelpers();
    await handleBluetoothRequest(
      request('/abbai-flow/bluetooth/events'),
      response,
      manager,
      helpers,
    );
    expect(response.headers['Content-Type']).toContain('text/event-stream');
    expect(response.chunks.join('')).toContain('event: state');
    listener?.({ ...snapshot, connection: 'connected', updatedAt: 2 });
    expect(response.chunks.join('')).toContain('"connection":"connected"');
    response.close();
    expect(listener).toBeUndefined();
  });
});
