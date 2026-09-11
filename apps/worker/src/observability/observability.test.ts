import { describe, expect, it } from 'vitest';

import {
  MetricsRegistry,
  createWorkerErrorReporter,
  sanitizeWorkerTelemetry,
} from './observability.js';

describe('worker observability', () => {
  it('counts poll and job outcomes with safe labels', () => {
    const metrics = new MetricsRegistry({
      service: 'worker',
      environment: 'test',
      releaseSha: 'abc123',
    });

    metrics.setProcessHealth(1);
    metrics.recordPoll('success');
    metrics.recordPoll('failure');
    metrics.recordJob('MATERIALIZE_PLAN_OCCURRENCES', 'completed');
    metrics.recordJob('EVALUATE_BUDGET_NOTIFICATIONS', 'failed');
    metrics.setBacklog(3);

    const output = metrics.render();

    expect(output).toContain('harmofin_worker_polls_total{outcome="success"} 1');
    expect(output).toContain('harmofin_worker_polls_total{outcome="failure"} 1');
    expect(output).toContain(
      'harmofin_worker_jobs_total{job_type="MATERIALIZE_PLAN_OCCURRENCES",outcome="completed"} 1',
    );
    expect(output).toContain('harmofin_worker_backlog 3');
    expect(output).not.toMatch(/payload|comment|amount|password|cookie/i);
  });

  it('redacts payload fields from worker telemetry', () => {
    const payload = sanitizeWorkerTelemetry({
      event: 'job_outcome',
      jobType: 'EVALUATE_BUDGET_NOTIFICATIONS',
      outcome: 'failed',
      jobPayload: { amountMinor: 1000, comment: 'private' },
      password: 'secret-password',
      cookie: 'secret-cookie',
    });

    expect(payload).toEqual({
      event: 'job_outcome',
      jobType: 'EVALUATE_BUDGET_NOTIFICATIONS',
      outcome: 'failed',
    });
  });

  it('disables worker error reporting without an endpoint', async () => {
    const reporter = createWorkerErrorReporter(undefined, async () => new Response(null));

    await expect(reporter.report(new Error('failed'), { jobPayload: 'secret' })).resolves.toBe(
      false,
    );
  });
});
