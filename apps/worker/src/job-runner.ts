import type { WorkerJobType } from '@prisma/client';

import { WorkerJobRepository, type ClaimedJob } from './job.repository.js';

export interface WorkerJobHandler {
  execute(now: Date): Promise<void>;
}

export interface JobRunnerOptions {
  pollIntervalMs: number;
  concurrency: number;
  leaseSeconds: number;
  now?: () => Date;
}

export class JobRunner {
  private timer: NodeJS.Timeout | undefined;
  private readonly activeRuns = new Set<Promise<void>>();
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
    const jobs = await this.repository.claimDue(
      this.options.concurrency,
      this.now(),
      jobTypes,
      this.options.leaseSeconds,
    );
    await Promise.all(jobs.map((job) => this.runJob(job)));
  }

  private async runJob(job: ClaimedJob): Promise<void> {
    const run = this.executeJob(job);
    this.activeRuns.add(run);
    try {
      await run;
    } finally {
      this.activeRuns.delete(run);
    }
  }

  private async executeJob(job: ClaimedJob): Promise<void> {
    const now = this.now();
    const handler = this.handlers[job.jobType];
    if (!handler) return;
    try {
      await handler.execute(now);
      await this.repository.completeRecurring(job.id, nextRunAt(job.jobType, now));
    } catch (error) {
      await this.repository.retry(job.id, job.attempts, now, errorText(error));
    }
  }
}

function nextRunAt(jobType: WorkerJobType, now: Date): Date {
  const delayMs = jobType === 'MATERIALIZE_PLAN_OCCURRENCES' ? 300_000 : 900_000;
  return new Date(now.getTime() + delayMs);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 500);
  return 'Unknown error';
}
