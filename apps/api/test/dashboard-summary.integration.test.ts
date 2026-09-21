import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { cycleAndPeriodFor, todayInTimezone } from '../src/cycles/cycle-period.domain.js';

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

describe('dashboard summary API', () => {
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
    owner = await register(`summary-owner-${randomUUID()}@harmofin.test`);
    foreign = await register(`summary-foreign-${randomUUID()}@harmofin.test`);
    await seedSummaryData();
  });

  afterAll(async () => {
    if (owner) await cleanup(owner);
    if (foreign) await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it('returns only confirmed server projections and period limit', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/summary`,
      cookies: { harmofin_session: owner.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      totalAccountMoneyMinor: '14500',
      unallocatedIncomeMinor: '3000',
      unassignedStartingBalanceMinor: '9000',
      periodLimit: {
        state: 'available',
        limitMinor: '3000',
        spentMinor: '500',
        remainingMinor: '2500',
      },
      upcomingObligations: [
        expect.objectContaining({
          planName: 'Платёж summary',
          amountMinor: '3600000',
          status: 'PENDING',
          actionPath: expect.stringContaining('/app/plans?occurrence='),
        }),
      ],
    });
  });

  it('reports onboarding progress from real budget data', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/summary`,
      cookies: { harmofin_session: owner.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      onboarding: {
        categoriesSeeded: true,
        cycleConfigured: false,
        hasAccounts: true,
        hasEnvelopeStartingBalances: true,
        hasAllocatedIncome: true,
      },
    });
  });

  it('reports every onboarding step as not started for a fresh budget', async () => {
    const fresh = await register(`summary-fresh-${randomUUID()}@harmofin.test`);
    try {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/budgets/${fresh.budgetId}/summary`,
        cookies: { harmofin_session: fresh.cookie },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        onboarding: {
          categoriesSeeded: false,
          cycleConfigured: false,
          hasAccounts: false,
          hasEnvelopeStartingBalances: false,
          hasAllocatedIncome: false,
        },
      });
    } finally {
      await cleanup(fresh);
    }
  });

  it('hides foreign budget summary', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/summary`,
      cookies: { harmofin_session: foreign.cookie },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  async function seedSummaryData() {
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: owner.budgetId } });
    const today = todayInTimezone(new Date(), budget.timezone);
    const period = cycleAndPeriodFor(budget, today).period;
    const accountId = randomUUID();
    const incomeCategoryId = randomUUID();
    const expenseCategoryId = randomUUID();
    const envelopeId = randomUUID();
    const incomeId = randomUUID();

    await prisma.account.create({
      data: {
        id: accountId,
        budgetId: owner.budgetId,
        name: 'Счёт summary',
        accountType: 'CASH',
        startingBalanceMinor: 10_000n,
        accountingStartDate: new Date(`${today}T00:00:00.000Z`),
      },
    });
    await prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId: owner.budgetId,
        name: 'Архивный счёт summary',
        accountType: 'CASH',
        startingBalanceMinor: 500n,
        accountingStartDate: new Date(`${today}T00:00:00.000Z`),
        archivedAt: new Date(),
      },
    });
    await prisma.category.createMany({
      data: [
        {
          id: incomeCategoryId,
          budgetId: owner.budgetId,
          name: 'Доход summary',
          categoryType: 'INCOME',
          displayOrder: 0,
        },
        {
          id: expenseCategoryId,
          budgetId: owner.budgetId,
          name: 'Расход summary',
          categoryType: 'EXPENSE',
          displayOrder: 1,
        },
      ],
    });
    await prisma.envelope.create({
      data: {
        id: envelopeId,
        budgetId: owner.budgetId,
        name: 'Текущий summary',
        envelopeType: 'CURRENT_EXPENSES',
        periodSlot: period.id,
        startingBalanceMinor: 1_000n,
        displayOrder: 0,
      },
    });
    await prisma.envelope.create({
      data: {
        id: randomUUID(),
        budgetId: owner.budgetId,
        name: 'Архивный конверт summary',
        envelopeType: 'CURRENT_EXPENSES',
        startingBalanceMinor: 200n,
        displayOrder: 1,
        archivedAt: new Date(),
      },
    });
    await prisma.transaction.create({
      data: {
        id: incomeId,
        budgetId: owner.budgetId,
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        amountMinor: 5_000n,
        occurredOn: new Date(`${today}T00:00:00.000Z`),
        accountId,
        categoryId: incomeCategoryId,
        confirmedAt: new Date(),
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    await prisma.incomeAllocation.create({
      data: {
        id: randomUUID(),
        budgetId: owner.budgetId,
        incomeTransactionId: incomeId,
        status: 'CONFIRMED',
        amountMinor: 2_000n,
        occurredOn: new Date(`${today}T00:00:00.000Z`),
        accountId,
        envelopeId,
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: owner.budgetId,
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        amountMinor: 500n,
        occurredOn: new Date(`${today}T00:00:00.000Z`),
        accountId,
        categoryId: expenseCategoryId,
        envelopeId,
        confirmedAt: new Date(),
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    const planId = randomUUID();
    await prisma.regularPlan.create({
      data: {
        id: planId,
        workspaceId: owner.workspaceId,
        budgetId: owner.budgetId,
        name: 'Платёж summary',
        planType: 'EXPENSE',
        amountMinor: 3_600_000n,
        anchorOn: new Date(`${today}T00:00:00.000Z`),
        startOn: new Date(`${today}T00:00:00.000Z`),
        recurrence: 'MONTHLY',
        categoryId: expenseCategoryId,
        envelopeId,
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    await prisma.planOccurrence.create({
      data: {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        budgetId: owner.budgetId,
        planId,
        scheduledOn: new Date(`${today}T00:00:00.000Z`),
        planName: 'Платёж summary',
        planType: 'EXPENSE',
        amountMinor: 3_600_000n,
        categoryId: expenseCategoryId,
        envelopeId,
        status: 'PENDING',
      },
    });
    await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: owner.budgetId,
        transactionType: 'INCOME',
        status: 'DRAFT',
        amountMinor: 99_999n,
        occurredOn: new Date(`${today}T00:00:00.000Z`),
        accountId,
        categoryId: incomeCategoryId,
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
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
    if (!cookie) {
      throw new Error(
        `Missing session cookie: ${response.statusCode} ${JSON.stringify(response.json())}`,
      );
    }
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
