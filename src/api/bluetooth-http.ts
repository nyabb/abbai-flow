import {
  BluetoothManager,
  BluetoothOperationError,
  validateBluetoothControl,
} from './bluetooth-manager';
import type { BluetoothSnapshot } from './bluetooth-types';

export interface BluetoothHttpRequest {
  method?: string;
  url?: string;
}

export interface BluetoothHttpResponse {
  destroyed: boolean;
  writableEnded: boolean;
  writeHead(status: number, headers?: Record<string, string>): unknown;
  write(chunk: string): unknown;
  on(event: 'close', listener: () => void): unknown;
}

interface JsonObjectResult {
  value?: Record<string, unknown>;
  error?: { status: number; message: string };
}

export interface BluetoothHttpHelpers {
  sendJson(
    response: BluetoothHttpResponse,
    status: number,
    payload: unknown,
    extraHeaders?: Record<string, string>,
  ): void;
  readJsonObject(request: BluetoothHttpRequest): Promise<JsonObjectResult>;
}

export async function handleBluetoothRequest(
  request: BluetoothHttpRequest,
  response: BluetoothHttpResponse,
  bluetooth: BluetoothManager,
  helpers: BluetoothHttpHelpers,
): Promise<boolean> {
  const pathname = (request.url || '/').split('?')[0];
  const method = request.method || 'GET';

  if (pathname === '/abbai-flow/bluetooth/state') {
    if (method !== 'GET') {
      helpers.sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
      return true;
    }
    helpers.sendJson(response, 200, bluetooth.getSnapshot());
    return true;
  }

  if (pathname === '/abbai-flow/bluetooth/events') {
    if (method !== 'GET') {
      helpers.sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
      return true;
    }
    streamBluetoothState(response, bluetooth);
    return true;
  }

  if (pathname === '/abbai-flow/bluetooth/control') {
    if (method !== 'POST') {
      helpers.sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
      return true;
    }
    const parsed = await helpers.readJsonObject(request);
    if (parsed.error) {
      helpers.sendJson(response, parsed.error.status, { error: parsed.error.message });
      return true;
    }
    const validation = validateBluetoothControl(parsed.value);
    if (!validation.control) {
      helpers.sendJson(response, 400, { error: validation.error });
      return true;
    }
    try {
      await bluetooth.control(validation.control);
      helpers.sendJson(response, 202, { accepted: true });
    } catch (error) {
      const status = error instanceof BluetoothOperationError ? error.status : 503;
      const message =
        error instanceof BluetoothOperationError
          ? error.message
          : 'Bluetooth could not complete that request';
      helpers.sendJson(response, status, { error: message });
    }
    return true;
  }

  return false;
}

function streamBluetoothState(response: BluetoothHttpResponse, bluetooth: BluetoothManager): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (snapshot: BluetoothSnapshot) => {
    if (response.destroyed || response.writableEnded) return;
    response.write(`event: state\ndata: ${JSON.stringify(snapshot)}\n\n`);
  };
  const unsubscribe = bluetooth.subscribe(send);
  response.on('close', unsubscribe);
}
