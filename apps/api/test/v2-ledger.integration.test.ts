import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { AssignmentBalanceRepository } from '../src/envelope-plans/assignment-balance.repository.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const ownerEmail = `v2-ledger-balance-${randomUUID()}@harmofin.test`;

let app: NestFastifyApplication;
let server: FastifyInstance;
let ownerId: string;
let budgetId: string;
let accountId: string;
let transferAccountId: string;
let incomeCategoryId: string;
let expenseCategoryId: string;
let incomeId: string;
let envelopeAId: string;
let envelopeBId: string;
let envelopeCId: string;
let envelopeDId: string;
let legacyEnvelopeId: string;
let periodAId: string;
let periodA2Id: string;

const at = (date: string) => new Date(`${date}T00:00:00Z`);

describe('v2 envelope ledger: assignment balance projection', () => {
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
    budgetId = owner.budget.id;

    await prisma.budget.update({
      where: { id: budgetId },
      data: {
        planModelVersion: 2,
        planModelActivatedOn: at('2026-09-01'),
        timezone: 'UTC',
      },
    });

    const account = await prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId,
        ownerUserId: ownerId,
        name: 'Основной счёт',
        accountType: 'BANK_ACCOUNT',
        startingBalanceMinor: 10_000_000n,
        accountingStartDate: at('2026-09-01'),
      },
    });
    accountId = account.id;
    const transferAccount = await prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId,
        ownerUserId: ownerId,
        name: 'Второй счёт',
        accountType: 'CASH',
        startingBalanceMinor: 0n,
        accountingStartDate: at('2026-09-01'),
      },
    });
    transferAccountId = transferAccount.id;

    incomeCategoryId = await createCategory('Доходы', 'INCOME');
    expenseCategoryId = await createCategory('Расходы', 'EXPENSE');

    const income = await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId,
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        accountingModelVersion: 2,
        amountMinor: 10_000_000n,
        occurredOn: at('2026-10-05'),
        confirmedAt: at('2026-10-05'),
        accountId,
        categoryId: incomeCategoryId,
        createdByUserId: ownerId,
        updatedByUserId: ownerId,
      },
    });
    incomeId = income.id;

    envelopeAId = await createEnvelope('Конверт A');
    envelopeBId = await createEnvelope('Конверт B');
    envelopeCId = await createEnvelope('Конверт C');
    envelopeDId = await createEnvelope('Конверт D');
    legacyEnvelopeId = await createEnvelope('Наследственный конверт');

    periodAId = await createPeriod(envelopeAId, '2026-10-01', '2026-10-31');
    periodA2Id = await createPeriod(envelopeAId, '2026-11-01', '2026-11-30');

    await createAssignment({
      envelopeId: envelopeAId,
      type: 'INCOME',
      amountMinor: 6_500_000n,
      effectiveOn: '2026-10-05',
      periodId: periodAId,
      sourceIncomeTransactionId: incomeId,
    });
    await createAssignment({
      envelopeId: envelopeAId,
      type: 'OPENING',
      amountMinor: 1_000_000n,
      effectiveOn: '2026-11-02',
      periodId: periodA2Id,
    });
    await createAssignment({
      envelopeId: envelopeBId,
      type: 'OPENING',
      amountMinor: 3_000_000n,
      effectiveOn: '2026-10-01',
    });
    await createAssignment({
      envelopeId: envelopeCId,
      type: 'OPENING',
      amountMinor: 2_000_000n,
      effectiveOn: '2026-10-01',
    });
    const removedAssignment = await createAssignment({
      envelopeId: envelopeAId,
      type: 'OPENING',
      amountMinor: 999_999n,
      effectiveOn: '2026-10-02',
      periodId: periodAId,
    });
    await prisma.envelopeAssignment.update({
      where: { id: removedAssignment.id, budgetId },
      data: { status: 'DELETED' },
    });

    await createMovement({
      sourceEnvelopeId: envelopeCId,
      destinationEnvelopeId: envelopeAId,
      destinationPeriodId: periodA2Id,
      amountMinor: 1_000_000n,
      effectiveOn: '2026-11-04',
    });
    const removedMovement = await createMovement({
      sourceEnvelopeId: envelopeBId,
      destinationEnvelopeId: envelopeAId,
      destinationPeriodId: periodAId,
      amountMinor: 888_000n,
      effectiveOn: '2026-10-06',
    });
    await prisma.envelopeMovement.update({
      where: { id: removedMovement.id, budgetId },
      data: { status: 'DELETED' },
    });

    await createExpense(envelopeAId, 2_000_000n, '2026-10-10', {
      status: 'CONFIRMED',
      confirmedAt: at('2026-10-10'),
    });
    await createExpense(envelopeAId, 500_000n, '2026-10-25', {
      status: 'CONFIRMED',
      confirmedAt: at('2026-10-25'),
    });
    await createExpense(envelopeAId, 400_000n, '2026-11-10', {
      status: 'CONFIRMED',
      confirmedAt: at('2026-11-10'),
    });
    await createExpense(envelopeBId, 1_000_000n, '2026-10-15', {
      status: 'CONFIRMED',
      confirmedAt: at('2026-10-15'),
    });
    await createExpense(envelopeCId, 300_000n, '2026-10-12', {
      status: 'CANCELLED',
      cancelledAt: at('2026-10-12'),
    });
    await createExpense(envelopeBId, 900_000n, '2026-10-19', { status: 'DRAFT' });
    await createExpense(envelopeAId, 600_000n, '2026-10-11', {
      status: 'CONFIRMED',
      confirmedAt: at('2026-10-11'),
      accountingModelVersion: 1,
    });
    await createExpense(envelopeAId, 700_000n, '2026-10-16', {
      status: 'DELETED',
      confirmedAt: at('2026-10-16'),
      deletedAt: at('2026-10-16'),
      preDeleteStatus: 'CONFIRMED',
    });
    await createExpense(envelopeCId, 150_000n, '2026-11-10', {
      status: 'CONFIRMED',
      confirmedAt: at('2026-11-10'),
    });

    await prisma.incomeAllocation.create({
      data: {
        id: randomUUID(),
        budgetId,
        incomeTransactionId: incomeId,
        status: 'CONFIRMED',
        amountMinor: 3_000_000n,
        occurredOn: at('2026-10-05'),
        accountId,
        envelopeId: legacyEnvelopeId,
        createdByUserId: ownerId,
        updatedByUserId: ownerId,
      },
    });
    const transfer = await prisma.transfer.create({
      data: {
        id: randomUUID(),
        budgetId,
        status: 'CONFIRMED',
        mode: 'LEGACY_PARTS',
        totalMinor: 900_000n,
        occurredOn: at('2026-10-07'),
        confirmedAt: at('2026-10-07'),
        createdByUserId: ownerId,
        updatedByUserId: ownerId,
      },
    });
    await prisma.transferPart.create({
      data: {
        id: randomUUID(),
        transferId: transfer.id,
        budgetId,
        sourceAccountId: accountId,
        destinationAccountId: transferAccountId,
        sourceEnvelopeId: envelopeAId,
        destinationEnvelopeId: legacyEnvelopeId,
        amountMinor: 900_000n,
      },
    });
  });

  afterAll(async () => {
    await cleanupUser(ownerId);
    await app.close();
    await prisma.$disconnect();
  });

  it('не включает назначение до effective_on: баланс 0', async () => {
    await expect(balance(envelopeAId, periodAId, at('2026-10-01'))).resolves.toEqual({
      funded: 0n,
      spent: 0n,
      balance: 0n,
    });
  });

  it('сводит назначение и v2-расход за период, игнорируя v1-записи, черновик, отмену и удаление', async () => {
    await expect(balance(envelopeAId, periodAId, at('2026-10-20'))).resolves.toEqual({
      funded: 6_500_000n,
      spent: 2_000_000n,
      balance: 4_500_000n,
    });
    await expect(balance(envelopeAId, periodAId, at('2026-10-25'))).resolves.toEqual({
      funded: 6_500_000n,
      spent: 2_500_000n,
      balance: 4_000_000n,
    });
  });

  it('не смешивает периоды одного конверта и считает перенос в период', async () => {
    await expect(balance(envelopeAId, periodAId, at('2026-11-10'))).resolves.toEqual({
      funded: 6_500_000n,
      spent: 2_500_000n,
      balance: 4_000_000n,
    });
    await expect(balance(envelopeAId, periodA2Id, at('2026-11-02'))).resolves.toEqual({
      funded: 1_000_000n,
      spent: 0n,
      balance: 1_000_000n,
    });
    await expect(balance(envelopeAId, periodA2Id, at('2026-11-10'))).resolves.toEqual({
      funded: 2_000_000n,
      spent: 400_000n,
      balance: 1_600_000n,
    });
  });

  it('считает непрерывные конверты без периода: переносы влияют на обе стороны', async () => {
    await expect(balance(envelopeBId, null, at('2026-10-20'))).resolves.toEqual({
      funded: 3_000_000n,
      spent: 1_000_000n,
      balance: 2_000_000n,
    });
    await expect(balance(envelopeCId, null, at('2026-11-10'))).resolves.toEqual({
      funded: 1_000_000n,
      spent: 150_000n,
      balance: 850_000n,
    });
  });

  it('allBalances отдаёт строки для активных периодов, непрерывных конвертов и пустых конвертов', async () => {
    const rows = await prisma.$transaction((tx) =>
      new AssignmentBalanceRepository().allBalances(tx, budgetId, at('2026-11-10')),
    );
    const byKey = new Map(rows.map((row) => [`${row.envelopeId}:${row.periodId ?? ''}`, row]));

    expect(byKey.get(`${envelopeAId}:${periodAId}`)).toEqual({
      envelopeId: envelopeAId,
      periodId: periodAId,
      funded: 6_500_000n,
      spent: 2_500_000n,
      balance: 4_000_000n,
    });
    expect(byKey.get(`${envelopeAId}:${periodA2Id}`)).toEqual({
      envelopeId: envelopeAId,
      periodId: periodA2Id,
      funded: 2_000_000n,
      spent: 400_000n,
      balance: 1_600_000n,
    });
    expect(byKey.get(`${envelopeBId}:`)).toEqual({
      envelopeId: envelopeBId,
      periodId: null,
      funded: 3_000_000n,
      spent: 1_000_000n,
      balance: 2_000_000n,
    });
    expect(byKey.get(`${envelopeCId}:`)).toEqual({
      envelopeId: envelopeCId,
      periodId: null,
      funded: 1_000_000n,
      spent: 150_000n,
      balance: 850_000n,
    });
    expect(rows.some((row) => row.envelopeId === envelopeAId && row.periodId === null)).toBe(false);
    expect(byKey.get(`${envelopeDId}:`)).toEqual({
      envelopeId: envelopeDId,
      periodId: null,
      funded: 0n,
      spent: 0n,
      balance: 0n,
    });
    for (const row of rows) {
      expect(typeof row.funded).toBe('bigint');
      expect(typeof row.spent).toBe('bigint');
      expect(typeof row.balance).toBe('bigint');
    }
  });

  it('назначения и переносы не создают операций и не меняют кэш-баланс счёта', async () => {
    expect(await prisma.transaction.count({ where: { budgetId } })).toBe(10);
    expect(await prisma.incomeAllocation.count({ where: { budgetId } })).toBe(1);
    expect(await prisma.transferPart.count({ where: { budgetId } })).toBe(1);

    const [cashRow] = (await prisma.$queryRaw`
      SELECT a."starting_balance_minor"
          + (SELECT COALESCE(SUM(t."amount_minor"), 0) FROM "transactions" t
             WHERE t."budget_id" = ${budgetId}::uuid
               AND t."account_id" = ${accountId}::uuid
               AND t."status" = 'CONFIRMED'
               AND t."transaction_type" = 'INCOME')
          - (SELECT COALESCE(SUM(t."amount_minor"), 0) FROM "transactions" t
             WHERE t."budget_id" = ${budgetId}::uuid
               AND t."account_id" = ${accountId}::uuid
               AND t."status" = 'CONFIRMED'
               AND t."transaction_type" = 'EXPENSE') AS cash
      FROM "accounts" a WHERE a."id" = ${accountId}::uuid
    `) as unknown as Array<{ cash: string | bigint }>;
    if (!cashRow) throw new Error('Account row not found.');
    expect(BigInt(String(cashRow.cash))).toBe(15_350_000n);
  });
});

async function balance(
  envelopeId: string,
  periodId: string | null,
  asOf: Date,
): Promise<{ funded: bigint; spent: bigint; balance: bigint }> {
  return prisma.$transaction((tx) =>
    new AssignmentBalanceRepository().balance(tx, budgetId, envelopeId, periodId, asOf),
  );
}

async function createCategory(name: string, categoryType: 'INCOME' | 'EXPENSE'): Promise<string> {
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

async function createEnvelope(name: string): Promise<string> {
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      ownerUserId: ownerId,
      name,
      envelopeType: 'CUSTOM',
      startingBalanceMinor: 0n,
      displayOrder: 950,
    },
  });
  return envelope.id;
}

async function createPeriod(envelopeId: string, startsOn: string, endsOn: string): Promise<string> {
  const period = await prisma.envelopePeriod.create({
    data: {
      id: randomUUID(),
      budgetId,
      envelopeId,
      startsOn: at(startsOn),
      endsOn: at(endsOn),
    },
  });
  return period.id;
}

async function createAssignment(input: {
  envelopeId: string;
  type: 'INCOME' | 'OPENING' | 'FREE';
  amountMinor: bigint;
  effectiveOn: string;
  periodId?: string;
  sourceIncomeTransactionId?: string;
}): Promise<{ id: string }> {
  return prisma.envelopeAssignment.create({
    data: {
      id: randomUUID(),
      budgetId,
      envelopeId: input.envelopeId,
      type: input.type,
      amountMinor: input.amountMinor,
      effectiveOn: at(input.effectiveOn),
      periodId: input.periodId ?? null,
      sourceIncomeTransactionId: input.sourceIncomeTransactionId ?? null,
      createdByUserId: ownerId,
    },
  });
}

async function createMovement(input: {
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
  destinationPeriodId?: string;
  amountMinor: bigint;
  effectiveOn: string;
}): Promise<{ id: string }> {
  return prisma.envelopeMovement.create({
    data: {
      id: randomUUID(),
      budgetId,
      sourceEnvelopeId: input.sourceEnvelopeId,
      destinationEnvelopeId: input.destinationEnvelopeId,
      destinationPeriodId: input.destinationPeriodId ?? null,
      amountMinor: input.amountMinor,
      effectiveOn: at(input.effectiveOn),
      createdByUserId: ownerId,
    },
  });
}

async function createExpense(
  envelopeId: string,
  amountMinor: bigint,
  occurredOn: string,
  extra: Record<string, unknown>,
): Promise<void> {
  await prisma.transaction.create({
    data: {
      id: randomUUID(),
      budgetId,
      transactionType: 'EXPENSE',
      accountingModelVersion: 2,
      amountMinor,
      occurredOn: at(occurredOn),
      accountId,
      categoryId: expenseCategoryId,
      envelopeId,
      createdByUserId: ownerId,
      updatedByUserId: ownerId,
      ...extra,
    },
  });
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
    await prisma.transferPart.deleteMany({
      where: { transfer: { budget: { workspaceId } } },
    });
    await prisma.transfer.deleteMany({ where: { budget: { workspaceId } } });
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
