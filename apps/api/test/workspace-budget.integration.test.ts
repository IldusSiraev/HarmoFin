import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const ownerEmail = `owner-${randomUUID()}@harmofin.test`;
const otherEmail = `other-${randomUUID()}@harmofin.test`;
const password = 'correct-password-10';

let app: NestFastifyApplication;
let server: FastifyInstance;
let ownerId: string;
let otherId: string;
let ownerCookie: string;
let ownerCsrf: string;
let ownerWorkspaceId: string;
let ownerBudgetId: string;

describe('workspace and budget API isolation', () => {
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
    ownerWorkspaceId = owner.workspace.id;
    ownerBudgetId = owner.budget.id;
    ownerCookie = owner.cookie;
    ownerCsrf = owner.csrfToken;
    const other = await register(otherEmail);
    otherId = other.user.id;
  });

  afterAll(async () => {
    for (const userId of [ownerId, otherId].filter((id): id is string => Boolean(id))) {
      await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.recoveryToken.deleteMany({ where: { userId } });
      const memberships = await prisma.workspaceMembership.findMany({
        where: { userId },
        select: { workspaceId: true },
      });
      await prisma.workspaceMembership.deleteMany({ where: { userId } });
      for (const { workspaceId } of memberships) {
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
    await app.close();
    await prisma.$disconnect();
  });

  it('documents protected workspace and budget paths in OpenAPI', async () => {
    const response = await server.inject({ method: 'GET', url: '/openapi.json' });
    const document = response.json<{ paths: Record<string, unknown> }>();

    expect(document.paths['/api/v1/workspaces']).toMatchObject({
      post: {
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateWorkspaceRequest' } },
          },
        },
      },
    });
    expect(document.paths['/api/v1/workspaces/{workspaceId}/budgets']).toMatchObject({
      post: {
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateBudgetRequest' } },
          },
        },
      },
    });
  });

  it('lists only workspaces where active membership exists', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      cookies: { harmofin_session: ownerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ownerWorkspaceId, role: 'OWNER' })]),
    );
  });

  it('creates workspace, OWNER membership, first budget, and audit event atomically', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { origin, 'x-csrf-token': ownerCsrf },
      cookies: { harmofin_session: ownerCookie },
      payload: { workspaceName: 'Второе пространство', budgetName: 'Второй бюджет' },
    });
    const body = response.json<{ id: string; budget: { id: string } }>();

    expect(response.statusCode).toBe(201);
    expect(
      await prisma.workspaceMembership.findFirst({
        where: { userId: ownerId, workspaceId: body.id, role: 'OWNER' },
      }),
    ).not.toBeNull();
    expect(
      await prisma.budget.findFirst({ where: { id: body.budget.id, workspaceId: body.id } }),
    ).not.toBeNull();
    expect(
      await prisma.auditEvent.findFirst({
        where: { actorUserId: ownerId, workspaceId: body.id, action: 'CREATED' },
      }),
    ).not.toBeNull();
  });

  it('defaults a new budget to a calendar-month cycle', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ownerBudgetId}`,
      cookies: { harmofin_session: ownerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      cycleStartDay: 1,
      periodBoundaryOffset: 15,
    });
  });

  it('returns 404 rather than revealing another user workspace or budget', async () => {
    const other = await login(otherEmail);
    const workspaceBudgets = await server.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${ownerWorkspaceId}/budgets`,
      cookies: { harmofin_session: other.cookie },
    });
    const budget = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ownerBudgetId}`,
      cookies: { harmofin_session: other.cookie },
    });

    expect(workspaceBudgets.statusCode).toBe(404);
    expect(budget.statusCode).toBe(404);
    expect(workspaceBudgets.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(budget.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('returns 403 for an accessible EDITOR mutation', async () => {
    await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'EDITOR' },
    });

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${ownerWorkspaceId}/budgets`,
      headers: { origin, 'x-csrf-token': ownerCsrf },
      cookies: { harmofin_session: ownerCookie },
      payload: { name: 'Недоступный бюджет' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
    await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'OWNER' },
    });
  });
  it('does not expose archived budgets and workspaces', async () => {
    await prisma.budget.update({ where: { id: ownerBudgetId }, data: { status: 'ARCHIVED' } });

    try {
      const budget = await server.inject({
        method: 'GET',
        url: `/api/v1/budgets/${ownerBudgetId}`,
        cookies: { harmofin_session: ownerCookie },
      });
      expect(budget.statusCode).toBe(404);
    } finally {
      await prisma.budget.update({ where: { id: ownerBudgetId }, data: { status: 'ACTIVE' } });
    }

    await prisma.workspace.update({
      where: { id: ownerWorkspaceId },
      data: { status: 'ARCHIVED' },
    });

    try {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${ownerWorkspaceId}/budgets`,
        cookies: { harmofin_session: ownerCookie },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    } finally {
      await prisma.workspace.update({
        where: { id: ownerWorkspaceId },
        data: { status: 'ACTIVE' },
      });
    }
  });
});

async function register(email: string) {
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
  return { ...body, cookie };
}

async function login(email: string) {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email, password },
  });
  const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
  if (!cookie) throw new Error('Missing session cookie');
  return { cookie };
}
