import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const ownerEmail = `v2-foundation-owner-${randomUUID()}@harmofin.test`;
const otherEmail = `v2-foundation-other-${randomUUID()}@harmofin.test`;

let app: NestFastifyApplication;
let server: FastifyInstance;
let ownerId: string;
let otherId: string;
let ownerCookie: string;
let otherWorkspaceId: string;
let otherBudgetId: string;
let ownBudgetId: string;
let ownerEnvelopeId: string;
let foreignEnvelopeId: string;

describe('v2 foundation: URI versioning and budget model version', () => {
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

    const owner = await register(ownerEmail);
    ownerId = owner.user.id;
    ownerCookie = owner.cookie;
    const other = await register(otherEmail);
    otherId = other.user.id;
    otherWorkspaceId = other.workspace.id;
    otherBudgetId = other.budget.id;
    ownBudgetId = owner.budget.id;
    ownerEnvelopeId = await createTestEnvelope(ownBudgetId, 'F02 owner envelope');
    foreignEnvelopeId = await createTestEnvelope(otherBudgetId, 'F02 foreign envelope');
  });

  afterAll(async () => {
    await cleanupUser(ownerId);
    await cleanupUser(otherId);
    await app.close();
    await prisma.$disconnect();
  });

  it('keeps the v1 health endpoint on /api/v1 and documents both versions in OpenAPI', async () => {
    const live = await server.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(live.statusCode).toBe(200);

    const response = await server.inject({ method: 'GET', url: '/openapi.json' });
    expect(response.statusCode).toBe(200);
    const document = response.json<OpenApiDocument>();
    expect(document.paths['/api/v1/health/live']).toBeDefined();
    const modelOperation = document.paths['/api/v2/budgets/{budgetId}/model'];
    expect(modelOperation).toBeDefined();
    expect(modelOperation?.get).toBeDefined();
    for (const status of ['401', '404', '409']) {
      expect(
        modelOperation?.get?.responses?.[status]?.content?.['application/json']?.schema,
      ).toEqual({ $ref: '#/components/schemas/ProblemDetailsResponse' });
    }
    expect(modelOperation?.get?.security).toEqual([{ session: [] }]);
  });

  it('answers 401 without a session, 404 for a foreign budget and 409 for a v1 budget', async () => {
    const anonymous = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${otherBudgetId}/model`,
    });
    expect(anonymous.statusCode).toBe(401);

    const foreign = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${otherBudgetId}/model`,
      cookies: { harmofin_session: ownerCookie },
    });
    expect(foreign.statusCode).toBe(404);

    const ownV1 = await getOwnV1BudgetId(ownerId);
    const mismatch = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${ownV1}/model`,
      cookies: { harmofin_session: ownerCookie },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({ code: 'MODEL_VERSION_MISMATCH' });
    expect(typeof mismatch.json()?.detail).toBe('string');
    expect((mismatch.json()?.detail as string).length).toBeGreaterThan(0);
  });

  it('keeps a legacy budget on model version 1 without an activation date', async () => {
    const row = (await prisma.budget.findUniqueOrThrow({
      where: { id: (await getOwnV1BudgetId(ownerId)) },
    })) as unknown as Record<string, unknown>;

    expect(row['planModelVersion']).toBe(1);
    expect(row['planModelActivatedOn']).toBeNull();
  });

  it('rejects a v2 budget without planModelActivatedOn with MODEL_VERSION_MISMATCH', async () => {
    const budgetId = await getOwnV1BudgetId(ownerId);
    await prisma.budget.update({
      where: { id: budgetId },
      data: { planModelVersion: 2, planModelActivatedOn: null },
    });

    const response = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${budgetId}/model`,
      cookies: { harmofin_session: ownerCookie },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'MODEL_VERSION_MISMATCH' });
    expect(typeof response.json()?.detail).toBe('string');
    expect((response.json()?.detail as string).length).toBeGreaterThan(0);
  });

  it('returns the current model for an activated v2 budget', async () => {
    const budgetId = await getOwnV1BudgetId(ownerId);
    await prisma.budget.update({
      where: { id: budgetId },
      data: { planModelVersion: 2, planModelActivatedOn: new Date('2026-09-29T00:00:00Z') },
    });

    const response = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${budgetId}/model`,
      cookies: { harmofin_session: ownerCookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ planModelVersion: number; planModelActivatedOn: string | null }>();
    expect(body.planModelVersion).toBe(2);
    expect(body.planModelActivatedOn).toBe('2026-09-29');
  });

  it('rejects a duplicate envelope_period for the same (budgetId, envelopeId, startsOn)', async () => {
    const periodData = {
      budgetId: ownBudgetId,
      envelopeId: ownerEnvelopeId,
      startsOn: new Date('2026-10-01T00:00:00Z'),
      endsOn: new Date('2026-10-31T00:00:00Z'),
    };
    const first = await prisma.envelopePeriod.create({
      data: {
        id: randomUUID(),
        ...periodData,
      },
    });
    expect(first.targetStatus).toBe('UNSET');

    await expect(
      prisma.envelopePeriod.create({
        data: {
          id: randomUUID(),
          ...periodData,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects an envelope_period whose envelope belongs to another budget (composite FK)', async () => {
    await expect(
      prisma.envelopePeriod.create({
        data: {
          id: randomUUID(),
          budgetId: ownBudgetId,
          envelopeId: foreignEnvelopeId,
          startsOn: new Date('2026-11-01T00:00:00Z'),
          endsOn: new Date('2026-11-30T00:00:00Z'),
        },
      }),
    ).rejects.toThrow();
  });

  it('keeps an untouched v1 budget on planModelVersion=1 after the additive migration', async () => {
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: otherBudgetId } });
    expect(budget.planModelVersion).toBe(1);
  });

  it('creates an envelope_funding_rule and a budget_cycle_revision for the budget', async () => {
    const rule = await prisma.envelopeFundingRule.create({
      data: {
        id: randomUUID(),
        budgetId: ownBudgetId,
        envelopeId: ownerEnvelopeId,
        type: 'FIXED_PER_PERIOD',
        priority: 1,
        fixedMinor: 5000n,
      },
    });
    expect(rule.type).toBe('FIXED_PER_PERIOD');

    const revision = await prisma.budgetCycleRevision.create({
      data: {
        id: randomUUID(),
        budgetId: ownBudgetId,
        effectiveOn: new Date('2026-10-01T00:00:00Z'),
        cycleStartDay: 15,
        periodBoundaryOffset: 15,
        timezone: 'Europe/Moscow',
      },
    });
    expect(revision.cycleStartDay).toBe(15);
  });
});

async function getOwnV1BudgetId(userId: string): Promise<string> {
  const membership = await prisma.workspaceMembership.findFirstOrThrow({
    where: { userId, isActive: true },
    select: { workspaceId: true },
  });
  const budget = await prisma.budget.findFirstOrThrow({
    where: { workspaceId: membership.workspaceId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return budget.id;
}

type OpenApiSchema = {
  $ref?: string;
};

type OpenApiResponse = {
  content?: Record<string, { schema?: OpenApiSchema }>;
};

type OpenApiOperation = {
  security?: Array<Record<string, string[]>>;
  responses?: Record<string, OpenApiResponse>;
};

type OpenApiDocument = {
  paths: Record<string, Partial<Record<'get' | 'post' | 'patch', OpenApiOperation>>>;
  components: {
    securitySchemes: Record<string, { type?: string; in?: string; name?: string }>;
    schemas: Record<string, OpenApiSchema>;
  };
};

async function createTestEnvelope(budgetId: string, name: string): Promise<string> {
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      name,
      envelopeType: 'CUSTOM',
      startingBalanceMinor: 0n,
      displayOrder: 900,
    },
  });
  return envelope.id;
}

async function register(email: string) {
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
  const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
  if (!cookie) throw new Error('Missing session cookie');
  return { ...body, cookie };
}

async function cleanupUser(userId: string) {
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
    await prisma.envelopePeriod.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeFundingRule.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budgetCycleRevision.deleteMany({ where: { budget: { workspaceId } } });
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

type F06Session = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
};

type F06Refs = {
  accounts: [string, string];
  incomeCategoryId: string;
  envelopes: [string, string];
};

async function registerF06(server: FastifyInstance, email: string): Promise<F06Session> {
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
  const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
  if (!cookie) throw new Error('Missing session cookie');
  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    cookie,
    csrfToken: body.csrfToken,
  };
}

async function createF06Refs(server: FastifyInstance, user: F06Session): Promise<F06Refs> {
  const post = async (url: string, payload: Record<string, unknown>) => {
    const response = await server.inject({
      method: 'POST',
      url,
      headers: { origin, 'x-csrf-token': user.csrfToken },
      cookies: { harmofin_session: user.cookie },
      payload,
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ id: string }>();
  };
  const tag = user.budgetId.slice(0, 8);
  const accountOne = await post(`/api/v1/budgets/${user.budgetId}/accounts`, {
    name: `F06 счёт ${tag} 1`,
    accountType: 'CASH',
    currency: 'RUB',
    startingBalance: '1000.00',
    accountingStartDate: '2026-09-01',
  });
  const accountTwo = await post(`/api/v1/budgets/${user.budgetId}/accounts`, {
    name: `F06 счёт ${tag} 2`,
    accountType: 'CASH',
    currency: 'RUB',
    startingBalance: '1000.00',
    accountingStartDate: '2026-09-01',
  });
  const incomeCategory = await post(`/api/v1/budgets/${user.budgetId}/categories`, {
    name: `F06 доход ${tag}`,
    categoryType: 'INCOME',
    displayOrder: 0,
  });
  const envelopeOne = await post(`/api/v1/budgets/${user.budgetId}/envelopes`, {
    name: `F06 конверт ${tag} 1`,
    envelopeType: 'CUSTOM',
    currency: 'RUB',
    startingBalance: '2000.00',
    displayOrder: 0,
  });
  const envelopeTwo = await post(`/api/v1/budgets/${user.budgetId}/envelopes`, {
    name: `F06 конверт ${tag} 2`,
    envelopeType: 'CUSTOM',
    currency: 'RUB',
    startingBalance: '2000.00',
    displayOrder: 0,
  });
  return {
    accounts: [accountOne.id, accountTwo.id],
    incomeCategoryId: incomeCategory.id,
    envelopes: [envelopeOne.id, envelopeTwo.id],
  };
}

async function cleanupF06User(userId: string, workspaceId: string) {
  await prisma.incomeAllocation.deleteMany({ where: { budget: { workspaceId } } });
  await prisma.transaction.deleteMany({ where: { budget: { workspaceId } } });
  await prisma.transferPart.deleteMany({ where: { transfer: { budget: { workspaceId } } } });
  await prisma.transfer.deleteMany({ where: { budget: { workspaceId } } });
  await prisma.envelopeReallocation.deleteMany({ where: { budget: { workspaceId } } });
  await prisma.idempotencyRecord.deleteMany({ where: { budget: { workspaceId } } });
  await cleanupUser(userId);
}

describe('v1 financial recordings are blocked for a budget on model version 2', () => {
  let blockApp: NestFastifyApplication;
  let blockServer: FastifyInstance;
  let blocked: F06Session;
  let blockedRefs: F06Refs;
  let control: F06Session;
  let controlRefs: F06Refs;
  let draftIncomeId: string;
  let deletedIncomeId: string;
  let confirmedIncomeId: string;
  let seedAllocationId: string;
  let seedTransferId: string;
  let seedReallocationId: string;

  beforeAll(async () => {
    blockApp = await createApiApp(
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
    await blockApp.init();
    blockServer = blockApp.getHttpAdapter().getInstance() as FastifyInstance;
    await blockServer.ready();

    blocked = await registerF06(blockServer, `v2-block-owner-${randomUUID()}@harmofin.test`);
    control = await registerF06(blockServer, `v2-block-control-${randomUUID()}@harmofin.test`);
    blockedRefs = await createF06Refs(blockServer, blocked);
    controlRefs = await createF06Refs(blockServer, control);
    await prisma.budget.update({
      where: { id: blocked.budgetId },
      data: { planModelVersion: 2, planModelActivatedOn: new Date('2026-09-29T00:00:00Z') },
    });

    draftIncomeId = (
      await prisma.transaction.create({
        data: {
          id: randomUUID(),
          budgetId: blocked.budgetId,
          transactionType: 'INCOME',
          status: 'DRAFT',
          amountMinor: 50_000n,
          occurredOn: new Date('2026-10-05T00:00:00Z'),
          accountId: blockedRefs.accounts[0],
          categoryId: blockedRefs.incomeCategoryId,
          createdByUserId: blocked.userId,
          updatedByUserId: blocked.userId,
        },
      })
    ).id;
    deletedIncomeId = (
      await prisma.transaction.create({
        data: {
          id: randomUUID(),
          budgetId: blocked.budgetId,
          transactionType: 'INCOME',
          status: 'DELETED',
          preDeleteStatus: 'DRAFT',
          amountMinor: 50_000n,
          occurredOn: new Date('2026-10-05T00:00:00Z'),
          accountId: blockedRefs.accounts[0],
          categoryId: blockedRefs.incomeCategoryId,
          deletedAt: new Date('2026-10-06T00:00:00Z'),
          createdByUserId: blocked.userId,
          updatedByUserId: blocked.userId,
        },
      })
    ).id;
    confirmedIncomeId = (
      await prisma.transaction.create({
        data: {
          id: randomUUID(),
          budgetId: blocked.budgetId,
          transactionType: 'INCOME',
          status: 'CONFIRMED',
          amountMinor: 100_000n,
          occurredOn: new Date('2026-10-05T00:00:00Z'),
          accountId: blockedRefs.accounts[0],
          categoryId: blockedRefs.incomeCategoryId,
          confirmedAt: new Date('2026-10-05T00:00:00Z'),
          createdByUserId: blocked.userId,
          updatedByUserId: blocked.userId,
        },
      })
    ).id;
    seedAllocationId = (
      await prisma.incomeAllocation.create({
        data: {
          id: randomUUID(),
          budgetId: blocked.budgetId,
          incomeTransactionId: confirmedIncomeId,
          status: 'CONFIRMED',
          amountMinor: 40_000n,
          occurredOn: new Date('2026-10-05T00:00:00Z'),
          accountId: blockedRefs.accounts[0],
          envelopeId: blockedRefs.envelopes[0],
          createdByUserId: blocked.userId,
          updatedByUserId: blocked.userId,
        },
      })
    ).id;
    seedTransferId = (
      await prisma.transfer.create({
        data: {
          id: randomUUID(),
          budgetId: blocked.budgetId,
          status: 'DRAFT',
          totalMinor: 100_000n,
          occurredOn: new Date('2026-10-05T00:00:00Z'),
          createdByUserId: blocked.userId,
          updatedByUserId: blocked.userId,
        },
      })
    ).id;
    await prisma.transferPart.create({
      data: {
        id: randomUUID(),
        transferId: seedTransferId,
        budgetId: blocked.budgetId,
        sourceAccountId: blockedRefs.accounts[0],
        destinationAccountId: blockedRefs.accounts[1],
        sourceEnvelopeId: blockedRefs.envelopes[0],
        destinationEnvelopeId: blockedRefs.envelopes[1],
        amountMinor: 100_000n,
      },
    });
    seedReallocationId = (
      await prisma.envelopeReallocation.create({
        data: {
          id: randomUUID(),
          budgetId: blocked.budgetId,
          status: 'CONFIRMED',
          sourceEnvelopeId: blockedRefs.envelopes[0],
          destinationEnvelopeId: blockedRefs.envelopes[1],
          amountMinor: 10_000n,
          occurredOn: new Date('2026-10-05T00:00:00Z'),
          createdByUserId: blocked.userId,
          updatedByUserId: blocked.userId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (blocked) await cleanupF06User(blocked.userId, blocked.workspaceId);
    if (control) await cleanupF06User(control.userId, control.workspaceId);
    if (blockApp) await blockApp.close();
    await prisma.$disconnect();
  });

  async function blockedMutation(
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    key: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    const response = await blockServer.inject({
      method,
      url,
      headers: { origin, 'x-csrf-token': blocked.csrfToken, 'Idempotency-Key': key },
      cookies: { harmofin_session: blocked.cookie },
      ...(payload === undefined ? {} : { payload }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'MODEL_VERSION_MISMATCH' });
  }

  it('blocks v1 transaction writes on a v2 budget and leaves the seeded rows untouched', async () => {
    await blockedMutation(
      'POST',
      `/api/v1/budgets/${blocked.budgetId}/transactions`,
      'f06-v2-transaction-create',
      {
        transactionType: 'INCOME',
        amount: '10.00',
        occurredOn: '2026-10-10',
        accountId: blockedRefs.accounts[0],
        categoryId: blockedRefs.incomeCategoryId,
      },
    );
    await blockedMutation(
      'PATCH',
      `/api/v1/budgets/${blocked.budgetId}/transactions/${draftIncomeId}`,
      'f06-v2-transaction-update',
      { amount: '60.00' },
    );
    await blockedMutation(
      'POST',
      `/api/v1/budgets/${blocked.budgetId}/transactions/${draftIncomeId}/confirm`,
      'f06-v2-transaction-confirm',
    );
    await blockedMutation(
      'POST',
      `/api/v1/budgets/${blocked.budgetId}/transactions/${draftIncomeId}/cancel`,
      'f06-v2-transaction-cancel',
    );
    await blockedMutation(
      'DELETE',
      `/api/v1/budgets/${blocked.budgetId}/transactions/${draftIncomeId}`,
      'f06-v2-transaction-delete',
    );
    await blockedMutation(
      'POST',
      `/api/v1/budgets/${blocked.budgetId}/transactions/${deletedIncomeId}/restore`,
      'f06-v2-transaction-restore',
    );
    await blockedMutation(
      'POST',
      `/api/v1/budgets/${blocked.budgetId}/transactions/${confirmedIncomeId}/delete-with-allocations`,
      'f06-v2-transaction-delete-with-allocations',
      { allocationResolution: 'DELETE' },
    );

    const transactions = await prisma.transaction.findMany({
      where: { budgetId: blocked.budgetId },
      select: { id: true, status: true, deletedAt: true },
    });
    expect(transactions).toHaveLength(3);
    const byId = new Map(transactions.map((row) => [row.id, row]));
    expect(byId.get(draftIncomeId)?.status).toBe('DRAFT');
    expect(byId.get(draftIncomeId)?.deletedAt).toBeNull();
    expect(byId.get(deletedIncomeId)?.status).toBe('DELETED');
    expect(byId.get(confirmedIncomeId)?.status).toBe('CONFIRMED');
  });

  it('blocks v1 transfer writes on a v2 budget and leaves the seeded transfer untouched', async () => {
    await blockedMutation(
      'POST',
      `/api/v1/budgets/${blocked.budgetId}/transfers`,
      'f06-v2-transfer-create',
      {
        status: 'DRAFT',
        total: '10.00',
        occurredOn: '2026-10-10',
        sourceAccountId: blockedRefs.accounts[0],
        destinationAccountId: blockedRefs.accounts[1],
        parts: [{ sourceEnvelopeId: blockedRefs.envelopes[0], amount: '10.00' }],
      },
    );
    await blockedMutation(
      'POST',
      `/api/v1/budgets/${blocked.budgetId}/transfers/${seedTransferId}/confirm`,
      'f06-v2-transfer-confirm',
    );
    await blockedMutation(
      'POST',
      `/api/v1/budgets/${blocked.budgetId}/transfers/${seedTransferId}/cancel`,
      'f06-v2-transfer-cancel',
    );
    await blockedMutation(
      'DELETE',
      `/api/v1/budgets/${blocked.budgetId}/transfers/${seedTransferId}`,
      'f06-v2-transfer-delete',
    );

    expect(await prisma.transfer.count({ where: { budgetId: blocked.budgetId } })).toBe(1);
    expect(await prisma.transferPart.count({ where: { budgetId: blocked.budgetId } })).toBe(1);
    const [transferRow] = await prisma.transfer.findMany({
      where: { id: seedTransferId },
      select: { status: true, deletedAt: true },
    });
    expect(transferRow?.status).toBe('DRAFT');
    expect(transferRow?.deletedAt).toBeNull();
  });

  it('blocks v1 income allocation writes on a v2 budget and leaves the seeded allocation untouched', async () => {
    await blockedMutation(
      'POST',
      `/api/v1/budgets/${blocked.budgetId}/transactions/${confirmedIncomeId}/allocations`,
      'f06-v2-allocation-create',
      {
        amount: '20.00',
        occurredOn: '2026-10-10',
        accountId: blockedRefs.accounts[0],
        envelopeId: blockedRefs.envelopes[0],
      },
    );
    await blockedMutation(
      'PATCH',
      `/api/v1/budgets/${blocked.budgetId}/allocations/${seedAllocationId}`,
      'f06-v2-allocation-update',
      { amount: '35.00' },
    );
    await blockedMutation(
      'DELETE',
      `/api/v1/budgets/${blocked.budgetId}/allocations/${seedAllocationId}`,
      'f06-v2-allocation-delete',
    );

    expect(await prisma.incomeAllocation.count({ where: { budgetId: blocked.budgetId } })).toBe(1);
    const [allocationRow] = await prisma.incomeAllocation.findMany({
      where: { id: seedAllocationId },
      select: { status: true, deletedAt: true },
    });
    expect(allocationRow?.status).toBe('CONFIRMED');
    expect(allocationRow?.deletedAt).toBeNull();
  });

  it('blocks v1 envelope reallocation writes on a v2 budget and leaves the seeded row untouched', async () => {
    await blockedMutation(
      'POST',
      `/api/v1/budgets/${blocked.budgetId}/envelope-reallocations`,
      'f06-v2-reallocation-create',
      {
        sourceEnvelopeId: blockedRefs.envelopes[0],
        destinationEnvelopeId: blockedRefs.envelopes[1],
        amount: '10.00',
        occurredOn: '2026-10-10',
      },
    );
    await blockedMutation(
      'DELETE',
      `/api/v1/budgets/${blocked.budgetId}/envelope-reallocations/${seedReallocationId}`,
      'f06-v2-reallocation-delete',
    );

    expect(await prisma.envelopeReallocation.count({ where: { budgetId: blocked.budgetId } })).toBe(
      1,
    );
    const [reallocationRow] = await prisma.envelopeReallocation.findMany({
      where: { id: seedReallocationId },
      select: { status: true, deletedAt: true },
    });
    expect(reallocationRow?.status).toBe('CONFIRMED');
    expect(reallocationRow?.deletedAt).toBeNull();
  });

  it('keeps v1 financial recordings working on a model-1 budget', async () => {
    const post = async (url: string, key: string, payload: Record<string, unknown>) => {
      const response = await blockServer.inject({
        method: 'POST',
        url,
        headers: { origin, 'x-csrf-token': control.csrfToken, 'Idempotency-Key': key },
        cookies: { harmofin_session: control.cookie },
        payload,
      });
      expect(response.statusCode).toBe(201);
      return response.json<{ id: string }>();
    };

    await post(`/api/v1/budgets/${control.budgetId}/transactions`, 'f06-v1-income-draft', {
      transactionType: 'INCOME',
      status: 'DRAFT',
      amount: '10.00',
      occurredOn: '2026-10-10',
      accountId: controlRefs.accounts[0],
      categoryId: controlRefs.incomeCategoryId,
    });
    const confirmed = await post(
      `/api/v1/budgets/${control.budgetId}/transactions`,
      'f06-v1-income-confirmed',
      {
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        amount: '200.00',
        occurredOn: '2026-10-10',
        accountId: controlRefs.accounts[0],
        categoryId: controlRefs.incomeCategoryId,
      },
    );
    await post(
      `/api/v1/budgets/${control.budgetId}/transactions/${confirmed.id}/allocations`,
      'f06-v1-allocation',
      {
        amount: '50.00',
        occurredOn: '2026-10-10',
        accountId: controlRefs.accounts[0],
        envelopeId: controlRefs.envelopes[0],
      },
    );
    await post(`/api/v1/budgets/${control.budgetId}/transfers`, 'f06-v1-transfer', {
      status: 'DRAFT',
      total: '100.00',
      occurredOn: '2026-10-10',
      sourceAccountId: controlRefs.accounts[0],
      destinationAccountId: controlRefs.accounts[1],
      parts: [{ sourceEnvelopeId: controlRefs.envelopes[0], amount: '100.00' }],
    });
    await post(`/api/v1/budgets/${control.budgetId}/envelope-reallocations`, 'f06-v1-reallocation', {
      sourceEnvelopeId: controlRefs.envelopes[0],
      destinationEnvelopeId: controlRefs.envelopes[1],
      amount: '50.00',
      occurredOn: '2026-10-10',
    });
  });
});
