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

type User = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  csrfToken: string;
  cookie: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
const createdUsers: string[] = [];

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
});

afterAll(async () => {
  for (const userId of createdUsers) await cleanupUser(userId);
  await app.close();
  await prisma.$disconnect();
});

describe('v2 onboarding: no mandatory plans', () => {
  it('OWNER: 204, колонка задана, одно audit-событие, дашборд видит флаг', async () => {
    const owner = await register('owner');
    const key = randomUUID();

    const first = await decline(owner, owner.budgetId, key);
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe('');

    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: owner.budgetId } });
    expect(budget.onboardingNoMandatoryPlansAt).toBeInstanceOf(Date);
    const audit = await prisma.auditEvent.findMany({
      where: { budgetId: owner.budgetId, entityType: 'budget_onboarding' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityId: owner.budgetId,
      action: 'MANDATORY_PLANS_DECLINED',
      source: 'API',
      actorUserId: owner.userId,
    });

    const dashboard = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${owner.budgetId}/dashboard`,
      headers: authHeaders(owner),
    });
    expect(dashboard.statusCode).toBe(200);
    expect(
      dashboard.json<{ onboarding: { mandatoryPlansDeclined: boolean } }>().onboarding
        .mandatoryPlansDeclined,
    ).toBe(true);
  });

  it('повтор тем же и другим ключом: 204, момент не меняется, второго audit нет', async () => {
    const owner = await register('repeat');
    const key = randomUUID();
    expect((await decline(owner, owner.budgetId, key)).statusCode).toBe(204);
    const stored = (await prisma.budget.findUniqueOrThrow({ where: { id: owner.budgetId } }))
      .onboardingNoMandatoryPlansAt;

    expect((await decline(owner, owner.budgetId, key)).statusCode).toBe(204);
    expect((await decline(owner, owner.budgetId, randomUUID())).statusCode).toBe(204);

    const after = await prisma.budget.findUniqueOrThrow({ where: { id: owner.budgetId } });
    expect(after.onboardingNoMandatoryPlansAt?.toISOString()).toBe(stored?.toISOString());
    expect(
      await prisma.auditEvent.count({
        where: { budgetId: owner.budgetId, entityType: 'budget_onboarding' },
      }),
    ).toBe(1);
  });

  it('EDITOR и VIEWER: 403 без записи', async () => {
    const owner = await register('roles-owner');
    for (const role of ['EDITOR', 'VIEWER'] as const) {
      const member = await register(`roles-${role.toLowerCase()}`);
      await prisma.workspaceMembership.create({
        data: { id: randomUUID(), workspaceId: owner.workspaceId, userId: member.userId, role },
      });
      const response = await decline(member, owner.budgetId, randomUUID());
      expect(response.statusCode, role).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('FORBIDDEN');
    }
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: owner.budgetId } });
    expect(budget.onboardingNoMandatoryPlansAt).toBeNull();
  });

  it('чужой бюджет: 404, бюджет B не меняется', async () => {
    const a = await register('isolation-a');
    const b = await register('isolation-b');
    const response = await decline(a, b.budgetId, randomUUID());
    expect(response.statusCode).toBe(404);
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: b.budgetId } });
    expect(budget.onboardingNoMandatoryPlansAt).toBeNull();
  });

  it('бюджет v1: 409 MODEL_VERSION_MISMATCH', async () => {
    const owner = await register('v1');
    await prisma.budget.update({
      where: { id: owner.budgetId },
      data: { planModelVersion: 1, planModelActivatedOn: null },
    });
    const response = await decline(owner, owner.budgetId, randomUUID());
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('MODEL_VERSION_MISMATCH');
  });

  it('без сессии 401, без CSRF 403, без ключа 400', async () => {
    const owner = await register('guards');
    const url = `/api/v2/budgets/${owner.budgetId}/onboarding/no-mandatory-plans`;
    const noSession = await server.inject({ method: 'POST', url, headers: { origin } });
    expect(noSession.statusCode).toBe(401);
    const noCsrf = await server.inject({
      method: 'POST',
      url,
      headers: { ...authHeaders(owner), 'idempotency-key': randomUUID() },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json<{ code: string }>().code).toBe('CSRF_INVALID');
    const noKey = await server.inject({
      method: 'POST',
      url,
      headers: { ...authHeaders(owner), 'x-csrf-token': owner.csrfToken },
    });
    expect(noKey.statusCode).toBe(400);
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: owner.budgetId } });
    expect(budget.onboardingNoMandatoryPlansAt).toBeNull();
  });

  it('OpenAPI описывает маршрут: 204, ошибки, cookie, Idempotency-Key', async () => {
    const openApi = await server.inject({ method: 'GET', url: '/openapi.json' });
    const document = openApi.json<{
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    }>();
    const operation =
      document.paths['/api/v2/budgets/{budgetId}/onboarding/no-mandatory-plans']?.post;
    expect(operation).toBeDefined();
    for (const code of ['204', '400', '401', '403', '404', '409']) {
      expect(operation!.responses[code], code).toBeDefined();
    }
    const text = JSON.stringify(operation);
    expect(text).toContain('session');
    expect(text).toContain('Idempotency-Key');
  });
});

function authHeaders(who: User): Record<string, string> {
  return { origin, cookie: `harmofin_session=${who.cookie}` };
}

function decline(as: User, budgetId: string, key: string) {
  return server.inject({
    method: 'POST',
    url: `/api/v2/budgets/${budgetId}/onboarding/no-mandatory-plans`,
    headers: { ...authHeaders(as), 'x-csrf-token': as.csrfToken, 'idempotency-key': key },
  });
}

async function register(label: string): Promise<User> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email: `v2-onb-${label}-${randomUUID()}@harmofin.test`, password },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{
    user: { id: string };
    workspace: { id: string };
    budget: { id: string };
    csrfToken: string;
  }>();
  createdUsers.push(body.user.id);
  const raw = response.headers['set-cookie'];
  const setCookie = Array.isArray(raw) ? raw.join('; ') : (raw ?? '');
  const match = /harmofin_session=([^;]+)/.exec(setCookie);
  expect(match).not.toBeNull();
  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    csrfToken: body.csrfToken,
    cookie: decodeURIComponent(match![1]!),
  };
}

async function cleanupUser(userId: string): Promise<void> {
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    select: { workspaceId: true },
  });
  await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.recoveryToken.deleteMany({ where: { userId } });
  for (const { workspaceId } of memberships) {
    const where = { budget: { workspaceId } };
    await prisma.auditEvent.deleteMany({ where: { workspaceId } });
    await prisma.idempotencyRecord.deleteMany({ where });
    await prisma.envelopePeriod.deleteMany({ where });
    await prisma.envelopeFundingRule.deleteMany({ where });
    await prisma.budgetCycleRevision.deleteMany({ where });
    await prisma.account.deleteMany({ where });
    await prisma.category.deleteMany({ where });
    await prisma.envelope.deleteMany({ where });
  }
  await prisma.workspaceMembership.deleteMany({ where: { userId } });
  for (const { workspaceId } of memberships) {
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId } });
    await prisma.budget.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}
