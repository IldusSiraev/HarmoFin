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
const ownerEmail = `v2-foundation-owner-${randomUUID()}@harmofin.test`;
const otherEmail = `v2-foundation-other-${randomUUID()}@harmofin.test`;

let app: NestFastifyApplication;
let server: FastifyInstance;
let ownerId: string;
let otherId: string;
let ownerCookie: string;
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

  it('answers 401 without a session, and 404 for a foreign budget', async () => {
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
  });

  it('cannot persist a v2 budget without planModelActivatedOn (database CHECK, M04)', async () => {
    const budgetId = await getOwnBudgetId(ownerId);
    await expect(
      prisma.budget.update({
        where: { id: budgetId },
        data: { planModelVersion: 2, planModelActivatedOn: null },
      }),
    ).rejects.toThrow();
  });

  it('returns the current model for an activated v2 budget', async () => {
    const budgetId = await getOwnBudgetId(ownerId);
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

async function getOwnBudgetId(userId: string): Promise<string> {
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
