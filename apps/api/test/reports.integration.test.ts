import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
};

let app: NestFastifyApplication;
let server: FastifyInstance;
let owner: Session;
let editor: Session;
let viewer: Session;
let foreign: Session;
let accountId: string;
let categoryId: string;
let envelopeId: string;
let goalEnvelopeId: string;
let noDeadlineGoalEnvelopeId: string;
let archivedGoalEnvelopeId: string;
let foreignGoalEnvelopeId: string;
let reportPlanId: string;
let foreignPlanId: string;

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
    editor = await register(`reports-editor-${randomUUID()}@harmofin.test`);
    viewer = await register(`reports-viewer-${randomUUID()}@harmofin.test`);
    foreign = await register(`reports-foreign-${randomUUID()}@harmofin.test`);
    // This suite's fixture dates (10th/25th cycle boundaries) assume the
    // pre-Task-1 cycle configuration; pin it explicitly now that new budgets
    // default to a calendar-month cycle.
    await prisma.budget.update({
      where: { id: owner.budgetId },
      data: { cycleStartDay: 10, periodBoundaryOffset: 15 },
    });
    await prisma.workspaceMembership.createMany({
      data: [
        {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          userId: editor.userId,
          role: 'EDITOR',
        },
        {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          userId: viewer.userId,
          role: 'VIEWER',
        },
      ],
    });
    await seedReportData();
  });

  afterAll(async () => {
    for (const session of [owner, editor, viewer, foreign]) {
      if (session) await cleanup(session);
    }
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
    'plan-vs-actual',
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

  it('calculates plan/fact by occurrence date and confirmed linked actual only', async () => {
    const response = await getReport('plan-vs-actual', {
      from: '2026-08-10',
      to: '2026-09-09',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      key: 'plan-vs-actual',
      rows: [
        {
          planId: reportPlanId,
          plannedMinor: '450000',
          actualMinor: '170000',
          varianceMinor: '-280000',
          plannedOccurrenceCount: 3,
          confirmedOccurrenceCount: 1,
          journalFilters: { planId: reportPlanId, status: 'CONFIRMED' },
        },
      ],
    });
  });

  it('projects active goal progress without changing financial state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T12:00:00.000Z'));
    try {
      const before = await Promise.all([
        prisma.transaction.count({ where: { budgetId: owner.budgetId } }),
        prisma.envelope.count({ where: { budgetId: owner.budgetId } }),
      ]);
      const response = await getReport('savings-goals', { envelopeId: goalEnvelopeId });
      const foreignFilter = await getReport('savings-goals', {
        envelopeId: foreignGoalEnvelopeId,
      });
      const after = await Promise.all([
        prisma.transaction.count({ where: { budgetId: owner.budgetId } }),
        prisma.envelope.count({ where: { budgetId: owner.budgetId } }),
      ]);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        key: 'savings-goals',
        rows: expect.arrayContaining([
          expect.objectContaining({
            envelopeId: goalEnvelopeId,
            currentMinor: '500',
            targetMinor: '50000',
            remainingMinor: '49500',
            progressPermille: 10,
            isReached: false,
            daysRemaining: 7,
          }),
          expect.objectContaining({
            envelopeId: noDeadlineGoalEnvelopeId,
            currentMinor: '25000',
            targetMinor: '100000',
            remainingMinor: '75000',
            progressPermille: 250,
            isReached: false,
            daysRemaining: null,
          }),
        ]),
      });
      expect(response.json<{ rows: Array<{ envelopeId: string }> }>().rows).not.toContainEqual(
        expect.objectContaining({ envelopeId: archivedGoalEnvelopeId }),
      );
      expect(foreignFilter.statusCode).toBe(404);
      expect(after).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows editor and viewer to read scoped reports but not foreign users', async () => {
    const [editorReport, viewerReport, foreignReport] = await Promise.all([
      getReportFor(editor, 'plan-vs-actual', { from: '2026-08-10', to: '2026-09-09' }),
      getReportFor(viewer, 'savings-goals', {}),
      getReportFor(foreign, 'plan-vs-actual', {}),
    ]);

    expect(editorReport.statusCode).toBe(200);
    expect(editorReport.json()).toMatchObject({ key: 'plan-vs-actual' });
    expect(viewerReport.statusCode).toBe(200);
    expect(viewerReport.json()).toMatchObject({ key: 'savings-goals' });
    expect(foreignReport.statusCode).toBe(404);
    expect(foreignReport.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
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
    goalEnvelopeId = randomUUID();
    noDeadlineGoalEnvelopeId = randomUUID();
    archivedGoalEnvelopeId = randomUUID();
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
          targetDate: new Date('2026-09-16T00:00:00.000Z'),
          displayOrder: 1,
        },
        {
          id: noDeadlineGoalEnvelopeId,
          budgetId: owner.budgetId,
          name: 'Резерв отчёт',
          envelopeType: 'SAVINGS_GOAL',
          startingBalanceMinor: 25_000n,
          targetAmountMinor: 100_000n,
          displayOrder: 2,
        },
        {
          id: archivedGoalEnvelopeId,
          budgetId: owner.budgetId,
          name: 'Архивная цель отчёт',
          envelopeType: 'SAVINGS_GOAL',
          startingBalanceMinor: 10_000n,
          targetAmountMinor: 20_000n,
          archivedAt: new Date('2026-09-01T00:00:00.000Z'),
          displayOrder: 3,
        },
      ],
    });
    foreignGoalEnvelopeId = randomUUID();
    await prisma.envelope.create({
      data: {
        id: foreignGoalEnvelopeId,
        budgetId: foreign.budgetId,
        name: 'Чужая цель отчёт',
        envelopeType: 'SAVINGS_GOAL',
        startingBalanceMinor: 0n,
        targetAmountMinor: 10_000n,
        displayOrder: 0,
      },
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

    const planAccountId = randomUUID();
    const planCategoryId = randomUUID();
    const planEnvelopeId = randomUUID();
    const confirmedActualId = randomUUID();
    const draftActualId = randomUUID();
    reportPlanId = randomUUID();
    await prisma.account.create({
      data: {
        id: planAccountId,
        budgetId: owner.budgetId,
        name: 'Счёт плана отчёта',
        accountType: 'CASH',
        startingBalanceMinor: 0n,
        accountingStartDate: occurredOn,
      },
    });
    await prisma.category.create({
      data: {
        id: planCategoryId,
        budgetId: owner.budgetId,
        name: 'Ипотека отчёт',
        categoryType: 'EXPENSE',
        displayOrder: 2,
      },
    });
    await prisma.envelope.create({
      data: {
        id: planEnvelopeId,
        budgetId: owner.budgetId,
        name: 'Конверт плана отчёта',
        envelopeType: 'MANDATORY_EXPENSES',
        startingBalanceMinor: 0n,
        displayOrder: 2,
      },
    });
    await prisma.transaction.createMany({
      data: [
        {
          id: confirmedActualId,
          budgetId: owner.budgetId,
          transactionType: 'EXPENSE',
          status: 'CONFIRMED',
          amountMinor: 170_000n,
          occurredOn: new Date('2026-10-10T00:00:00.000Z'),
          accountId: planAccountId,
          categoryId: planCategoryId,
          envelopeId: planEnvelopeId,
          confirmedAt: new Date(),
          createdByUserId: owner.userId,
          updatedByUserId: owner.userId,
        },
        {
          id: draftActualId,
          budgetId: owner.budgetId,
          transactionType: 'EXPENSE',
          status: 'DRAFT',
          amountMinor: 150_000n,
          occurredOn: new Date('2026-08-25T00:00:00.000Z'),
          accountId: planAccountId,
          categoryId: planCategoryId,
          envelopeId: planEnvelopeId,
          createdByUserId: owner.userId,
          updatedByUserId: owner.userId,
        },
      ],
    });
    await prisma.regularPlan.create({
      data: {
        id: reportPlanId,
        workspaceId: owner.workspaceId,
        budgetId: owner.budgetId,
        name: 'Ипотека',
        planType: 'EXPENSE',
        amountMinor: 150_000n,
        anchorOn: occurredOn,
        startOn: occurredOn,
        recurrence: 'MONTHLY',
        accountId: planAccountId,
        categoryId: planCategoryId,
        envelopeId: planEnvelopeId,
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    await prisma.planOccurrence.createMany({
      data: [
        {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          budgetId: owner.budgetId,
          planId: reportPlanId,
          scheduledOn: new Date('2026-08-10T00:00:00.000Z'),
          planName: 'Ипотека',
          planType: 'EXPENSE',
          amountMinor: 150_000n,
          accountId: planAccountId,
          categoryId: planCategoryId,
          envelopeId: planEnvelopeId,
          status: 'COMPLETED',
          transactionId: confirmedActualId,
          completedAt: new Date(),
        },
        {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          budgetId: owner.budgetId,
          planId: reportPlanId,
          scheduledOn: new Date('2026-08-20T00:00:00.000Z'),
          planName: 'Ипотека',
          planType: 'EXPENSE',
          amountMinor: 150_000n,
          accountId: planAccountId,
          categoryId: planCategoryId,
          envelopeId: planEnvelopeId,
          status: 'SKIPPED',
          skippedAt: new Date(),
        },
        {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          budgetId: owner.budgetId,
          planId: reportPlanId,
          scheduledOn: new Date('2026-08-25T00:00:00.000Z'),
          planName: 'Ипотека',
          planType: 'EXPENSE',
          amountMinor: 150_000n,
          accountId: planAccountId,
          categoryId: planCategoryId,
          envelopeId: planEnvelopeId,
          status: 'PENDING',
          transactionId: draftActualId,
        },
      ],
    });
    foreignPlanId = randomUUID();
    await prisma.regularPlan.create({
      data: {
        id: foreignPlanId,
        workspaceId: foreign.workspaceId,
        budgetId: foreign.budgetId,
        name: 'Чужой план',
        planType: 'SAVINGS',
        amountMinor: 1_000n,
        anchorOn: occurredOn,
        startOn: occurredOn,
        recurrence: 'MONTHLY',
        createdByUserId: foreign.userId,
        updatedByUserId: foreign.userId,
      },
    });
  }

  function getReport(key: string, query: Record<string, string>) {
    return getReportFor(owner, key, query);
  }

  function getReportFor(session: Session, key: string, query: Record<string, string>) {
    return server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/reports/${key}?${new URLSearchParams(query)}`,
      cookies: { harmofin_session: session.cookie },
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
    await forceBudgetV1(prisma, body.budget.id);
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
