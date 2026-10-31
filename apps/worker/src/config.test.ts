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
      mail: undefined,
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

  it('enables mail only with a complete SMTP configuration', () => {
    expect(
      loadWorkerConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: '587',
        SMTP_USER: 'mailer',
        SMTP_PASSWORD: 'secret',
        MAIL_FROM: 'no-reply@example.test',
        WEB_BASE_URL: 'https://app.example.test',
      }).mail,
    ).toEqual({
      smtpHost: 'smtp.example.test',
      smtpPort: 587,
      smtpUser: 'mailer',
      smtpPassword: 'secret',
      from: 'no-reply@example.test',
      webBaseUrl: 'https://app.example.test',
    });
  });

  it('keeps mail off without SMTP_HOST, including an empty value', () => {
    expect(
      loadWorkerConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
        SMTP_HOST: '',
      }).mail,
    ).toBeUndefined();
  });

  it('rejects a partial SMTP configuration', () => {
    expect(() =>
      loadWorkerConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
        SMTP_HOST: 'smtp.example.test',
      }),
    ).toThrow(/SMTP_PORT, MAIL_FROM, WEB_BASE_URL/);
    expect(() =>
      loadWorkerConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: '587',
        SMTP_USER: 'mailer',
        MAIL_FROM: 'no-reply@example.test',
        WEB_BASE_URL: 'https://app.example.test',
      }),
    ).toThrow(/SMTP_USER, SMTP_PASSWORD/);
  });
});
