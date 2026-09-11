import { describe, expect, it } from 'vitest';

import { loadWorkerConfig } from './config.js';

describe('loadWorkerConfig', () => {
  it('uses durable job defaults', () => {
    expect(
      loadWorkerConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
      }),
    ).toEqual({
      nodeEnv: 'test',
      logLevel: 'info',
      databaseUrl: 'postgresql://worker:worker@localhost:5432/harmofin',
      pollIntervalMs: 30_000,
      concurrency: 1,
      leaseSeconds: 300,
      healthHost: '127.0.0.1',
      healthPort: 3002,
      releaseSha: 'dev',
      errorReportingEndpoint: undefined,
      otelExporterOtlpEndpoint: undefined,
    });
  });

  it('requires a PostgreSQL database URL', () => {
    expect(() => loadWorkerConfig({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
  });

  it('rejects unsupported log levels', () => {
    expect(() => loadWorkerConfig({ NODE_ENV: 'test', LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('maps configured telemetry endpoints', () => {
    expect(
      loadWorkerConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
        RELEASE_SHA: 'release-123',
        ERROR_REPORTING_ENDPOINT: 'https://errors.invalid/ingest',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://traces.invalid/v1/traces',
      }),
    ).toMatchObject({
      releaseSha: 'release-123',
      errorReportingEndpoint: 'https://errors.invalid/ingest',
      otelExporterOtlpEndpoint: 'https://traces.invalid/v1/traces',
    });
  });

  it('treats an empty optional telemetry endpoint as unset instead of crashing', () => {
    const config = loadWorkerConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
      ERROR_REPORTING_ENDPOINT: '',
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
    });

    expect(config.errorReportingEndpoint).toBeUndefined();
    expect(config.otelExporterOtlpEndpoint).toBeUndefined();
  });

  it('rejects health ports outside TCP range', () => {
    expect(() =>
      loadWorkerConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
        WORKER_HEALTH_PORT: '65536',
      }),
    ).toThrow(/WORKER_HEALTH_PORT/);
  });
});
