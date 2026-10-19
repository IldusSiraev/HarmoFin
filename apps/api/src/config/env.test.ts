import { describe, expect, it } from 'vitest';

import { loadApiConfig } from './env.js';

const validEnvironment = {
  NODE_ENV: 'test',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
  WEB_ORIGIN: 'http://localhost:3000',
  AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  MAIL_FROM: 'no-reply@harmofin.test',
  WEB_BASE_URL: 'http://localhost:3000',
};

describe('loadApiConfig', () => {
  it('rejects missing DATABASE_URL', () => {
    expect(() => loadApiConfig({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
  });

  it('maps valid test configuration with secure defaults', () => {
    expect(loadApiConfig(validEnvironment)).toEqual({
      nodeEnv: 'test',
      apiPort: 3001,
      databaseUrl: 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
      webOrigin: 'http://localhost:3000',
      logLevel: 'info',
      trustProxy: false,
      releaseSha: 'dev',
      appVersion: '0.0.0-dev',
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
      rateLimit: {
        windowSeconds: 900,
        loginMax: 10,
        recoveryMax: 5,
      },
    });
  });

  it('rejects ports outside TCP range', () => {
    expect(() =>
      loadApiConfig({
        ...validEnvironment,
        API_PORT: '65536',
      }),
    ).toThrow(/API_PORT/);
  });

  it('rejects a missing token hash secret', () => {
    const environment: NodeJS.ProcessEnv = { ...validEnvironment };
    delete environment.AUTH_TOKEN_HASH_SECRET;

    expect(() => loadApiConfig(environment)).toThrow(/AUTH_TOKEN_HASH_SECRET/);
  });

  it('rejects a non-numeric SMTP port', () => {
    expect(() => loadApiConfig({ ...validEnvironment, SMTP_PORT: 'smtp' })).toThrow(/SMTP_PORT/);
  });

  it('rejects an invalid web base URL', () => {
    expect(() =>
      loadApiConfig({ ...validEnvironment, WEB_BASE_URL: 'mailto:test@example.com' }),
    ).toThrow(/WEB_BASE_URL/);
  });

  it('uses a host-only cookie name in production', () => {
    expect(
      loadApiConfig({ ...validEnvironment, NODE_ENV: 'production', TRUST_PROXY: 'true' }).auth
        .cookieName,
    ).toBe('__Host-harmofin_session');
  });

  it('treats an empty optional telemetry endpoint as unset instead of crashing', () => {
    const config = loadApiConfig({
      ...validEnvironment,
      ERROR_REPORTING_ENDPOINT: '',
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
    });

    expect(config.errorReportingEndpoint).toBeUndefined();
    expect(config.otelExporterOtlpEndpoint).toBeUndefined();
  });

  it('treats empty SMTP_USER and SMTP_PASSWORD as unset instead of rejecting', () => {
    const config = loadApiConfig({
      ...validEnvironment,
      NODE_ENV: 'production',
      TRUST_PROXY: 'true',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
    });

    expect(config.mail.smtpUser).toBeUndefined();
    expect(config.mail.smtpPassword).toBeUndefined();
  });

  it('maps configured telemetry endpoints', () => {
    expect(
      loadApiConfig({
        ...validEnvironment,
        RELEASE_SHA: 'release-123',
        APP_VERSION: '1.2.3',
        ERROR_REPORTING_ENDPOINT: 'https://errors.invalid/ingest',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://traces.invalid/v1/traces',
      }),
    ).toMatchObject({
      releaseSha: 'release-123',
      appVersion: '1.2.3',
      errorReportingEndpoint: 'https://errors.invalid/ingest',
      otelExporterOtlpEndpoint: 'https://traces.invalid/v1/traces',
    });
  });

  it('requires trusted proxy configuration in production', () => {
    expect(() => loadApiConfig({ ...validEnvironment, NODE_ENV: 'production' })).toThrow(
      /TRUST_PROXY/,
    );
  });

  it('rejects production configuration with local placeholder secret', () => {
    expect(() =>
      loadApiConfig({
        ...validEnvironment,
        NODE_ENV: 'production',
        AUTH_TOKEN_HASH_SECRET: 'local-only-change-this-secret-32-bytes-minimum',
      }),
    ).toThrow(/AUTH_TOKEN_HASH_SECRET/);
  });
});
