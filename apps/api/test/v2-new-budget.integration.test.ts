import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { todayInTimezone } from '../src/cycles/cycle-period.domain.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const email = `v2-new-budget-${randomUUID()}@harmofin.test`;

let app: NestFastifyApplication;
let server: FastifyInstance;
let userId = '';
let workspaceId = '';
let budgetId = '';
let cookie = '';
let csrfToken = '';
let legacyBudgetId = '';
let createdBudgetId = '';

describe('M04: new budgets are created in plan model 2', () => {
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
    if (userId) {
      await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.workspaceMembership.deleteMany({ where: { userId } });
      if (workspaceId) {
        await prisma.budget.deleteMany({ where: { workspaceId } });
        await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      }
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('registers a user with a model 2 budget activated today in the budget timezone', async () => {
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
    userId = body.user.id;
    workspaceId = body.workspace.id;
    budgetId = body.budget.id;
    csrfToken = body.csrfToken;
    cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value ?? '';
    expect(cookie).not.toBe('');

    const row = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
    expect(row.planModelVersion).toBe(2);
    expect(row.planModelActivatedOn).not.toBeNull();
    expect(row.planModelActivatedOn?.toISOString().slice(0, 10)).toBe(
      todayInTimezone(new Date(), row.timezone),
    );
  });

  it('shows the version in /api/v1/me', async () => {
    const me = await server.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { origin },
      cookies: { harmofin_session: cookie },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json<{
      workspaces: Array<{ budgets: Array<{ id: string; planModelVersion: number }> }>;
    }>();
    expect(body.workspaces[0]?.budgets[0]?.planModelVersion).toBe(2);
  });

  it('keeps categories and envelopes empty until a template is applied', async () => {
    expect(await prisma.category.count({ where: { budgetId } })).toBe(0);
    expect(await prisma.envelope.count({ where: { budgetId } })).toBe(0);
  });

  it('creates a model 2 budget through POST in an existing workspace', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/budgets`,
      headers: { origin, 'x-csrf-token': csrfToken },
      cookies: { harmofin_session: cookie },
      payload: { name: 'Второй бюджет' },
    });
    expect(response.statusCode).toBe(201);
    createdBudgetId = response.json<{ id: string }>().id;
    const row = await prisma.budget.findUniqueOrThrow({ where: { id: createdBudgetId } });
    expect(row.planModelVersion).toBe(2);
    expect(row.planModelActivatedOn?.toISOString().slice(0, 10)).toBe(
      todayInTimezone(new Date(), row.timezone),
    );
    expect(await prisma.category.count({ where: { budgetId: createdBudgetId } })).toBe(0);
    expect(await prisma.envelope.count({ where: { budgetId: createdBudgetId } })).toBe(0);
  });

  it('does not rewrite a pre-existing model 1 budget', async () => {
    const legacy = await prisma.budget.create({
      data: { id: randomUUID(), workspaceId, name: 'Legacy v1', planModelVersion: 1 },
    });
    legacyBudgetId = legacy.id;
    await server.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { origin },
      cookies: { harmofin_session: cookie },
    });
    const row = await prisma.budget.findUniqueOrThrow({ where: { id: legacyBudgetId } });
    expect(row.planModelVersion).toBe(1);
    expect(row.planModelActivatedOn).toBeNull();
  });

  it('rejects model 2 without an activation date at the database level', async () => {
    await expect(
      prisma.budget.create({
        data: { id: randomUUID(), workspaceId, name: 'Broken v2', planModelVersion: 2 },
      }),
    ).rejects.toThrow();
  });

  it('defaults the column to 2 without a default for the activation date', async () => {
    const rows = await prisma.$queryRaw<
      Array<{ column_name: string; column_default: string | null }>
    >`SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name = 'budgets' AND column_name IN ('plan_model_version', 'plan_model_activated_on')`;
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r.column_default]));
    expect(byName.plan_model_version).toBe('2');
    expect(byName.plan_model_activated_on).toBeNull();
  });
});
