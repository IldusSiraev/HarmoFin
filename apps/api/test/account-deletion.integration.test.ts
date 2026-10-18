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
const password = 'correct-password-10';
const tokenSecret = 'test-only-secret-with-at-least-32-bytes';
const DAY_MS = 86_400_000;

type Fixture = {
  email: string;
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
const createdUserIds: string[] = [];

async function register(prefix: string): Promise<Fixture> {
  const email = `${prefix}-${randomUUID()}@harmofin.test`;
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
  const cookie = decodeURIComponent(/harmofin_session=([^;]+)/.exec(setCookie)?.[1] ?? '');
  createdUserIds.push(body.user.id);
  return {
    email,
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    cookie,
    csrfToken: body.csrfToken,
  };
}

function requestDeletion(fixture: Fixture, body: object, withCsrf = true) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/me/deletion',
    headers: {
      origin,
      cookie: `harmofin_session=${encodeURIComponent(fixture.cookie)}`,
      ...(withCsrf ? { 'x-csrf-token': fixture.csrfToken } : {}),
    },
    payload: body,
  });
}

function login(fixture: Fixture) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email: fixture.email, password },
  });
}

describe('account deletion', () => {
  beforeAll(async () => {
    app = await createApiApp(
      loadApiConfig({
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        WEB_ORIGIN: origin,
        AUTH_TOKEN_HASH_SECRET: tokenSecret,
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
    // TODO(Task 5): replace with worker purgeUserData() once apps/worker/src/account-purge.ts exists.
    for (const userId of createdUserIds) {
      await prisma.accountDeletion.deleteMany({ where: { userId } });
      await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.recoveryToken.deleteMany({ where: { userId } });
      const memberships = await prisma.workspaceMembership.findMany({
        where: { userId },
        select: { workspaceId: true },
      });
      await prisma.workspaceMembership.deleteMany({ where: { userId } });
      try {
        for (const { workspaceId } of memberships) {
          await prisma.budget.deleteMany({ where: { workspaceId } });
          await prisma.workspace.deleteMany({ where: { id: workspaceId } });
        }
        await prisma.user.deleteMany({ where: { id: userId } });
      } catch {
        // Budgets own child rows (categories/envelopes/etc.) with restrictive FKs; leaving
        // the workspace/budget/user rows behind is acceptable for this temporary cleanup.
      }
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('documents both endpoints in OpenAPI', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<string, unknown>;
    }>();
    expect(document.paths['/api/v1/me/deletion']).toMatchObject({ post: expect.any(Object) });
    expect(document.paths['/api/v1/auth/deletion/cancel']).toMatchObject({ post: expect.any(Object) });
  });

  it('rejects a wrong password with a field error and keeps the account', async () => {
    const fixture = await register('del-wrong');
    const response = await requestDeletion(fixture, { password: 'wrong-password-10' });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'CURRENT_PASSWORD_INVALID',
      fieldErrors: [expect.objectContaining({ field: 'password' })],
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).status).toBe(
      'ACTIVE',
    );
  });

  it('requires CSRF', async () => {
    const fixture = await register('del-csrf');
    const response = await requestDeletion(fixture, { password }, false);

    expect(response.statusCode).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).status).toBe(
      'ACTIVE',
    );
  });

  it('refuses while an owned workspace has another active member', async () => {
    const owner = await register('del-owner');
    const member = await register('del-member');
    await prisma.workspaceMembership.create({
      data: { id: randomUUID(), workspaceId: owner.workspaceId, userId: member.userId, role: 'EDITOR' },
    });

    const response = await requestDeletion(owner, { password });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'ACCOUNT_DELETION_HAS_MEMBERS' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } })).status).toBe(
      'ACTIVE',
    );
    await prisma.workspaceMembership.deleteMany({
      where: { workspaceId: owner.workspaceId, userId: member.userId },
    });
  });

  it('closes access at once and schedules the purge in 30 days', async () => {
    const fixture = await register('del-ok');
    const before = Date.now();
    const response = await requestDeletion(fixture, { password });

    expect(response.statusCode).toBe(202);
    const purgeAfter = new Date(response.json<{ purgeAfter: string }>().purgeAfter).getTime();
    expect(purgeAfter).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(purgeAfter).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS);
    expect(String(response.headers['set-cookie'])).toMatch(/harmofin_session=;/);

    const me = await server.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `harmofin_session=${encodeURIComponent(fixture.cookie)}` },
    });
    expect(me.statusCode).toBe(401);
    expect((await login(fixture)).statusCode).toBe(401);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });
    expect(user.status).toBe('PENDING_DELETION');
    expect(
      (await prisma.workspace.findUniqueOrThrow({ where: { id: fixture.workspaceId } })).status,
    ).toBe('ARCHIVED');
    expect(
      (await prisma.budget.findUniqueOrThrow({ where: { id: fixture.budgetId } })).status,
    ).toBe('ARCHIVED');
    expect(await prisma.session.count({ where: { userId: fixture.userId, revokedAt: null } })).toBe(
      0,
    );
    expect(
      await prisma.session.count({
        where: { userId: fixture.userId, revokedReason: 'ACCOUNT_DELETED' },
      }),
    ).toBeGreaterThan(0);
    const deletion = await prisma.accountDeletion.findFirstOrThrow({
      where: { userId: fixture.userId },
    });
    expect(deletion).toMatchObject({
      archivedWorkspaceIds: [fixture.workspaceId],
      archivedBudgetIds: [fixture.budgetId],
      restoredAt: null,
      purgedAt: null,
    });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { actorUserId: fixture.userId, action: 'ACCOUNT_DELETION_REQUESTED' },
    });
    expect(JSON.stringify(audit.newValues)).not.toContain(fixture.email);
  });
});
