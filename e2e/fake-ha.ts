import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** Minimal Home Assistant stand-in for calendar, weather, and media probes. */
export class FakeHa {
  readonly server: http.Server;

  private constructor(server: http.Server) {
    this.server = server;
  }

  static async start(): Promise<FakeHa> {
    const server = http.createServer((req, res) => {
      const body = JSON.stringify(req.url === '/api/' ? { message: 'API running' } : []);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
    });
    const instance = new FakeHa(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return instance;
  }

  get url(): string {
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server.listening) return resolve();
      this.server.close(() => resolve());
      this.server.closeAllConnections?.();
    });
  }
}
