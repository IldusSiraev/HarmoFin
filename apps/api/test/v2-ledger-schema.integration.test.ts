import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const ownerEmail = `v2-ledger-owner-${randomUUID()}@harmofin.test`;
const otherEmail = `v2-ledger-other-${randomUUID()}@harmofin.test`;

let app: NestFastifyApplication;
let server: FastifyInstance;
let ownerId: string;
let otherId: string;
let ownerBudgetId: string;
let otherBudgetId: string;
let ownerEnvelopeAId: string;
let ownerEnvelopeBId: string;
let foreignEnvelopeId: string;
let ownerPeriodAId: string;
let ownerPeriodBId: string;
let ownerEnvelopeBPeriodId: string;
let foreignPeriodId: string;
let ownerIncomeTransactionId: string;
let foreignIncomeTransactionId: string;

describe('v2 envelope ledger schema: virtual assignments and explicit movements', () => {
  beforeAll(async () => {
    app = await createApiApp(
      loadApiConfig({
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        WEB_ORIGIN: origin,
        AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        MAIL_FROM: 'no-reply@harmofin.test',
        WEB_BASE_URL: origin,
        LOG_LEVEL: 'silent',
      }),
    );
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();

    const owner = await register(ownerEmail);
    ownerId = owner.user.id;
    ownerBudgetId = owner.budget.id;
    const other = await register(otherEmail);
    otherId = other.user.id;
    otherBudgetId = other.budget.id;

    ownerEnvelopeAId = await createEnvelope(ownerBudgetId, 'F03 конверт A');
    ownerEnvelopeBId = await createEnvelope(ownerBudgetId, 'F03 конверт B');
    foreignEnvelopeId = await createEnvelope(otherBudgetId, 'F03 чужой конверт');

    ownerPeriodAId = await createPeriod(
      ownerBudgetId,
      ownerEnvelopeAId,
      '2026-10-01',
      '2026-10-31',
    );
    ownerPeriodBId = await createPeriod(
      ownerBudgetId,
      ownerEnvelopeAId,
      '2026-11-01',
      '2026-11-30',
    );
    ownerEnvelopeBPeriodId = await createPeriod(
      ownerBudgetId,
      ownerEnvelopeBId,
      '2026-10-01',
      '2026-10-31',
    );
    foreignPeriodId = await createPeriod(
      otherBudgetId,
      foreignEnvelopeId,
      '2026-10-01',
      '2026-10-31',
    );

    ownerIncomeTransactionId = await createIncomeTransaction(
      ownerBudgetId,
      ownerId,
      '2026-10-05',
      100000n,
    );
    foreignIncomeTransactionId = await createIncomeTransaction(
      otherBudgetId,
      otherId,
      '2026-10-05',
      50000n,
    );
  });

  afterAll(async () => {
    await cleanupUser(ownerId);
    await cleanupUser(otherId);
    await app.close();
    await prisma.$disconnect();
  });

  it('rejects an assignment with a zero amount (CHECK amount_minor > 0)', async () => {
    await expect(
      prisma.envelopeAssignment.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          envelopeId: ownerEnvelopeAId,
          type: 'OPENING',
          amountMinor: 0n,
          effectiveOn: new Date('2026-10-01T00:00:00Z'),
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a movement with a zero amount (CHECK amount_minor > 0)', async () => {
    await expect(
      prisma.envelopeMovement.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          sourceEnvelopeId: ownerEnvelopeAId,
          amountMinor: 0n,
          effectiveOn: new Date('2026-10-01T00:00:00Z'),
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects an assignment with a periodId from another budget (triple scoped FK)', async () => {
    await expect(
      prisma.envelopeAssignment.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          envelopeId: ownerEnvelopeAId,
          type: 'OPENING',
          amountMinor: 100n,
          effectiveOn: new Date('2026-10-01T00:00:00Z'),
          periodId: foreignPeriodId,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects an assignment whose period is in the same budget but another envelope (triple scoped FK)', async () => {
    await expect(
      prisma.envelopeAssignment.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          envelopeId: ownerEnvelopeAId,
          type: 'OPENING',
          amountMinor: 100n,
          effectiveOn: new Date('2026-10-01T00:00:00Z'),
          periodId: ownerEnvelopeBPeriodId,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects an assignment with a source income transaction from another budget (scoped FK)', async () => {
    await expect(
      prisma.envelopeAssignment.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          envelopeId: ownerEnvelopeAId,
          type: 'INCOME',
          amountMinor: 100n,
          effectiveOn: new Date('2026-10-01T00:00:00Z'),
          sourceIncomeTransactionId: foreignIncomeTransactionId,
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces the INCOME/OPENING/FREE shape of sourceIncomeTransactionId (CHECK)', async () => {
    await expect(
      prisma.envelopeAssignment.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          envelopeId: ownerEnvelopeAId,
          type: 'INCOME',
          amountMinor: 100n,
          effectiveOn: new Date('2026-10-01T00:00:00Z'),
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.envelopeAssignment.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          envelopeId: ownerEnvelopeAId,
          type: 'OPENING',
          amountMinor: 100n,
          effectiveOn: new Date('2026-10-01T00:00:00Z'),
          sourceIncomeTransactionId: ownerIncomeTransactionId,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.envelopeAssignment.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          envelopeId: ownerEnvelopeAId,
          type: 'FREE',
          amountMinor: 100n,
          effectiveOn: new Date('2026-10-01T00:00:00Z'),
          sourceIncomeTransactionId: ownerIncomeTransactionId,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a movement without a source (NOT NULL source_envelope_id)', async () => {
    const moveId = randomUUID();
    const before = await prisma.envelopeMovement.count({ where: { budgetId: ownerBudgetId } });

    await expect(
      prisma.$executeRaw`INSERT INTO "envelope_movements" (
        "id", "budget_id", "source_envelope_id", "source_period_id",
        "destination_envelope_id", "destination_period_id", "amount_minor",
        "effective_on", "status", "created_at", "updated_at"
      ) VALUES (
        ${moveId}, ${ownerBudgetId}, NULL, NULL, NULL, NULL, 100,
        '2026-10-01', 'CONFIRMED', NOW(), NOW()
      )`,
    ).rejects.toThrow();

    expect(await prisma.envelopeMovement.count({ where: { budgetId: ownerBudgetId } })).toBe(
      before,
    );
  });

  it('rejects a movement whose source envelope belongs to another budget (scoped FK)', async () => {
    await expect(
      prisma.envelopeMovement.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          sourceEnvelopeId: foreignEnvelopeId,
          amountMinor: 100n,
          effectiveOn: new Date('2026-10-01T00:00:00Z'),
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a movement whose destination period does not belong to the destination envelope (triple scoped FK)', async () => {
    await expect(
      prisma.envelopeMovement.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          sourceEnvelopeId: ownerEnvelopeBId,
          sourcePeriodId: ownerEnvelopeBPeriodId,
          destinationEnvelopeId: ownerEnvelopeAId,
          destinationPeriodId: ownerEnvelopeBPeriodId,
          amountMinor: 100n,
          effectiveOn: new Date('2026-10-01T00:00:00Z'),
        },
      }),
    ).rejects.toThrow();
  });

  it('accepts assignments for two different periods of the same envelope', async () => {
    const first = await prisma.envelopeAssignment.create({
      data: {
        id: randomUUID(),
        budgetId: ownerBudgetId,
        envelopeId: ownerEnvelopeAId,
        type: 'OPENING',
        amountMinor: 65000n,
        effectiveOn: new Date('2026-10-01T00:00:00Z'),
        periodId: ownerPeriodAId,
      },
    });
    const second = await prisma.envelopeAssignment.create({
      data: {
        id: randomUUID(),
        budgetId: ownerBudgetId,
        envelopeId: ownerEnvelopeAId,
        type: 'OPENING',
        amountMinor: 40000n,
        effectiveOn: new Date('2026-11-01T00:00:00Z'),
        periodId: ownerPeriodBId,
      },
    });

    expect(first.status).toBe('CONFIRMED');
    expect(second.status).toBe('CONFIRMED');
    expect(first.amountMinor).toBe(65000n);
    expect(second.amountMinor).toBe(40000n);
    expect(first.periodId).toBe(ownerPeriodAId);
    expect(second.periodId).toBe(ownerPeriodBId);
  });

  it('accepts an INCOME assignment bound to the budget own confirmed income', async () => {
    const assignment = await prisma.envelopeAssignment.create({
      data: {
        id: randomUUID(),
        budgetId: ownerBudgetId,
        envelopeId: ownerEnvelopeAId,
        type: 'INCOME',
        amountMinor: 20000n,
        effectiveOn: new Date('2026-10-05T00:00:00Z'),
        sourceIncomeTransactionId: ownerIncomeTransactionId,
      },
    });

    expect(assignment.sourceIncomeTransactionId).toBe(ownerIncomeTransactionId);
    expect(assignment.status).toBe('CONFIRMED');
  });

  it('accepts a movement with a destination period of the same destination envelope', async () => {
    const movement = await prisma.envelopeMovement.create({
      data: {
        id: randomUUID(),
        budgetId: ownerBudgetId,
        sourceEnvelopeId: ownerEnvelopeBId,
        sourcePeriodId: ownerEnvelopeBPeriodId,
        destinationEnvelopeId: ownerEnvelopeAId,
        destinationPeriodId: ownerPeriodAId,
        amountMinor: 15000n,
        effectiveOn: new Date('2026-10-02T00:00:00Z'),
      },
    });

    expect(movement.status).toBe('CONFIRMED');
    expect(movement.amountMinor).toBe(15000n);
    expect(movement.destinationEnvelopeId).toBe(ownerEnvelopeAId);
    expect(movement.destinationPeriodId).toBe(ownerPeriodAId);
  });

  it('accepts a movement with a null destination (explicit release)', async () => {
    const movement = await prisma.envelopeMovement.create({
      data: {
        id: randomUUID(),
        budgetId: ownerBudgetId,
        sourceEnvelopeId: ownerEnvelopeAId,
        sourcePeriodId: ownerPeriodAId,
        amountMinor: 7000n,
        effectiveOn: new Date('2026-10-03T00:00:00Z'),
      },
    });

    expect(movement.destinationEnvelopeId).toBeNull();
    expect(movement.destinationPeriodId).toBeNull();
    expect(movement.status).toBe('CONFIRMED');
  });
});

async function createEnvelope(budgetId: string, name: string): Promise<string> {
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      name,
      envelopeType: 'CUSTOM',
      startingBalanceMinor: 0n,
      displayOrder: 950,
    },
  });
  return envelope.id;
}

async function createPeriod(
  budgetId: string,
  envelopeId: string,
  startsOn: string,
  endsOn: string,
): Promise<string> {
  const period = await prisma.envelopePeriod.create({
    data: {
      id: randomUUID(),
      budgetId,
      envelopeId,
      startsOn: new Date(`${startsOn}T00:00:00Z`),
      endsOn: new Date(`${endsOn}T00:00:00Z`),
    },
  });
  return period.id;
}

async function createIncomeTransaction(
  budgetId: string,
  userId: string,
  occurredOn: string,
  amountMinor: bigint,
): Promise<string> {
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: `Счёт F03 ${randomUUID()}`,
      accountType: 'BANK_ACCOUNT',
      startingBalanceMinor: 0n,
      accountingStartDate: new Date('2026-09-01T00:00:00Z'),
    },
  });
  const category = await prisma.category.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: `Доход F03 ${randomUUID()}`,
      categoryType: 'INCOME',
      displayOrder: 0,
    },
  });
  const transaction = await prisma.transaction.create({
    data: {
      id: randomUUID(),
      budgetId,
      transactionType: 'INCOME',
      status: 'CONFIRMED',
      amountMinor,
      occurredOn: new Date(`${occurredOn}T00:00:00Z`),
      confirmedAt: new Date(`${occurredOn}T00:00:00Z`),
      accountId: account.id,
      categoryId: category.id,
      createdByUserId: userId,
      updatedByUserId: userId,
    },
  });
  return transaction.id;
}

async function register(email: string) {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{
    user: { id: string };
    workspace: { id: string };
    budget: { id: string };
    csrfToken: string;
  }>();
  const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
  if (!cookie) throw new Error('Missing session cookie');
  return { ...body, cookie };
}

async function cleanupUser(userId: string) {
  if (!userId) return;
  await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.recoveryToken.deleteMany({ where: { userId } });
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    select: { workspaceId: true },
  });
  await prisma.workspaceMembership.deleteMany({ where: { userId } });
  for (const { workspaceId } of memberships) {
    await prisma.envelopeMovement.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeAssignment.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.incomeAllocation.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopePeriod.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeFundingRule.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budgetCycleRevision.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.transaction.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budget.updateMany({
      where: { workspaceId },
      data: {
        incomeAllocationSourceCategoryId: null,
        incomeAllocationTargetEnvelopeId: null,
      },
    });
    await prisma.account.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.category.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelope.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budget.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}
