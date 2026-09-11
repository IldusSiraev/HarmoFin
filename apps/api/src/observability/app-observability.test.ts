import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../app.js';
import type { ApiConfig } from '../config/env.js';

const config: ApiConfig = {
  nodeEnv: 'test',
  apiPort: 3001,
  databaseUrl: 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
  webOrigin: 'http://localhost:3000',
  logLevel: 'silent',
  trustProxy: false,
  releaseSha: 'test-release',
  auth: {
    tokenHashSecret: 'test-only-secret-with-at-least-32-bytes',
    idleTimeoutSeconds: 2_592_000,
    absoluteTimeoutSeconds: 7_776_000,
    recoveryTtlSeconds: 3_600,
    cookieName: 'harmofin_session',
  },
  mail: {
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    from: 'no-reply@harmofin.test',
    webBaseUrl: 'http://localhost:3000',
  },
  rateLimit: { windowSeconds: 900, loginMax: 10, recoveryMax: 5 },
};

describe('API runtime observability', () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;

  beforeAll(async () => {
    app = await createApiApp(config);
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('propagates request IDs and records safe HTTP outcomes', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/health/live',
      headers: { 'x-request-id': 'test-request-id' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('test-request-id');

    const metrics = await server.inject({ method: 'GET', url: '/internal/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.body).toContain('harmofin_http_requests_total');
    expect(metrics.body).toContain('test-release');
    expect(metrics.body).not.toMatch(/password|cookie|authorization|comment|amount/i);
  });

  it('keeps metrics endpoint outside public API prefix', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/internal/metrics' });

    expect(response.statusCode).toBe(404);
  });
});
