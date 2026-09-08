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
  incomeCategoryId: string;
  expenseCategoryId: string;
  envelopeId: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
let owner: Session;
let viewer: Session;
let foreign: Session;
let ownerReferences: References;
let foreignReferences: References;
let planId: string;
let occurrenceId: string;
let notificationId: string;

describe('Stage 5 budget isolation and role matrix', () => {
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

    owner = await register(`stage-5-isolation-owner-${randomUUID()}@harmofin.test`);
    viewer = await register(`stage-5-isolation-viewer-${randomUUID()}@harmofin.test`);
    foreign = await register(`stage-5-isolation-foreign-${randomUUID()}@harmofin.test`);
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        userId: viewer.userId,
        role: 'VIEWER',
      },
    });

    ownerReferences = await createReferences(owner);
    foreignReferences = await createReferences(foreign);
    ({ planId, occurrenceId, notificationId } = await createPlanData());
  });

  afterAll(async () => {
    await cleanup(owner);
    await cleanup(viewer);
    await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it('hides plans, occurrences, notifications, and obligations from a foreign budget owner', async () => {
    const paths = [
      `/api/v1/budgets/${owner.budgetId}/plans`,
      `/api/v1/budgets/${owner.budgetId}/plans/occurrences`,
      `/api/v1/budgets/${owner.budgetId}/notifications`,
      `/api/v1/budgets/${owner.budgetId}/summary`,
    ];

    const responses = await Promise.all(
      paths.map((url) => server.inject({ method: 'GET', url, cookies: sessionCookies(foreign) })),
    );

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    }
  });

  it('permits a viewer to read plans and summary but not mutate a plan or occurrence', async () => {
    const [plans, occurrences, summary, create, skip, remove] = await Promise.all([
      server.inject({
        method: 'GET',
        url: `/api/v1/budgets/${owner.budgetId}/plans`,
        cookies: sessionCookies(viewer),
      }),
      server.inject({
        method: 'GET',
        url: `/api/v1/budgets/${owner.budgetId}/plans/occurrences`,
        cookies: sessionCookies(viewer),
      }),
      server.inject({
        method: 'GET',
        url: `/api/v1/budgets/${owner.budgetId}/summary`,
        cookies: sessionCookies(viewer),
      }),
      server.inject({
        method: 'POST',
        url: `/api/v1/budgets/${owner.budgetId}/plans`,
        headers: mutationHeaders(viewer, 'viewer-create'),
        cookies: sessionCookies(viewer),
        payload: planPayload(ownerReferences),
      }),
      server.inject({
        method: 'POST',
        url: `/api/v1/budgets/${owner.budgetId}/plans/occurrences/${occurrenceId}/skip`,
        headers: mutationHeaders(viewer, 'viewer-skip'),
        cookies: sessionCookies(viewer),
      }),
      server.inject({
        method: 'DELETE',
        url: `/api/v1/budgets/${owner.budgetId}/plans/${planId}`,
        headers: mutationHeaders(viewer, 'viewer-delete'),
        cookies: sessionCookies(viewer),
      }),
    ]);

    expect(plans.statusCode).toBe(200);
    expect(plans.json<{ items: Array<{ id: string }> }>().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: planId })]),
    );
    expect(occurrences.statusCode).toBe(200);
    expect(occurrences.json<{ items: Array<{ id: string }> }>().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: occurrenceId })]),
    );
    expect(summary.statusCode).toBe(200);
    expect(
      summary.json<{ upcomingObligations: Array<{ occurrenceId: string }> }>().upcomingObligations,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ occurrenceId })]));
    for (const response of [create, skip, remove]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('rejects a foreign occurrence ID before performing an occurrence action', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/plans/occurrences/${occurrenceId}/skip`,
      headers: mutationHeaders(foreign, 'foreign-skip'),
      cookies: sessionCookies(foreign),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('rejects account, category, and envelope IDs from another budget', async () => {
    const cases = [
      ['accountId', { accountId: foreignReferences.accountId }],
      ['categoryId', { categoryId: foreignReferences.expenseCategoryId }],
      ['envelopeId', { envelopeId: foreignReferences.envelopeId }],
    ] as const;

    for (const [field, foreignReference] of cases) {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/budgets/${owner.budgetId}/plans`,
        headers: mutationHeaders(owner, `foreign-reference-${field}`),
        cookies: sessionCookies(owner),
        payload: { ...planPayload(ownerReferences), ...foreignReference },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'REFERENCE_INVALID' });
    }
  });

  it('returns only recipient notifications and hides another recipient notification ID', async () => {
    const [list, read] = await Promise.all([
      server.inject({
        method: 'GET',
        url: `/api/v1/budgets/${owner.budgetId}/notifications`,
        cookies: sessionCookies(viewer),
      }),
      server.inject({
        method: 'POST',
        url: `/api/v1/budgets/${owner.budgetId}/notifications/${notificationId}/read`,
        headers: mutationHeaders(viewer, 'viewer-read-owner-notification'),
        cookies: sessionCookies(viewer),
      }),
    ]);

    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: unknown[] }>().items).toEqual([]);
    expect(read.statusCode).toBe(404);
    expect(read.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  async function createPlanData() {
    planId = randomUUID();
    occurrenceId = randomUUID();
    notificationId = randomUUID();
    await prisma.regularPlan.create({
      data: {
        id: planId,
        workspaceId: owner.workspaceId,
        budgetId: owner.budgetId,
        name: 'Изоляция планов',
        planType: 'EXPENSE',
        amountMinor: 15_000n,
        anchorOn: new Date('2099-01-15T00:00:00.000Z'),
        startOn: new Date('2099-01-15T00:00:00.000Z'),
        recurrence: 'MONTHLY',
        accountId: ownerReferences.accountId,
        categoryId: ownerReferences.expenseCategoryId,
        envelopeId: ownerReferences.envelopeId,
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    await prisma.planOccurrence.create({
      data: {
        id: occurrenceId,
        workspaceId: owner.workspaceId,
        budgetId: owner.budgetId,
        planId,
        scheduledOn: new Date('2099-01-15T00:00:00.000Z'),
        planName: 'Изоляция планов',
        planType: 'EXPENSE',
        amountMinor: 15_000n,
        accountId: ownerReferences.accountId,
        categoryId: ownerReferences.expenseCategoryId,
        envelopeId: ownerReferences.envelopeId,
        status: 'PENDING',
      },
    });
    await prisma.notification.create({
      data: {
        id: notificationId,
        workspaceId: owner.workspaceId,
        budgetId: owner.budgetId,
        userId: owner.userId,
        notificationType: 'PLAN_UPCOMING',
        occurrenceId,
        title: 'План изоляции',
        body: 'Уведомление доступно только получателю.',
        actionPath: `/app/plans?occurrence=${occurrenceId}`,
        notificationKey: `isolation:${notificationId}`,
      },
    });
    return { planId, occurrenceId, notificationId };
  }
});

function planPayload(references: References) {
  return {
    name: 'План ссылок',
    planType: 'EXPENSE',
    amount: '150.00',
    anchorOn: '2099-02-15',
    startOn: '2099-02-15',
    recurrence: 'MONTHLY',
    accountId: references.accountId,
    categoryId: references.expenseCategoryId,
    envelopeId: references.envelopeId,
  };
}

async function createReferences(session: Session): Promise<References> {
  const accountId = randomUUID();
  const incomeCategoryId = randomUUID();
  const expenseCategoryId = randomUUID();
  const envelopeId = randomUUID();
  await prisma.account.create({
    data: {
      id: accountId,
      budgetId: session.budgetId,
      name: `Счёт ${accountId}`,
      accountType: 'CASH',
      startingBalanceMinor: 0n,
      accountingStartDate: new Date('2026-09-01T00:00:00.000Z'),
    },
  });
  await prisma.category.createMany({
    data: [
      {
        id: incomeCategoryId,
        budgetId: session.budgetId,
        name: `Доход ${incomeCategoryId}`,
        categoryType: 'INCOME',
        displayOrder: 0,
      },
      {
        id: expenseCategoryId,
        budgetId: session.budgetId,
        name: `Расход ${expenseCategoryId}`,
        categoryType: 'EXPENSE',
        displayOrder: 1,
      },
    ],
  });
  await prisma.envelope.create({
    data: {
      id: envelopeId,
      budgetId: session.budgetId,
      name: `Конверт ${envelopeId}`,
      envelopeType: 'CURRENT_EXPENSES',
      startingBalanceMinor: 0n,
      displayOrder: 0,
    },
  });
  return { accountId, incomeCategoryId, expenseCategoryId, envelopeId };
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

function sessionCookies(session: Session) {
  return { harmofin_session: session.cookie };
}

function mutationHeaders(session: Session, key: string) {
  return { origin, 'x-csrf-token': session.csrfToken, 'idempotency-key': key };
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
