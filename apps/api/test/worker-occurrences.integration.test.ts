import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PlanOccurrenceHandler } from '../../worker/src/plan-occurrence.handler.js';
import { WorkerJobRepository } from '../../worker/src/job.repository.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const userId = randomUUID();
const workspaceId = randomUUID();
const budgetId = randomUUID();
const categoryId = randomUUID();
const accountId = randomUUID();
const envelopeId = randomUUID();
const planId = randomUUID();

const handler = new PlanOccurrenceHandler(prisma);

describe('plan occurrence worker handler', () => {
  beforeAll(async () => {
    await prisma.workerJob.deleteMany({
      where: {
        jobKey: { in: ['plans:materialize-v1', 'notifications:evaluate-budget-v1'] },
      },
    });
    await prisma.user.create({
      data: {
        id: userId,
        email: `worker-occurrences-${userId}@harmofin.test`,
        passwordHash: 'test-hash',
      },
    });
    await prisma.workspace.create({ data: { id: workspaceId, ownerId: userId, name: 'Worker' } });
    await prisma.budget.create({
      data: {
        id: budgetId,
        workspaceId,
        name: 'Бюджет worker',
        timezone: 'Europe/Moscow',
        planModelVersion: 2,
        planModelActivatedOn: new Date('2026-02-01T00:00:00.000Z'),
      },
    });
    await prisma.account.create({
      data: {
        id: accountId,
        budgetId,
        name: 'Счёт worker',
        accountType: 'CASH',
        startingBalanceMinor: 0n,
        accountingStartDate: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await prisma.category.create({
      data: {
        id: categoryId,
        budgetId,
        name: 'Расход worker',
        categoryType: 'EXPENSE',
        displayOrder: 0,
      },
    });
    await prisma.envelope.create({
      data: {
        id: envelopeId,
        budgetId,
        name: 'Обязательные worker',
        envelopeType: 'MANDATORY_EXPENSES',
        startingBalanceMinor: 0n,
        displayOrder: 0,
      },
    });
    await prisma.regularPlan.create({
      data: {
        id: planId,
        workspaceId,
        budgetId,
        name: 'Аренда',
        planType: 'EXPENSE',
        amountMinor: 100_000n,
        anchorOn: new Date('2026-01-31T00:00:00.000Z'),
        startOn: new Date('2026-01-31T00:00:00.000Z'),
        recurrence: 'MONTHLY',
        accountId,
        categoryId,
        envelopeId,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });
  });

  afterAll(async () => {
    await prisma.workerJob.deleteMany({
      where: {
        jobKey: { in: ['plans:materialize-v1', 'notifications:evaluate-budget-v1'] },
      },
    });
    await prisma.auditEvent.deleteMany({ where: { workspaceId } });
    await prisma.notification.deleteMany({ where: { budgetId } });
    await prisma.planOccurrence.deleteMany({ where: { budgetId } });
    await prisma.regularPlan.deleteMany({ where: { budgetId } });
    await prisma.transaction.deleteMany({ where: { budgetId } });
    await prisma.account.deleteMany({ where: { budgetId } });
    await prisma.category.deleteMany({ where: { budgetId } });
    await prisma.envelope.deleteMany({ where: { budgetId } });
    await prisma.budget.delete({ where: { id: budgetId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('claims a durable job once and recovers an expired lease', async () => {
    const repositoryA = new WorkerJobRepository(prisma);
    const repositoryB = new WorkerJobRepository(prisma);
    const now = new Date('2026-02-28T12:00:00.000Z');

    await repositoryA.ensureRecurringJobs(now);
    const [first, second] = await Promise.all([
      repositoryA.claimDue(1, now, ['MATERIALIZE_PLAN_OCCURRENCES'], 300),
      repositoryB.claimDue(1, now, ['MATERIALIZE_PLAN_OCCURRENCES'], 300),
    ]);

    expect(first.length + second.length).toBe(1);
    const claimed = [...first, ...second][0]!;
    const recovered = await repositoryB.claimDue(
      1,
      new Date('2026-02-28T12:05:01.000Z'),
      ['MATERIALIZE_PLAN_OCCURRENCES'],
      300,
    );

    expect(recovered).toEqual([
      expect.objectContaining({
        id: claimed.id,
        jobType: 'MATERIALIZE_PLAN_OCCURRENCES',
        attempts: 2,
      }),
    ]);
  });
  it('marks job failed after fifth retry', async () => {
    const repository = new WorkerJobRepository(prisma);
    const now = new Date('2026-02-28T12:00:00.000Z');
    const [job] = await repository.claimDue(
      1,
      new Date('2026-02-28T12:10:02.000Z'),
      ['MATERIALIZE_PLAN_OCCURRENCES'],
      300,
    );

    await repository.retry(job!.id, 5, now, 'Error: terminal');

    await expect(
      prisma.workerJob.findUniqueOrThrow({ where: { id: job!.id } }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      lastError: 'Error: terminal',
      lockedAt: null,
      leaseExpiresAt: null,
    });
  });

  it('materializes bounded occurrences idempotently and creates due records without balances', async () => {
    const now = new Date('2026-02-28T12:00:00.000Z');

    await handler.execute(now, budgetId);
    await handler.execute(now, budgetId);

    const occurrences = await prisma.planOccurrence.findMany({
      where: { planId },
      orderBy: { scheduledOn: 'asc' },
      select: { scheduledOn: true, status: true },
    });
    expect(occurrences).toEqual([
      { scheduledOn: new Date('2026-02-28T00:00:00.000Z'), status: 'DUE' },
      { scheduledOn: new Date('2026-03-31T00:00:00.000Z'), status: 'PENDING' },
    ]);
    expect(await prisma.transaction.count({ where: { budgetId } })).toBe(0);
    expect(
      await prisma.auditEvent.count({ where: { budgetId, entityType: 'plan_occurrence' } }),
    ).toBe(2);
  });
});
