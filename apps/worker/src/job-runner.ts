import type { WorkerJobType } from '@prisma/client';

import { WorkerJobRepository, type ClaimedJob } from './job.repository.js';

export interface WorkerJobHandler {
  execute(now: Date): Promise<void>;
}

export interface JobRunnerMetrics {
  recordPoll(outcome: 'success' | 'failure'): void;
  recordJob(jobType: string, outcome: 'completed' | 'failed' | 'retried'): void;
}

export interface JobRunnerOptions {
  pollIntervalMs: number;
  concurrency: number;
  leaseSeconds: number;
  now?: () => Date;
  metrics?: JobRunnerMetrics;
}

export class JobRunner {
  private timer: NodeJS.Timeout | undefined;
  private readonly activeRuns = new Set<Promise<boolean>>();
  private running = false;
  private readonly now: () => Date;

  constructor(
    private readonly repository: WorkerJobRepository,
    private readonly handlers: Partial<Record<WorkerJobType, WorkerJobHandler>>,
    private readonly options: JobRunnerOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.repository.ensureRecurringJobs(this.now());
    await this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.options.pollIntervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.all([...this.activeRuns]);
  }

  async runOnce(): Promise<void> {
    if (!this.running) return;
    const jobTypes = Object.entries(this.handlers).map(([jobType]) => jobType as WorkerJobType);
    try {
      const jobs = await this.repository.claimDue(
        this.options.concurrency,
        this.now(),
        jobTypes,
        this.options.leaseSeconds,
      );
      const outcomes = await Promise.all(jobs.map((job) => this.runJob(job)));
      this.options.metrics?.recordPoll(outcomes.includes(false) ? 'failure' : 'success');
    } catch (error) {
      this.options.metrics?.recordPoll('failure');
      throw error;
    }
  }

  private async runJob(job: ClaimedJob): Promise<boolean> {
    const run = this.executeJob(job);
    this.activeRuns.add(run);
    try {
      return await run;
    } finally {
      this.activeRuns.delete(run);
    }
  }

  private async executeJob(job: ClaimedJob): Promise<boolean> {
    const now = this.now();
    const handler = this.handlers[job.jobType];
    if (!handler) return true;
    try {
      await handler.execute(now);
      await this.repository.completeRecurring(job.id, nextRunAt(job.jobType, now));
      this.options.metrics?.recordJob(job.jobType, 'completed');
      return true;
    } catch (error) {
      const isFinalFailure = job.attempts >= 5;
      await this.repository.retry(job.id, job.attempts, now, errorText(error));
      this.options.metrics?.recordJob(job.jobType, isFinalFailure ? 'failed' : 'retried');
      return false;
    }
  }
}

function nextRunAt(jobType: WorkerJobType, now: Date): Date {
  const delayMs = jobType === 'MATERIALIZE_PLAN_OCCURRENCES' ? 300_000 : 900_000;
  return new Date(now.getTime() + delayMs);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.name : 'Unknown error';
}
