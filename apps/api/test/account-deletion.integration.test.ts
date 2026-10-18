import { createHmac, randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { newBudgetModelData } from '../src/common/plan-model/new-budget-model.js';
import { loadApiConfig } from '../src/config/env.js';
import { purgeUserData } from '../../worker/src/account-purge.js';
import { AccountPurgeHandler } from '../../worker/src/account-purge.handler.js';

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

function digest(raw: string): string {
  return createHmac('sha256', tokenSecret).update(raw).digest('hex');
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
    for (const userId of createdUserIds) {
      await prisma.$transaction((tx) => purgeUserData(tx, userId), { timeout: 60_000 });
      await prisma.accountDeletion.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('documents the deletion request endpoint in OpenAPI', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    }>();
    expect(document.paths['/api/v1/me/deletion']).toMatchObject({
      post: {
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RequestAccountDeletionRequest' },
            },
          },
        },
        responses: {
          '202': {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AccountDeletionScheduledResponse' },
              },
            },
          },
        },
      },
    });
    expect(document.paths['/api/v1/auth/deletion/cancel']).toMatchObject({
      post: {
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CancelAccountDeletionRequest' },
            },
          },
        },
        responses: { '204': expect.any(Object) },
      },
    });
    expect(document.components?.schemas).toMatchObject({
      RequestAccountDeletionRequest: expect.any(Object),
      AccountDeletionScheduledResponse: expect.any(Object),
      CancelAccountDeletionRequest: expect.any(Object),
    });
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

  async function deleteWithKnownToken(fixture: Fixture, rawToken: string) {
    expect((await requestDeletion(fixture, { password })).statusCode).toBe(202);
    await prisma.accountDeletion.updateMany({
      where: { userId: fixture.userId, restoredAt: null, purgedAt: null },
      data: { restoreTokenHash: digest(rawToken) },
    });
  }

  function cancel(token: string) {
    return server.inject({
      method: 'POST',
      url: '/api/v1/auth/deletion/cancel',
      headers: { origin },
      payload: { token },
    });
  }

  it('restores access by a valid token exactly once', async () => {
    const fixture = await register('del-restore');
    const rawToken = `restore-${randomUUID()}`;
    await deleteWithKnownToken(fixture, rawToken);

    expect((await cancel(rawToken)).statusCode).toBe(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).status).toBe('ACTIVE');
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: fixture.workspaceId } })).status).toBe('ACTIVE');
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: fixture.budgetId } })).status).toBe('ACTIVE');
    expect((await login(fixture)).statusCode).toBe(201);

    const reused = await cancel(rawToken);
    expect(reused.statusCode).toBe(422);
    expect(reused.json()).toMatchObject({ code: 'ACCOUNT_RESTORE_TOKEN_INVALID' });
  });

  it('rejects an unknown token and an expired one', async () => {
    expect((await cancel(`unknown-${randomUUID()}`)).statusCode).toBe(422);

    const fixture = await register('del-expired');
    const rawToken = `expired-${randomUUID()}`;
    await deleteWithKnownToken(fixture, rawToken);
    await prisma.accountDeletion.updateMany({
      where: { userId: fixture.userId },
      data: { purgeAfter: new Date(Date.now() - 1_000) },
    });

    expect((await cancel(rawToken)).statusCode).toBe(422);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).status).toBe('PENDING_DELETION');
  });

  it('does not reactivate a budget that was archived before the request', async () => {
    const fixture = await register('del-prearchived');
    const oldBudgetId = randomUUID();
    await prisma.budget.create({
      data: {
        id: oldBudgetId,
        workspaceId: fixture.workspaceId,
        name: 'Старый бюджет',
        status: 'ARCHIVED',
        ...newBudgetModelData(),
      },
    });
    const rawToken = `pre-${randomUUID()}`;
    await deleteWithKnownToken(fixture, rawToken);

    expect((await cancel(rawToken)).statusCode).toBe(204);
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: oldBudgetId } })).status).toBe('ARCHIVED');
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: fixture.budgetId } })).status).toBe('ACTIVE');
  });

  async function makeDue(userId: string) {
    await prisma.accountDeletion.updateMany({
      where: { userId, restoredAt: null, purgedAt: null },
      data: { purgeAfter: new Date(Date.now() - 1_000) },
    });
  }

  it('purges every row of the owned scope and anonymizes the user, leaving others intact', async () => {
    const target = await register('del-purge');
    const bystander = await register('del-bystander');
    await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: bystander.budgetId,
        name: 'Продукты',
        categoryType: 'EXPENSE',
        displayOrder: 1,
      },
    });
    await prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId: target.budgetId,
        name: 'Карта',
        accountType: 'BANK_ACCOUNT',
        currency: 'RUB',
        scale: 2,
        startingBalanceMinor: 100_000n,
        accountingStartDate: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    expect((await requestDeletion(target, { password })).statusCode).toBe(202);
    await makeDue(target.userId);

    await new AccountPurgeHandler(prisma).execute(new Date());

    expect(await prisma.budget.count({ where: { workspaceId: target.workspaceId } })).toBe(0);
    expect(await prisma.workspace.count({ where: { id: target.workspaceId } })).toBe(0);
    expect(await prisma.account.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.category.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: target.userId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { actorUserId: target.userId } })).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    expect(user).toMatchObject({
      email: `deleted-${target.userId}@invalid`,
      passwordHash: '',
      displayName: null,
      status: 'DELETED',
    });
    expect((await prisma.accountDeletion.findFirstOrThrow({ where: { userId: target.userId } })).purgedAt).not.toBeNull();

    expect(await prisma.budget.count({ where: { id: bystander.budgetId, status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.category.count({ where: { budgetId: bystander.budgetId } })).toBeGreaterThan(0);
  });

  it('skips restored and not yet due requests and is safe to re-run', async () => {
    const restored = await register('del-skip-restored');
    const rawToken = `skip-${randomUUID()}`;
    await deleteWithKnownToken(restored, rawToken);
    await makeDue(restored.userId);
    // A restore after the deadline is rejected, so restore first, then make the row due.
    await prisma.accountDeletion.updateMany({ where: { userId: restored.userId }, data: { restoredAt: new Date() } });
    await prisma.user.update({ where: { id: restored.userId }, data: { status: 'ACTIVE' } });

    const pending = await register('del-skip-pending');
    expect((await requestDeletion(pending, { password })).statusCode).toBe(202);

    const handler = new AccountPurgeHandler(prisma);
    await handler.execute(new Date());
    await handler.execute(new Date());

    expect(await prisma.budget.count({ where: { id: restored.budgetId } })).toBe(1);
    expect(await prisma.budget.count({ where: { id: pending.budgetId } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: pending.userId } })).status).toBe('PENDING_DELETION');
  });

});
