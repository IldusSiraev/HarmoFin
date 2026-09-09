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

let app: NestFastifyApplication;
let server: FastifyInstance;
let owner: Session;
let accountId: string;
let incomeCategoryId: string;
let planId: string;

function headers(key: string) {
  return { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key };
}

function draftPath(occurrenceId: string) {
  return `/api/v1/budgets/${owner.budgetId}/plans/occurrences/${occurrenceId}/create-draft`;
}

function confirmPath(transactionId: string) {
  return `/api/v1/budgets/${owner.budgetId}/transactions/${transactionId}/confirm`;
}

describe('plan occurrence transaction linkage', () => {
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
    owner = await register(`occurrence-transaction-${randomUUID()}@harmofin.test`);
    await seed();
  });

  afterAll(async () => {
    await cleanup(owner);
    await app.close();
    await prisma.$disconnect();
  });

  it('creates editable draft and completes linked occurrence only after confirm', async () => {
    const occurrence = await createOccurrence();
    const create = await server.inject({
      method: 'POST',
      url: draftPath(occurrence.id),
      headers: headers('occurrence-draft'),
      cookies: { harmofin_session: owner.cookie },
    });
    const draft = create.json<{ id: string; status: string; amountMinor: string }>();

    expect(create.statusCode).toBe(201);
    expect(draft).toMatchObject({ status: 'DRAFT', amountMinor: '10000' });
    await expect(
      prisma.planOccurrence.findUniqueOrThrow({ where: { id: occurrence.id } }),
    ).resolves.toMatchObject({
      status: 'DUE',
      transactionId: draft.id,
    });

    const confirm = await server.inject({
      method: 'POST',
      url: confirmPath(draft.id),
      headers: headers('confirm-occurrence-draft'),
      cookies: { harmofin_session: owner.cookie },
    });

    const confirmReplay = await server.inject({
      method: 'POST',
      url: confirmPath(draft.id),
      headers: headers('confirm-occurrence-draft'),
      cookies: { harmofin_session: owner.cookie },
    });

    expect(confirm.statusCode).toBe(200);
    expect(confirmReplay.json()).toEqual(confirm.json());
    await expect(
      prisma.planOccurrence.findUniqueOrThrow({ where: { id: occurrence.id } }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      transactionId: draft.id,
      completedAt: expect.any(Date),
    });
    expect(
      await prisma.auditEvent.count({
        where: { entityType: 'plan_occurrence', entityId: occurrence.id, action: 'COMPLETED' },
      }),
    ).toBe(1);
  });

  it('does not create second draft after linked draft is cancelled', async () => {
    const occurrence = await createOccurrence('2026-09-11');
    const created = await server.inject({
      method: 'POST',
      url: draftPath(occurrence.id),
      headers: headers('cancelled-draft-create'),
      cookies: { harmofin_session: owner.cookie },
    });
    const transactionId = created.json<{ id: string }>().id;
    const cancel = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/transactions/${transactionId}/cancel`,
      headers: headers('cancel-linked-draft'),
      cookies: { harmofin_session: owner.cookie },
    });
    const retry = await server.inject({
      method: 'POST',
      url: draftPath(occurrence.id),
      headers: headers('second-draft-key'),
      cookies: { harmofin_session: owner.cookie },
    });

    expect(cancel.statusCode).toBe(200);
    expect(retry.statusCode).toBe(409);
    expect(await prisma.transaction.count({ where: { budgetId: owner.budgetId } })).toBe(2);
    await expect(
      prisma.planOccurrence.findUniqueOrThrow({ where: { id: occurrence.id } }),
    ).resolves.toMatchObject({
      status: 'DUE',
      transactionId,
    });
  });

  async function seed() {
    accountId = randomUUID();
    incomeCategoryId = randomUUID();
    planId = randomUUID();
    await prisma.account.create({
      data: {
        id: accountId,
        budgetId: owner.budgetId,
        name: 'Счёт occurrence',
        accountType: 'CASH',
        startingBalanceMinor: 0n,
        accountingStartDate: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
    await prisma.category.create({
      data: {
        id: incomeCategoryId,
        budgetId: owner.budgetId,
        name: 'Доход occurrence',
        categoryType: 'INCOME',
        displayOrder: 0,
      },
    });
    await prisma.regularPlan.create({
      data: {
        id: planId,
        workspaceId: owner.workspaceId,
        budgetId: owner.budgetId,
        name: 'Доход по плану',
        planType: 'INCOME',
        amountMinor: 10_000n,
        anchorOn: new Date('2026-09-10T00:00:00.000Z'),
        startOn: new Date('2026-09-10T00:00:00.000Z'),
        recurrence: 'MONTHLY',
        accountId,
        categoryId: incomeCategoryId,
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
  }

  function createOccurrence(scheduledOn = '2026-09-10') {
    return prisma.planOccurrence.create({
      data: {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        budgetId: owner.budgetId,
        planId,
        scheduledOn: new Date(`${scheduledOn}T00:00:00.000Z`),
        planName: 'Доход по плану',
        planType: 'INCOME',
        amountMinor: 10_000n,
        accountId,
        categoryId: incomeCategoryId,
        status: 'DUE',
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
    await prisma.user.delete({ where: { id: session.userId } });
  }
});
