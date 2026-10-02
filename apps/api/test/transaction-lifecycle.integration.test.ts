import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { forceBudgetV1 } from './helpers/plan-model.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';

type Session = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
};

type References = {
  accountId: string;
  expenseCategoryId: string;
  incomeCategoryId: string;
  envelopeId: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
let owner: Session;
let foreign: Session;
let references: References;

describe('transaction lifecycle API', () => {
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
    owner = await register(`lifecycle-owner-${randomUUID()}@harmofin.test`);
    foreign = await register(`lifecycle-foreign-${randomUUID()}@harmofin.test`);
    references = await createReferences();
  });

  afterAll(async () => {
    await cleanup(owner);
    await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it('documents restore and income-resolution routes with idempotency headers', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<
        string,
        Record<string, { parameters?: Array<{ name: string; required?: boolean }> }>
      >;
    }>();
    const transaction = '/api/v1/budgets/{budgetId}/transactions/{transactionId}';
    const allocation = '/api/v1/budgets/{budgetId}/allocations/{allocationId}';

    for (const [path, method] of [
      [`${transaction}/restore`, 'post'],
      [`${transaction}/delete-with-allocations`, 'post'],
      [`${allocation}/restore`, 'post'],
    ] as const) {
      expect(document.paths[path]?.[method]?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Idempotency-Key', required: true }),
        ]),
      );
    }
  });

  it('restores deleted confirmed expense and reactivates server balance projection', async () => {
    const created = await createExpense('100.00', 'restore-expense-create');
    const id = created.json<{ id: string }>().id;
    const deleted = await deleteTransaction(id, 'restore-expense-delete');
    const beforeRestore = await getAccount();
    const restored = await restoreTransaction(id, 'restore-expense-restore');
    const replay = await restoreTransaction(id, 'restore-expense-restore');
    const afterRestore = await getAccount();

    expect(created.statusCode).toBe(201);
    expect(deleted.statusCode).toBe(200);
    expect(beforeRestore.json<{ currentBalanceMinor: string }>().currentBalanceMinor).toBe(
      '100000',
    );
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ status: 'CONFIRMED', deletedAt: null });
    expect(replay.json()).toEqual(restored.json());
    expect(afterRestore.json<{ currentBalanceMinor: string }>().currentBalanceMinor).toBe('90000');
    await expect(
      prisma.auditEvent.count({
        where: {
          budgetId: owner.budgetId,
          entityType: 'transaction',
          entityId: id,
          action: 'RESTORED',
        },
      }),
    ).resolves.toBe(1);
  });

  it('rejects deletion of confirmed income with confirmed allocation until resolution', async () => {
    const income = await createIncome('200.00', 'income-conflict-create');
    const incomeId = income.json<{ id: string }>().id;
    const allocation = await createAllocation(incomeId, '100.00', 'income-conflict-allocation');
    const rejected = await deleteTransaction(incomeId, 'income-conflict-delete');
    const resolved = await resolveIncomeDeletion(incomeId, 'DELETE', 'income-conflict-resolution');

    expect(income.statusCode).toBe(201);
    expect(allocation.statusCode).toBe(201);
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toMatchObject({
      code: 'INCOME_HAS_CONFIRMED_ALLOCATIONS',
      allocationIds: [allocation.json<{ id: string }>().id],
      allocationCount: 1,
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({ status: 'DELETED' });
    await expect(
      prisma.incomeAllocation.findUniqueOrThrow({
        where: { id: allocation.json<{ id: string }>().id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'DELETED' });
  });

  it('restores allocation only while its source income is confirmed', async () => {
    const income = await createIncome('200.00', 'allocation-restore-income');
    const incomeId = income.json<{ id: string }>().id;
    const allocation = await createAllocation(incomeId, '100.00', 'allocation-restore-create');
    const allocationId = allocation.json<{ id: string }>().id;
    const deleted = await deleteAllocation(allocationId, 'allocation-restore-delete');
    const restored = await restoreAllocation(allocationId, 'allocation-restore-restore');

    expect(deleted.statusCode).toBe(200);
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ status: 'CONFIRMED', deletedAt: null });

    const deletedAgain = await deleteAllocation(allocationId, 'allocation-restore-delete-again');
    const deletedIncome = await deleteTransaction(incomeId, 'allocation-restore-income-delete');
    const rejected = await restoreAllocation(
      allocationId,
      'allocation-restore-after-income-delete',
    );

    expect(deletedAgain.statusCode).toBe(200);
    expect(deletedIncome.statusCode).toBe(200);
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ code: 'REFERENCE_INVALID' });
  });

  it('limits restore to owner and hides foreign resources', async () => {
    const created = await createExpense('1.00', 'role-restore-create');
    const id = created.json<{ id: string }>().id;
    await deleteTransaction(id, 'role-restore-delete');
    await setRole('EDITOR');
    const editor = await restoreTransaction(id, 'role-restore-editor');
    await setRole('OWNER');
    const foreignResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/transactions/${id}/restore`,
      headers: { origin, 'x-csrf-token': foreign.csrfToken, 'idempotency-key': 'foreign-restore' },
      cookies: { harmofin_session: foreign.cookie },
    });

    expect(editor.statusCode).toBe(403);
    expect(foreignResponse.statusCode).toBe(404);
  });

  async function createReferences(): Promise<References> {
    const account = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/accounts`,
      headers: { origin, 'x-csrf-token': owner.csrfToken },
      cookies: { harmofin_session: owner.cookie },
      payload: {
        name: 'Счёт lifecycle',
        accountType: 'CASH',
        currency: 'RUB',
        startingBalance: '1000.00',
        accountingStartDate: '2026-09-01',
      },
    });
    const envelope = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/envelopes`,
      headers: { origin, 'x-csrf-token': owner.csrfToken },
      cookies: { harmofin_session: owner.cookie },
      payload: {
        name: 'Конверт lifecycle',
        envelopeType: 'CUSTOM',
        currency: 'RUB',
        startingBalance: '1000.00',
        displayOrder: 0,
      },
    });
    const incomeCategory = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/categories`,
      headers: { origin, 'x-csrf-token': owner.csrfToken },
      cookies: { harmofin_session: owner.cookie },
      payload: { name: 'Доход lifecycle', categoryType: 'INCOME', displayOrder: 0 },
    });
    const expenseCategory = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/categories`,
      headers: { origin, 'x-csrf-token': owner.csrfToken },
      cookies: { harmofin_session: owner.cookie },
      payload: { name: 'Расход lifecycle', categoryType: 'EXPENSE', displayOrder: 1 },
    });

    return {
      accountId: account.json<{ id: string }>().id,
      envelopeId: envelope.json<{ id: string }>().id,
      incomeCategoryId: incomeCategory.json<{ id: string }>().id,
      expenseCategoryId: expenseCategory.json<{ id: string }>().id,
    };
  }

  function createExpense(amount: string, key: string) {
    return createTransaction(
      {
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        amount,
        occurredOn: '2026-09-05',
        accountId: references.accountId,
        categoryId: references.expenseCategoryId,
        envelopeId: references.envelopeId,
        merchantName: 'Магазин',
      },
      key,
    );
  }

  function createIncome(amount: string, key: string) {
    return createTransaction(
      {
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        amount,
        occurredOn: '2026-09-05',
        accountId: references.accountId,
        categoryId: references.incomeCategoryId,
        sourceDescription: 'Источник',
      },
      key,
    );
  }

  function createTransaction(payload: Record<string, unknown>, key: string) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/transactions`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
      payload,
    });
  }

  function deleteTransaction(transactionId: string, key: string) {
    return server.inject({
      method: 'DELETE',
      url: `/api/v1/budgets/${owner.budgetId}/transactions/${transactionId}`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
    });
  }

  function restoreTransaction(transactionId: string, key: string) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/transactions/${transactionId}/restore`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
    });
  }

  function resolveIncomeDeletion(
    transactionId: string,
    allocationResolution: 'CANCEL' | 'DELETE',
    key: string,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/transactions/${transactionId}/delete-with-allocations`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
      payload: { allocationResolution },
    });
  }

  function createAllocation(transactionId: string, amount: string, key: string) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/transactions/${transactionId}/allocations`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
      payload: {
        amount,
        occurredOn: '2026-09-05',
        accountId: references.accountId,
        envelopeId: references.envelopeId,
      },
    });
  }

  function deleteAllocation(allocationId: string, key: string) {
    return server.inject({
      method: 'DELETE',
      url: `/api/v1/budgets/${owner.budgetId}/allocations/${allocationId}`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
    });
  }

  function restoreAllocation(allocationId: string, key: string) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/allocations/${allocationId}/restore`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
    });
  }

  function getAccount() {
    return server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/accounts/${references.accountId}`,
      cookies: { harmofin_session: owner.cookie },
    });
  }

  async function setRole(role: 'OWNER' | 'EDITOR') {
    await prisma.workspaceMembership.updateMany({
      where: { workspaceId: owner.workspaceId, userId: owner.userId },
      data: { role },
    });
  }

  async function register(email: string): Promise<Session> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email, password },
    });
    const body = response.json<{
      user: { id: string };
      workspace: { id: string };
      budget: { id: string };
      csrfToken: string;
    }>();
    const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
    if (!cookie) throw new Error('Missing session cookie');
    await forceBudgetV1(prisma, body.budget.id);
    return {
      userId: body.user.id,
      workspaceId: body.workspace.id,
      budgetId: body.budget.id,
      csrfToken: body.csrfToken,
      cookie,
    };
  }

  async function cleanup(session: Session) {
    const budgetIds = (
      await prisma.budget.findMany({
        where: { workspaceId: session.workspaceId },
        select: { id: true },
      })
    ).map((budget) => budget.id);
    await prisma.auditEvent.deleteMany({ where: { workspaceId: session.workspaceId } });
    await prisma.notification.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.planOccurrence.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.regularPlan.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transferPart.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transfer.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.incomeAllocation.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transaction.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.account.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.category.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.envelope.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: session.workspaceId } });
    await prisma.budget.deleteMany({ where: { id: { in: budgetIds } } });
    await prisma.workspace.deleteMany({ where: { id: session.workspaceId } });
    await prisma.session.deleteMany({ where: { userId: session.userId } });
    await prisma.user.deleteMany({ where: { id: session.userId } });
  }
});
