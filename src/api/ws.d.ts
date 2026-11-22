declare module 'ws' {
  interface ClientOptions {
    headers?: Record<string, string>;
    handshakeTimeout?: number;
    perMessageDeflate?: boolean;
  }

  interface ResponseLike {
    statusCode?: number;
  }

  export default class WebSocket {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;

    constructor(address: string, options?: ClientOptions);
    readonly readyState: number;
    on(event: 'open', listener: () => void): this;
    on(event: 'message', listener: (data: { toString(encoding?: string): string }) => void): this;
    on(
      event: 'unexpected-response',
      listener: (_request: unknown, response: ResponseLike) => void,
    ): this;
    on(event: 'error', listener: (_error: unknown) => void): this;
    on(event: 'close', listener: () => void): this;
    send(data: string): void;
    close(): void;
  }
}
