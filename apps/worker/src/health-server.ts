import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface WorkerRuntimeReadiness {
  readonly isReady: boolean;
}

export interface WorkerDatabaseHealth {
  check(): Promise<void>;
}

export interface WorkerHealthServerOptions {
  runtime: WorkerRuntimeReadiness;
  databaseHealth: WorkerDatabaseHealth;
  host: string;
  port: number;
}

export class WorkerHealthServer {
  private server: Server | undefined;
  private listeningPort: number | undefined;

  constructor(private readonly options: WorkerHealthServerOptions) {}

  get port(): number {
    if (this.listeningPort === undefined) throw new Error('Worker health server has not started');

    return this.listeningPort;
  }

  async start(): Promise<void> {
    if (this.server) return;

    const server = createServer((request, response) => {
      void this.handle(request.method, request.url, response);
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port, this.options.host, () => {
        server.off('error', reject);
        this.listeningPort = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;

    this.server = undefined;
    this.listeningPort = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async handle(
    method: string | undefined,
    url: string | undefined,
    response: ServerResponse,
  ): Promise<void> {
    if (method !== 'GET') {
      this.respond(response, 404, { status: 'not_found' });
      return;
    }

    if (url === '/live') {
      this.respond(response, 200, { status: 'ok' });
      return;
    }

    if (url !== '/ready' || !this.options.runtime.isReady) {
      this.respond(response, url === '/ready' ? 503 : 404, {
        status: url === '/ready' ? 'unavailable' : 'not_found',
      });
      return;
    }

    try {
      await this.options.databaseHealth.check();
      this.respond(response, 200, { status: 'ok' });
    } catch {
      this.respond(response, 503, { status: 'unavailable' });
    }
  }

  private respond(response: ServerResponse, statusCode: number, body: { status: string }): void {
    response.writeHead(statusCode, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(body));
  }
}

type ServerResponse = import('node:http').ServerResponse;
