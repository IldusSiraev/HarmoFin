import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient, type WorkerJobType } from '@prisma/client';

export type ClaimedJob = {
  id: string;
  jobType: WorkerJobType;
  attempts: number;
};

const recurringJobs: Array<{ jobKey: string; jobType: WorkerJobType }> = [
  { jobKey: 'plans:materialize-v1', jobType: 'MATERIALIZE_PLAN_OCCURRENCES' },
  { jobKey: 'notifications:evaluate-budget-v1', jobType: 'EVALUATE_BUDGET_NOTIFICATIONS' },
  { jobKey: 'accounts:purge-deleted-v1', jobType: 'PURGE_DELETED_ACCOUNTS' },
];

export class WorkerJobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async ensureRecurringJobs(now = new Date()): Promise<void> {
    await Promise.all(
      recurringJobs.map(({ jobKey, jobType }) =>
        this.prisma.workerJob.upsert({
          where: { jobKey },
          create: {
            id: randomUUID(),
            jobKey,
            jobType,
            payload: { version: 1 },
            status: 'PENDING',
            runAt: now,
          },
          update: {},
        }),
      ),
    );
  }

  async claimDue(
    limit: number,
    now: Date,
    jobTypes: WorkerJobType[],
    leaseSeconds: number,
  ): Promise<ClaimedJob[]> {
    if (jobTypes.length === 0) return [];
    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1_000);
    return this.prisma.$transaction(
      (tx) =>
        tx.$queryRaw<ClaimedJob[]>`
        WITH selected AS (
          SELECT "id"
          FROM "worker_jobs"
          WHERE "job_type" IN (${Prisma.join(jobTypes.map((type) => Prisma.sql`${type}::"WorkerJobType"`))})
            AND (
              ("status" = 'PENDING' AND "run_at" <= ${now})
              OR ("status" = 'RUNNING' AND "lease_expires_at" <= ${now})
            )
          ORDER BY "run_at" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE "worker_jobs" AS job
        SET
          "status" = 'RUNNING',
          "attempts" = job."attempts" + 1,
          "locked_at" = ${now},
          "lease_expires_at" = ${leaseExpiresAt},
          "updated_at" = ${now}
        FROM selected
        WHERE job."id" = selected."id"
        RETURNING
          job."id" AS "id",
          job."job_type" AS "jobType",
          job."attempts" AS "attempts"
      `,
    );
  }

  async completeRecurring(jobId: string, nextRunAt: Date): Promise<void> {
    const now = new Date();
    await this.prisma.workerJob.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        attempts: 0,
        runAt: nextRunAt,
        lockedAt: null,
        leaseExpiresAt: null,
        lastRunAt: now,
        completedAt: now,
        lastError: null,
      },
    });
  }

  async retry(jobId: string, attempts: number, now: Date, error: string): Promise<void> {
    if (attempts >= 5) {
      await this.prisma.workerJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          lockedAt: null,
          leaseExpiresAt: null,
          lastRunAt: now,
          lastError: error.slice(0, 500),
        },
      });
      return;
    }

    const delayMs = Math.min(30_000 * 2 ** (attempts - 1), 1_800_000);
    await this.prisma.workerJob.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        runAt: new Date(now.getTime() + delayMs),
        lockedAt: null,
        leaseExpiresAt: null,
        lastRunAt: now,
        lastError: error.slice(0, 500),
      },
    });
  }
}
