import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const userId = randomUUID();
const workspaceId = randomUUID();
const budgetId = randomUUID();
const accountId = randomUUID();
const categoryId = randomUUID();
const currentEnvelopeId = randomUUID();
const secondCurrentEnvelopeId = randomUUID();
const customEnvelopeId = randomUUID();

async function createTransaction(
  status: 'CONFIRMED' | 'DELETED',
  preDeleteStatus: 'CONFIRMED' | null,
) {
  return prisma.transaction.create({
    data: {
      id: randomUUID(),
      budgetId,
      transactionType: 'INCOME',
      status,
      amountMinor: 100n,
      occurredOn: new Date('2026-09-05'),
      accountId,
      categoryId,
      confirmedAt: status === 'CONFIRMED' ? new Date('2026-09-05T12:00:00.000Z') : null,
      deletedAt: status === 'DELETED' ? new Date('2026-09-05T12:00:00.000Z') : null,
      preDeleteStatus,
      createdByUserId: userId,
      updatedByUserId: userId,
    },
  });
}

describe('Stage 3b lifecycle and period-slot migration', () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `stage-3b-${userId}@harmofin.test`, passwordHash: 'test-hash' },
    });
    await prisma.workspace.create({ data: { id: workspaceId, ownerId: userId, name: 'Stage 3b' } });
    await prisma.budget.create({
      data: { id: budgetId, workspaceId, name: 'Бюджет Stage 3b', planModelVersion: 1 },
    });
    await prisma.account.create({
      data: {
        id: accountId,
        budgetId,
        name: 'Наличные',
        accountType: 'CASH',
        startingBalanceMinor: 0n,
        accountingStartDate: new Date('2026-09-05'),
      },
    });
    await prisma.category.create({
      data: {
        id: categoryId,
        budgetId,
        name: 'Доход',
        categoryType: 'INCOME',
        displayOrder: 0,
      },
    });
  });

  afterAll(async () => {
    await prisma.incomeAllocation.deleteMany({ where: { budgetId } });
    await prisma.transaction.deleteMany({ where: { budgetId } });
    await prisma.envelope.deleteMany({ where: { budgetId } });
    await prisma.category.deleteMany({ where: { budgetId } });
    await prisma.account.deleteMany({ where: { budgetId } });
    await prisma.budget.delete({ where: { id: budgetId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('enforces active period-slot uniqueness and current-expense type', async () => {
    await prisma.envelope.create({
      data: {
        id: currentEnvelopeId,
        budgetId,
        name: 'Текущие 10–24',
        envelopeType: 'CURRENT_EXPENSES',
        periodSlot: 'FIRST',
        startingBalanceMinor: 0n,
        displayOrder: 0,
      },
    });

    await expect(
      prisma.envelope.create({
        data: {
          id: secondCurrentEnvelopeId,
          budgetId,
          name: 'Другие текущие',
          envelopeType: 'CURRENT_EXPENSES',
          periodSlot: 'FIRST',
          startingBalanceMinor: 0n,
          displayOrder: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await expect(
      prisma.envelope.create({
        data: {
          id: customEnvelopeId,
          budgetId,
          name: 'Неверный слот',
          envelopeType: 'CUSTOM',
          periodSlot: 'SECOND',
          startingBalanceMinor: 0n,
          displayOrder: 2,
        },
      }),
    ).rejects.toThrow('violates check constraint');
  });

  it('requires persisted pre-delete status for deleted transactions', async () => {
    await expect(createTransaction('DELETED', null)).rejects.toThrow('violates check constraint');
    await expect(createTransaction('CONFIRMED', 'CONFIRMED')).rejects.toThrow(
      'violates check constraint',
    );

    await expect(createTransaction('DELETED', 'CONFIRMED')).resolves.toMatchObject({
      status: 'DELETED',
      preDeleteStatus: 'CONFIRMED',
    });
  });

  it('persists allocation restore metadata', async () => {
    const income = await createTransaction('CONFIRMED', null);
    const allocation = await prisma.incomeAllocation.create({
      data: {
        id: randomUUID(),
        budgetId,
        incomeTransactionId: income.id,
        status: 'DELETED',
        preDeleteStatus: 'CONFIRMED',
        amountMinor: 100n,
        occurredOn: new Date('2026-09-05'),
        accountId,
        envelopeId: currentEnvelopeId,
        deletedAt: new Date('2026-09-05T12:00:00.000Z'),
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });

    expect(allocation.preDeleteStatus).toBe('CONFIRMED');
  });
});
