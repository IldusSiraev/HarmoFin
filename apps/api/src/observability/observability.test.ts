import { describe, expect, it } from 'vitest';

import {
  MetricsRegistry,
  createErrorReporter,
  createTraceExporter,
  sanitizeTelemetry,
} from './observability.js';

describe('API observability', () => {
  it('sanitizes secrets, cookies, comments, and financial values before telemetry', () => {
    const payload = sanitizeTelemetry({
      event: 'request_outcome',
      requestId: 'request-1',
      route: '/api/v1/budgets/:budgetId',
      status: 200,
      password: 'secret-password',
      cookie: 'harmofin_session=secret-cookie',
      authorization: 'Bearer secret-token',
      comment: 'private comment',
      amountMinor: 125000,
      merchantName: 'Private merchant',
      nested: { databaseUrl: 'postgresql://user:password@db/harmofin' },
    });

    expect(payload).toEqual({
      event: 'request_outcome',
      requestId: 'request-1',
      route: '/api/v1/budgets/:budgetId',
      status: 200,
    });
    expect(JSON.stringify(payload)).not.toMatch(/secret|private|125000|merchant|postgresql/i);
  });

  it('renders internal Prometheus metrics without dynamic sensitive labels', () => {
    const metrics = new MetricsRegistry({
      service: 'api',
      environment: 'test',
      releaseSha: 'abc123',
    });

    metrics.setProcessHealth(1);
    metrics.recordHttpRequest('GET', '/api/v1/budgets/:budgetId', 200, 42);
    metrics.recordHttpRequest('POST', '/api/v1/budgets/:budgetId', 500, 99);
    metrics.setDatabaseReadiness(1);
    metrics.recordDatabaseLatency(12);
    metrics.increment('login_failures_total');

    const output = metrics.render();

    expect(output).toContain('harmofin_process_health{service="api",environment="test"} 1');
    expect(output).toContain(
      'harmofin_http_requests_total{method="GET",route="/api/v1/budgets/:budgetId",status_class="2xx"} 1',
    );
    expect(output).toContain(
      'harmofin_http_requests_total{method="POST",route="/api/v1/budgets/:budgetId",status_class="5xx"} 1',
    );
    expect(output).toContain(
      'harmofin_release_info{service="api",environment="test",release="abc123"} 1',
    );
    expect(output).not.toMatch(/amount|comment|cookie|password|secret|125000/i);
  });

  it('disables reporters when endpoints are not configured', async () => {
    const fetcher = async () => new Response(null, { status: 500 });
    const errorReporter = createErrorReporter(undefined, fetcher);
    const traceExporter = createTraceExporter(undefined, fetcher);

    await expect(
      errorReporter.report(new Error('private failure'), { comment: 'private' }),
    ).resolves.toBe(false);
    await expect(traceExporter.export({ amountMinor: 100, cookie: 'secret' })).resolves.toBe(false);
  });
});

describe('telemetry redaction', () => {
  it('does not send sensitive fields to configured reporters', async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const fetcher = async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: String(init?.body) });
      return new Response(null, { status: 200 });
    };
    const reporter = createErrorReporter('https://errors.invalid/project', fetcher);

    await expect(
      reporter.report(new Error('boom'), {
        route: '/api/v1/budgets/:budgetId',
        password: 'secret-password',
        cookie: 'secret-cookie',
        comment: 'private comment',
        amountMinor: 999,
      }),
    ).resolves.toBe(true);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://errors.invalid/project');
    expect(requests[0]?.body).not.toMatch(/secret|private|999/);
  });
});
