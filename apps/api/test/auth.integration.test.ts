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
const email = `auth-${randomUUID()}@harmofin.test`;
const password = 'correct-password-10';
const origin = 'http://localhost:3000';

let app: NestFastifyApplication;
let server: FastifyInstance;
let userId: string | undefined;

describe('auth API', () => {
  beforeAll(async () => {
    app = await createApiApp(loadApiConfig({
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
    }));
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();
  });

  afterAll(async () => {
    if (userId) {
      await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.recoveryToken.deleteMany({ where: { userId } });
      const memberships = await prisma.workspaceMembership.findMany({ where: { userId }, select: { workspaceId: true } });
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

  it('registers atomically, exposes safe data, and sets an HttpOnly session cookie', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email, password, workspaceName: 'Тестовое пространство', budgetName: 'Тестовый бюджет' },
    });
    const body = response.json<{ user: { id: string }; csrfToken: string; workspace: { id: string }; budget: { id: string } }>();
    userId = body.user.id;

    expect(response.statusCode).toBe(201);
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Lax');
    expect(response.headers['set-cookie']).not.toContain('Secure');
    expect(body.csrfToken).toEqual(expect.any(String));
    expect(response.body).not.toContain('password');
    expect(response.body).not.toContain('tokenHash');
    expect(await prisma.workspaceMembership.findFirst({ where: { userId, role: 'OWNER', isActive: true } })).not.toBeNull();
    expect(await prisma.budget.findUnique({ where: { id: body.budget.id } })).not.toBeNull();
  });

  it('rejects duplicate emails and invalid credentials without revealing password state', async () => {
    const duplicate = await server.inject({ method: 'POST', url: '/api/v1/auth/register', headers: { origin }, payload: { email, password } });
    const wrongPassword = await server.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { email, password: 'wrong-password' } });
    const missingUser = await server.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { email: `missing-${randomUUID()}@harmofin.test`, password } });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
    expect(wrongPassword.statusCode).toBe(401);
    expect(missingUser.statusCode).toBe(401);
    expect(wrongPassword.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(missingUser.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('requires CSRF for logout and revokes session after valid logout', async () => {
    const login = await server.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { email, password } });
    const cookie = login.cookies.find((item) => item.name === 'harmofin_session');
    const csrfToken = login.json<{ csrfToken: string }>().csrfToken;

    expect(cookie?.value).toEqual(expect.any(String));
    const me = await server.inject({ method: 'GET', url: '/api/v1/me', cookies: { harmofin_session: cookie?.value ?? '' } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { id: userId } });

    const blocked = await server.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin }, cookies: { harmofin_session: cookie?.value ?? '' } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: 'CSRF_INVALID' });

    const logout = await server.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin, 'x-csrf-token': csrfToken }, cookies: { harmofin_session: cookie?.value ?? '' } });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers['set-cookie']).toContain('harmofin_session=;');

    const invalid = await server.inject({ method: 'GET', url: '/api/v1/me', cookies: { harmofin_session: cookie?.value ?? '' } });
    expect(invalid.statusCode).toBe(401);
  });
});
