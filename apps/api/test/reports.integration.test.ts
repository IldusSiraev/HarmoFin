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
};

let app: NestFastifyApplication;
let server: FastifyInstance;
let owner: Session;
let foreign: Session;
let accountId: string;
let categoryId: string;
let envelopeId: string;

describe('reports API', () => {
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
    owner = await register(`reports-owner-${randomUUID()}@harmofin.test`);
    foreign = await register(`reports-foreign-${randomUUID()}@harmofin.test`);
    await seedReportData();
  });

  afterAll(async () => {
    if (owner) await cleanup(owner);
    if (foreign) await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it.each([
    'expenses-by-category',
    'expenses-by-period',
    'expenses-by-cycle',
    'incomes-by-cycle',
    'savings-reallocation-by-cycle',
    'net-cash-flow',
    'account-balances',
    'envelope-balances',
    'savings-goals',
  ])('returns confirmed data for %s', async (key) => {
    const response = await getReport(key, { from: '2026-08-10', to: '2026-09-09' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ key, rows: expect.any(Array) });
  });

  it('keeps transfers out of net cash flow and supplies journal filters', async () => {
    const response = await getReport('net-cash-flow', {
      from: '2026-08-10',
      to: '2026-09-09',
      accountId,
      categoryId,
      envelopeId,
    });
    const body = response.json<{
      rows: Array<{
        incomeMinor: string;
        expenseMinor: string;
        netCashFlowMinor: string;
        journalFilters: unknown;
      }>;
    }>();

    expect(body.rows).toEqual([
      expect.objectContaining({
        incomeMinor: '0',
        expenseMinor: '2500',
        netCashFlowMinor: '-2500',
        journalFilters: { from: '2026-08-10', to: '2026-09-09' },
      }),
    ]);
  });

  it('rejects oversized ranges, foreign filter IDs and foreign budgets', async () => {
    const oversized = await getReport('net-cash-flow', { from: '2020-01-01', to: '2026-01-01' });
    const foreignFilter = await getReport('net-cash-flow', { accountId: randomUUID() });
    const foreignBudget = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/reports/net-cash-flow`,
      cookies: { harmofin_session: foreign.cookie },
    });

    expect(oversized.statusCode).toBe(400);
    expect(foreignFilter.statusCode).toBe(404);
    expect(foreignBudget.statusCode).toBe(404);
  });

  async function seedReportData() {
    accountId = randomUUID();
    const destinationAccountId = randomUUID();
    const incomeCategoryId = randomUUID();
    categoryId = randomUUID();
    envelopeId = randomUUID();
    const goalEnvelopeId = randomUUID();
    const incomeId = randomUUID();
    const occurredOn = new Date('2026-08-10T00:00:00.000Z');

    await prisma.account.createMany({
      data: [
        {
          id: accountId,
          budgetId: owner.budgetId,
          name: 'Основной отчёт',
          accountType: 'CASH',
          startingBalanceMinor: 20_000n,
          accountingStartDate: occurredOn,
        },
        {
          id: destinationAccountId,
          budgetId: owner.budgetId,
          name: 'Накопительный отчёт',
          accountType: 'BANK_ACCOUNT',
          startingBalanceMinor: 0n,
          accountingStartDate: occurredOn,
        },
      ],
    });
    await prisma.category.createMany({
      data: [
        {
          id: incomeCategoryId,
          budgetId: owner.budgetId,
          name: 'Зарплата отчёт',
          categoryType: 'INCOME',
          displayOrder: 0,
        },
        {
          id: categoryId,
          budgetId: owner.budgetId,
          name: 'Продукты отчёт',
          categoryType: 'EXPENSE',
          displayOrder: 1,
        },
      ],
    });
    await prisma.envelope.createMany({
      data: [
        {
          id: envelopeId,
          budgetId: owner.budgetId,
          name: 'Текущий отчёт',
          envelopeType: 'CURRENT_EXPENSES',
          periodSlot: 'FIRST',
          startingBalanceMinor: 5_000n,
          displayOrder: 0,
        },
        {
          id: goalEnvelopeId,
          budgetId: owner.budgetId,
          name: 'Ремонт отчёт',
          envelopeType: 'SAVINGS_GOAL',
          startingBalanceMinor: 0n,
          targetAmountMinor: 50_000n,
          targetDate: new Date('2027-01-01T00:00:00.000Z'),
          displayOrder: 1,
        },
      ],
    });
    await prisma.transaction.createMany({
      data: [
        {
          id: incomeId,
          budgetId: owner.budgetId,
          transactionType: 'INCOME',
          status: 'CONFIRMED',
          amountMinor: 10_000n,
          occurredOn,
          accountId,
          categoryId: incomeCategoryId,
          confirmedAt: new Date(),
          createdByUserId: owner.userId,
          updatedByUserId: owner.userId,
        },
        {
          id: randomUUID(),
          budgetId: owner.budgetId,
          transactionType: 'EXPENSE',
          status: 'CONFIRMED',
          amountMinor: 2_500n,
          occurredOn,
          accountId,
          categoryId,
          envelopeId,
          confirmedAt: new Date(),
          createdByUserId: owner.userId,
          updatedByUserId: owner.userId,
        },
        {
          id: randomUUID(),
          budgetId: owner.budgetId,
          transactionType: 'EXPENSE',
          status: 'DRAFT',
          amountMinor: 99_999n,
          occurredOn,
          accountId,
          categoryId,
          envelopeId,
          createdByUserId: owner.userId,
          updatedByUserId: owner.userId,
        },
      ],
    });
    await prisma.incomeAllocation.create({
      data: {
        id: randomUUID(),
        budgetId: owner.budgetId,
        incomeTransactionId: incomeId,
        amountMinor: 1_000n,
        occurredOn,
        accountId,
        envelopeId,
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    const transferId = randomUUID();
    await prisma.transfer.create({
      data: {
        id: transferId,
        budgetId: owner.budgetId,
        status: 'CONFIRMED',
        totalMinor: 500n,
        occurredOn,
        confirmedAt: new Date(),
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    await prisma.transferPart.create({
      data: {
        id: randomUUID(),
        transferId,
        budgetId: owner.budgetId,
        sourceAccountId: accountId,
        destinationAccountId,
        sourceEnvelopeId: envelopeId,
        destinationEnvelopeId: goalEnvelopeId,
        amountMinor: 500n,
      },
    });
  }

  function getReport(key: string, query: Record<string, string>) {
    return server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/reports/${key}?${new URLSearchParams(query)}`,
      cookies: { harmofin_session: owner.cookie },
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
    }>();
    const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
    if (!cookie) throw new Error('Missing session cookie');
    return {
      userId: body.user.id,
      workspaceId: body.workspace.id,
      budgetId: body.budget.id,
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
