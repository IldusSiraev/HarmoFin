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
const ownerEmail = `v2-payment-owner-${randomUUID()}@harmofin.test`;
const otherEmail = `v2-payment-other-${randomUUID()}@harmofin.test`;

let app: NestFastifyApplication;
let server: FastifyInstance;
let ownerId: string;
let otherId: string;
let ownerBudgetId: string;
let otherBudgetId: string;
let ownerAccountAId: string;
let ownerAccountBId: string;
let foreignAccountId: string;
let ownerEnvelopeAId: string;
let ownerEnvelopeBId: string;
let ownerExpenseEnvelopeId: string;
let otherExpenseEnvelopeId: string;
let ownerExpenseCategoryId: string;
let otherExpenseCategoryId: string;
let legacyTransferId: string;
let ownerPlanId: string;
let ownerOccurrenceId: string;
let ownerTransactionAId: string;
let ownerTransactionBId: string;
let foreignTransactionId: string;

describe('v2 payment schema: direct transfer and plan payments', () => {
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

    await prisma.budget.update({
      where: { id: ownerBudgetId },
      data: {
        planModelVersion: 2,
        planModelActivatedOn: new Date('2026-09-29T00:00:00Z'),
      },
    });

    ownerAccountAId = await createAccount(ownerBudgetId, 'F04 счёт A');
    ownerAccountBId = await createAccount(ownerBudgetId, 'F04 счёт B');
    foreignAccountId = await createAccount(otherBudgetId, 'F04 чужой счёт');
    ownerEnvelopeAId = await createEnvelope(ownerBudgetId, 'F04 конверт A');
    ownerEnvelopeBId = await createEnvelope(ownerBudgetId, 'F04 конверт B');
    ownerExpenseEnvelopeId = await createEnvelope(ownerBudgetId, 'F04 конверт расхода');
    otherExpenseEnvelopeId = await createEnvelope(otherBudgetId, 'F04 чужой конверт расхода');
    ownerExpenseCategoryId = await createCategory(ownerBudgetId, 'F04 расход', 'EXPENSE');
    otherExpenseCategoryId = await createCategory(otherBudgetId, 'F04 чужой расход', 'EXPENSE');

    ownerPlanId = await createRegularPlan(ownerBudgetId, ownerId);
    ownerOccurrenceId = await createPlanOccurrence(ownerBudgetId, ownerPlanId);

    ownerTransactionAId = await createExpenseTransaction(
      ownerBudgetId,
      ownerId,
      ownerAccountAId,
      ownerExpenseCategoryId,
      ownerExpenseEnvelopeId,
      '2026-10-02',
      30000n,
    );
    ownerTransactionBId = await createExpenseTransaction(
      ownerBudgetId,
      ownerId,
      ownerAccountBId,
      ownerExpenseCategoryId,
      ownerExpenseEnvelopeId,
      '2026-10-03',
      20000n,
    );
    foreignTransactionId = await createExpenseTransaction(
      otherBudgetId,
      otherId,
      foreignAccountId,
      otherExpenseCategoryId,
      otherExpenseEnvelopeId,
      '2026-10-02',
      10000n,
    );

    legacyTransferId = await createLegacyTransferWithParts(ownerBudgetId, ownerId);
  });

  afterAll(async () => {
    await cleanupUser(ownerId);
    await cleanupUser(otherId);
    await app.close();
    await prisma.$disconnect();
  });

  it('keeps a legacy transfer with parts valid and defaults its mode to LEGACY_PARTS', async () => {
    const transfer = await prisma.transfer.findUniqueOrThrow({
      where: { id: legacyTransferId },
      include: { parts: true },
    });

    expect(transfer.mode).toBe('LEGACY_PARTS');
    expect(transfer.sourceAccountId).toBeNull();
    expect(transfer.destinationAccountId).toBeNull();
    expect(transfer.totalMinor).toBe(100000n);
    const partAmounts = transfer.parts
      .map((part) => part.amountMinor)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(partAmounts).toEqual([40000n, 60000n]);
  });

  it('accepts an ACCOUNT_ONLY direct transfer between two accounts of the same budget', async () => {
    const transfer = await prisma.transfer.create({
      data: {
        id: randomUUID(),
        budgetId: ownerBudgetId,
        status: 'CONFIRMED',
        mode: 'ACCOUNT_ONLY',
        sourceAccountId: ownerAccountAId,
        destinationAccountId: ownerAccountBId,
        totalMinor: 50000n,
        occurredOn: new Date('2026-10-05T00:00:00Z'),
        confirmedAt: new Date('2026-10-05T00:00:00Z'),
        createdByUserId: ownerId,
        updatedByUserId: ownerId,
      },
    });

    expect(transfer.mode).toBe('ACCOUNT_ONLY');
    expect(transfer.sourceAccountId).toBe(ownerAccountAId);
    expect(transfer.destinationAccountId).toBe(ownerAccountBId);
    expect(await prisma.transferPart.count({ where: { transferId: transfer.id } })).toBe(0);
  });

  it('rejects a direct transfer whose source and destination are the same account (CHECK)', async () => {
    await expect(
      prisma.transfer.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          status: 'CONFIRMED',
          mode: 'ACCOUNT_ONLY',
          sourceAccountId: ownerAccountAId,
          destinationAccountId: ownerAccountAId,
          totalMinor: 50000n,
          occurredOn: new Date('2026-10-06T00:00:00Z'),
          createdByUserId: ownerId,
          updatedByUserId: ownerId,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a direct transfer that references an account from another budget (composite FK)', async () => {
    await expect(
      prisma.transfer.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          status: 'CONFIRMED',
          mode: 'ACCOUNT_ONLY',
          sourceAccountId: foreignAccountId,
          destinationAccountId: ownerAccountAId,
          totalMinor: 50000n,
          occurredOn: new Date('2026-10-06T00:00:00Z'),
          createdByUserId: ownerId,
          updatedByUserId: ownerId,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.transfer.create({
        data: {
          id: randomUUID(),
          budgetId: otherBudgetId,
          status: 'CONFIRMED',
          mode: 'ACCOUNT_ONLY',
          sourceAccountId: ownerAccountAId,
          destinationAccountId: foreignAccountId,
          totalMinor: 50000n,
          occurredOn: new Date('2026-10-06T00:00:00Z'),
          createdByUserId: otherId,
          updatedByUserId: otherId,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a transfer with account references set while its mode is LEGACY_PARTS (CHECK)', async () => {
    await expect(
      prisma.transfer.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          status: 'CONFIRMED',
          sourceAccountId: ownerAccountAId,
          destinationAccountId: ownerAccountBId,
          totalMinor: 50000n,
          occurredOn: new Date('2026-10-07T00:00:00Z'),
          createdByUserId: ownerId,
          updatedByUserId: ownerId,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects an ACCOUNT_ONLY transfer with only one of the account references set (CHECK)', async () => {
    await expect(
      prisma.transfer.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          status: 'CONFIRMED',
          mode: 'ACCOUNT_ONLY',
          sourceAccountId: ownerAccountAId,
          totalMinor: 50000n,
          occurredOn: new Date('2026-10-07T00:00:00Z'),
          createdByUserId: ownerId,
          updatedByUserId: ownerId,
        },
      }),
    ).rejects.toThrow();
  });

  it('accepts two plan payments for the same occurrence linked by different transactions', async () => {
    await expect(
      prisma.planPayment.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          occurrenceId: ownerOccurrenceId,
          transactionId: ownerTransactionAId,
        },
      }),
    ).resolves.toHaveProperty('transactionId', ownerTransactionAId);

    await expect(
      prisma.planPayment.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          occurrenceId: ownerOccurrenceId,
          transactionId: ownerTransactionBId,
        },
      }),
    ).resolves.toHaveProperty('transactionId', ownerTransactionBId);

    expect(
      await prisma.planPayment.count({
        where: { budgetId: ownerBudgetId, occurrenceId: ownerOccurrenceId },
      }),
    ).toBe(2);
  });

  it('rejects a second plan payment linked to the same transaction (UNIQUE budget_id + transaction_id)', async () => {
    await expect(
      prisma.planPayment.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          occurrenceId: ownerOccurrenceId,
          transactionId: ownerTransactionAId,
        },
      }),
    ).rejects.toThrow();

    expect(
      await prisma.planPayment.count({
        where: { budgetId: ownerBudgetId, occurrenceId: ownerOccurrenceId },
      }),
    ).toBe(2);
  });

  it('rejects a plan payment whose transaction belongs to another budget (composite FK)', async () => {
    await expect(
      prisma.planPayment.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudgetId,
          occurrenceId: ownerOccurrenceId,
          transactionId: foreignTransactionId,
        },
      }),
    ).rejects.toThrow();
  });
});

async function createAccount(budgetId: string, name: string): Promise<string> {
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId,
      name,
      accountType: 'BANK_ACCOUNT',
      startingBalanceMinor: 0n,
      accountingStartDate: new Date('2026-09-01T00:00:00Z'),
    },
  });
  return account.id;
}

async function createCategory(
  budgetId: string,
  name: string,
  categoryType: 'INCOME' | 'EXPENSE',
): Promise<string> {
  const category = await prisma.category.create({
    data: {
      id: randomUUID(),
      budgetId,
      name,
      categoryType,
      displayOrder: 0,
    },
  });
  return category.id;
}

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

async function createExpenseTransaction(
  budgetId: string,
  userId: string,
  accountId: string,
  categoryId: string,
  envelopeId: string,
  occurredOn: string,
  amountMinor: bigint,
): Promise<string> {
  const transaction = await prisma.transaction.create({
    data: {
      id: randomUUID(),
      budgetId,
      transactionType: 'EXPENSE',
      status: 'CONFIRMED',
      amountMinor,
      occurredOn: new Date(`${occurredOn}T00:00:00Z`),
      confirmedAt: new Date(`${occurredOn}T00:00:00Z`),
      accountId,
      categoryId,
      envelopeId,
      createdByUserId: userId,
      updatedByUserId: userId,
    },
  });
  return transaction.id;
}

async function createRegularPlan(budgetId: string, userId: string): Promise<string> {
  const { workspaceId } = await prisma.budget.findUniqueOrThrow({
    where: { id: budgetId },
    select: { workspaceId: true },
  });
  const plan = await prisma.regularPlan.create({
    data: {
      id: randomUUID(),
      workspaceId,
      budgetId,
      name: `План F04 ${randomUUID()}`,
      planType: 'EXPENSE',
      amountMinor: 50000n,
      anchorOn: new Date('2026-10-01T00:00:00Z'),
      startOn: new Date('2026-10-01T00:00:00Z'),
      recurrence: 'MONTHLY',
      createdByUserId: userId,
      updatedByUserId: userId,
    },
  });
  return plan.id;
}

async function createPlanOccurrence(budgetId: string, planId: string): Promise<string> {
  const budget = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
  const occurrence = await prisma.planOccurrence.create({
    data: {
      id: randomUUID(),
      workspaceId: budget.workspaceId,
      budgetId,
      planId,
      scheduledOn: new Date('2026-10-01T00:00:00Z'),
      planName: 'План F04',
      planType: 'EXPENSE',
      amountMinor: 50000n,
    },
  });
  return occurrence.id;
}

async function createLegacyTransferWithParts(budgetId: string, userId: string): Promise<string> {
  const [envelopeA, envelopeB, accountA, accountB] = await Promise.all([
    prisma.envelope.findFirstOrThrow({ where: { id: ownerEnvelopeAId } }),
    prisma.envelope.findFirstOrThrow({ where: { id: ownerEnvelopeBId } }),
    prisma.account.findFirstOrThrow({ where: { id: ownerAccountAId } }),
    prisma.account.findFirstOrThrow({ where: { id: ownerAccountBId } }),
  ]);
  const transfer = await prisma.transfer.create({
    data: {
      id: randomUUID(),
      budgetId,
      status: 'CONFIRMED',
      totalMinor: 100000n,
      occurredOn: new Date('2026-10-04T00:00:00Z'),
      confirmedAt: new Date('2026-10-04T00:00:00Z'),
      createdByUserId: userId,
      updatedByUserId: userId,
    },
  });
  await prisma.transferPart.createMany({
    data: [
      {
        id: randomUUID(),
        transferId: transfer.id,
        budgetId,
        sourceAccountId: accountA.id,
        destinationAccountId: accountB.id,
        sourceEnvelopeId: envelopeA.id,
        destinationEnvelopeId: envelopeB.id,
        amountMinor: 60000n,
      },
      {
        id: randomUUID(),
        transferId: transfer.id,
        budgetId,
        sourceAccountId: accountA.id,
        destinationAccountId: accountB.id,
        sourceEnvelopeId: envelopeA.id,
        destinationEnvelopeId: envelopeB.id,
        amountMinor: 40000n,
      },
    ],
  });
  return transfer.id;
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
    const budgetIds = (
      await prisma.budget.findMany({ where: { workspaceId }, select: { id: true } })
    ).map((budget) => budget.id);
    await prisma.planPayment.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transferPart.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transfer.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.planOccurrence.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.notification.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.regularPlan.deleteMany({ where: { workspaceId } });
    await prisma.transaction.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.incomeAllocation.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeMovement.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeAssignment.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopePeriod.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeFundingRule.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budgetCycleRevision.deleteMany({ where: { budget: { workspaceId } } });
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
