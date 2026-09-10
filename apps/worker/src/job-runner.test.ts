import { describe, expect, it, vi } from 'vitest';

import { JobRunner } from './job-runner.js';

const now = new Date('2026-09-08T12:00:00.000Z');

describe('JobRunner', () => {
  it('reports poll and job outcomes to metrics', async () => {
    const repository = {
      ensureRecurringJobs: vi.fn().mockResolvedValue(undefined),
      claimDue: vi
        .fn()
        .mockResolvedValue([
          { id: 'job-id', jobType: 'MATERIALIZE_PLAN_OCCURRENCES' as const, attempts: 1 },
        ]),
      completeRecurring: vi.fn().mockResolvedValue(undefined),
      retry: vi.fn().mockResolvedValue(undefined),
    };
    const metrics = { recordPoll: vi.fn(), recordJob: vi.fn() };
    const runner = new JobRunner(
      repository as never,
      { MATERIALIZE_PLAN_OCCURRENCES: { execute: vi.fn().mockResolvedValue(undefined) } },
      { pollIntervalMs: 30_000, concurrency: 1, leaseSeconds: 300, now: () => now, metrics },
    );

    await runner.start();
    await runner.stop();

    expect(metrics.recordPoll).toHaveBeenCalledWith('success');
    expect(metrics.recordJob).toHaveBeenCalledWith('MATERIALIZE_PLAN_OCCURRENCES', 'completed');
  });

  it('reports a failed poll and retried job outcome on handler error', async () => {
    const repository = {
      ensureRecurringJobs: vi.fn().mockResolvedValue(undefined),
      claimDue: vi
        .fn()
        .mockResolvedValue([
          { id: 'job-id', jobType: 'MATERIALIZE_PLAN_OCCURRENCES' as const, attempts: 1 },
        ]),
      completeRecurring: vi.fn().mockResolvedValue(undefined),
      retry: vi.fn().mockResolvedValue(undefined),
    };
    const metrics = { recordPoll: vi.fn(), recordJob: vi.fn() };
    const runner = new JobRunner(
      repository as never,
      {
        MATERIALIZE_PLAN_OCCURRENCES: { execute: vi.fn().mockRejectedValue(new Error('boom')) },
      },
      { pollIntervalMs: 30_000, concurrency: 1, leaseSeconds: 300, now: () => now, metrics },
    );

    await runner.start();
    await runner.stop();

    expect(metrics.recordPoll).toHaveBeenCalledWith('failure');
    expect(metrics.recordJob).toHaveBeenCalledWith('MATERIALIZE_PLAN_OCCURRENCES', 'retried');
  });

  it('claims a materialization job and schedules next execution', async () => {
    const repository = {
      ensureRecurringJobs: vi.fn().mockResolvedValue(undefined),
      claimDue: vi.fn().mockResolvedValue([
        {
          id: 'job-id',
          jobType: 'MATERIALIZE_PLAN_OCCURRENCES' as const,
          attempts: 1,
        },
      ]),
      completeRecurring: vi.fn().mockResolvedValue(undefined),
      retry: vi.fn().mockResolvedValue(undefined),
    };
    const handler = { execute: vi.fn().mockResolvedValue(undefined) };
    const runner = new JobRunner(
      repository as never,
      { MATERIALIZE_PLAN_OCCURRENCES: handler },
      { pollIntervalMs: 30_000, concurrency: 1, leaseSeconds: 300, now: () => now },
    );

    await runner.start();
    await runner.stop();

    expect(repository.ensureRecurringJobs).toHaveBeenCalledOnce();
    expect(repository.claimDue).toHaveBeenCalledWith(1, now, ['MATERIALIZE_PLAN_OCCURRENCES'], 300);
    expect(handler.execute).toHaveBeenCalledWith(now);
    expect(repository.completeRecurring).toHaveBeenCalledWith(
      'job-id',
      new Date('2026-09-08T12:05:00.000Z'),
    );
  });

  it('schedules notification evaluation fifteen minutes later', async () => {
    const repository = {
      ensureRecurringJobs: vi.fn().mockResolvedValue(undefined),
      claimDue: vi
        .fn()
        .mockResolvedValue([
          { id: 'job-id', jobType: 'EVALUATE_BUDGET_NOTIFICATIONS' as const, attempts: 1 },
        ]),
      completeRecurring: vi.fn().mockResolvedValue(undefined),
      retry: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new JobRunner(
      repository as never,
      { EVALUATE_BUDGET_NOTIFICATIONS: { execute: vi.fn().mockResolvedValue(undefined) } },
      { pollIntervalMs: 30_000, concurrency: 1, leaseSeconds: 300, now: () => now },
    );

    await runner.start();
    await runner.stop();

    expect(repository.completeRecurring).toHaveBeenCalledWith(
      'job-id',
      new Date('2026-09-08T12:15:00.000Z'),
    );
  });

  it('retries handler failure with sanitized error', async () => {
    const repository = {
      ensureRecurringJobs: vi.fn().mockResolvedValue(undefined),
      claimDue: vi
        .fn()
        .mockResolvedValue([
          { id: 'job-id', jobType: 'MATERIALIZE_PLAN_OCCURRENCES' as const, attempts: 2 },
        ]),
      completeRecurring: vi.fn().mockResolvedValue(undefined),
      retry: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new JobRunner(
      repository as never,
      {
        MATERIALIZE_PLAN_OCCURRENCES: {
          execute: vi.fn().mockRejectedValue(new Error('database timeout')),
        },
      },
      { pollIntervalMs: 30_000, concurrency: 1, leaseSeconds: 300, now: () => now },
    );

    await runner.start();
    await runner.stop();

    expect(repository.retry).toHaveBeenCalledWith('job-id', 2, now, 'Error');
  });
});
