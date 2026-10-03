import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { FinancialBalanceRepository } from '../src/common/finance/financial-balance.repository.js';
import { assertDisposableDatabase } from './helpers/disposable-db.js';

// C01 (этап 08): характеризационный тест. Он фиксирует, что реальные суммы v1-эпохи
// (income, expense, legacy-перевод с частями, legacy income_allocation) читаются v2-путями
// ровно один раз и общий cash сходится. Перед удалением любых v1-обработчиков тест обязан быть зелёным.
const databaseUrl = assertDisposableDatabase(
  process.env.DATABASE_URL ??
    'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test',
);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const START = 1_000_000n;
const OLD_INCOME = 500_000n;
const OLD_EXPENSE = 150_000n;
const OLD_ALLOCATION = 400_000n;
const LEGACY_PART = 100_000n;
const NEW_EXPENSE = 30_000n;
const DIRECT = 200_000n;
// Деньги на счетах: 1 000 000 + 500 000 - 150 000 - 30 000. Переводы cash не меняют, allocation тоже.
const EXPECTED_TOTAL_CASH = 1_320_000n;
const EXPECTED_MAIN = 1_020_000n;
const EXPECTED_SECOND = 300_000n;

type Row = Record<string, unknown>;
type Res = { statusCode: number; body: string; json<T = Record<string, unknown>>(): T };
type JournalItem = {
  id: string;
  accountingModelVersion: 1 | 2;
  transactionType: 'INCOME' | 'EXPENSE';
  status: string;
  amountMinor: string;
};
type World = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  accountId: string;
  secondAccountId: string;
  oldIncomeId: string;
  oldExpenseId: string;
  newExpenseId: string;
  allocationId: string;
  legacyTransferId: string;
  directTransferId: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
const balances = new FinancialBalanceRepository();
const createdUsers: string[] = [];

const getAs = (cookie: string, url: string) =>
  server.inject({
    method: 'GET',
    url,
    headers: { origin, cookie: `harmofin_session=${cookie}` },
  }) as unknown as Promise<Res>;
const cashOf = (w: World, accountId: string) =>
  prisma.$transaction((tx) => balances.accountBalance(tx, w.budgetId, accountId));
const totalCash = async (w: World) =>
  (await cashOf(w, w.accountId)) + (await cashOf(w, w.secondAccountId));
const occurrences = (haystack: string[], id: string) => haystack.filter((v) => v === id).length;

async function journal(w: World): Promise<JournalItem[]> {
  const res = await getAs(w.cookie, `/api/v2/budgets/${w.budgetId}/transactions?limit=100`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ items: JournalItem[] }>().items;
}
async function reportRows(w: World, key: string): Promise<Row[]> {
  const res = await getAs(w.cookie, `/api/v2/budgets/${w.budgetId}/reports/${key}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ rows: Row[] }>().rows;
}
async function csv(w: World, file: string): Promise<string[]> {
  const res = await getAs(w.cookie, `/api/v2/budgets/${w.budgetId}/exports/${file}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.body.split(/\r?\n/).filter((line) => line.length > 0);
}

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
});

afterAll(async () => {
  for (const userId of createdUsers) await cleanupUser(userId);
  await app.close();
  await prisma.$disconnect();
});

describe('v2: исторические чтения эпохи v1 (C01)', () => {
  it('v2 journal: старые income/expense и новый v2 расход, каждый ровно один раз с реальными суммами', async () => {
    const w = await world();
    const items = await journal(w);
    const ids = items.map((item) => item.id);
    for (const id of [w.oldIncomeId, w.oldExpenseId, w.newExpenseId]) {
      expect(occurrences(ids, id)).toBe(1);
    }
    expect(items).toHaveLength(3);
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(w.oldIncomeId)).toMatchObject({
      accountingModelVersion: 1,
      transactionType: 'INCOME',
      amountMinor: OLD_INCOME.toString(),
    });
    expect(byId.get(w.oldExpenseId)).toMatchObject({
      accountingModelVersion: 1,
      transactionType: 'EXPENSE',
      amountMinor: OLD_EXPENSE.toString(),
    });
    expect(byId.get(w.newExpenseId)).toMatchObject({
      accountingModelVersion: 2,
      amountMinor: NEW_EXPENSE.toString(),
    });
    const net = items.reduce(
      (sum, item) =>
        item.status === 'CONFIRMED'
          ? sum + (item.transactionType === 'INCOME' ? 1n : -1n) * BigInt(item.amountMinor)
          : sum,
      0n,
    );
    expect(net).toBe(OLD_INCOME - OLD_EXPENSE - NEW_EXPENSE);

    // Одиночное чтение старой операции через v2.
    const one = await getAs(
      w.cookie,
      `/api/v2/budgets/${w.budgetId}/transactions/${w.oldExpenseId}`,
    );
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json<JournalItem>().amountMinor).toBe(OLD_EXPENSE.toString());
  });

  it('v2 transfers GET: старый перевод с частями и прямой перевод читаются, суммы не удваиваются', async () => {
    const w = await world();
    const res = await getAs(w.cookie, `/api/v2/budgets/${w.budgetId}/transfers?limit=100`);
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json<{
      items: Array<{ id: string; mode: string; totalMinor: string; parts?: unknown[] }>;
    }>().items;
    const ids = items.map((item) => item.id);
    expect(occurrences(ids, w.legacyTransferId)).toBe(1);
    expect(occurrences(ids, w.directTransferId)).toBe(1);
    const legacy = items.find((item) => item.id === w.legacyTransferId)!;
    expect(legacy).toMatchObject({ mode: 'LEGACY_PARTS', totalMinor: LEGACY_PART.toString() });
    expect(legacy.parts).toHaveLength(1);
    const direct = items.find((item) => item.id === w.directTransferId)!;
    expect(direct).toMatchObject({ mode: 'ACCOUNT_ONLY', totalMinor: DIRECT.toString() });

    const one = await getAs(
      w.cookie,
      `/api/v2/budgets/${w.budgetId}/transfers/${w.legacyTransferId}`,
    );
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json<{ totalMinor: string }>().totalMinor).toBe(LEGACY_PART.toString());
  });

  it('v2 reports: account-balances и net-cash-flow учитывают старые суммы один раз; общий cash сходится', async () => {
    const w = await world();
    const balancesRows = await reportRows(w, 'account-balances');
    const byAccount = new Map(balancesRows.map((row) => [row.accountId as string, row]));
    expect(byAccount.get(w.accountId)?.balanceMinor).toBe(EXPECTED_MAIN.toString());
    expect(byAccount.get(w.secondAccountId)?.balanceMinor).toBe(EXPECTED_SECOND.toString());
    const reported = balancesRows.reduce(
      (sum, row) => sum + BigInt(row.balanceMinor as string),
      0n,
    );
    expect(reported).toBe(EXPECTED_TOTAL_CASH);

    const flow = await reportRows(w, 'net-cash-flow');
    expect(flow.reduce((sum, row) => sum + BigInt(row.incomeMinor as string), 0n)).toBe(OLD_INCOME);
    expect(flow.reduce((sum, row) => sum + BigInt(row.expenseMinor as string), 0n)).toBe(
      OLD_EXPENSE + NEW_EXPENSE,
    );
    const byCategory = await reportRows(w, 'expenses-by-category');
    expect(byCategory.reduce((sum, row) => sum + BigInt(row.expenseMinor as string), 0n)).toBe(
      OLD_EXPENSE + NEW_EXPENSE,
    );
  });

  it('accountBalance (legacy transfer_parts + ACCOUNT_ONLY) даёт ожидаемый cash и не меняется после чтений', async () => {
    const w = await world();
    const before = {
      main: await cashOf(w, w.accountId),
      second: await cashOf(w, w.secondAccountId),
      total: await totalCash(w),
    };
    expect(before).toEqual({
      main: EXPECTED_MAIN,
      second: EXPECTED_SECOND,
      total: EXPECTED_TOTAL_CASH,
    });
    // Все читающие v2-пути подряд.
    await journal(w);
    await reportRows(w, 'account-balances');
    await csv(w, 'transactions.csv');
    await csv(w, 'legacy-assignments.csv');
    await getAs(w.cookie, `/api/v2/budgets/${w.budgetId}/history/legacy-assignments`);
    const after = { total: await totalCash(w), main: await cashOf(w, w.accountId) };
    expect(after.total).toBe(before.total);
    expect(after.main).toBe(before.main);
    // Перевод и legacy-распределение не создают и не меняют транзакций.
    expect(await prisma.transaction.count({ where: { budgetId: w.budgetId } })).toBe(3);
  });

  it('CSV transactions: старые id присутствуют ровно один раз с моделью 1, v2 расход с моделью 2', async () => {
    const w = await world();
    const lines = await csv(w, 'transactions.csv');
    const rowOf = (id: string) => lines.filter((line) => line.startsWith(`${id};`));
    for (const id of [w.oldIncomeId, w.oldExpenseId]) {
      expect(rowOf(id)).toHaveLength(1);
      expect(rowOf(id)[0]!.split(';')[1]).toBe('1');
    }
    expect(rowOf(w.newExpenseId)).toHaveLength(1);
    expect(rowOf(w.newExpenseId)[0]!.split(';')[1]).toBe('2');
    expect(lines.filter((line) => line.includes(w.oldIncomeId))).toHaveLength(1);
    // Заголовок + 3 транзакции; переводы здесь не выгружаются.
    expect(lines).toHaveLength(4);
    expect(rowOf(w.oldIncomeId)[0]!.split(';')[5]).toBe(OLD_INCOME.toString());
    expect(rowOf(w.oldExpenseId)[0]!.split(';')[5]).toBe(OLD_EXPENSE.toString());
  });

  it('CSV legacy-assignments и v2 history: старое распределение доходов читается один раз и не входит в cash', async () => {
    const w = await world();
    const lines = await csv(w, 'legacy-assignments.csv');
    expect(lines.filter((line) => line.startsWith(`${w.allocationId};`))).toHaveLength(1);
    const res = await getAs(w.cookie, `/api/v2/budgets/${w.budgetId}/history/legacy-assignments`);
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json<{
      items: Array<{ id: string; sourceKind: string; amountMinor: string }>;
    }>().items;
    const allocation = items.filter((item) => item.id === w.allocationId);
    expect(allocation).toHaveLength(1);
    expect(allocation[0]).toMatchObject({
      sourceKind: 'LEGACY_ALLOCATION',
      amountMinor: OLD_ALLOCATION.toString(),
    });
    expect(await totalCash(w)).toBe(EXPECTED_TOTAL_CASH);
  });

  it('audit: история старой операции читается (живой потребитель v1-маршрута /api/v1/.../audit)', async () => {
    const w = await world();
    const res = await getAs(
      w.cookie,
      `/api/v1/budgets/${w.budgetId}/transactions/${w.oldExpenseId}/audit`,
    );
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json<{ items: Array<{ action: string; entityId: string }> }>().items;
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.action)).toEqual(['transaction.create', 'transaction.confirm']);
    for (const item of items) expect(item.entityId).toBe(w.oldExpenseId);
    // Чужая транзакция из другого бюджета не читается.
    const other = await world();
    const foreign = await getAs(
      w.cookie,
      `/api/v1/budgets/${w.budgetId}/transactions/${other.oldExpenseId}/audit`,
    );
    expect(foreign.statusCode).toBe(404);
  });

  it('audit v1: EDITOR получает 403, посторонний не участник получает 404', async () => {
    const w = await world();
    const outsider = await world();
    const url = `/api/v1/budgets/${w.budgetId}/transactions/${w.oldExpenseId}/audit`;
    await prisma.workspaceMembership.updateMany({
      where: { userId: w.userId, workspaceId: w.workspaceId },
      data: { role: 'EDITOR' },
    });
    try {
      const editor = await getAs(w.cookie, url);
      expect(editor.statusCode, editor.body).toBe(403);
      expect(editor.json()).toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await prisma.workspaceMembership.updateMany({
        where: { userId: w.userId, workspaceId: w.workspaceId },
        data: { role: 'OWNER' },
      });
    }
    const foreign = await getAs(outsider.cookie, url);
    expect(foreign.statusCode, foreign.body).toBe(404);
  });
});

async function world(): Promise<World> {
  const email = `v2-hist-${randomUUID()}@harmofin.test`;
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
  }>();
  createdUsers.push(body.user.id);
  const raw = response.headers['set-cookie'];
  const setCookie = Array.isArray(raw) ? raw.join('; ') : (raw ?? '');
  const match = /harmofin_session=([^;]+)/.exec(setCookie);
  expect(match).not.toBeNull();
  const userId = body.user.id;
  const budgetId = body.budget.id;
  await prisma.budget.update({
    where: { id: budgetId },
    data: {
      planModelVersion: 2,
      planModelActivatedOn: day('2026-03-01'),
      timezone: 'UTC',
      cycleStartDay: 1,
      periodBoundaryOffset: 14,
    },
  });
  const account = (name: string, startingBalanceMinor: bigint) =>
    prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId,
        name,
        accountType: 'BANK_ACCOUNT',
        startingBalanceMinor,
        accountingStartDate: day('2026-01-01'),
      },
    });
  const category = (name: string, categoryType: 'EXPENSE' | 'INCOME', order: number) =>
    prisma.category.create({
      data: { id: randomUUID(), budgetId, name, categoryType, displayOrder: order },
    });
  const main = await account('Основной счёт', START);
  const second = await account('Накопительный счёт', 0n);
  const food = await category('Еда', 'EXPENSE', 900);
  const salary = await category('Зарплата', 'INCOME', 901);
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: 'Текущий',
      envelopeType: 'CURRENT_EXPENSES',
      startingBalanceMinor: 0n,
      displayOrder: 950,
      periodSlot: 'FIRST',
    },
  });
  const tx = (
    transactionType: 'INCOME' | 'EXPENSE',
    amountMinor: bigint,
    occurredOn: string,
    accountingModelVersion: 1 | 2,
  ) =>
    prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId,
        transactionType,
        status: 'CONFIRMED',
        accountingModelVersion,
        amountMinor,
        occurredOn: day(occurredOn),
        confirmedAt: new Date(),
        categoryId: transactionType === 'INCOME' ? salary.id : food.id,
        accountId: main.id,
        envelopeId: transactionType === 'EXPENSE' ? envelope.id : null,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });
  // Эпоха v1: строки создаются напрямую с accountingModelVersion=1.
  const oldIncome = await tx('INCOME', OLD_INCOME, '2026-02-02', 1);
  const oldExpense = await tx('EXPENSE', OLD_EXPENSE, '2026-02-10', 1);
  const allocation = await prisma.incomeAllocation.create({
    data: {
      id: randomUUID(),
      budgetId,
      incomeTransactionId: oldIncome.id,
      status: 'CONFIRMED',
      amountMinor: OLD_ALLOCATION,
      occurredOn: day('2026-02-02'),
      accountId: main.id,
      envelopeId: envelope.id,
      createdByUserId: userId,
      updatedByUserId: userId,
    },
  });
  const legacyTransferId = randomUUID();
  await prisma.transfer.create({
    data: {
      id: legacyTransferId,
      budgetId,
      status: 'CONFIRMED',
      mode: 'LEGACY_PARTS',
      totalMinor: LEGACY_PART,
      occurredOn: day('2026-02-15'),
      confirmedAt: new Date(),
      createdByUserId: userId,
      updatedByUserId: userId,
    },
  });
  await prisma.transferPart.create({
    data: {
      id: randomUUID(),
      transferId: legacyTransferId,
      budgetId,
      sourceAccountId: main.id,
      destinationAccountId: second.id,
      sourceEnvelopeId: envelope.id,
      destinationEnvelopeId: envelope.id,
      amountMinor: LEGACY_PART,
    },
  });
  for (const [action, offset] of [
    ['transaction.create', 0],
    ['transaction.confirm', 1],
  ] as const) {
    await prisma.auditEvent.create({
      data: {
        id: randomUUID(),
        actorUserId: userId,
        workspaceId: body.workspace.id,
        budgetId,
        entityType: 'transaction',
        entityId: oldExpense.id,
        action,
        source: 'api',
        createdAt: new Date(Date.UTC(2026, 1, 10, 10, offset)),
      },
    });
  }
  // Эпоха v2.
  const newExpense = await tx('EXPENSE', NEW_EXPENSE, '2026-03-05', 2);
  const directTransferId = randomUUID();
  await prisma.transfer.create({
    data: {
      id: directTransferId,
      budgetId,
      status: 'CONFIRMED',
      mode: 'ACCOUNT_ONLY',
      totalMinor: DIRECT,
      occurredOn: day('2026-03-06'),
      confirmedAt: new Date(),
      sourceAccountId: main.id,
      destinationAccountId: second.id,
      createdByUserId: userId,
      updatedByUserId: userId,
    },
  });
  return {
    userId,
    workspaceId: body.workspace.id,
    budgetId,
    cookie: decodeURIComponent(match![1]!),
    accountId: main.id,
    secondAccountId: second.id,
    oldIncomeId: oldIncome.id,
    oldExpenseId: oldExpense.id,
    newExpenseId: newExpense.id,
    allocationId: allocation.id,
    legacyTransferId,
    directTransferId,
  };
}

async function cleanupUser(userId: string): Promise<void> {
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    select: { workspaceId: true },
  });
  await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.recoveryToken.deleteMany({ where: { userId } });
  for (const { workspaceId } of memberships) {
    const where = { budget: { workspaceId } };
    await prisma.auditEvent.deleteMany({ where: { workspaceId } });
    await prisma.idempotencyRecord.deleteMany({ where });
    await prisma.incomeAllocation.deleteMany({ where });
    await prisma.envelopeReallocation.deleteMany({ where });
    await prisma.envelopeMovement.deleteMany({ where });
    await prisma.envelopeAssignment.deleteMany({ where });
    await prisma.planPayment.deleteMany({ where });
    await prisma.planOccurrence.deleteMany({ where });
    await prisma.regularPlan.deleteMany({ where });
    await prisma.envelopePeriod.deleteMany({ where });
    await prisma.envelopeFundingRule.deleteMany({ where });
    await prisma.budgetCycleRevision.deleteMany({ where });
    const budgets = await prisma.budget.findMany({ where: { workspaceId }, select: { id: true } });
    await prisma.transferPart.deleteMany({
      where: { budgetId: { in: budgets.map((budget) => budget.id) } },
    });
    await prisma.transfer.deleteMany({ where });
    await prisma.transaction.deleteMany({ where });
    await prisma.account.deleteMany({ where });
    await prisma.category.deleteMany({ where });
    await prisma.envelope.deleteMany({ where });
  }
  await prisma.workspaceMembership.deleteMany({ where: { userId } });
  for (const { workspaceId } of memberships) {
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId } });
    await prisma.budget.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}
