import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

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
let smallerExpenseId: string;
let largerExpenseId: string;
let deletedExpenseId: string;

describe('operations journal API', () => {
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
    owner = await register(`journal-owner-${randomUUID()}@harmofin.test`);
    foreign = await register(`journal-foreign-${randomUUID()}@harmofin.test`);
    references = await createReferences();
    await seedJournal();
  });

  afterAll(async () => {
    await cleanup(owner);
    await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it('combines search, date, references, type, status and stable amount pagination', async () => {
    const first = await listJournal({
      search: 'market',
      from: '2026-08-25',
      to: '2026-09-01',
      cycleStart: '2026-08-10',
      periodStart: '2026-08-25',
      accountId: references.accountId,
      categoryId: references.expenseCategoryId,
      envelopeId: references.envelopeId,
      type: 'EXPENSE',
      status: 'CONFIRMED',
      sortBy: 'amount',
      sortDirection: 'asc',
      limit: '1',
    });
    const firstBody = first.json<{ items: Array<{ id: string }>; nextCursor: string | null }>();
    const second = await listJournal({
      search: 'market',
      from: '2026-08-25',
      to: '2026-09-01',
      cycleStart: '2026-08-10',
      periodStart: '2026-08-25',
      accountId: references.accountId,
      categoryId: references.expenseCategoryId,
      envelopeId: references.envelopeId,
      type: 'EXPENSE',
      status: 'CONFIRMED',
      sortBy: 'amount',
      sortDirection: 'asc',
      limit: '1',
      cursor: firstBody.nextCursor ?? '',
    });

    expect(first.statusCode).toBe(200);
    expect(firstBody.items.map((item) => item.id)).toEqual([smallerExpenseId]);
    expect(firstBody.nextCursor).toEqual(expect.any(String));
    expect(second.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id)).toEqual([
      largerExpenseId,
    ]);
  });

  it('returns validation error for malformed cursor and unknown filter ID', async () => {
    const malformed = await listJournal({ cursor: 'invalid', sortBy: 'amount' });
    const unknownReference = await listJournal({ accountId: randomUUID() });

    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(unknownReference.statusCode).toBe(404);
    expect(unknownReference.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('excludes deleted by default and exposes deleted history only to owner', async () => {
    const defaultList = await listJournal({ limit: '100' });
    const deleted = await listJournal({ status: 'DELETED' });
    await setRole('EDITOR');
    const editorAll = await listJournal({ status: 'all' });
    await setRole('OWNER');

    expect(
      defaultList.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id),
    ).not.toContain(deletedExpenseId);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id)).toContain(
      deletedExpenseId,
    );
    expect(editorAll.statusCode).toBe(403);
  });

  it('returns allowlisted transaction audit only to owner', async () => {
    const ownerAudit = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/transactions/${smallerExpenseId}/audit`,
      cookies: { harmofin_session: owner.cookie },
    });
    await setRole('EDITOR');
    const editorAudit = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/transactions/${smallerExpenseId}/audit`,
      cookies: { harmofin_session: owner.cookie },
    });
    await setRole('OWNER');

    expect(ownerAudit.statusCode).toBe(200);
    const body = ownerAudit.json<{ items: Array<{ newValues: unknown }> }>();
    expect(body.items).not.toHaveLength(0);
    expect(JSON.stringify(body.items)).not.toContain('Тайный комментарий');
    expect(JSON.stringify(body.items)).not.toContain('Малый Market');
    expect(editorAudit.statusCode).toBe(403);
  });

  async function seedJournal() {
    const smaller = await createExpense('10.00', '2026-08-25', 'Малый Market', 'journal-small');
    const larger = await createExpense('20.00', '2026-08-25', 'Большой Market', 'journal-large');
    await createIncome('30.00', '2026-09-01', 'Salary', 'journal-income');
    const deleted = await createExpense(
      '5.00',
      '2026-09-02',
      'Удалённый Market',
      'journal-deleted',
    );

    smallerExpenseId = smaller.json<{ id: string }>().id;
    largerExpenseId = larger.json<{ id: string }>().id;
    deletedExpenseId = deleted.json<{ id: string }>().id;
    await server.inject({
      method: 'DELETE',
      url: `/api/v1/budgets/${owner.budgetId}/transactions/${deletedExpenseId}`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': 'journal-delete' },
      cookies: { harmofin_session: owner.cookie },
    });
  }

  async function createReferences(): Promise<References> {
    const account = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/accounts`,
      headers: { origin, 'x-csrf-token': owner.csrfToken },
      cookies: { harmofin_session: owner.cookie },
      payload: {
        name: 'Счёт journal',
        accountType: 'CASH',
        currency: 'RUB',
        startingBalance: '1000.00',
        accountingStartDate: '2026-08-01',
      },
    });
    const envelope = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/envelopes`,
      headers: { origin, 'x-csrf-token': owner.csrfToken },
      cookies: { harmofin_session: owner.cookie },
      payload: {
        name: 'Конверт journal',
        envelopeType: 'CUSTOM',
        currency: 'RUB',
        startingBalance: '1000.00',
        displayOrder: 0,
      },
    });
    const incomeCategory = await createCategory('Доход journal', 'INCOME', 0);
    const expenseCategory = await createCategory('Расход journal', 'EXPENSE', 1);

    return {
      accountId: account.json<{ id: string }>().id,
      envelopeId: envelope.json<{ id: string }>().id,
      incomeCategoryId: incomeCategory.json<{ id: string }>().id,
      expenseCategoryId: expenseCategory.json<{ id: string }>().id,
    };
  }

  function createCategory(name: string, categoryType: 'INCOME' | 'EXPENSE', displayOrder: number) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/categories`,
      headers: { origin, 'x-csrf-token': owner.csrfToken },
      cookies: { harmofin_session: owner.cookie },
      payload: { name, categoryType, displayOrder },
    });
  }

  function createExpense(amount: string, occurredOn: string, merchantName: string, key: string) {
    return createTransaction(
      {
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        amount,
        occurredOn,
        accountId: references.accountId,
        categoryId: references.expenseCategoryId,
        envelopeId: references.envelopeId,
        merchantName,
        comment: 'Тайный комментарий',
      },
      key,
    );
  }

  function createIncome(
    amount: string,
    occurredOn: string,
    sourceDescription: string,
    key: string,
  ) {
    return createTransaction(
      {
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        amount,
        occurredOn,
        accountId: references.accountId,
        categoryId: references.incomeCategoryId,
        sourceDescription,
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

  function listJournal(query: Record<string, string>) {
    return server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/transactions?${new URLSearchParams(query)}`,
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
