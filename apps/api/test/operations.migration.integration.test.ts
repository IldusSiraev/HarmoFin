import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const operations = prisma;
const userId = randomUUID();
const workspaceId = randomUUID();
const budgetId = randomUUID();
const otherBudgetId = randomUUID();
const accountId = randomUUID();
const categoryId = randomUUID();
const envelopeId = randomUUID();
const otherAccountId = randomUUID();
const otherCategoryId = randomUUID();
const otherEnvelopeId = randomUUID();
const incomeTransactionId = randomUUID();

async function createReferences(
  targetBudgetId: string,
  ids: { accountId: string; categoryId: string; envelopeId: string },
) {
  await prisma.account.create({
    data: {
      id: ids.accountId,
      budgetId: targetBudgetId,
      name: `Счёт ${ids.accountId}`,
      accountType: 'CASH',
      startingBalanceMinor: 0n,
      accountingStartDate: new Date('2026-09-04'),
    },
  });
  await prisma.category.create({
    data: {
      id: ids.categoryId,
      budgetId: targetBudgetId,
      name: `Категория ${ids.categoryId}`,
      categoryType: 'INCOME',
      displayOrder: 0,
    },
  });
  await prisma.envelope.create({
    data: {
      id: ids.envelopeId,
      budgetId: targetBudgetId,
      name: `Конверт ${ids.envelopeId}`,
      envelopeType: 'CUSTOM',
      startingBalanceMinor: 0n,
      displayOrder: 0,
    },
  });
}

function transactionData(
  overrides: Partial<Prisma.TransactionUncheckedCreateInput> = {},
): Prisma.TransactionUncheckedCreateInput {
  return {
    id: randomUUID(),
    budgetId,
    transactionType: 'INCOME',
    amountMinor: 1n,
    occurredOn: new Date('2026-09-04'),
    accountId,
    categoryId,
    createdByUserId: userId,
    updatedByUserId: userId,
    ...overrides,
  } as Prisma.TransactionUncheckedCreateInput;
}

function allocationData(
  overrides: Partial<Prisma.IncomeAllocationUncheckedCreateInput> = {},
): Prisma.IncomeAllocationUncheckedCreateInput {
  return {
    id: randomUUID(),
    budgetId,
    incomeTransactionId,
    amountMinor: 1n,
    occurredOn: new Date('2026-09-04'),
    accountId,
    envelopeId,
    createdByUserId: userId,
    updatedByUserId: userId,
    ...overrides,
  } as Prisma.IncomeAllocationUncheckedCreateInput;
}

describe('Stage 3a operations migration', () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `operations-${userId}@harmofin.test`, passwordHash: 'test-hash' },
    });
    await prisma.workspace.create({
      data: { id: workspaceId, ownerId: userId, name: 'Операции' },
    });
    await prisma.budget.create({ data: { id: budgetId, workspaceId, name: 'Первый бюджет' } });
    await prisma.budget.create({ data: { id: otherBudgetId, workspaceId, name: 'Второй бюджет' } });
    await createReferences(budgetId, { accountId, categoryId, envelopeId });
    await createReferences(otherBudgetId, {
      accountId: otherAccountId,
      categoryId: otherCategoryId,
      envelopeId: otherEnvelopeId,
    });
    await operations.transaction.create({ data: transactionData({ id: incomeTransactionId }) });
  });

  afterAll(async () => {
    await operations.idempotencyRecord.deleteMany({
      where: { budgetId: { in: [budgetId, otherBudgetId] } },
    });
    await operations.incomeAllocation.deleteMany({
      where: { budgetId: { in: [budgetId, otherBudgetId] } },
    });
    await operations.transaction.deleteMany({
      where: { budgetId: { in: [budgetId, otherBudgetId] } },
    });
    await prisma.account.deleteMany({ where: { budgetId: { in: [budgetId, otherBudgetId] } } });
    await prisma.category.deleteMany({ where: { budgetId: { in: [budgetId, otherBudgetId] } } });
    await prisma.envelope.deleteMany({ where: { budgetId: { in: [budgetId, otherBudgetId] } } });
    await prisma.budget.deleteMany({ where: { id: { in: [budgetId, otherBudgetId] } } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('enforces Stage 3a financial SQL constraints', async () => {
    await expect(
      operations.transaction.create({ data: transactionData({ currency: 'USD' }) }),
    ).rejects.toThrow('violates check constraint');
    await expect(
      operations.transaction.create({ data: transactionData({ scale: 3 }) }),
    ).rejects.toThrow('violates check constraint');
    await expect(
      operations.transaction.create({ data: transactionData({ amountMinor: 0n }) }),
    ).rejects.toThrow('violates check constraint');
    await expect(
      operations.transaction.create({
        data: transactionData({ transactionType: 'EXPENSE', envelopeId: null }),
      }),
    ).rejects.toThrow('violates check constraint');
    await expect(
      operations.incomeAllocation.create({ data: allocationData({ currency: 'USD' }) }),
    ).rejects.toThrow('violates check constraint');
    await expect(
      operations.incomeAllocation.create({ data: allocationData({ scale: 3 }) }),
    ).rejects.toThrow('violates check constraint');
    await expect(
      operations.incomeAllocation.create({ data: allocationData({ amountMinor: 0n }) }),
    ).rejects.toThrow('violates check constraint');
  });

  it('enforces same-budget relations, allocation source and idempotency uniqueness', async () => {
    await expect(
      operations.transaction.create({
        data: transactionData({
          accountId: otherAccountId,
          categoryId: otherCategoryId,
          envelopeId: otherEnvelopeId,
        }),
      }),
    ).rejects.toMatchObject({ code: 'P2003' });

    await expect(
      operations.incomeAllocation.create({
        data: allocationData({ incomeTransactionId: randomUUID() }),
      }),
    ).rejects.toMatchObject({ code: 'P2003' });

    const key = `key-${randomUUID()}`;
    const data = {
      budgetId,
      actorUserId: userId,
      key,
      operation: 'transaction.create',
      requestHash: 'a'.repeat(64),
      responseStatus: 201,
      responseBody: { id: incomeTransactionId },
    };
    await operations.idempotencyRecord.create({ data: { id: randomUUID(), ...data } });
    await expect(
      operations.idempotencyRecord.create({ data: { id: randomUUID(), ...data } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
