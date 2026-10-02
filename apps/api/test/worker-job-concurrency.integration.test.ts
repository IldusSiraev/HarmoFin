import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient, type WorkerJobType } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JobRunner, type WorkerJobHandler } from '../../worker/src/job-runner.js';
import { WorkerJobRepository, type ClaimedJob } from '../../worker/src/job.repository.js';
import { PlanOccurrenceHandler } from '../../worker/src/plan-occurrence.handler.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const workerA = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const workerB = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const userId = randomUUID();
const workspaceId = randomUUID();
const budgetId = randomUUID();
const categoryId = randomUUID();
const planId = randomUUID();
const jobId = randomUUID();
const jobKey = `worker-concurrency:${randomUUID()}`;
const initialNow = new Date('2026-09-10T12:00:00.000Z');
const recoveryNow = new Date('2026-09-10T12:10:00.000Z');
const jobType: WorkerJobType = 'MATERIALIZE_PLAN_OCCURRENCES';

let repository: WorkerJobRepository;

describe('worker job concurrency', () => {
  beforeAll(async () => {
    repository = new WorkerJobRepository(prisma);
    await prisma.user.create({
      data: {
        id: userId,
        email: `worker-concurrency-${userId}@harmofin.test`,
        passwordHash: 'test-hash',
      },
    });
    await prisma.workspace.create({
      data: { id: workspaceId, ownerId: userId, name: 'Worker concurrency' },
    });
    await prisma.budget.create({
      data: {
        id: budgetId,
        workspaceId,
        name: 'Бюджет concurrency',
        timezone: 'Europe/Moscow',
        planModelVersion: 1,
      },
    });
    await prisma.category.create({
      data: {
        id: categoryId,
        budgetId,
        name: 'Доход concurrency',
        categoryType: 'INCOME',
        displayOrder: 0,
      },
    });
    await prisma.regularPlan.create({
      data: {
        id: planId,
        workspaceId,
        budgetId,
        name: 'Одно возникновение',
        planType: 'INCOME',
        amountMinor: 10_000n,
        anchorOn: new Date('2026-09-10T00:00:00.000Z'),
        startOn: new Date('2026-09-10T00:00:00.000Z'),
        recurrence: 'ONE_TIME',
        categoryId,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });
    await prisma.workerJob.create({
      data: {
        id: jobId,
        jobKey,
        jobType,
        payload: { version: 1 },
        status: 'PENDING',
        runAt: initialNow,
      },
    });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { workspaceId } });
    await prisma.planOccurrence.deleteMany({ where: { budgetId } });
    await prisma.regularPlan.deleteMany({ where: { budgetId } });
    await prisma.workerJob.deleteMany({ where: { id: jobId } });
    await prisma.category.deleteMany({ where: { budgetId } });
    await prisma.budget.deleteMany({ where: { id: budgetId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await Promise.all([prisma.$disconnect(), workerA.$disconnect(), workerB.$disconnect()]);
  });

  it('runs one materialization handler after concurrent claim and after lease recovery', async () => {
    const initialClaim = await claimConcurrently(initialNow);
    expect(initialClaim).toHaveLength(1);
    expect(initialClaim[0]).toMatchObject({ id: jobId, attempts: 1 });

    const initialCalls = await runClaimedJob(initialClaim[0]!, initialNow);
    expect(initialCalls).toBe(1);
    expect(await prisma.planOccurrence.count({ where: { planId } })).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { budgetId, entityType: 'plan_occurrence', action: 'CREATED', source: 'WORKER' },
      }),
    ).toBe(1);

    await prisma.workerJob.update({
      where: { id: jobId },
      data: {
        status: 'RUNNING',
        attempts: 1,
        lockedAt: initialNow,
        leaseExpiresAt: new Date(recoveryNow.getTime() - 1),
      },
    });

    const recoveredClaim = await claimConcurrently(recoveryNow);
    expect(recoveredClaim).toHaveLength(1);
    expect(recoveredClaim[0]).toMatchObject({ id: jobId, attempts: 2 });

    const recoveryCalls = await runClaimedJob(recoveredClaim[0]!, recoveryNow);
    expect(recoveryCalls).toBe(1);
    expect(await prisma.planOccurrence.count({ where: { planId } })).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { budgetId, entityType: 'plan_occurrence', action: 'CREATED', source: 'WORKER' },
      }),
    ).toBe(1);
    await expect(
      prisma.workerJob.findUniqueOrThrow({ where: { id: jobId } }),
    ).resolves.toMatchObject({
      status: 'PENDING',
      attempts: 0,
      lockedAt: null,
      leaseExpiresAt: null,
      runAt: new Date(recoveryNow.getTime() + 300_000),
    });
  });

  async function claimConcurrently(now: Date): Promise<ClaimedJob[]> {
    const barrier = createBarrier(2);
    const [left, right] = await Promise.all([
      claimById(workerA, now, barrier),
      claimById(workerB, now, barrier),
    ]);
    return [...left, ...right];
  }

  async function runClaimedJob(job: ClaimedJob, now: Date): Promise<number> {
    let calls = 0;
    const materialize: WorkerJobHandler = {
      async execute(handlerNow) {
        calls += 1;
        await new PlanOccurrenceHandler(prisma).execute(handlerNow, budgetId);
      },
    };
    const runnerA = new JobRunner(
      scopedRunnerRepository(job),
      { [jobType]: materialize },
      runnerOptions(now),
    );
    const runnerB = new JobRunner(
      scopedRunnerRepository(),
      { [jobType]: materialize },
      runnerOptions(now),
    );

    await Promise.all([runnerA.start(), runnerB.start()]);
    await Promise.all([runnerA.stop(), runnerB.stop()]);
    return calls;
  }
});

function runnerOptions(now: Date) {
  return { pollIntervalMs: 60_000, concurrency: 1, leaseSeconds: 300, now: () => now };
}

function scopedRunnerRepository(job?: ClaimedJob) {
  let available = job;
  return {
    ensureRecurringJobs: async () => undefined,
    claimDue: async () => {
      const claimed = available ? [available] : [];
      available = undefined;
      return claimed;
    },
    completeRecurring: (jobId: string, nextRunAt: Date) =>
      repository.completeRecurring(jobId, nextRunAt),
    retry: (jobId: string, attempts: number, now: Date, error: string) =>
      repository.retry(jobId, attempts, now, error),
  } as unknown as WorkerJobRepository;
}

async function claimById(
  client: PrismaClient,
  now: Date,
  barrier: ReturnType<typeof createBarrier>,
): Promise<ClaimedJob[]> {
  await barrier.wait();
  const leaseExpiresAt = new Date(now.getTime() + 300_000);
  return client.$transaction(
    (tx) =>
      tx.$queryRaw<ClaimedJob[]>`
      WITH selected AS (
        SELECT "id"
        FROM "worker_jobs"
        WHERE "id" = ${jobId}::uuid
          AND "job_type" = ${Prisma.sql`${jobType}::"WorkerJobType"`}
          AND (
            ("status" = 'PENDING' AND "run_at" <= ${now})
            OR ("status" = 'RUNNING' AND "lease_expires_at" <= ${now})
          )
        FOR UPDATE SKIP LOCKED
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

function createBarrier(parties: number) {
  let arrived = 0;
  let release: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async wait() {
      arrived += 1;
      if (arrived === parties) release?.();
      await ready;
    },
  };
}
