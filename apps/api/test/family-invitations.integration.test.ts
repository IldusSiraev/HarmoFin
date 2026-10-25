import { randomBytes, randomUUID } from 'node:crypto';

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
const mailpitOrigin = `http://127.0.0.1:${process.env.MAILPIT_PORT ?? '8025'}`;

let app: NestFastifyApplication;
let server: FastifyInstance;

let owner: RegisteredActor;
let ownerEmail: string;
let editor: RegisteredActor;
let stranger: RegisteredActor;
let ownerWorkspaceId: string;
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

describe('family invitations API', () => {
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
    ownerEmail = owner.user.email;
    ownerWorkspaceId = owner.workspaceId;
    await setDisplayName(owner, 'Иван');
    editor = await register();
    stranger = await register();
    strangerWorkspaceId = stranger.workspaceId;
  });

  afterAll(async () => {
    const allWorkspaceIds = new Set<string>([ownerWorkspaceId, strangerWorkspaceId]);
    for (const userId of createdUserIds) {
      const memberships = await prisma.workspaceMembership.findMany({
        where: { userId },
        select: { workspaceId: true },
      });
      for (const { workspaceId } of memberships) allWorkspaceIds.add(workspaceId);
    }
    await prisma.workspaceInvitation.deleteMany({
      where: { workspaceId: { in: [...allWorkspaceIds] } },
    });
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

  it('creates an invitation, mails a fragment link and stores only the digest', async () => {
    const response = await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/invitations`, owner, {
      email: '  Alia@Harmofin.TEST ',
      role: 'EDITOR',
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{ id: string; email: string; inviteUrl: string; status: string }>();
    expect(body).toMatchObject({ email: 'alia@harmofin.test', status: 'PENDING' });
    const url = new URL(body.inviteUrl);
    expect(url.pathname).toBe('/invite');
    expect(url.search).toBe('');
    const rawToken = new URLSearchParams(url.hash.slice(1)).get('token')!;

    const stored = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: body.id } });
    expect(stored.tokenHash).not.toContain(rawToken);
    const audit = await prisma.auditEvent.findMany({ where: { entityId: body.id } });
    expect(JSON.stringify(audit)).not.toContain(rawToken);

    const mail = await latestMailpitMessage('alia@harmofin.test');
    expect(mail.Text).toContain(`/invite#token=${rawToken}`);
    expect(mail.Text).not.toContain('?token=');
  });

  it('rejects a second pending invitation for the same email', async () => {
    const response = await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/invitations`, owner, {
      email: 'alia@harmofin.test',
      role: 'VIEWER',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'INVITATION_ALREADY_PENDING' });
  });

  it('rejects an invitation for an existing member', async () => {
    const response = await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/invitations`, owner, {
      email: ownerEmail,
      role: 'EDITOR',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'ALREADY_MEMBER' });
  });

  it('resend rotates the token so the old link stops working', async () => {
    const [invitation] = await listInvitations(owner);
    const before = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation!.id } });
    const resent = await inject(
      'POST',
      `/api/v1/workspaces/${ownerWorkspaceId}/invitations/${invitation!.id}/resend`,
      owner,
    );
    expect(resent.statusCode).toBe(200);
    const after = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation!.id } });
    expect(after.tokenHash).not.toBe(before.tokenHash);
    expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
  });

  it('lists invitations without tokens and only to the creator', async () => {
    const list = await inject('GET', `/api/v1/workspaces/${ownerWorkspaceId}/invitations`, owner);
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toMatch(/token|inviteUrl/i);
    await addMember(ownerWorkspaceId, editor.user.id, 'EDITOR');
    const byEditor = await inject('GET', `/api/v1/workspaces/${ownerWorkspaceId}/invitations`, editor);
    expect(byEditor.statusCode).toBe(403);
  });

  it('cannot revoke an invitation through another workspace', async () => {
    const [invitation] = await listInvitations(owner);
    const response = await inject(
      'DELETE',
      `/api/v1/workspaces/${strangerWorkspaceId}/invitations/${invitation!.id}`,
      stranger,
    );
    expect(response.statusCode).toBe(404);
    const still = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation!.id } });
    expect(still.status).toBe('PENDING');
  });

  it('rejects malformed invitation ids with 400', async () => {
    const response = await inject(
      'DELETE',
      `/api/v1/workspaces/${ownerWorkspaceId}/invitations/not-a-uuid`,
      owner,
    );
    expect(response.statusCode).toBe(400);
  });

  it('enforces the pending invitation limit', async () => {
    await seedPendingInvitations(ownerWorkspaceId, owner.user.id, 20);
    const response = await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/invitations`, owner, {
      email: 'one-more@harmofin.test',
      role: 'EDITOR',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'INVITATION_LIMIT_REACHED' });
  });

  it('re-checks the pending limit when resending an expired invitation back into the pool', async () => {
    const actor = await register();
    await setDisplayName(actor, 'Иван');
    const expiredId = await seedExpiredInvitation(actor.workspaceId, actor.user.id, 'expired@harmofin.test');
    await seedPendingInvitations(actor.workspaceId, actor.user.id, 20);

    const response = await inject(
      'POST',
      `/api/v1/workspaces/${actor.workspaceId}/invitations/${expiredId}/resend`,
      actor,
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'INVITATION_LIMIT_REACHED' });
    const stored = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: expiredId } });
    expect(stored.status).toBe('EXPIRED');
  });

  it('maps a resend conflict with a newer pending invitation for the same email to 409', async () => {
    const actor = await register();
    await setDisplayName(actor, 'Иван');
    const email = 'dup@harmofin.test';
    const expiredId = await seedExpiredInvitation(actor.workspaceId, actor.user.id, email);
    const created = await inject('POST', `/api/v1/workspaces/${actor.workspaceId}/invitations`, actor, {
      email,
      role: 'EDITOR',
    });
    expect(created.statusCode).toBe(201);

    const response = await inject(
      'POST',
      `/api/v1/workspaces/${actor.workspaceId}/invitations/${expiredId}/resend`,
      actor,
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'INVITATION_ALREADY_PENDING' });
    const stillExpired = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: expiredId } });
    expect(stillExpired.status).toBe('EXPIRED');
  });

  it('enforces the member limit on create', async () => {
    const actor = await register();
    await setDisplayName(actor, 'Иван');
    const extraUserIds = await seedUsers(9);
    for (const userId of extraUserIds) await addMember(actor.workspaceId, userId, 'EDITOR');

    const response = await inject('POST', `/api/v1/workspaces/${actor.workspaceId}/invitations`, actor, {
      email: 'no-room@harmofin.test',
      role: 'EDITOR',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'MEMBER_LIMIT_REACHED' });
  });
});

async function register(): Promise<RegisteredActor> {
  const email = `invite-${randomUUID()}@harmofin.test`;
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

async function setDisplayName(actor: Actor, displayName: string): Promise<void> {
  await prisma.user.update({ where: { id: actor.user.id }, data: { displayName } });
}

async function addMember(workspaceId: string, userId: string, role: 'EDITOR' | 'VIEWER'): Promise<void> {
  await prisma.workspaceMembership.create({
    data: { id: createUuidV7(), workspaceId, userId, role },
  });
}

async function listInvitations(actor: Actor): Promise<Array<{ id: string }>> {
  const response = await inject('GET', `/api/v1/workspaces/${ownerWorkspaceId}/invitations`, actor);
  return response.json<Array<{ id: string }>>();
}

async function seedPendingInvitations(workspaceId: string, invitedByUserId: string, count: number): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  for (let index = 0; index < count; index += 1) {
    await prisma.workspaceInvitation.create({
      data: {
        id: createUuidV7(),
        workspaceId,
        email: `seed-${randomUUID()}@harmofin.test`,
        role: 'VIEWER',
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt,
        invitedByUserId,
      },
    });
  }
}

async function seedExpiredInvitation(
  workspaceId: string,
  invitedByUserId: string,
  email: string,
): Promise<string> {
  const id = createUuidV7();
  await prisma.workspaceInvitation.create({
    data: {
      id,
      workspaceId,
      email,
      role: 'EDITOR',
      tokenHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() - 1_000),
      status: 'EXPIRED',
      invitedByUserId,
    },
  });
  return id;
}

async function seedUsers(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = createUuidV7();
    await prisma.user.create({
      data: {
        id,
        email: `seed-user-${randomUUID()}@harmofin.test`,
        passwordHash: 'not-a-real-hash',
        status: 'ACTIVE',
      },
    });
    createdUserIds.add(id);
    ids.push(id);
  }
  return ids;
}

async function latestMailpitMessage(recipient: string): Promise<{ Text: string }> {
  const search = await fetch(
    `${mailpitOrigin}/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`,
  );
  const { messages } = (await search.json()) as { messages: Array<{ ID: string }> };
  const latest = messages[0];
  if (!latest) throw new Error(`No mail found for ${recipient}`);
  const message = await fetch(`${mailpitOrigin}/api/v1/message/${latest.ID}`);
  return (await message.json()) as { Text: string };
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
    headers:
      method === 'GET' ? { origin } : { origin, 'x-csrf-token': actor.csrfToken },
    cookies: { harmofin_session: actor.cookie },
  };
  if (payload !== undefined) options.payload = payload;
  return server.inject(options);
}
