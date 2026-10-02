import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { NotificationRuleHandler } from '../../worker/src/notification.handler.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const today = '2026-09-10';
const now = new Date(`${today}T12:00:00.000Z`);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

type Session = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  accountId: string;
  envelopeId: string;
  categoryId: string;
  planId: string;
  todayId: string;
  overdueId: string;
  upcomingId: string;
};

const legacyTypes = [
  'UNALLOCATED_INCOME',
  'NEGATIVE_ACCOUNT',
  'NEGATIVE_ENVELOPE',
  'INSUFFICIENT_MANDATORY_OBLIGATIONS',
  'PLAN_UPCOMING',
];

let app: NestFastifyApplication;
let server: FastifyInstance;
let v2: Session;
let v1: Session;

const notifications = (session: Session) =>
  prisma.notification.findMany({
    where: { budgetId: session.budgetId },
    select: {
      notificationType: true,
      occurrenceId: true,
      resolvedAt: true,
      actionPath: true,
      body: true,
      title: true,
      notificationKey: true,
    },
  });

const open = async (session: Session, type: 'PLAN_TODAY' | 'PLAN_OVERDUE') =>
  (await notifications(session)).filter(
    (item) => item.notificationType === type && item.resolvedAt === null,
  );

describe('v2 notifications', () => {
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
    v2 = await register(`v2-notif-${randomUUID()}@harmofin.test`);
    v1 = await register(`v1-notif-${randomUUID()}@harmofin.test`);
    await seed(v2);
    await seed(v1);
    await prisma.budget.update({
      where: { id: v2.budgetId },
      data: { planModelVersion: 2, planModelActivatedOn: day('2026-08-01'), timezone: 'UTC' },
    });
  });

  afterAll(async () => {
    await cleanup(v2);
    await cleanup(v1);
    await app.close();
    await prisma.$disconnect();
  });

  it('sends due and overdue once for a model 2 budget and no old financial types', async () => {
    const handler = new NotificationRuleHandler(prisma);
    await handler.execute(now, v2.budgetId);
    await handler.execute(now, v2.budgetId);

    const v2Notifications = await notifications(v2);
    expect(v2Notifications.map((item) => item.notificationType).sort()).toEqual([
      'PLAN_OVERDUE',
      'PLAN_TODAY',
    ]);
    expect(
      v2Notifications.some(
        (item) => item.notificationType === 'INSUFFICIENT_MANDATORY_OBLIGATIONS',
      ),
    ).toBe(false);
    expect(v2Notifications.find((item) => item.notificationType === 'PLAN_TODAY')).toMatchObject({
      occurrenceId: v2.todayId,
      actionPath: `/app/plans?occurrence=${v2.todayId}`,
      notificationKey: `occurrence:${v2.todayId}:PLAN_TODAY`,
    });
    expect(v2Notifications.find((item) => item.notificationType === 'PLAN_OVERDUE')).toMatchObject({
      occurrenceId: v2.overdueId,
    });
    expect(JSON.stringify(v2Notifications)).not.toMatch(/\b100\b|1\.00/);
  });

  it('keeps the v1 rule set for a model 1 budget and isolates budgets', async () => {
    const handler = new NotificationRuleHandler(prisma);
    await handler.execute(now, v1.budgetId);
    await handler.execute(now, v2.budgetId);

    const types = new Set((await notifications(v1)).map((item) => item.notificationType));
    expect(types).toEqual(
      new Set([
        'PLAN_UPCOMING',
        'PLAN_TODAY',
        'PLAN_OVERDUE',
        'UNALLOCATED_INCOME',
        'NEGATIVE_ACCOUNT',
        'NEGATIVE_ENVELOPE',
        'INSUFFICIENT_MANDATORY_OBLIGATIONS',
      ]),
    );
    const v2Notifications = await notifications(v2);
    expect(
      v2Notifications.every((item) =>
        ['PLAN_TODAY', 'PLAN_OVERDUE'].includes(item.notificationType),
      ),
    ).toBe(true);
    expect((await notifications(v1)).every((item) => item.occurrenceId !== v2.todayId)).toBe(true);
  });

  it('keeps a partially paid occurrence and resolves after full payment', async () => {
    await pay(v2, v2.overdueId, 40n);
    await new NotificationRuleHandler(prisma).execute(now, v2.budgetId);
    expect(await open(v2, 'PLAN_OVERDUE')).toHaveLength(1);

    await pay(v2, v2.overdueId, 60n);
    await new NotificationRuleHandler(prisma).execute(now, v2.budgetId);
    expect(await open(v2, 'PLAN_OVERDUE')).toHaveLength(0);
  });

  it('resolves after skip and after confirmed completion', async () => {
    await prisma.planOccurrence.update({
      where: { id: v2.todayId },
      data: { status: 'SKIPPED', skippedAt: new Date() },
    });
    await new NotificationRuleHandler(prisma).execute(now, v2.budgetId);
    expect(await open(v2, 'PLAN_TODAY')).toHaveLength(0);
    await new NotificationRuleHandler(prisma).execute(now, v2.budgetId);
    expect(
      (await notifications(v2)).filter((item) => item.notificationType === 'PLAN_TODAY'),
    ).toHaveLength(1);

    await prisma.planOccurrence.update({
      where: { id: v2.overdueId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await new NotificationRuleHandler(prisma).execute(now, v2.budgetId);
    expect(await open(v2, 'PLAN_OVERDUE')).toHaveLength(0);
  });

  it('resolves legacy v1-only notifications after a budget moves to model 2', async () => {
    await prisma.budget.update({
      where: { id: v1.budgetId },
      data: { planModelVersion: 2, planModelActivatedOn: day('2026-08-01') },
    });
    await new NotificationRuleHandler(prisma).execute(now, v1.budgetId);
    const openOld = (await notifications(v1)).filter(
      (item) => item.resolvedAt === null && legacyTypes.includes(item.notificationType),
    );
    expect(openOld).toEqual([]);
  });

  it('shows the inbox only to the budget member', async () => {
    const own = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${v2.budgetId}/notifications`,
      cookies: { harmofin_session: v2.cookie },
    });
    const foreign = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${v2.budgetId}/notifications`,
      cookies: { harmofin_session: v1.cookie },
    });
    expect(own.statusCode).toBe(200);
    expect(foreign.statusCode).toBe(404);
  });

  async function pay(session: Session, occurrenceId: string, amount: bigint) {
    const transactionId = randomUUID();
    await prisma.transaction.create({
      data: {
        id: transactionId,
        budgetId: session.budgetId,
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        amountMinor: amount,
        occurredOn: day(today),
        accountId: session.accountId,
        categoryId: session.categoryId,
        envelopeId: session.envelopeId,
        confirmedAt: new Date(),
        createdByUserId: session.userId,
        updatedByUserId: session.userId,
      },
    });
    await prisma.planPayment.create({
      data: { id: randomUUID(), budgetId: session.budgetId, occurrenceId, transactionId },
    });
  }

  async function seed(session: Session) {
    session.accountId = randomUUID();
    session.envelopeId = randomUUID();
    session.categoryId = randomUUID();
    session.planId = randomUUID();
    const incomeCategoryId = randomUUID();
    await prisma.account.create({
      data: {
        id: session.accountId,
        budgetId: session.budgetId,
        name: 'Минусовый счёт',
        accountType: 'CASH',
        startingBalanceMinor: -1_000n,
        accountingStartDate: day(today),
      },
    });
    await prisma.envelope.create({
      data: {
        id: session.envelopeId,
        budgetId: session.budgetId,
        name: 'Обязательные',
        envelopeType: 'MANDATORY_EXPENSES',
        startingBalanceMinor: -50n,
        displayOrder: 0,
      },
    });
    await prisma.category.createMany({
      data: [
        {
          id: session.categoryId,
          budgetId: session.budgetId,
          name: 'Аренда',
          categoryType: 'EXPENSE',
          displayOrder: 0,
        },
        {
          id: incomeCategoryId,
          budgetId: session.budgetId,
          name: 'Доход',
          categoryType: 'INCOME',
          displayOrder: 1,
        },
      ],
    });
    await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: session.budgetId,
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        amountMinor: 500n,
        occurredOn: day(today),
        accountId: session.accountId,
        categoryId: incomeCategoryId,
        confirmedAt: day(today),
        createdByUserId: session.userId,
        updatedByUserId: session.userId,
      },
    });
    await prisma.regularPlan.create({
      data: {
        id: session.planId,
        workspaceId: session.workspaceId,
        budgetId: session.budgetId,
        name: 'Аренда',
        planType: 'EXPENSE',
        amountMinor: 100n,
        anchorOn: day(today),
        startOn: day(today),
        recurrence: 'MONTHLY',
        accountId: session.accountId,
        categoryId: session.categoryId,
        envelopeId: session.envelopeId,
        createdByUserId: session.userId,
        updatedByUserId: session.userId,
      },
    });
    const occurrence = async (scheduledOn: string, status: 'PENDING' | 'DUE') => {
      const id = randomUUID();
      await prisma.planOccurrence.create({
        data: {
          id,
          workspaceId: session.workspaceId,
          budgetId: session.budgetId,
          planId: session.planId,
          scheduledOn: day(scheduledOn),
          planName: 'Аренда',
          planType: 'EXPENSE',
          amountMinor: 100n,
          accountId: session.accountId,
          categoryId: session.categoryId,
          envelopeId: session.envelopeId,
          status,
        },
      });
      return id;
    };
    session.todayId = await occurrence(today, 'DUE');
    session.upcomingId = await occurrence('2026-09-13', 'PENDING');
    session.overdueId = await occurrence('2026-09-09', 'DUE');
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
    } as Session;
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
    await prisma.planPayment.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.planOccurrence.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.regularPlan.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { budgetId: { in: budgetIds } } });
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
