import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createUuidV7 } from '../src/common/identifiers/uuid-v7.js';
import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';

let app: NestFastifyApplication;
let server: FastifyInstance;

let owner: RegisteredActor;
let alia: RegisteredActor;
let bob: RegisteredActor;
let stranger: RegisteredActor;
let ownerWorkspaceId: string;
let ownerBudgetId: string;
let strangerWorkspaceId: string;

const createdUserIds = new Set<string>();

interface Actor {
  user: { id: string; email: string };
  cookie: string;
  csrfToken: string;
}

interface RegisteredActor extends Actor {
  workspaceId: string;
  budgetId: string;
}

describe('family members API', () => {
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

    owner = await register();
    ownerWorkspaceId = owner.workspaceId;
    ownerBudgetId = owner.budgetId;
    alia = await register();
    bob = await register();
    stranger = await register();
    strangerWorkspaceId = stranger.workspaceId;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { workspaceId: { in: [ownerWorkspaceId, strangerWorkspaceId] } },
    });
    await prisma.workspaceInvitation.deleteMany({
      where: { workspaceId: { in: [ownerWorkspaceId, strangerWorkspaceId] } },
    });
    const allWorkspaceIds = new Set<string>();
    for (const userId of createdUserIds) {
      const memberships = await prisma.workspaceMembership.findMany({
        where: { userId },
        select: { workspaceId: true },
      });
      for (const { workspaceId } of memberships) allWorkspaceIds.add(workspaceId);
    }
    await prisma.auditEvent.deleteMany({ where: { workspaceId: { in: [...allWorkspaceIds] } } });
    for (const userId of createdUserIds) {
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.recoveryToken.deleteMany({ where: { userId } });
      await prisma.workspaceMembership.deleteMany({ where: { userId } });
    }
    for (const workspaceId of allWorkspaceIds) {
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
    for (const userId of createdUserIds) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('lists members with the creator first and hides other families', async () => {
    await addMember(ownerWorkspaceId, alia.user.id, 'EDITOR');
    const response = await inject('GET', `/api/v1/workspaces/${ownerWorkspaceId}/members`, alia);
    expect(response.statusCode).toBe(200);
    const members = response.json<Array<{ userId: string; isCreator: boolean; role: string }>>();
    expect(members[0]).toMatchObject({ userId: owner.user.id, isCreator: true, role: 'OWNER' });
    expect(members.map((member) => member.userId)).toContain(alia.user.id);

    const foreign = await inject('GET', `/api/v1/workspaces/${ownerWorkspaceId}/members`, stranger);
    expect(foreign.statusCode).toBe(404);
  });

  it('rejects malformed path params with 400 instead of a raw database error', async () => {
    const malformedWorkspace = await inject('GET', '/api/v1/workspaces/not-a-uuid/members', owner);
    expect(malformedWorkspace.statusCode).toBe(400);

    const malformedLeave = await inject('POST', '/api/v1/workspaces/not-a-uuid/leave', owner);
    expect(malformedLeave.statusCode).toBe(400);

    const malformedMembership = await inject(
      'PATCH',
      `/api/v1/workspaces/${ownerWorkspaceId}/members/not-a-uuid`,
      owner,
      { role: 'VIEWER' },
    );
    expect(malformedMembership.statusCode).toBe(400);
  });

  it('lets only the creator change roles and never the creator role', async () => {
    const aliaMembership = await membershipOf(ownerWorkspaceId, alia.user.id);
    const byEditor = await inject(
      'PATCH',
      `/api/v1/workspaces/${ownerWorkspaceId}/members/${aliaMembership}`,
      alia,
      { role: 'VIEWER' },
    );
    expect(byEditor.statusCode).toBe(403);

    const byOwner = await inject(
      'PATCH',
      `/api/v1/workspaces/${ownerWorkspaceId}/members/${aliaMembership}`,
      owner,
      { role: 'VIEWER' },
    );
    expect(byOwner.statusCode).toBe(200);
    expect(byOwner.json()).toMatchObject({ role: 'VIEWER' });

    const ownerMembership = await membershipOf(ownerWorkspaceId, owner.user.id);
    const creator = await inject(
      'PATCH',
      `/api/v1/workspaces/${ownerWorkspaceId}/members/${ownerMembership}`,
      owner,
      { role: 'EDITOR' },
    );
    expect(creator.statusCode).toBe(409);
    expect(creator.json()).toMatchObject({ code: 'CANNOT_CHANGE_CREATOR' });
  });

  it('removes a member: access ends, notifications resolve, creator is notified', async () => {
    const aliaMembership = await membershipOf(ownerWorkspaceId, alia.user.id);
    await seedNotification(ownerWorkspaceId, ownerBudgetId, alia.user.id);
    const removed = await inject(
      'DELETE',
      `/api/v1/workspaces/${ownerWorkspaceId}/members/${aliaMembership}`,
      owner,
    );
    expect(removed.statusCode).toBe(204);

    const budgetRead = await inject('GET', `/api/v1/budgets/${ownerBudgetId}`, alia);
    expect([403, 404]).toContain(budgetRead.statusCode);
    const journal = await inject('GET', `/api/v2/budgets/${ownerBudgetId}/journal`, alia);
    expect([403, 404]).toContain(journal.statusCode);

    expect(
      await prisma.notification.count({
        where: { workspaceId: ownerWorkspaceId, userId: alia.user.id, resolvedAt: null },
      }),
    ).toBe(0);
    expect(
      await prisma.notification.count({
        where: { userId: owner.user.id, notificationType: 'MEMBER_REMOVED' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: {
          workspaceId: ownerWorkspaceId,
          entityType: 'workspace_membership',
          action: 'REMOVED',
        },
      }),
    ).toBe(1);
  });

  it('gives a member without other workspaces a personal one after leaving', async () => {
    const invitedOnly = await registerWithoutWorkspace();
    const left = await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/leave`, invitedOnly);
    expect(left.statusCode).toBe(204);

    const me = await inject('GET', '/api/v1/me', invitedOnly);
    expect(me.statusCode).toBe(200);
    const body = me.json<{
      activeWorkspaceId: string | null;
      workspaces: Array<{ id: string; isCreator: boolean }>;
    }>();
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0]!.isCreator).toBe(true);
    expect(body.workspaces[0]!.id).not.toBe(ownerWorkspaceId);
    expect(body.activeWorkspaceId).toBe(body.workspaces[0]!.id);
  });

  it('does not let the creator leave', async () => {
    const response = await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/leave`, owner);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'CANNOT_CHANGE_CREATOR' });
  });

  it('selects an accessible workspace and rejects a foreign one', async () => {
    await addMember(ownerWorkspaceId, bob.user.id, 'VIEWER');
    const selected = await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/select`, bob);
    expect(selected.statusCode).toBe(204);
    const foreign = await inject('POST', `/api/v1/workspaces/${strangerWorkspaceId}/select`, bob);
    expect(foreign.statusCode).toBe(404);
  });
});

async function register(): Promise<RegisteredActor> {
  const email = `member-${randomUUID()}@harmofin.test`;
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email, password },
  });
  const body = response.json<{
    user: { id: string; email: string };
    workspace: { id: string };
    budget: { id: string };
    csrfToken: string;
  }>();
  const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
  if (!cookie) throw new Error('Missing session cookie');
  createdUserIds.add(body.user.id);
  return {
    user: body.user,
    cookie,
    csrfToken: body.csrfToken,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
  };
}

async function registerWithoutWorkspace(): Promise<RegisteredActor> {
  const actor = await register();
  await prisma.workspace.update({ where: { id: actor.workspaceId }, data: { status: 'ARCHIVED' } });
  await addMember(ownerWorkspaceId, actor.user.id, 'EDITOR');
  return actor;
}

async function addMember(
  workspaceId: string,
  userId: string,
  role: 'EDITOR' | 'VIEWER',
): Promise<void> {
  await prisma.workspaceMembership.create({
    data: { id: createUuidV7(), workspaceId, userId, role },
  });
}

async function membershipOf(workspaceId: string, userId: string): Promise<string> {
  const membership = await prisma.workspaceMembership.findFirstOrThrow({
    where: { workspaceId, userId, isActive: true },
    select: { id: true },
  });
  return membership.id;
}

async function seedNotification(
  workspaceId: string,
  budgetId: string,
  userId: string,
): Promise<void> {
  await prisma.notification.create({
    data: {
      id: createUuidV7(),
      workspaceId,
      budgetId,
      userId,
      notificationType: 'MEMBER_JOINED',
      title: 'Тест',
      body: 'Тестовое уведомление',
      notificationKey: `test:${randomUUID()}`,
    },
  });
}

async function inject(
  method: 'GET' | 'PATCH' | 'DELETE' | 'POST',
  url: string,
  actor: Actor,
  payload?: Record<string, unknown>,
) {
  const options: InjectOptions = {
    method,
    url,
    headers: method === 'GET' ? { origin } : { origin, 'x-csrf-token': actor.csrfToken },
    cookies: { harmofin_session: actor.cookie },
  };
  if (payload !== undefined) options.payload = payload;
  return server.inject(options);
}
