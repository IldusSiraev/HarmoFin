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

type Session = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
let owner: Session;
let foreign: Session;
let accountId: string;
let envelopeId: string;
let incomeCategoryId: string;
let expenseCategoryId: string;
let incomeTransactionId: string;
let todayOccurrenceId: string;

function notificationPath(notificationId?: string) {
  const path = `/api/v1/budgets/${owner.budgetId}/notifications`;
  return notificationId ? `${path}/${notificationId}` : path;
}

function headers(key: string) {
  return { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key };
}

describe('internal notifications', () => {
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
    owner = await register(`notifications-owner-${randomUUID()}@harmofin.test`);
    foreign = await register(`notifications-foreign-${randomUUID()}@harmofin.test`);
    await seed();
  });

  afterAll(async () => {
    await cleanup(owner);
    await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it('creates each due and overdue notification once and no old financial rules', async () => {
    const handler = new NotificationRuleHandler(prisma);
    const now = new Date(`${today}T12:00:00.000Z`);

    await handler.execute(now, owner.budgetId);
    await handler.execute(now, owner.budgetId);

    const notifications = await prisma.notification.findMany({
      where: { budgetId: owner.budgetId, userId: owner.userId },
      select: { notificationType: true, occurrenceId: true, title: true },
    });
    expect(notifications.map((item) => item.notificationType).sort()).toEqual([
      'PLAN_OVERDUE',
      'PLAN_TODAY',
    ]);
    expect(notifications.find((item) => item.notificationType === 'PLAN_TODAY')?.occurrenceId).toBe(
      todayOccurrenceId,
    );
    expect(notifications.every((item) => /[А-Яа-яЁё]/u.test(item.title))).toBe(true);
  });

  it('lists unread notifications before read notifications', async () => {
    await prisma.notification.create({
      data: {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        budgetId: owner.budgetId,
        userId: owner.userId,
        notificationType: 'PLAN_TODAY',
        occurrenceId: todayOccurrenceId,
        title: 'Прочитанное уведомление',
        body: 'Это уведомление не должно быть первым.',
        actionPath: `/app/plans?occurrence=${todayOccurrenceId}`,
        notificationKey: `read-order:${randomUUID()}`,
        readAt: new Date(),
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: notificationPath(),
      cookies: { harmofin_session: owner.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ items: Array<{ readAt: string | null }> }>().items[0]?.readAt,
    ).toBeNull();
  });

  it('lists recipient notifications and idempotently marks them read', async () => {
    const list = await server.inject({
      method: 'GET',
      url: notificationPath(),
      cookies: { harmofin_session: owner.cookie },
    });
    const notificationId = list.json<{ items: Array<{ id: string; readAt: string | null }> }>()
      .items[0]!.id;
    const first = await server.inject({
      method: 'POST',
      url: `${notificationPath(notificationId)}/read`,
      headers: headers('read-notification'),
      cookies: { harmofin_session: owner.cookie },
    });
    const replay = await server.inject({
      method: 'POST',
      url: `${notificationPath(notificationId)}/read`,
      headers: headers('read-notification'),
      cookies: { harmofin_session: owner.cookie },
    });

    expect(list.statusCode).toBe(200);
    expect(first.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(first.json()).toMatchObject({ id: notificationId, readAt: expect.any(String) });
  });

  it('marks every unread notification as read with an idempotent request', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `${notificationPath()}/read-all`,
      headers: headers('read-all-notifications'),
      cookies: { harmofin_session: owner.cookie },
    });
    const replay = await server.inject({
      method: 'POST',
      url: `${notificationPath()}/read-all`,
      headers: headers('read-all-notifications'),
      cookies: { harmofin_session: owner.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ updatedCount: number }>().updatedCount).toBeGreaterThan(0);
    expect(replay.json()).toEqual(response.json());
    expect(
      await prisma.notification.count({
        where: { budgetId: owner.budgetId, userId: owner.userId, readAt: null },
      }),
    ).toBe(0);
  });

  it('rejects malformed notification cursor', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `${notificationPath()}?cursor=bad-cursor`,
      cookies: { harmofin_session: owner.cookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('hides inbox from a foreign budget member', async () => {
    const response = await server.inject({
      method: 'GET',
      url: notificationPath(),
      cookies: { harmofin_session: foreign.cookie },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  async function seed() {
    accountId = randomUUID();
    envelopeId = randomUUID();
    incomeCategoryId = randomUUID();
    expenseCategoryId = randomUUID();
    incomeTransactionId = randomUUID();
    await prisma.account.create({
      data: {
        id: accountId,
        budgetId: owner.budgetId,
        ownerUserId: owner.userId,
        name: 'Минусовый счёт',
        accountType: 'CASH',
        startingBalanceMinor: -1_000n,
        accountingStartDate: new Date(`${today}T00:00:00.000Z`),
      },
    });
    await prisma.envelope.create({
      data: {
        id: envelopeId,
        budgetId: owner.budgetId,
        ownerUserId: owner.userId,
        name: 'Обязательные уведомления',
        envelopeType: 'MANDATORY_EXPENSES',
        startingBalanceMinor: -50n,
        displayOrder: 0,
      },
    });
    await prisma.category.createMany({
      data: [
        {
          id: incomeCategoryId,
          budgetId: owner.budgetId,
          name: 'Доход',
          categoryType: 'INCOME',
          displayOrder: 0,
        },
        {
          id: expenseCategoryId,
          budgetId: owner.budgetId,
          name: 'Расход',
          categoryType: 'EXPENSE',
          displayOrder: 1,
        },
      ],
    });
    await prisma.transaction.create({
      data: {
        id: incomeTransactionId,
        budgetId: owner.budgetId,
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        amountMinor: 500n,
        occurredOn: new Date(`${today}T00:00:00.000Z`),
        accountId,
        categoryId: incomeCategoryId,
        confirmedAt: new Date(`${today}T00:00:00.000Z`),
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
        ownerUserId: owner.userId,
        name: 'Платёж',
        planType: 'EXPENSE',
        amountMinor: 100n,
        anchorOn: new Date(`${today}T00:00:00.000Z`),
        startOn: new Date(`${today}T00:00:00.000Z`),
        recurrence: 'MONTHLY',
        accountId,
        categoryId: expenseCategoryId,
        envelopeId,
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    const occurrence = (scheduledOn: string, status: 'PENDING' | 'DUE') =>
      prisma.planOccurrence.create({
        data: {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          budgetId: owner.budgetId,
          planId,
          scheduledOn: new Date(`${scheduledOn}T00:00:00.000Z`),
          planName: 'Платёж',
          planType: 'EXPENSE',
          amountMinor: 100n,
          accountId,
          categoryId: expenseCategoryId,
          envelopeId,
          status,
        },
      });
    todayOccurrenceId = (await occurrence(today, 'DUE')).id;
    await occurrence('2026-09-13', 'PENDING');
    await occurrence('2026-09-09', 'DUE');
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
    await prisma.notification.deleteMany({ where: { budgetId: { in: budgetIds } } });
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
