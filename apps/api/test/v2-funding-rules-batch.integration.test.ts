import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';

const emails = {
  owner: `v2-batch-owner-${randomUUID()}@harmofin.test`,
  outsider: `v2-batch-outsider-${randomUUID()}@harmofin.test`,
  viewer: `v2-batch-viewer-${randomUUID()}@harmofin.test`,
  editor: `v2-batch-editor-${randomUUID()}@harmofin.test`,
};

type RegisteredUser = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  csrfToken: string;
  cookie: string;
};
type Context = Record<keyof typeof emails, RegisteredUser>;

let app: NestFastifyApplication;
let server: FastifyInstance;
const ctx: Partial<Context> = {};

let currentA: string;
let currentB: string;
let mandatory: string;
let savings: string;
let archived: string;
let outsiderEnvelope: string;
let incomeCategory: string;
let expenseCategory: string;

describe('v2 funding rules batch', () => {
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

    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      ctx[key] = await register(emails[key]);
    }
    for (const key of ['owner', 'outsider'] as const) {
      await prisma.budget.update({
        where: { id: ctx[key]!.budgetId },
        data: {
          planModelVersion: 2,
          planModelActivatedOn: new Date(Date.now() - 60 * 86_400_000),
          timezone: 'UTC',
          cycleStartDay: 1,
          periodBoundaryOffset: 14,
        },
      });
    }
    for (const [key, role] of [
      ['viewer', 'VIEWER'],
      ['editor', 'EDITOR'],
    ] as const) {
      await prisma.workspaceMembership.create({
        data: {
          id: randomUUID(),
          workspaceId: ctx.owner!.workspaceId,
          userId: ctx[key]!.userId,
          role,
        },
      });
    }

    await prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.owner!.budgetId,
        name: 'Основной счёт',
        accountType: 'BANK_ACCOUNT',
        startingBalanceMinor: 30_000_000n,
        accountingStartDate: new Date(Date.now() - 90 * 86_400_000),
      },
    });
    const budgetId = ctx.owner!.budgetId;
    currentA = await createEnvelope(budgetId, 'CURRENT_EXPENSES', 'Еда', 'FIRST');
    currentB = await createEnvelope(budgetId, 'CURRENT_EXPENSES', 'Транспорт', 'SECOND');
    mandatory = await createEnvelope(budgetId, 'MANDATORY_EXPENSES', 'Обязательные');
    savings = await createEnvelope(budgetId, 'SAVINGS_GOAL', 'Подушка');
    archived = await createEnvelope(budgetId, 'SAVINGS_GOAL', 'Старый');
    await prisma.envelope.update({ where: { id: archived }, data: { archivedAt: new Date() } });
    outsiderEnvelope = await createEnvelope(
      ctx.outsider!.budgetId,
      'CURRENT_EXPENSES',
      'Чужой',
      'FIRST',
    );
    incomeCategory = await createCategory(budgetId, 'INCOME', 'Зарплата');
    expenseCategory = await createCategory(budgetId, 'EXPENSE', 'Продукты');
  });

  it('GET funding-rules: правила своего бюджета в порядке priority, затем envelopeId', async () => {
    const budgetId = ctx.owner!.budgetId;
    await prisma.envelopeFundingRule.createMany({
      data: [
        { id: randomUUID(), budgetId, envelopeId: savings, type: 'PERCENT_OF_INCOME', priority: 20, percentBasisPoints: 1000 },
        { id: randomUUID(), budgetId, envelopeId: currentA, type: 'FIXED_PER_PERIOD', priority: 10, fixedMinor: 1_500_000n },
        { id: randomUUID(), budgetId, envelopeId: currentB, type: 'MANUAL', priority: 0 },
      ],
    });
    await prisma.envelopeFundingRule.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.outsider!.budgetId,
        envelopeId: outsiderEnvelope,
        type: 'MANUAL',
        priority: 0,
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${budgetId}/funding-rules`,
      headers: authHeaders(ctx.owner),
    });
    expect(response.statusCode).toBe(200);
    const items = response.json<{ items: Array<Record<string, unknown>> }>().items;
    expect(items.map((item) => item.envelopeId)).toEqual([currentB, currentA, savings]);
    expect(items[1]).toMatchObject({
      type: 'FIXED_PER_PERIOD',
      priority: 10,
      fixedAmountMinor: '1500000',
      percentBasisPoints: null,
    });
    expect(items[2]).toMatchObject({ type: 'PERCENT_OF_INCOME', percentBasisPoints: 1000 });

    const viewer = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${budgetId}/funding-rules`,
      headers: authHeaders(ctx.viewer),
    });
    expect(viewer.statusCode).toBe(200);

    const foreign = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${budgetId}/funding-rules`,
      headers: authHeaders(ctx.outsider),
    });
    expect(foreign.statusCode).toBe(404);

    const anonymous = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${budgetId}/funding-rules`,
      headers: { origin },
    });
    expect(anonymous.statusCode).toBe(401);

    await prisma.envelopeFundingRule.deleteMany({ where: { budgetId } });
  });
});

afterAll(async () => {
  for (const key of Object.keys(ctx) as Array<keyof Context>) {
    await cleanupUser(ctx[key]?.userId ?? '');
  }
  await app.close();
  await prisma.$disconnect();
});

function authHeaders(user: RegisteredUser | undefined): Record<string, string> {
  return { origin, cookie: `harmofin_session=${user?.cookie ?? ''}` };
}

function mutationHeaders(user: RegisteredUser | undefined, key: string): Record<string, string> {
  return {
    ...authHeaders(user),
    'x-csrf-token': user?.csrfToken ?? '',
    'idempotency-key': key,
  };
}

async function createCategory(
  budgetId: string,
  categoryType: 'INCOME' | 'EXPENSE',
  name: string,
): Promise<string> {
  const category = await prisma.category.create({
    data: { id: randomUUID(), budgetId, name, categoryType, displayOrder: 0 },
  });
  return category.id;
}

function putBatch(user: RegisteredUser | undefined, payload: unknown, key: string) {
  return server.inject({
    method: 'PUT',
    url: `/api/v2/budgets/${ctx.owner!.budgetId}/funding-rules`,
    headers: mutationHeaders(user, key),
    payload: payload as Record<string, unknown>,
  });
}

async function register(email: string): Promise<RegisteredUser> {
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
    csrfToken: string;
  }>();
  const setCookieRaw = response.headers['set-cookie'];
  const setCookie = Array.isArray(setCookieRaw) ? setCookieRaw.join('; ') : (setCookieRaw ?? '');
  const match = /harmofin_session=([^;]+)/.exec(setCookie);
  const cookie = match ? decodeURIComponent(match[1]!) : '';
  expect(cookie).not.toHaveLength(0);
  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    csrfToken: body.csrfToken,
    cookie,
  };
}

async function createEnvelope(
  budgetId: string,
  envelopeType: 'CURRENT_EXPENSES' | 'MANDATORY_EXPENSES' | 'SAVINGS_GOAL',
  name: string,
  periodSlot?: 'FIRST' | 'SECOND',
): Promise<string> {
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      name,
      envelopeType,
      startingBalanceMinor: 0n,
      displayOrder: 950,
      ...(periodSlot ? { periodSlot } : {}),
    },
  });
  return envelope.id;
}

async function cleanupUser(userId: string): Promise<void> {
  if (!userId) return;
  await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.recoveryToken.deleteMany({ where: { userId } });
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    select: { workspaceId: true },
  });
  await prisma.workspaceMembership.deleteMany({ where: { userId } });
  for (const { workspaceId } of memberships) {
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId } });
    await prisma.idempotencyRecord.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeMovement.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeAssignment.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.incomeAllocation.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.transferPart.deleteMany({ where: { transfer: { budget: { workspaceId } } } });
    await prisma.transfer.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopePeriod.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeFundingRule.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budgetCycleRevision.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.transaction.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budget.updateMany({
      where: { workspaceId },
      data: {
        incomeAllocationSourceCategoryId: null,
        incomeAllocationTargetEnvelopeId: null,
      },
    });
    await prisma.account.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.category.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelope.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budget.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}
