import { createHmac, randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const email = `auth-${randomUUID()}@harmofin.test`;
const password = 'correct-password-10';
const origin = 'http://localhost:3000';

let app: NestFastifyApplication;
let server: FastifyInstance;
let userId: string | undefined;

describe('auth API', () => {
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
      await prisma.recoveryToken.deleteMany({ where: { userId } });
      const memberships = await prisma.workspaceMembership.findMany({
        where: { userId },
        select: { workspaceId: true },
      });
      await prisma.workspaceMembership.deleteMany({ where: { userId } });
      for (const { workspaceId } of memberships) {
        await prisma.budget.deleteMany({ where: { workspaceId } });
        await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      }
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('documents auth and me paths in OpenAPI', async () => {
    const response = await server.inject({ method: 'GET', url: '/openapi.json' });
    const document = response.json<{
      paths: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    }>();

    expect(response.statusCode).toBe(200);
    expect(document.paths['/api/v1/auth/register']).toBeDefined();
    expect(document.paths['/api/v1/auth/login']).toBeDefined();
    expect(document.paths['/api/v1/auth/recovery/request']).toBeDefined();
    expect(document.paths['/api/v1/auth/recovery/confirm']).toBeDefined();
    expect(document.paths['/api/v1/auth/sessions']).toBeDefined();
    expect(document.paths['/api/v1/me']).toMatchObject({
      get: expect.any(Object),
      patch: expect.any(Object),
    });
    expect(document.paths['/api/v1/invitations/preview']).toMatchObject({
      post: { responses: { '200': expect.any(Object), '404': expect.any(Object) } },
    });
    expect(document.paths['/api/v1/invitations/preview']).not.toHaveProperty('post.security');
    expect(document.paths['/api/v1/invitations/accept']).toMatchObject({
      post: { responses: { '200': expect.any(Object), '422': expect.any(Object) } },
    });
    expect(document.paths['/api/v1/auth/register']).toMatchObject({
      post: {
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } },
          },
        },
        responses: {
          '201': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AuthSessionResponse' } },
            },
          },
        },
      },
    });
    expect(document.components?.schemas).toMatchObject({
      RegisterRequest: expect.any(Object),
      AuthSessionResponse: expect.any(Object),
      ProblemDetailsResponse: expect.any(Object),
    });
  });

  it('registers atomically, exposes safe data, and sets an HttpOnly session cookie', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: {
        email,
        password,
        workspaceName: 'Тестовое пространство',
        budgetName: 'Тестовый бюджет',
      },
    });
    const body = response.json<{
      user: { id: string };
      csrfToken: string;
      workspace: { id: string };
      budget: { id: string };
    }>();
    userId = body.user.id;

    expect(response.statusCode).toBe(201);
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Lax');
    expect(response.headers['set-cookie']).not.toContain('Secure');
    expect(body.csrfToken).toEqual(expect.any(String));
    expect(response.body).not.toContain('password');
    expect(response.body).not.toContain('tokenHash');
    expect(
      await prisma.workspaceMembership.findFirst({
        where: { userId, role: 'OWNER', isActive: true },
      }),
    ).not.toBeNull();
    expect(await prisma.budget.findUnique({ where: { id: body.budget.id } })).not.toBeNull();
  });

  it('rejects duplicate emails and invalid credentials without revealing password state', async () => {
    const duplicate = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email, password },
    });
    const wrongPassword = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { email, password: 'wrong-password' },
    });
    const missingUser = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { email: `missing-${randomUUID()}@harmofin.test`, password },
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
    expect(wrongPassword.statusCode).toBe(401);
    expect(missingUser.statusCode).toBe(401);
    expect(wrongPassword.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(missingUser.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('exposes planModelVersion per budget in /me and follows the stored model', async () => {
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { email, password },
    });
    const cookie = login.cookies.find((item) => item.name === 'harmofin_session')?.value ?? '';
    type MeBody = {
      workspaces: Array<{ budgets: Array<{ id: string; planModelVersion: number }> }>;
    };
    const readBudgets = async () => {
      const me = await server.inject({
        method: 'GET',
        url: '/api/v1/me',
        cookies: { harmofin_session: cookie },
      });
      expect(me.statusCode).toBe(200);
      return me.json<MeBody>().workspaces.flatMap((workspace) => workspace.budgets);
    };

    const before = await readBudgets();
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((budget) => budget.planModelVersion === 2)).toBe(true);

    const budgetId = before[0]?.id ?? '';
    await prisma.budget.update({ where: { id: budgetId }, data: { planModelVersion: 1 } });
    try {
      const after = await readBudgets();
      expect(after.find((budget) => budget.id === budgetId)?.planModelVersion).toBe(1);
    } finally {
      await prisma.budget.update({ where: { id: budgetId }, data: { planModelVersion: 2 } });
    }
  });

  it('updates the display name via PATCH /me with CSRF and reports creator access in /me', async () => {
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { email, password },
    });
    const cookie = login.cookies.find((item) => item.name === 'harmofin_session')?.value ?? '';
    const { csrfToken, workspace } = login.json<{ csrfToken: string; workspace: { id: string } }>();

    const withoutCsrf = await server.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { origin },
      cookies: { harmofin_session: cookie },
      payload: { displayName: 'Ильдар' },
    });
    expect(withoutCsrf.statusCode).toBe(403);

    const invalid = await server.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { origin, 'x-csrf-token': csrfToken },
      cookies: { harmofin_session: cookie },
      payload: { displayName: '   ' },
    });
    expect(invalid.statusCode).toBe(400);

    const updated = await server.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { origin, 'x-csrf-token': csrfToken },
      cookies: { harmofin_session: cookie },
      payload: { displayName: '  Ильдар Заметный ' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({
      user: { id: userId, email, displayName: 'Ильдар Заметный' },
    });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { actorUserId: userId ?? '', action: 'PROFILE_UPDATED' },
    });
    expect(JSON.stringify(audit)).not.toContain('Ильдар');

    const me = await server.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: { harmofin_session: cookie },
    });
    const body = me.json<{
      user: { displayName: string };
      activeWorkspaceId: string;
      workspaces: Array<{ id: string; isCreator: boolean }>;
    }>();
    expect(body.user.displayName).toBe('Ильдар Заметный');
    expect(body.activeWorkspaceId).toBe(workspace.id);
    expect(body.workspaces).toEqual([expect.objectContaining({ id: workspace.id, isCreator: true })]);
  });

  it('requires CSRF for logout and revokes session after valid logout', async () => {
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { email, password },
    });
    const cookie = login.cookies.find((item) => item.name === 'harmofin_session');
    const csrfToken = login.json<{ csrfToken: string }>().csrfToken;

    expect(cookie?.value).toEqual(expect.any(String));
    const me = await server.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: { harmofin_session: cookie?.value ?? '' },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { id: userId } });

    const blocked = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin },
      cookies: { harmofin_session: cookie?.value ?? '' },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: 'CSRF_INVALID' });

    const logout = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin, 'x-csrf-token': csrfToken },
      cookies: { harmofin_session: cookie?.value ?? '' },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers['set-cookie']).toContain('harmofin_session=;');

    const invalid = await server.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: { harmofin_session: cookie?.value ?? '' },
    });
    expect(invalid.statusCode).toBe(401);

    const repeatedLogout = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin },
      cookies: { harmofin_session: cookie?.value ?? '' },
    });
    expect(repeatedLogout.statusCode).toBe(204);
  });

  it('lists, revokes one, and revokes all sessions without exposing token material', async () => {
    const firstLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { email, password },
    });
    const firstCookie = firstLogin.cookies.find((item) => item.name === 'harmofin_session')?.value;
    const firstCsrf = firstLogin.json<{ csrfToken: string }>().csrfToken;
    const secondLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { email, password },
    });
    const secondCookie = secondLogin.cookies.find(
      (item) => item.name === 'harmofin_session',
    )?.value;

    const sessions = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      cookies: { harmofin_session: firstCookie ?? '' },
    });
    const views = sessions.json<Array<{ id: string }>>();
    const secondSessionId = secondCookie
      ? await prisma.session
          .findUnique({
            where: {
              tokenHash: createHmac('sha256', 'test-only-secret-with-at-least-32-bytes')
                .update(secondCookie)
                .digest('hex'),
            },
            select: { id: true },
          })
          .then((session) => session?.id)
      : undefined;

    expect(sessions.statusCode).toBe(200);
    expect(sessions.body).not.toContain('tokenHash');
    expect(views.length).toBeGreaterThanOrEqual(2);
    expect(secondSessionId).toEqual(expect.any(String));

    const revokeOne = await server.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${secondSessionId}`,
      headers: { origin, 'x-csrf-token': firstCsrf },
      cookies: { harmofin_session: firstCookie ?? '' },
    });
    expect(revokeOne.statusCode).toBe(204);

    const revokedSession = await server.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: { harmofin_session: secondCookie ?? '' },
    });
    expect(revokedSession.statusCode).toBe(401);

    const revokeAll = await server.inject({
      method: 'DELETE',
      url: '/api/v1/auth/sessions',
      headers: { origin, 'x-csrf-token': firstCsrf },
      cookies: { harmofin_session: firstCookie ?? '' },
    });
    expect(revokeAll.statusCode).toBe(204);

    const currentSession = await server.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: { harmofin_session: firstCookie ?? '' },
    });
    expect(currentSession.statusCode).toBe(401);
  });
});
