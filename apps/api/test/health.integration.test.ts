import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import type { ApiConfig } from '../src/config/env.js';

const baseConfig: ApiConfig = {
  nodeEnv: 'test',
  apiPort: 3001,
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
  webOrigin: 'http://localhost:3000',
  logLevel: 'silent',
};

describe('API health contract', () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;

  beforeAll(async () => {
    app = await createApiApp(baseConfig);
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('publishes liveness', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('publishes readiness when PostgreSQL is available', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', dependencies: { database: 'ok' } });
  });

  it('publishes its OpenAPI health paths and Problem Details schema', async () => {
    const response = await server.inject({ method: 'GET', url: '/openapi.json' });
    const document = response.json<{
      paths: Record<string, unknown>;
      components: {
        schemas: Record<string, { properties?: Record<string, { type?: string }> }>;
      };
    }>();

    expect(response.statusCode).toBe(200);
    expect(document.paths['/api/v1/health/live']).toBeDefined();
    expect(document.paths['/api/v1/health/ready']).toBeDefined();
    expect(document.components.schemas.ProblemDetailsResponse?.properties).toMatchObject({
      type: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'number' },
      code: { type: 'string' },
      detail: { type: 'string' },
      requestId: { type: 'string' },
    });
  });
});

describe('API readiness failure', () => {
  it('returns safe Problem Details when PostgreSQL is unavailable', async () => {
    const app = await createApiApp({
      ...baseConfig,
      databaseUrl: 'postgresql://harmofin_local:not-a-secret@127.0.0.1:1/harmofin',
    });
    await app.init();
    const server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();

    try {
      const response = await server.inject({ method: 'GET', url: '/api/v1/health/ready' });
      const body = JSON.parse(response.body) as Record<string, unknown>;

      expect(response.statusCode).toBe(503);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(body.code).toBe('DATABASE_UNAVAILABLE');
      expect(body.requestId).toEqual(expect.any(String));
      expect(response.body).not.toContain('not-a-secret');
      expect(response.body).not.toContain('SELECT 1');
    } finally {
      await app.close();
    }
  });
});
